// Pure technical-indicator math over a candle array [{o,h,l,c,...}].
// Kept dependency-free and deterministic so backtests are reproducible.

export function ema(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out = [];
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gain = 0;
  let loss = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  const avgGain = gain / period;
  const avgLoss = loss / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function atr(candles, period = 14) {
  if (candles.length < period + 1) return 0;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].c;
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - prevClose), Math.abs(c.l - prevClose)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

// ADX-lite: trend-strength proxy (0..100) using directional movement.
export function adx(candles, period = 14) {
  if (candles.length < period + 2) return 0;
  let plusDM = 0;
  let minusDM = 0;
  let tr = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const up = candles[i].h - candles[i - 1].h;
    const down = candles[i - 1].l - candles[i].l;
    if (up > down && up > 0) plusDM += up;
    if (down > up && down > 0) minusDM += down;
    const c = candles[i];
    tr += Math.max(c.h - c.l, Math.abs(c.h - candles[i - 1].c), Math.abs(c.l - candles[i - 1].c));
  }
  if (tr === 0) return 0;
  const plusDI = (plusDM / tr) * 100;
  const minusDI = (minusDM / tr) * 100;
  const denom = plusDI + minusDI;
  if (denom === 0) return 0;
  return (Math.abs(plusDI - minusDI) / denom) * 100;
}

// Classify the market regime — the heart of the adaptive strategy.
// trend (follow), range (mean-revert), or unclear (stand aside).
export function classifyRegime({ closes, candles }) {
  const fast = ema(closes, 20);
  const slow = ema(closes, 50);
  const price = closes[closes.length - 1];
  const f = fast[fast.length - 1];
  const s = slow[slow.length - 1];
  const trendStrength = adx(candles, 14); // higher = trendier
  const r = rsi(closes, 14);
  const a = atr(candles, 14);
  const atrPct = (a / price) * 100;

  const emaSpreadPct = s ? ((f - s) / s) * 100 : 0;
  const aboveBoth = price > f && price > s;
  const belowBoth = price < f && price < s;

  let regime = 'unclear';
  let bias = 'flat';
  if (trendStrength >= 25 && Math.abs(emaSpreadPct) > 0.15) {
    regime = 'trend';
    bias = emaSpreadPct > 0 && aboveBoth ? 'long' : emaSpreadPct < 0 && belowBoth ? 'short' : 'flat';
  } else if (trendStrength < 20) {
    regime = 'range';
    // mean-reversion: fade extremes
    bias = r < 35 ? 'long' : r > 65 ? 'short' : 'flat';
  }

  return {
    regime,
    bias,
    metrics: {
      price: round(price),
      ema20: round(f ?? price),
      ema50: round(s ?? price),
      emaSpreadPct: round(emaSpreadPct, 3),
      rsi: round(r, 1),
      adx: round(trendStrength, 1),
      atr: round(a),
      atrPct: round(atrPct, 2),
    },
  };
}

const round = (x, d = 2) => (x == null || Number.isNaN(x) ? 0 : Number(Number(x).toFixed(d)));
