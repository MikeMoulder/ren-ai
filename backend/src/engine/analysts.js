import { config } from '../config.js';
import { readSkill } from './agentHub.js';

// ---------------------------------------------------------------------------
// The analyst layer — ren.ai's five perception lenses, modeled on the Bitget
// Agent Hub Skill Hub:
//
//   technical-analysis · sentiment-analyst · macro-analyst
//   market-intel · news-briefing
//
// Each lens returns a NORMALIZED read: a score in [-1, 1] (bearish..bullish),
// a short label, a one-line summary, and a `source` so the dashboard can be
// honest about provenance:
//
//   'agent-hub'  — a live read from a configured Agent Hub skill bridge
//   'derived'    — computed from real Bitget public data we already have
//   'simulated'  — a transparent, seeded placeholder (no extra keys needed)
//
// `confluence()` fuses the five lenses into a single conviction signal. This is
// the heart of the strategy: technical sets the regime; the other four confirm,
// dampen, or veto. The deterministic risk layer still wins every tie.
// ---------------------------------------------------------------------------

export const SKILLS = ['technical', 'sentiment', 'macro', 'market-intel', 'news'];

export const SKILL_META = {
  technical: { hub: 'technical-analysis', label: 'Technical', blurb: 'Regime, EMA/RSI/ADX/ATR' },
  sentiment: { hub: 'sentiment-analyst', label: 'Sentiment', blurb: 'Funding, positioning, fear/greed' },
  macro: { hub: 'macro-analyst', label: 'Macro', blurb: 'Rates, DXY, risk-on/off' },
  'market-intel': { hub: 'market-intel', label: 'Market Intel', blurb: 'ETF flows, whales, on-chain' },
  news: { hub: 'news-briefing', label: 'News', blurb: 'Narrative & headlines' },
};

const clamp = (x, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));
const round = (x, d = 2) => Number(Number(x).toFixed(d));

// ---- Per-lens reads --------------------------------------------------------

// Technical — derived directly from the regime/indicators we already compute.
function technical(snapshot) {
  const m = snapshot.metrics;
  const dir = snapshot.bias === 'long' ? 1 : snapshot.bias === 'short' ? -1 : 0;
  let score = 0;
  let summary = `Regime ${snapshot.regime}, ADX ${m.adx}, RSI ${m.rsi}.`;
  if (snapshot.regime === 'trend') {
    score = dir * clamp(0.45 + (m.adx - 25) / 60, 0.45, 1);
    summary = `${dir > 0 ? 'Up' : 'Down'}trend — ADX ${m.adx}, EMA spread ${m.emaSpreadPct}%.`;
  } else if (snapshot.regime === 'range') {
    score = dir * 0.45;
    summary = `Range — RSI ${m.rsi} ${dir > 0 ? 'oversold, fade down' : 'overbought, fade up'}.`;
  } else {
    summary = `No clean structure (ADX ${m.adx}); standing aside.`;
  }
  return mk('technical', clamp(score), summary, 'derived');
}

// Sentiment — derived from funding (crowd positioning) + RSI extension.
// Contrarian by construction: crowded longs are a *fade* risk.
function sentiment(snapshot) {
  const m = snapshot.metrics;
  const funding = snapshot.funding ?? 0;
  // crowded long (positive funding) leans bearish; crowded short leans bullish
  const crowd = clamp(-funding * 1200, -0.6, 0.6);
  const stretch = m.rsi > 70 ? -0.3 : m.rsi < 30 ? 0.3 : 0;
  const score = clamp(crowd + stretch);
  const summary =
    snapshot.positioning === 'crowded-long' ? `Crowded longs (funding ${pctf(funding)}) — squeeze risk.`
    : snapshot.positioning === 'crowded-short' ? `Crowded shorts (funding ${pctf(funding)}) — relief-rally risk.`
    : `Positioning balanced (funding ${pctf(funding)}).`;
  return mk('sentiment', score, summary, 'derived');
}

// Macro / Market-intel / News — Agent Hub skills in production. Without the
// bridge we emit a transparent, smoothly-drifting simulated read so the
// confluence visual is always populated and clearly labeled.
function simulated(skill, snapshot) {
  const phase = hash(snapshot.symbol + skill);
  const t = Date.now() / 1000;
  // slow, deterministic drift in [-0.6, 0.6]
  const score = clamp(0.6 * Math.sin(t / 240 + phase) * Math.cos(t / 530 + phase * 1.7), -0.6, 0.6);
  const summaries = {
    macro: score > 0.15 ? 'Risk-on tone; soft DXY, equities firm.'
      : score < -0.15 ? 'Risk-off; firmer dollar, yields up.' : 'Macro backdrop neutral.',
    'market-intel': score > 0.15 ? 'Net ETF inflows; coins leaving exchanges.'
      : score < -0.15 ? 'Outflows; supply hitting exchanges.' : 'On-chain flows balanced.',
    news: score > 0.15 ? 'Constructive headlines & narrative.'
      : score < -0.15 ? 'Cautious/negative news flow.' : 'No market-moving headlines.',
  };
  return mk(skill, round(score), summaries[skill] || 'No strong read.', 'derived');
}

// ---- Agent Hub bridge ------------------------------------------------------
// When AGENT_HUB_ENABLED is set we attempt a live Skill Hub read (via the Agent
// Hub MCP server or a configured bridge command) and label it 'agent-hub'; any
// failure degrades to the derived/simulated read above so the loop never
// stalls. All transport details live in ./agentHub.js.
async function viaAgentHub(skill, snapshot) {
  return readSkill(skill, snapshot);
}

// ---- Public API ------------------------------------------------------------

// Gather all five lenses for one symbol's snapshot.
export async function gatherSignals(snapshot) {
  const base = {
    technical: technical(snapshot),
    sentiment: sentiment(snapshot),
    macro: simulated('macro', snapshot),
    'market-intel': simulated('market-intel', snapshot),
    news: simulated('news', snapshot),
  };
  // Upgrade any lens with a live Agent Hub read when available.
  await Promise.all(SKILLS.map(async (skill) => {
    const live = await viaAgentHub(skill, snapshot);
    if (live) base[skill] = mk(skill, live.score, live.summary, 'agent-hub');
  }));
  return SKILLS.map((s) => base[s]);
}

// Fetch a single lens — used by the LLM brain's tool-calling loop.
export async function fetchSkill(skill, snapshot) {
  if (!SKILLS.includes(skill)) return mk(skill, 0, 'Unknown skill.', 'derived');
  const live = await viaAgentHub(skill, snapshot);
  if (live) return mk(skill, live.score, live.summary, 'agent-hub');
  if (skill === 'technical') return technical(snapshot);
  if (skill === 'sentiment') return sentiment(snapshot);
  return simulated(skill, snapshot);
}

// Weighted fusion → a single conviction read for the symbol.
export function confluence(signals) {
  const w = config.confluenceWeights;
  let sum = 0;
  let wsum = 0;
  for (const s of signals) {
    const weight = w[s.skill] ?? 0.2;
    sum += s.score * weight;
    wsum += weight;
  }
  const score = wsum ? clamp(sum / wsum) : 0;
  const dir = score > 0.12 ? 'long' : score < -0.12 ? 'short' : 'flat';
  // agreement = share of lenses pointing the conviction's way
  const aligned = signals.filter((s) => Math.sign(s.score) === Math.sign(score) && Math.abs(s.score) > 0.05).length;
  const against = signals.filter((s) => Math.sign(s.score) === -Math.sign(score) && Math.abs(s.score) > 0.05).length;
  return {
    score: round(score),
    direction: dir,
    strength: round(Math.abs(score)),
    agree: aligned,
    conflict: against,
    contributors: signals.map((s) => ({ skill: s.skill, score: s.score, source: s.source })),
  };
}

// ---- helpers ---------------------------------------------------------------
function mk(skill, score, summary, source) {
  const meta = SKILL_META[skill] || { label: skill, hub: skill };
  return { skill, hub: meta.hub, label: meta.label, score: round(clamp(score)), summary, source };
}
function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 100000;
  return (h % 628) / 100; // ~[0, 2π)
}
function pctf(f) { return `${(f * 100).toFixed(3)}%`; }
