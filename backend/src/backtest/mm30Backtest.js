import { detectSetup, planTrade, MM30_DEFAULTS } from '../engine/strategies/mm30.js';

// ---------------------------------------------------------------------------
// MM30 backtester. Pure & deterministic given a candle array. Simulates one
// position at a time per symbol with intrabar SL/TP/BE resolution using each
// bar's high/low. Order-of-touch inside a bar is resolved PESSIMISTICALLY
// (adverse level assumed hit first) so results are conservative rather than
// rosy. Break-even arming takes effect from the NEXT bar to avoid same-bar
// "+1R then back to entry" ambiguity.
// ---------------------------------------------------------------------------

export const BT_DEFAULTS = {
  ...MM30_DEFAULTS,
  feePct: 0.0006, // taker fee per side (Bitget USDT-M ~0.06%)
  slipPct: 0.0004, // slippage per side (matches paperBroker 4bps)
  riskFraction: 0.01, // risk this fraction of equity per trade (used when riskDollars is null)
  riskDollars: null, // fixed $ risked per trade; overrides riskFraction when set
  startEquity: 10000,
  maxBarsInTrade: 0, // 0 = no timeout; else force mark-to-close after N bars
};

function simulateTrade(candles, plan, entryIndex, o) {
  const dir = plan.side === 'long' ? 1 : -1;
  let stop = plan.stop;
  let beArmed = false;
  const last = o.maxBarsInTrade > 0
    ? Math.min(candles.length - 1, entryIndex + o.maxBarsInTrade - 1)
    : candles.length - 1;

  for (let j = entryIndex; j <= last; j++) {
    const k = candles[j];
    const lowHit = dir === 1 ? k.l <= stop : k.h >= stop; // adverse touch vs stop
    const tpHit = dir === 1 ? k.h >= plan.takeProfit : k.l <= plan.takeProfit;
    const beHit = dir === 1 ? k.h >= plan.beTrigger : k.l <= plan.beTrigger;

    // Pessimistic ordering: adverse (stop) before favorable (tp) within a bar.
    if (lowHit) return finalize(plan, stop, j, beArmed ? 'be-stop' : 'stop', o);
    if (tpHit) return finalize(plan, plan.takeProfit, j, 'tp', o);
    if (!beArmed && beHit) {
      beArmed = true;
      stop = plan.entry; // break-even from next bar
    }
  }
  // Unresolved: mark to last close.
  return finalize(plan, candles[last].c, last, 'timeout', o);
}

function finalize(plan, exit, exitIndex, why, o) {
  const dir = plan.side === 'long' ? 1 : -1;
  const costPerSide = o.feePct + o.slipPct;
  const grossPoints = (exit - plan.entry) * dir;
  const feePoints = (plan.entry + exit) * costPerSide;
  const netPoints = grossPoints - feePoints;
  return {
    side: plan.side,
    entry: plan.entry,
    stop: plan.stop,
    takeProfit: plan.takeProfit,
    exit,
    exitIndex,
    why,
    risk: plan.risk,
    grossR: grossPoints / plan.risk,
    netR: netPoints / plan.risk,
    netPoints,
  };
}

export function runBacktest(candles, opts = {}) {
  const o = { ...BT_DEFAULTS, ...opts };
  const trades = [];
  let setups = 0;
  let cursor = 1; // first detectable B is index 1

  for (let i = cursor; i < candles.length - 1; i++) {
    const setup = detectSetup(candles, i, o);
    if (!setup) continue;
    setups++;
    const entryBar = candles[i + 1];
    const plan = planTrade(setup, entryBar.o);
    if (!plan) continue;
    const t = simulateTrade(candles, plan, i + 1, o);
    t.atTime = candles[i + 1].t;
    trades.push(t);
    // resume detection AFTER the trade closes (no overlapping positions)
    i = Math.max(i, t.exitIndex);
  }

  return { trades, setups, stats: summarize(trades, o) };
}

function summarize(trades, o) {
  let equity = o.startEquity;
  let peak = equity;
  let maxDD = 0;
  const eqCurve = [equity];
  let wins = 0, losses = 0, scratches = 0, timeouts = 0;
  let sumR = 0, sumWinR = 0, sumLossR = 0, grossWin$ = 0, grossLoss$ = 0;

  for (const t of trades) {
    const riskDollars = o.riskDollars != null ? o.riskDollars : o.riskFraction * equity;
    const qty = riskDollars / t.risk; // size so 1R adverse ≈ riskDollars
    const pnl = qty * t.netPoints;
    t.qty = qty;
    t.riskDollars = riskDollars;
    t.equityBefore = equity;
    equity += pnl;
    eqCurve.push(equity);
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, (peak - equity) / peak);

    sumR += t.netR;
    if (t.why === 'tp') { wins++; sumWinR += t.netR; grossWin$ += pnl; }
    else if (t.why === 'stop') { losses++; sumLossR += t.netR; grossLoss$ += pnl; }
    else if (t.why === 'be-stop') { scratches++; if (pnl >= 0) grossWin$ += pnl; else grossLoss$ += pnl; }
    else { timeouts++; if (pnl >= 0) grossWin$ += pnl; else grossLoss$ += pnl; if (t.netR > 0) sumWinR += t.netR; else sumLossR += t.netR; }
    t.pnl = pnl;
    t.equityAfter = equity;
  }

  const n = trades.length;
  const decisive = wins + losses;
  return {
    trades: n,
    wins, losses, scratches, timeouts,
    winRate: decisive ? wins / decisive : 0,
    winRateAll: n ? wins / n : 0,
    expectancyR: n ? sumR / n : 0,
    avgWinR: wins ? sumWinR / wins : 0,
    avgLossR: losses ? sumLossR / losses : 0,
    profitFactor: grossLoss$ ? Math.abs(grossWin$ / grossLoss$) : Infinity,
    startEquity: o.startEquity,
    finalEquity: equity,
    returnPct: ((equity - o.startEquity) / o.startEquity) * 100,
    maxDrawdownPct: maxDD * 100,
    eqCurve,
  };
}
