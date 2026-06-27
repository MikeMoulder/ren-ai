import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { log } from '../logger.js';
import { McpStdioClient } from './mcpClient.js';

// ---------------------------------------------------------------------------
// Bitget Agent Hub bridge.
//
// Turns a live Agent Hub Skill Hub read into the normalized lens shape the
// confluence engine expects: { score ∈ [-1,1], summary }.
//
// Two transports, both optional and pluggable:
//   • MCP mode      — talk JSON-RPC to the Agent Hub MCP server
//                     (default `npx -y bitget-mcp-server`) and call the analyst
//                     tool that matches each skill.
//   • Command mode  — spawn a user-supplied bridge command per read, passing
//                     {skill,hub,symbol,snapshot} on stdin, expecting
//                     {score,summary} JSON on stdout. Lets a deployment wire the
//                     hub however it likes (a shell script, a Python client…).
//
// Every read is best-effort: any failure returns null and the caller falls back
// to the derived/simulated lens, so the trading loop never stalls. A short TTL
// cache keeps one perceive cycle from spawning the same read five times, and a
// `lastLiveAt` timestamp lets the dashboard report whether the hub is genuinely
// live (not merely configured).
// ---------------------------------------------------------------------------

// Skill -> Agent Hub Skill Hub name. Mirrors SKILL_META in analysts.js but kept
// local so the bridge has no import cycle.
const SKILL_HUB = {
  technical: 'technical-analysis',
  sentiment: 'sentiment-analyst',
  macro: 'macro-analyst',
  'market-intel': 'market-intel',
  news: 'news-briefing',
};

const clamp = (x, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));

let mcp = null;          // lazily-created McpStdioClient
let toolMap = null;      // skill -> resolved MCP tool descriptor
let lastLiveAt = 0;      // ms timestamp of the most recent successful live read
const cache = new Map(); // `${skill}:${symbol}` -> { at, value }

function cacheTtlMs() {
  // Refresh roughly once per perceive cycle; never hammer the hub.
  return Math.max(15000, (config.loopSeconds || 30) * 1000 * 0.8);
}

export function hubStatus() {
  const enabled = config.agentHub.enabled;
  const live = enabled && Date.now() - lastLiveAt < 3 * 60 * 1000;
  return { enabled, live, lastLiveAt: lastLiveAt || null };
}

// Public entry point used by the analyst layer.
export async function readSkill(skill, snapshot) {
  if (!config.agentHub.enabled) return null;
  const key = `${skill}:${snapshot.symbol}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < cacheTtlMs()) return hit.value;

  let value = null;
  try {
    value = config.agentHub.command
      ? await viaCommand(skill, snapshot)
      : await viaMcp(skill, snapshot);
  } catch (e) {
    log.warn(`Agent Hub read failed (${skill}/${snapshot.symbol}):`, e.message);
    value = null;
  }
  if (value) lastLiveAt = Date.now();
  cache.set(key, { at: Date.now(), value });
  return value;
}

// ---- Command transport -----------------------------------------------------
function viaCommand(skill, snapshot) {
  const [cmd, ...args] = config.agentHub.command.split(/\s+/).filter(Boolean);
  const payload = JSON.stringify({
    skill, hub: SKILL_HUB[skill], symbol: snapshot.symbol, snapshot,
  });
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...hubEnv() } });
    let out = '';
    const timer = setTimeout(() => { try { child.kill(); } catch {} resolve(null); }, 25000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', () => {});
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(normalize(out));
    });
    child.stdin.end(payload);
  });
}

// ---- MCP transport ---------------------------------------------------------
function getMcp() {
  if (!mcp) {
    mcp = new McpStdioClient(config.agentHub.mcpCommand, { env: hubEnv() });
  }
  return mcp;
}

async function resolveToolMap() {
  if (toolMap) return toolMap;
  const tools = await getMcp().listTools();
  toolMap = {};
  for (const [skill, hub] of Object.entries(SKILL_HUB)) {
    // Match the analyst tool by hub name or skill keyword in the tool name.
    const needle = hub.replace(/-/g, '');
    const kw = skill.replace(/-/g, '');
    const found = tools.find((t) => {
      const n = String(t.name || '').toLowerCase().replace(/[-_]/g, '');
      return n.includes(needle) || n.includes(kw);
    });
    if (found) toolMap[skill] = found;
  }
  const missing = Object.keys(SKILL_HUB).filter((s) => !toolMap[s]);
  if (missing.length) log.warn('Agent Hub MCP: no tool matched for', missing.join(', '));
  return toolMap;
}

async function viaMcp(skill, snapshot) {
  const map = await resolveToolMap();
  const tool = map[skill];
  if (!tool) return null;
  const res = await getMcp().callTool(tool.name, buildArgs(tool, snapshot));
  if (res?.isError) return null;
  return normalizeMcpResult(res);
}

// Fill the tool's declared input schema with what we know (symbol/asset/etc.).
function buildArgs(tool, snapshot) {
  const props = tool.inputSchema?.properties || {};
  const base = snapshot.symbol.replace(/USDT$|USD$|-.*$/i, '');
  const args = {};
  for (const name of Object.keys(props)) {
    const n = name.toLowerCase();
    if (/(symbol|ticker|pair|instrument)/.test(n)) args[name] = snapshot.symbol;
    else if (/(asset|coin|token|base|currency)/.test(n)) args[name] = base;
    else if (/(timeframe|interval|granularity|period)/.test(n)) args[name] = '4h';
  }
  // Always include a symbol hint even if the schema is permissive/empty.
  if (!Object.keys(args).length) args.symbol = snapshot.symbol;
  return args;
}

function normalizeMcpResult(res) {
  // Prefer structured output; otherwise distill the analyst's text.
  const sc = res?.structuredContent;
  if (sc && (typeof sc.score === 'number' || typeof sc.score === 'string')) {
    return { score: clamp(Number(sc.score)), summary: trim(sc.summary || textOf(res)) };
  }
  return normalize(textOf(res));
}

function textOf(res) {
  return (res?.content || [])
    .filter((c) => c?.type === 'text' && c.text)
    .map((c) => c.text)
    .join('\n');
}

// ---- Score extraction ------------------------------------------------------
// Accepts either {score,summary} JSON or free analyst prose and produces a
// normalized lens read. Prose is scored by an explicit score:/rating: field if
// present, else a bullish/bearish lexical lean — transparently approximate.
function normalize(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  if (!text) return null;

  // 1) Structured {score, summary}.
  try {
    const j = JSON.parse(text);
    if (j && (typeof j.score === 'number' || typeof j.score === 'string')) {
      return { score: clamp(Number(j.score)), summary: trim(j.summary || j.text || '') };
    }
  } catch {}

  // 2) An explicit "score: 0.4" / "rating: -0.2" in the prose.
  const m = text.match(/\b(?:score|rating|signal)\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);
  if (m) {
    let v = Number(m[1]);
    if (Math.abs(v) > 1) v = v / (Math.abs(v) > 10 ? 100 : 10); // tolerate 0..100 / 0..10 scales
    return { score: clamp(v), summary: trim(text) };
  }

  // 3) Fallback: lexical lean from the analyst summary.
  return { score: lexicalScore(text), summary: trim(text) };
}

const BULL = /\b(bull(?:ish)?|long|buy|accumulat|inflow|risk-?on|breakout|upside|strong|rally|support holds?)\b/gi;
const BEAR = /\b(bear(?:ish)?|short|sell|distribut|outflow|risk-?off|breakdown|downside|weak|dump|selloff|resistance)\b/gi;
function lexicalScore(text) {
  const b = (text.match(BULL) || []).length;
  const s = (text.match(BEAR) || []).length;
  if (b + s === 0) return 0;
  return clamp(((b - s) / (b + s)) * 0.6); // cap the confidence of a lexical read
}

function trim(s) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 200); }

function hubEnv() {
  // The hub authenticates to Bitget with the agent's own keys.
  return {
    BITGET_API_KEY: config.bitget.apiKey,
    BITGET_SECRET_KEY: config.bitget.secretKey,
    BITGET_PASSPHRASE: config.bitget.passphrase,
  };
}
