// ---------------------------------------------------------------------------
// Risk manager. The brain proposes; risk disposes. Every decision passes
// through here before it can touch an account. Two jobs:
//   1) GATES  — reject decisions that violate hard limits.
//   2) SIZING — convert a conviction into a concrete contract size using an
//      ATR-based risk budget (risk a fixed % of equity per trade, scaled by
//      conviction). This keeps position size sane across volatility regimes.
// ---------------------------------------------------------------------------

export const RISK = {
  riskPerTradePct: 0.01, // risk 1% of equity per trade at the stop
  atrStopMult: 2.0, // stop distance = 2 * ATR
  maxPositions: 2, // concurrent open positions
  maxLeverage: 5, // notional cap = equity * maxLeverage (per position: /maxPositions)
  minConviction: 0.45, // ignore low-conviction ideas
  dailyLossLimitPct: 0.06, // halt new entries after -6% day
};

export function gateAndSize({ decision, snapshot, equity, positions, dayPnlPct }) {
  const { action, conviction, sizePct } = decision;

  if (action === 'hold') return { allow: false, reason: 'hold', action };
  if (action === 'close') return { allow: true, action, size: null };

  // --- entry gates ---
  if (conviction < RISK.minConviction) {
    return { allow: false, reason: `conviction ${conviction.toFixed(2)} < ${RISK.minConviction}`, action };
  }
  const openCount = Object.keys(positions).length;
  if (!positions[decision.symbol] && openCount >= RISK.maxPositions) {
    return { allow: false, reason: `max positions (${RISK.maxPositions}) reached`, action };
  }
  if (positions[decision.symbol]) {
    return { allow: false, reason: 'already in a position (manage via close/hold)', action };
  }
  if (dayPnlPct <= -RISK.dailyLossLimitPct) {
    return { allow: false, reason: `daily loss limit (${RISK.dailyLossLimitPct * 100}%) hit`, action };
  }

  // --- sizing ---
  const price = snapshot.price;
  const atr = Math.max(snapshot.metrics.atr, price * 0.001); // floor to avoid div-by-0
  // A decision may carry an explicit stop/TP plan (e.g. MM30's below-B stop +
  // 1R target). When present we size to that stop; otherwise default to ATR.
  const plan = decision.plan && decision.plan.stop != null ? decision.plan : null;
  const stopDistance = Math.max(plan ? Math.abs(price - plan.stop) : RISK.atrStopMult * atr, price * 0.0005);

  const riskBudget = equity * RISK.riskPerTradePct * conviction * (0.5 + 0.5 * sizePct);
  let size = riskBudget / stopDistance; // base units (e.g. BTC)

  // Cap notional so leverage stays bounded.
  const maxNotionalPerPos = (equity * RISK.maxLeverage) / RISK.maxPositions;
  if (size * price > maxNotionalPerPos) size = maxNotionalPerPos / price;

  size = roundSize(size, price);
  if (size <= 0) return { allow: false, reason: 'computed size rounds to 0', action };

  const stopPrice = plan ? plan.stop
    : action === 'open_long' ? price - stopDistance : price + stopDistance;
  // A plan with no takeProfit (e.g. trend-breakout) means trailing-stop exit only.
  const takeProfit = plan
    ? (decision.plan.takeProfit != null ? decision.plan.takeProfit : null)
    : action === 'open_long' ? price + stopDistance * 1.6 : price - stopDistance * 1.6;

  return {
    allow: true,
    action,
    size,
    notional: round(size * price, 2),
    leverage: round((size * price) / (equity / RISK.maxPositions), 2),
    stopPrice: round(stopPrice, 2),
    takeProfit: takeProfit == null ? null : round(takeProfit, 2),
    riskUsd: round(riskBudget, 2),
    strategy: decision.strategy || null,
    trailDist: decision.trailDist != null ? round(decision.trailDist, 2) : null,
  };
}

// Sensible contract rounding by price magnitude.
function roundSize(size, price) {
  if (price > 10000) return Number(size.toFixed(4)); // BTC
  if (price > 100) return Number(size.toFixed(3)); // ETH/SOL
  return Number(size.toFixed(1));
}

const round = (x, d = 2) => Number(Number(x).toFixed(d));
