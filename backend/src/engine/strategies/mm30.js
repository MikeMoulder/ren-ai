// ---------------------------------------------------------------------------
// MM30 Strategy — "Momentum Mirror, 2-candle continuation".
//
// Idea: the market often shows momentum persistence after two confirming
// candles in the same direction. We look at the last two CLOSED candles:
//
//   A = candles[i-1]   B = candles[i]   (B is the most recent closed candle)
//
//   Bullish setup : A green, B green, and B.close > A.close   (higher structure)
//   Bearish setup : A red,   B red,   and B.close < A.close   (lower  structure)
//
// On a valid setup we expect candle C (the next bar) to continue in that
// direction and enter at C's open.
//
//   SL : the 50% level of candle B  ->  (B.high + B.low) / 2
//   TP : 2R  (R = distance from entry to SL)
//   BE : when price reaches +1R, the stop is moved to break-even (entry).
//
// This module is PURE: it takes a candle array and an index and returns a
// setup descriptor (or null). The same function powers both the live engine
// and the backtester so behaviour is identical and reproducible.
// candle shape: { t, o, h, l, c, v }
// ---------------------------------------------------------------------------

export const MM30_DEFAULTS = {
  rr: 2, // take-profit reward multiple
  beAtR: 1, // move stop to break-even once this R-multiple is reached
  // --- stop placement ---
  stopMode: 'mid', // 'mid' = 50% of B (literal MM30); 'B' = just beyond candle B's extreme; 'atr' = entry±atrMult*ATR; 'structB' = beyond B or A's extreme
  stopBufferPct: 0.02, // buffer added beyond the structural extreme (% of price), for 'B'/'structB'
  atrMult: 1.2, // ATR multiple when stopMode='atr'
  atrPeriod: 14,
  minRiskPct: 0, // floor the stop distance to this % of entry (kills fee-blowup on tiny candles)
  // --- optional filters (all off by default => the "pure" MM30) ---
  minBodyRatio: 0, // each candle body must be >= this fraction of its range
  bMustEngulfMidA: false, // require B.close beyond A's 50% (stronger structure)
  emaTrendFilter: 0, // 0=off; else only take longs above / shorts below EMA(n)
  emaStackFilter: 0, // 0=off; else require price>EMA20>EMA50 (long) / inverse (short) at period pair (20/n)
  // --- "trading intelligence" confluence filters (all off by default) ---
  volFilter: 0, // 0=off; else require B.volume > average volume of prior N candles
  atrExpansion: 0, // 0=off; else require B's range > mult * ATR (a real momentum candle, not noise)
  rsiGuard: 0, // 0=off; else block longs when RSI > this (and shorts when RSI < 100-this) — avoid exhaustion
  strongClose: 0, // 0=off; else require B to close within the top (long)/bottom (short) `frac` of its range
  maxRiskPct: Infinity, // skip setups whose R is wider than this % of entry
};

const isGreen = (k) => k.c > k.o;
const isRed = (k) => k.c < k.o;
const body = (k) => Math.abs(k.c - k.o);
const range = (k) => Math.max(k.h - k.l, 1e-12);
const mid = (k) => (k.h + k.l) / 2;

// EMA value at a given index over closes (simple incremental, for the filter).
function emaAt(candles, idx, period) {
  if (idx < period - 1) return null;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i <= period - 1; i++) prev += candles[i].c;
  prev /= period;
  for (let i = period; i <= idx; i++) prev = candles[i].c * k + prev * (1 - k);
  return prev;
}

// Wilder ATR at a given index (over the trailing `period` true-ranges).
function atrAt(candles, idx, period) {
  if (idx < period) return null;
  let sum = 0;
  for (let i = idx - period + 1; i <= idx; i++) {
    const c = candles[i];
    sum += Math.max(c.h - c.l, Math.abs(c.h - candles[i - 1].c), Math.abs(c.l - candles[i - 1].c));
  }
  return sum / period;
}

// RSI at a given index over the trailing `period` close-to-close changes.
function rsiAt(candles, idx, period = 14) {
  if (idx < period) return 50;
  let gain = 0, loss = 0;
  for (let i = idx - period + 1; i <= idx; i++) {
    const d = candles[i].c - candles[i - 1].c;
    if (d >= 0) gain += d; else loss -= d;
  }
  if (loss === 0) return 100;
  const rs = (gain / period) / (loss / period);
  return 100 - 100 / (1 + rs);
}

// Average volume of the `period` candles BEFORE index idx (context for B).
function avgVolBefore(candles, idx, period) {
  if (idx < period) return null;
  let s = 0;
  for (let i = idx - period; i < idx; i++) s += candles[i].v;
  return s / period;
}

// Detect a setup formed by candles A=i-1, B=i. Entry is taken on bar i+1 open,
// but we leave the entry price to the caller (live = next tick / next open,
// backtest = candles[i+1].open) so this stays pure.
export function detectSetup(candles, i, opts = {}) {
  const o = { ...MM30_DEFAULTS, ...opts };
  if (i < 1 || i >= candles.length) return null;
  const A = candles[i - 1];
  const B = candles[i];

  let side = null;
  if (isGreen(A) && isGreen(B) && B.c > A.c) side = 'long';
  else if (isRed(A) && isRed(B) && B.c < A.c) side = 'short';
  if (!side) return null;

  // Optional: bodies must be "real" candles, not dojis.
  if (o.minBodyRatio > 0) {
    if (body(A) / range(A) < o.minBodyRatio) return null;
    if (body(B) / range(B) < o.minBodyRatio) return null;
  }
  // Optional: B must close beyond A's midpoint (stronger continuation).
  if (o.bMustEngulfMidA) {
    if (side === 'long' && B.c <= mid(A)) return null;
    if (side === 'short' && B.c >= mid(A)) return null;
  }
  // Optional EMA trend filter (price vs a single EMA).
  if (o.emaTrendFilter > 0) {
    const e = emaAt(candles, i, o.emaTrendFilter);
    if (e != null) {
      if (side === 'long' && B.c < e) return null;
      if (side === 'short' && B.c > e) return null;
    }
  }
  // Optional EMA-stack trend filter: price > EMA20 > EMA(slow) for longs (inverse for shorts).
  if (o.emaStackFilter > 0) {
    const fast = emaAt(candles, i, 20);
    const slow = emaAt(candles, i, o.emaStackFilter);
    if (fast != null && slow != null) {
      if (side === 'long' && !(B.c > fast && fast > slow)) return null;
      if (side === 'short' && !(B.c < fast && fast < slow)) return null;
    }
  }

  // Volume confirmation: B must trade more than its recent context (momentum).
  if (o.volFilter > 0) {
    const av = avgVolBefore(candles, i, o.volFilter);
    if (av != null && B.v <= av) return null;
  }
  // Volatility expansion: B must be a real range candle, not chop.
  if (o.atrExpansion > 0) {
    const a = atrAt(candles, i - 1, 14);
    if (a != null && (B.h - B.l) < o.atrExpansion * a) return null;
  }
  // Exhaustion guard: don't chase longs into overbought / shorts into oversold.
  if (o.rsiGuard > 0) {
    const r = rsiAt(candles, i, 14);
    if (side === 'long' && r > o.rsiGuard) return null;
    if (side === 'short' && r < 100 - o.rsiGuard) return null;
  }
  // Conviction: B should close near the extreme it's pushing toward.
  if (o.strongClose > 0) {
    const loc = (B.c - B.l) / range(B); // 1 = closed at high, 0 = at low
    if (side === 'long' && loc < 1 - o.strongClose) return null;
    if (side === 'short' && loc > o.strongClose) return null;
  }

  // Stop placement. Note: 'mid'/'structB' are referenced to B; 'atr' to entry,
  // so for 'atr' the caller's entry price is required (handled in planTrade via
  // a stopDist hint). We precompute the distance/anchor here where possible.
  let stop;
  let stopDist = null; // when set, planTrade builds the stop from entry ± dist
  const buf = (o.stopBufferPct / 100) * B.c;
  if (o.stopMode === 'B') {
    stop = side === 'long' ? B.l - buf : B.h + buf; // just beyond candle B
  } else if (o.stopMode === 'structB') {
    stop = side === 'long' ? Math.min(B.l, A.l) - buf : Math.max(B.h, A.h) + buf;
  } else if (o.stopMode === 'atr') {
    const a = atrAt(candles, i, o.atrPeriod);
    if (a == null) return null;
    stopDist = o.atrMult * a;
  } else {
    stop = mid(B); // 50% of candle B (literal MM30)
  }
  return { atIndex: i, entryIndex: i + 1, side, stop, stopDist, opts: o, A, B };
}

// Given a setup and a concrete entry price, compute the full trade plan.
// Returns null if the geometry is invalid (e.g. a gap put entry on the wrong
// side of the 50% stop, leaving non-positive risk).
export function planTrade(setup, entry) {
  const { side, opts } = setup;
  const dir = side === 'long' ? 1 : -1;
  // Risk distance: from an explicit stop anchor, or an ATR distance hint.
  let risk = setup.stopDist != null ? setup.stopDist : (entry - setup.stop) * dir;
  if (opts.minRiskPct > 0) risk = Math.max(risk, (entry * opts.minRiskPct) / 100); // floor
  if (risk <= 0) return null;
  if (opts.maxRiskPct !== Infinity && (risk / entry) * 100 > opts.maxRiskPct) return null;
  const stop = entry - dir * risk;
  return {
    side,
    entry,
    stop,
    risk,
    riskPct: (risk / entry) * 100,
    takeProfit: entry + dir * opts.rr * risk,
    beTrigger: entry + dir * opts.beAtR * risk, // price at which stop -> entry
    rr: opts.rr,
    beAtR: opts.beAtR,
  };
}
