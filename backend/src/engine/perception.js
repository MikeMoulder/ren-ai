import { getTicker, getCandles } from '../bitget/publicClient.js';
import { classifyRegime } from './indicators.js';
import { gatherSignals, confluence } from './analysts.js';
import { detectSetup, planTrade } from './strategies/mm30.js';
import { trendSignal, planTrade as planTrend } from './strategies/trendBreakout.js';
import { config } from '../config.js';

// Evaluate the MM30 setup on the latest CLOSED candle. The candle array's last
// element is the still-forming bar, so B = candles[n-2], A = candles[n-3]. We
// enter at the current mark price (≈ the open of the forming bar = candle C).
function mm30Signal(candles, price) {
  if (!config.mm30.enabled) return { active: false };
  const i = candles.length - 2; // last fully closed candle (= B)
  const setup = detectSetup(candles, i, { ...config.mm30, beAtR: 99 });
  if (!setup) return { active: false };
  const plan = planTrade(setup, price);
  if (!plan) return { active: false };
  return {
    active: true,
    side: plan.side,
    entry: plan.entry,
    stop: plan.stop,
    takeProfit: plan.takeProfit,
    risk: Number(plan.risk.toFixed(6)),
    riskPct: Number(plan.riskPct.toFixed(3)),
  };
}

// Evaluate the Trend-Breakout signal on the latest CLOSED candle and turn it
// into a concrete plan (initial stop + trailing distance) at the current price.
function trendSig(candles, price) {
  if (!config.trend.enabled) return { active: false };
  const sig = trendSignal(candles, candles.length - 2, config.trend);
  if (!sig.active) return { active: false };
  const plan = planTrend(sig, price, config.trend);
  if (!plan) return { active: false };
  return {
    active: true,
    side: plan.side,
    stop: plan.stop,
    trailDist: plan.trailDist,
    trailMult: plan.trailMult,
    strategy: 'trend',
  };
}

// ---------------------------------------------------------------------------
// The agent's "senses". For each symbol we fetch live candles + ticker and
// distill them into a compact, model-friendly snapshot: regime, directional
// bias, key indicator values, funding (a positioning/sentiment proxy).
//
// We then run the five Agent Hub analyst lenses (technical, sentiment, macro,
// market-intel, news) over the snapshot and fuse them into a `confluence`
// conviction read — the multi-signal core of the strategy.
// ---------------------------------------------------------------------------

export async function perceive() {
  const snapshots = [];
  let dataSource = 'live';

  for (const symbol of config.symbols) {
    const [{ candles, source }, ticker] = await Promise.all([
      getCandles(symbol, config.candleLookback),
      getTicker(symbol),
    ]);
    if (source !== 'live' || ticker.source !== 'live') dataSource = 'synthetic';

    const closes = candles.map((c) => c.c);
    const regime = classifyRegime({ closes, candles });

    // Funding sign as a crowd-positioning signal: very positive funding =>
    // crowded longs (fade risk); very negative => crowded shorts.
    const funding = ticker.fundingRate ?? 0;
    const positioning =
      funding > 0.0003 ? 'crowded-long' : funding < -0.0003 ? 'crowded-short' : 'balanced';

    const snapshot = {
      symbol,
      price: ticker.price,
      change24h: ticker.change24h,
      regime: regime.regime,
      bias: regime.bias,
      metrics: regime.metrics,
      funding: Number(funding.toFixed?.(6) ?? funding),
      positioning,
      mm30: mm30Signal(candles, ticker.price), // MM30 pattern trigger (off unless enabled)
      trend: trendSig(candles, ticker.price), // Trend-Breakout signal (off unless enabled)
      signals: [], // five analyst lenses, filled below
      confluence: null, // fused conviction read
    };

    // Run the five analyst lenses and fuse them.
    snapshot.signals = await gatherSignals(snapshot);
    snapshot.confluence = confluence(snapshot.signals);

    snapshots.push(snapshot);
  }

  return { at: Date.now(), dataSource, snapshots };
}
