import fs from 'node:fs';
import path from 'node:path';
import { fetchHistory } from './history.js';
import { runBacktest, BT_DEFAULTS } from './mm30Backtest.js';
import { config } from '../config.js';

// CLI: node src/backtest/run.js [--symbols=BTCUSDT,ETHUSDT] [--gran=15m]
//      [--bars=4000] [--rr=2] [--be=1] [--risk=0.01] [--variant=base|filtered]
//      [--minBody=0.5] [--ema=200] [--no-cache]

function parseArgs(argv) {
  const a = {};
  for (const s of argv.slice(2)) {
    const m = s.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) a[m[1]] = m[2] === undefined ? true : m[2];
  }
  return a;
}

const fmt = (x, d = 2) => (Number.isFinite(x) ? Number(x).toFixed(d) : String(x));
const pct = (x) => `${fmt(x)}%`;

function printReport(label, agg, bySymbol) {
  const s = agg;
  console.log(`\n══════════════════════════════════════════════════════════════`);
  console.log(`  ${label}`);
  console.log(`══════════════════════════════════════════════════════════════`);
  console.log(`  Trades taken      : ${s.trades}   (setups found: ${s.setups})`);
  console.log(`  Wins / Losses     : ${s.wins} / ${s.losses}   BE-scratch: ${s.scratches}  timeout: ${s.timeouts}`);
  console.log(`  Win rate          : ${pct(s.winRate * 100)} (decisive)   ${pct(s.winRateAll * 100)} (all)`);
  console.log(`  Expectancy        : ${fmt(s.expectancyR, 3)} R / trade`);
  console.log(`  Avg win / loss    : +${fmt(s.avgWinR, 2)}R / ${fmt(s.avgLossR, 2)}R`);
  console.log(`  Profit factor     : ${fmt(s.profitFactor, 2)}`);
  console.log(`  Return            : ${pct(s.returnPct)}   (equity ${fmt(s.startEquity)} -> ${fmt(s.finalEquity)})`);
  console.log(`  Max drawdown      : ${pct(s.maxDrawdownPct)}`);
  if (bySymbol) {
    console.log(`  ── per symbol ──`);
    for (const [sym, st] of Object.entries(bySymbol)) {
      console.log(`    ${sym.padEnd(9)} trades ${String(st.trades).padStart(4)}  WR ${pct(st.winRate * 100).padStart(7)}  exp ${fmt(st.expectancyR, 3)}R  ret ${pct(st.returnPct)}`);
    }
  }
}

// Aggregate per-symbol trade lists into one combined run (chronological).
function aggregate(results, o) {
  const all = [];
  let setups = 0;
  for (const r of results) { all.push(...r.trades); setups += r.setups; }
  all.sort((a, b) => a.atTime - b.atTime);
  // re-run equity over combined chronological order
  let equity = o.startEquity, peak = equity, maxDD = 0;
  let wins = 0, losses = 0, scratches = 0, timeouts = 0, sumR = 0, sumWinR = 0, sumLossR = 0, gW = 0, gL = 0;
  for (const t of all) {
    const riskDollars = o.riskDollars != null ? o.riskDollars : o.riskFraction * equity;
    const qty = riskDollars / t.risk;
    const pnl = qty * t.netPoints;
    t.qty = qty; t.equityBefore = equity; t.pnl = pnl;
    equity += pnl; t.equityAfter = equity;
    peak = Math.max(peak, equity); maxDD = Math.max(maxDD, (peak - equity) / peak);
    sumR += t.netR;
    if (t.why === 'tp') { wins++; sumWinR += t.netR; gW += pnl; }
    else if (t.why === 'stop') { losses++; sumLossR += t.netR; gL += pnl; }
    else if (t.why === 'be-stop') { scratches++; if (pnl >= 0) gW += pnl; else gL += pnl; }
    else { timeouts++; if (pnl >= 0) gW += pnl; else gL += pnl; }
  }
  const decisive = wins + losses;
  return {
    ledger: all,
    setups, trades: all.length, wins, losses, scratches, timeouts,
    winRate: decisive ? wins / decisive : 0,
    winRateAll: all.length ? wins / all.length : 0,
    expectancyR: all.length ? sumR / all.length : 0,
    avgWinR: wins ? sumWinR / wins : 0,
    avgLossR: losses ? sumLossR / losses : 0,
    profitFactor: gL ? Math.abs(gW / gL) : Infinity,
    startEquity: o.startEquity, finalEquity: equity,
    returnPct: ((equity - o.startEquity) / o.startEquity) * 100,
    maxDrawdownPct: maxDD * 100,
  };
}

async function main() {
  const a = parseArgs(process.argv);
  const symbols = (a.symbols ? a.symbols.split(',') : config.symbols).map((s) => s.trim());
  const gran = a.gran || '15m';
  const bars = Number(a.bars || 4000);
  const cache = !a['no-cache'];

  const variants = {
    base: {}, // literal MM30: 50%-of-B stop, 2R, BE at 1R
    filtered: { minBodyRatio: 0.5, bMustEngulfMidA: true, emaTrendFilter: 200, minRiskPct: 0.5 },
    // Best config found in research: ATR stop + EMA-stack trend gate. Designed
    // for the 4H timeframe (run with --gran=4H). Positive net of fees in-sample.
    trend: { stopMode: 'atr', atrMult: 1.2, emaStackFilter: 50, rr: 2, beAtR: 1 },
    // User spec: 30m, full TP at 1R, SL just below candle B, skip if B too big.
    // taker fees (market-on-open), no stop floor.
    spec: { stopMode: 'B', rr: 1, beAtR: 99, maxRiskPct: Number(a.maxRisk || 1.0) },
    // Same spec but maker-style: limit entry (0.02%/side, no slippage) + a 0.5%
    // stop floor so the round-trip fee can never exceed the 1R target.
    specMaker: {
      stopMode: 'B', rr: 1, beAtR: 99, maxRiskPct: Number(a.maxRisk || 1.0),
      minRiskPct: 0.5, feePct: 0.0002, slipPct: 0,
    },
    // Cost-fixed + trend gate: only take the pattern with the EMA20>EMA50 stack.
    specTrend: {
      stopMode: 'B', rr: 1, beAtR: 99, maxRiskPct: Number(a.maxRisk || 1.0),
      minRiskPct: 0.5, feePct: 0.0002, slipPct: 0, emaStackFilter: 50,
    },
    // Full confluence: trend + volume confirmation + strong-close conviction.
    // Best in-sample config — strips low-conviction coin-flips, lifts WR to ~61%.
    specConf: {
      stopMode: 'B', rr: 1, beAtR: 99, maxRiskPct: Number(a.maxRisk || 1.0),
      minRiskPct: 0.5, feePct: 0.0002, slipPct: 0,
      emaStackFilter: 50, volFilter: 20, strongClose: 0.5,
    },
  };
  // --variant accepts a single name or a comma-separated list.
  const want = a.variant ? String(a.variant).split(',').map((s) => s.trim()) : null;
  const chosen = want
    ? Object.fromEntries(want.filter((v) => variants[v]).map((v) => [v, variants[v]]))
    : variants;

  const overrides = {};
  if (a.rr) overrides.rr = Number(a.rr);
  if (a.be) overrides.beAtR = Number(a.be);
  if (a.risk) overrides.riskFraction = Number(a.risk);
  if (a.minBody) overrides.minBodyRatio = Number(a.minBody);
  if (a.ema) overrides.emaTrendFilter = Number(a.ema);
  if (a.fee !== undefined) overrides.feePct = Number(a.fee);
  if (a.slip !== undefined) overrides.slipPct = Number(a.slip);
  if (a.riskDollars) overrides.riskDollars = Number(a.riskDollars);
  if (a.startEquity) overrides.startEquity = Number(a.startEquity);

  const logFile = a.log ? (a.log === true ? 'backtest_log.md' : a.log) : null;
  if (logFile) fs.writeFileSync(path.resolve(process.cwd(), logFile), `# MM30 Backtest Logs — ${gran}\n\nGenerated: ${new Date().toISOString()}\n`);

  console.log(`MM30 backtest — symbols=${symbols.join(',')} gran=${gran} bars=${bars}`);
  const data = {};
  for (const sym of symbols) {
    const candles = await fetchHistory(sym, gran, bars, { cache });
    data[sym] = candles;
    const span = candles.length
      ? `${new Date(candles[0].t).toISOString().slice(0, 10)} → ${new Date(candles.at(-1).t).toISOString().slice(0, 10)}`
      : 'no data';
    console.log(`  ${sym}: ${candles.length} candles  (${span})`);
  }

  for (const [vname, vopts] of Object.entries(chosen)) {
    const opts = { ...vopts, ...overrides };
    const o = { ...BT_DEFAULTS, ...opts };
    const results = [];
    const bySymbol = {};
    for (const sym of symbols) {
      const r = runBacktest(data[sym], opts);
      r.trades.forEach((t) => (t.symbol = sym));
      results.push({ trades: r.trades, setups: r.setups });
      bySymbol[sym] = { ...r.stats, setups: r.setups };
    }
    const agg = aggregate(results, o);
    printReport(`VARIANT: ${vname}   ${JSON.stringify(opts)}`, agg, bySymbol);
    if (logFile) writeLedger(logFile, vname, opts, o, gran, agg);
  }
}

function writeLedger(file, vname, opts, o, gran, agg) {
  const dp = (p) => (p > 10000 ? 1 : p > 100 ? 2 : 4);
  const ts = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
  const lines = [];
  lines.push('');
  lines.push(`## Variant: ${vname}`);
  lines.push('');
  lines.push(`Timeframe: ${gran}  |  Config: \`${JSON.stringify(opts)}\``);
  lines.push(`Account: $${fmt(o.startEquity)} start, $${fmt(o.riskDollars ?? o.riskFraction * o.startEquity)} risk per trade  |  Fees: ${(o.feePct * 100).toFixed(3)}% + slip ${(o.slipPct * 100).toFixed(3)}% per side`);
  lines.push('');
  lines.push(`**Result:** ${agg.trades} trades, ${pct(agg.winRate * 100)} win rate, expectancy ${fmt(agg.expectancyR, 3)}R, return ${pct(agg.returnPct)} (final $${fmt(agg.finalEquity)}), max DD ${pct(agg.maxDrawdownPct)}`);
  lines.push('');
  lines.push('| # | Timestamp (UTC) | Pair | Side | Entry | Exit | Size | Outcome | Balance Δ ($) | Balance ($) |');
  lines.push('|--:|---|---|---|--:|--:|--:|---|--:|--:|');
  agg.ledger.forEach((t, idx) => {
    lines.push(
      `| ${idx + 1} | ${ts(t.atTime)} | ${t.symbol} | ${t.side} | ${fmt(t.entry, dp(t.entry))} | ${fmt(t.exit, dp(t.exit))} | ${fmt(t.qty, 4)} | ${t.why} | ${t.pnl >= 0 ? '+' : ''}${fmt(t.pnl)} | ${fmt(t.equityAfter)} |`
    );
  });
  lines.push('');
  fs.appendFileSync(path.resolve(process.cwd(), file), lines.join('\n'));
  console.log(`\n  → ledger appended to ${file} (${vname}: ${agg.ledger.length} trades)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
