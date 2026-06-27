import { ema, atr } from '../indicators.js';

// ---------------------------------------------------------------------------
// Trend-Breakout strategy — the one that actually backtests positive.
//
//   Filter : trade only WITH the higher trend  (EMA fast > EMA slow = up)
//   Entry  : price breaks the highest high (long) / lowest low (short) of the
//            last `breakoutLen` candles
//   Exit   : a chandelier TRAILING stop — initial stop = trailMult * ATR away,
//            then ratcheted in our favour every bar. No fixed take-profit:
//            losers are cut at ~1R, winners are left to run. That asymmetry is
//            the whole edge (low win-rate, large average winner).
//
// Pure & deterministic: `trendSignal` evaluates a closed candle, `planTrade`
// turns a signal + entry price into a concrete plan, and `nextTrailStop` is the
// single trailing-stop formula shared by the backtester and the live loop.
// candle shape: { t, o, h, l, c, v }
// ---------------------------------------------------------------------------

export const TREND_DEFAULTS = {
  emaFast: 50,
  emaSlow: 200,
  breakoutLen: 10,
  atrPeriod: 14,
  trailMult: 3, // initial stop & trailing distance = trailMult * ATR
};

// Evaluate the strategy on candle index `i` (must be a CLOSED candle).
// Returns { active, side, atr } — atr is the volatility unit for the stop.
export function trendSignal(candles, i, opts = {}) {
  const o = { ...TREND_DEFAULTS, ...opts };
  if (i < o.emaSlow || i < o.breakoutLen || i >= candles.length) return { active: false };
  const closes = candles.map((c) => c.c);
  const ef = ema(closes, o.emaFast);
  const es = ema(closes, o.emaSlow);
  const fast = ef[i];
  const slow = es[i];
  if (fast == null || slow == null) return { active: false };
  const a = atr(candles.slice(0, i + 1), o.atrPeriod);
  if (!a) return { active: false };

  let hh = -Infinity;
  let ll = Infinity;
  for (let k = i - o.breakoutLen; k < i; k++) {
    if (candles[k].h > hh) hh = candles[k].h;
    if (candles[k].l < ll) ll = candles[k].l;
  }
  const c = candles[i];
  if (fast > slow && c.c > hh) return { active: true, side: 'long', atr: a };
  if (fast < slow && c.c < ll) return { active: true, side: 'short', atr: a };
  return { active: false };
}

// Build a concrete plan from a signal and the entry price.
export function planTrade(signal, entry, opts = {}) {
  const o = { ...TREND_DEFAULTS, ...opts };
  const dir = signal.side === 'long' ? 1 : -1;
  const trailDist = o.trailMult * signal.atr;
  if (!(trailDist > 0)) return null;
  return {
    side: signal.side,
    entry,
    stop: entry - dir * trailDist, // initial stop
    trailDist, // ratchet distance (fixed at entry, matches the backtest)
    trailMult: o.trailMult,
    strategy: 'trend',
  };
}

// The one trailing-stop formula. `extreme` is the best price reached since
// entry (highest high for a long, lowest low for a short). Stops only ratchet
// in our favour — never loosen.
export function nextTrailStop(side, extreme, trailDist, prevStop) {
  const candidate = side === 'long' ? extreme - trailDist : extreme + trailDist;
  if (prevStop == null) return candidate;
  return side === 'long' ? Math.max(prevStop, candidate) : Math.min(prevStop, candidate);
}
