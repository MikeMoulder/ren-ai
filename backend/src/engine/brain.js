import { config, llmEnabled, LLM_BASE_URLS } from '../config.js';
import { log } from '../logger.js';
import { fetchSkill, SKILLS, SKILL_META } from './analysts.js';

// ---------------------------------------------------------------------------
// The reasoning core. ren.ai weighs five Agent Hub analyst lenses into a single
// conviction and acts on it. We prefer an LLM that *calls the skills as tools*
// (so the model decides which lenses to consult and how to weigh conflict — the
// thing only an agent can do), and fall back to a transparent confluence rule
// engine when no key is set, so the system is always runnable and explainable.
//
// Decision schema (per symbol):
//   { symbol, action: open_long|open_short|close|hold,
//     conviction: 0..1, sizePct: 0..1, reason: string }
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are ren.ai, an autonomous crypto perpetual-futures trading agent on Bitget.
You manage a single USDT-margined account and your decisions are mirrored to subscribers.

Your method: multi-signal confluence. You have five analyst skills from the Bitget Agent Hub —
technical, sentiment, macro, market-intel, news. Technical sets the regime (follow strong trends,
mean-revert in ranges, stand aside when unclear); the other four confirm, dampen, or veto.
Call the skill tools you need to read the market, then decide. Capital preservation first:
prefer "hold" when the lenses disagree or edge is thin. One position per symbol.

When done gathering reads, respond with STRICT JSON only, no prose, of the form:
{"decisions":[{"symbol":"BTCUSDT","action":"open_long","conviction":0.0,"sizePct":0.0,"reason":"..."}]}
Rules:
- action ∈ open_long, open_short, close, hold.
- conviction ∈ [0,1]; sizePct ∈ [0,1] (fraction of the per-trade risk budget).
- If you already hold the right-direction position, prefer "hold". Only "open_*" when flat.
- reason: one concise sentence naming the deciding signals (e.g. "technical + sentiment long, macro neutral").`;

// Skill tools exposed to the model (OpenAI function-calling shape).
const TOOLS = SKILLS.map((skill) => ({
  type: 'function',
  function: {
    name: `read_${skill.replace('-', '_')}`,
    description: `Bitget Agent Hub "${SKILL_META[skill].hub}" skill — ${SKILL_META[skill].blurb}. Returns a normalized score in [-1,1] (bearish..bullish) with a summary.`,
    parameters: {
      type: 'object',
      properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT' } },
      required: ['symbol'],
    },
  },
}));

const TOOL_TO_SKILL = Object.fromEntries(SKILLS.map((s) => [`read_${s.replace('-', '_')}`, s]));

export async function decide({ perception, positions, equity, risk }) {
  if (!llmEnabled) {
    return { source: 'confluence-rules', decisions: ruleBrain(perception, positions) };
  }
  try {
    const decisions = await llmDecide({ perception, positions, equity, risk });
    return { source: `llm:${config.llm.model}`, decisions };
  } catch (e) {
    log.warn('LLM decide failed, using confluence rules:', e.message);
    return { source: 'confluence-rules(fallback)', decisions: ruleBrain(perception, positions) };
  }
}

async function llmDecide({ perception, positions, equity, risk }) {
  const snapBySymbol = Object.fromEntries(perception.snapshots.map((s) => [s.symbol, s]));
  const userPayload = {
    equity,
    riskLimits: risk,
    openPositions: Object.values(positions).map((p) => ({
      symbol: p.symbol, side: p.side, size: p.size, entry: p.entry, uPnl: p.uPnl,
    })),
    // Compact market view + the pre-computed confluence so the model has a
    // baseline; it can still call the skill tools for fresh per-lens reads.
    market: perception.snapshots.map((s) => ({
      symbol: s.symbol, price: s.price, regime: s.regime, bias: s.bias,
      confluence: s.confluence, metrics: s.metrics, positioning: s.positioning,
      // Mechanical strategy triggers (only present when enabled) — advisory.
      ...(config.mm30.enabled && s.mm30?.active
        ? { mm30: { side: s.mm30.side, entry: s.mm30.entry, stop: s.mm30.stop, takeProfit: s.mm30.takeProfit, riskPct: s.mm30.riskPct } }
        : {}),
      ...(config.trend.enabled && s.trend?.active
        ? { trendBreakout: { side: s.trend.side, stop: s.trend.stop, trail: `${s.trend.trailMult}xATR` } }
        : {}),
    })),
    dataSource: perception.dataSource,
  };

  let stratNote = '';
  if (config.mm30.enabled) stratNote += `\n\nA mechanical "mm30" trigger may appear on a symbol (2-candle continuation). Treat it as an extra signal: only act on it when the confluence lenses do not oppose its side. If you open in the mm30 direction, the system uses mm30's stop/takeProfit.`;
  if (config.trend.enabled) stratNote += `\n\nA "trendBreakout" trigger may appear (EMA-trend + breakout, the validated edge). Prefer acting on it in its side unless confluence opposes. If you open in its direction the system applies a trailing stop (no fixed take-profit) — so let winners run and do not "close" early on minor wobbles.`;
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT + stratNote },
    { role: 'user', content: `Snapshot:\n${JSON.stringify(userPayload)}\n\nConsult skills as needed, then return the JSON decision object.` },
  ];

  // Tool-calling loop: let the model pull skill reads, fulfil them, repeat.
  for (let round = 0; round < 3; round++) {
    const msg = await chat(messages, round === 0 ? TOOLS : undefined);
    messages.push(msg);
    const calls = msg.tool_calls || [];
    if (!calls.length) {
      const parsed = extractJSON(msg.content ?? '');
      return attachMm30Plans(sanitize(Array.isArray(parsed?.decisions) ? parsed.decisions : [], perception), perception);
    }
    for (const call of calls) {
      const skill = TOOL_TO_SKILL[call.function?.name];
      let result = { error: 'unknown skill' };
      try {
        const args = JSON.parse(call.function?.arguments || '{}');
        const snap = snapBySymbol[args.symbol] || perception.snapshots[0];
        const read = await fetchSkill(skill, snap);
        result = { skill: read.skill, score: read.score, summary: read.summary, source: read.source };
      } catch (e) {
        result = { error: e.message };
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  // Out of rounds — make one final non-tool call for the decision.
  const final = await chat([...messages, { role: 'user', content: 'Return the JSON decision object now.' }]);
  const parsed = extractJSON(final.content ?? '');
  return attachMm30Plans(sanitize(Array.isArray(parsed?.decisions) ? parsed.decisions : [], perception), perception);
}

// When the LLM opens in the same direction as an active mechanical signal, ride
// that signal's concrete plan (otherwise risk.js falls back to its ATR stop).
function attachMm30Plans(decisions, perception) {
  const bySymbol = Object.fromEntries(perception.snapshots.map((s) => [s.symbol, s]));
  for (const d of decisions) {
    const want = d.action === 'open_long' ? 'long' : d.action === 'open_short' ? 'short' : null;
    if (!want) continue;
    const snap = bySymbol[d.symbol];
    if (config.trend.enabled && snap?.trend?.active && snap.trend.side === want) {
      d.plan = { stop: snap.trend.stop }; // trailing only, no fixed TP
      d.strategy = 'trend';
      d.trailDist = snap.trend.trailDist;
    } else if (config.mm30.enabled && snap?.mm30?.active && snap.mm30.side === want) {
      d.plan = { stop: snap.mm30.stop, takeProfit: snap.mm30.takeProfit };
    }
  }
  return decisions;
}

async function chat(messages, tools) {
  const baseUrl = config.llm.baseUrl || LLM_BASE_URLS[config.llm.provider] || LLM_BASE_URLS.openrouter;
  const body = { model: config.llm.model, temperature: 0.4, messages };
  if (tools) { body.tools = tools; body.tool_choice = 'auto'; }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llm.apiKey}`,
        'HTTP-Referer': 'https://github.com/ren-ai-agent',
        'X-Title': 'ren.ai Trading Agent',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 180)}`);
    const j = await res.json();
    return j.choices?.[0]?.message ?? { content: '' };
  } finally {
    clearTimeout(timer);
  }
}

function extractJSON(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

function sanitize(decisions, perception) {
  const valid = new Set(perception.snapshots.map((s) => s.symbol));
  const actions = new Set(['open_long', 'open_short', 'close', 'hold']);
  return decisions
    .filter((d) => d && valid.has(d.symbol) && actions.has(d.action))
    .map((d) => ({
      symbol: d.symbol,
      action: d.action,
      conviction: clamp(Number(d.conviction) || 0, 0, 1),
      sizePct: clamp(Number(d.sizePct) || 0, 0, 1),
      reason: String(d.reason || '').slice(0, 240),
    }));
}

// ---- Transparent confluence rule brain (deterministic fallback) -----------
// Reads the same multi-signal confluence the LLM sees, so even keyless mode
// produces multi-signal reasoning the dashboard can render.
function ruleBrain(perception, positions) {
  return perception.snapshots.map((s) => {
    const pos = positions[s.symbol];
    const c = s.confluence || { direction: 'flat', score: 0, agree: 0, conflict: 0 };
    const sig = signalText(s);

    // Manage an open position first.
    if (pos) {
      // Trend trades exit purely on their trailing stop — never close on a
      // confluence wobble (cutting winners early is what breaks trend-following).
      if (pos.strategy === 'trend') return d(s.symbol, 'hold', 0.5, 0, `Holding ${pos.side} trend: trailing stop manages exit.`);
      const wrongWay =
        (pos.side === 'long' && c.direction === 'short') ||
        (pos.side === 'short' && c.direction === 'long');
      if (wrongWay) return d(s.symbol, 'close', 0.6, 0, `Confluence flipped to ${c.direction} (${sig}); exit ${pos.side}.`);
      return d(s.symbol, 'hold', 0.5, 0, `Holding ${pos.side}: confluence ${c.score} (${sig}).`);
    }

    // Flat — choose the entry trigger.
    if (config.trend.enabled) return trendEntry(s, c, sig);
    if (config.mm30.enabled) return mm30Entry(s, c, sig);

    // Default: act when technical has a regime AND confluence agrees.
    const techDirectional = s.regime !== 'unclear' && s.bias !== 'flat';
    if (techDirectional && c.direction === 'long' && s.bias === 'long') {
      return d(s.symbol, 'open_long', conv(c), size(c, s), `Long confluence ${c.score} (${sig}); ${c.agree} lenses agree.`);
    }
    if (techDirectional && c.direction === 'short' && s.bias === 'short') {
      return d(s.symbol, 'open_short', conv(c), size(c, s), `Short confluence ${c.score} (${sig}); ${c.agree} lenses agree.`);
    }
    return d(s.symbol, 'hold', 0.3, 0, `Edge unclear: regime ${s.regime}, confluence ${c.score} (${sig}).`);
  });
}

// Trend-Breakout entry: EMA-trend + breakout fires the trigger; confluence may
// veto if it opposes. Carries the initial stop + trailing distance so risk.js
// sizes to the stop and the live loop ratchets it. No fixed take-profit.
function trendEntry(s, c, sig) {
  const t = s.trend || { active: false };
  if (!t.active) return d(s.symbol, 'hold', 0.3, 0, `No trend breakout (regime ${s.regime}).`);

  const opposed = c.direction === (t.side === 'long' ? 'short' : 'long');
  if (config.trend.requireConfluence && opposed) {
    return d(s.symbol, 'hold', 0.3, 0, `Trend ${t.side} vetoed: confluence ${c.score} opposes (${sig}).`);
  }
  const agree = c.direction === t.side;
  const conviction = clamp(0.5 + (agree ? c.strength * 0.4 : 0) - c.conflict * 0.05, 0.5, 0.95);
  const action = t.side === 'long' ? 'open_long' : 'open_short';
  const decision = d(s.symbol, action, conviction, 0.7,
    `Trend-breakout ${t.side} (trail ${t.trailMult}×ATR, SL ${round2(t.stop)}); ${agree ? `confluence ${c.score} agrees` : `confluence neutral (${c.score})`}.`);
  decision.plan = { stop: t.stop }; // no takeProfit → trailing-stop exit only
  decision.strategy = 'trend';
  decision.trailDist = t.trailDist;
  return decision;
}

// MM30 entry: the 2-candle pattern fires the trigger; the confluence lenses
// confirm or veto. Walk-forward showed the mechanical edge is weak, so the
// confluence gate (must not OPPOSE the pattern) is what earns the trade. The
// concrete stop/TP from the MM30 plan rides along so risk.js sizes to it.
function mm30Entry(s, c, sig) {
  const mm = s.mm30 || { active: false };
  if (!mm.active) return d(s.symbol, 'hold', 0.3, 0, `No MM30 setup (regime ${s.regime}).`);

  const opposed = c.direction === (mm.side === 'long' ? 'short' : 'long');
  if (config.mm30.requireConfluence && opposed) {
    return d(s.symbol, 'hold', 0.3, 0, `MM30 ${mm.side} vetoed: confluence ${c.score} opposes (${sig}).`);
  }
  const agree = c.direction === mm.side;
  // Baseline conviction clears the risk gate; confluence agreement adds to it.
  const conviction = clamp(0.5 + (agree ? c.strength * 0.4 : 0) - c.conflict * 0.05, 0.5, 0.95);
  const action = mm.side === 'long' ? 'open_long' : 'open_short';
  const note = agree ? `confluence ${c.score} agrees` : `confluence neutral (${c.score})`;
  const decision = d(s.symbol, action, conviction, 0.7,
    `MM30 ${mm.side} @ ${mm.entry} (SL ${mm.stop}, ${mm.riskPct}% risk); ${note} (${sig}).`);
  decision.plan = { stop: mm.stop, takeProfit: mm.takeProfit }; // honored by risk.js
  return decision;
}

function signalText(s) {
  return (s.signals || [])
    .filter((x) => Math.abs(x.score) > 0.15)
    .map((x) => `${x.label} ${x.score > 0 ? '+' : ''}${x.score}`)
    .join(', ') || 'mixed';
}

const d = (symbol, action, conviction, sizePct, reason) => ({ symbol, action, conviction, sizePct, reason });
const conv = (c) => clamp(0.4 + c.strength * 0.55 - c.conflict * 0.08, 0.4, 0.95);
const size = (c, s) => clamp(0.4 + c.strength * 0.6 - s.metrics.atrPct / 12, 0.3, 1);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const round2 = (x) => Math.round(x * 100) / 100;
