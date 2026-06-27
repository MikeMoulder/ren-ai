import fs from 'node:fs';
import path from 'node:path';
import { fetchHistory } from './history.js';
import { trendSignal, planTrade, nextTrailStop, TREND_DEFAULTS } from '../engine/strategies/trendBreakout.js';
import { config } from '../config.js';

// Backtest for the Trend-Breakout strategy. Uses the SAME trendSignal +
// nextTrailStop the live engine uses, so the backtest and production agree.
// Intrabar trailing is resolved pessimistically (adverse touch checked first).
//
// CLI: node src/backtest/runTrend.js [--symbols=a,b] [--gran=4H] [--bars=5000]
//      [--trail=3] [--breakout=10] [--risk=100] [--fee=0.0006] [--slip=0.0004]

function parseArgs(argv) {
  const a = {};
  for (const s of argv.slice(2)) { const m = s.match(/^--([^=]+)(?:=(.*))?$/); if (m) a[m[1]] = m[2] ?? true; }
  return a;
}
const fmt = (x, d = 1) => (Number.isFinite(x) ? Number(x).toFixed(d) : String(x));

function simulate(candles, opts, cost) {
  const o = { ...TREND_DEFAULTS, ...opts };
  const trades = [];
  for (let i = o.emaSlow; i < candles.length - 1; i++) {
    const sig = trendSignal(candles, i, o);
    if (!sig.active) continue;
    const entry = candles[i].c; // enter at the breakout candle's close
    const plan = planTrade(sig, entry, o);
    if (!plan) continue;
    const dir = sig.side === 'long' ? 1 : -1;
    let stop = plan.stop;
    let extreme = entry;
    let exit = null;
    let exitIndex = candles.length - 1;
    for (let j = i + 1; j < candles.length; j++) {
      const k = candles[j];
      if (dir === 1 ? k.l <= stop : k.h >= stop) { exit = stop; exitIndex = j; break; } // stop first (pessimistic)
      extreme = dir === 1 ? Math.max(extreme, k.h) : Math.min(extreme, k.l);
      stop = nextTrailStop(sig.side, extreme, plan.trailDist, stop);
    }
    if (exit == null) exit = candles[candles.length - 1].c;
    const net = (exit - entry) * dir - (entry + exit) * cost;
    trades.push({
      R: net / plan.trailDist, atTime: candles[i].t, exitTime: candles[exitIndex].t,
      side: sig.side, entry, exit, risk: plan.trailDist, exitIndex,
    });
    i = Math.max(i, exitIndex); // no overlapping positions
  }
  return trades;
}

function stats(trades, riskDollars, startEq = 10000) {
  const n = trades.length;
  if (!n) return { n: 0 };
  const wins = trades.filter((t) => t.R > 0).length;
  const sumR = trades.reduce((a, b) => a + b.R, 0);
  let eq = startEq, peak = startEq, dd = 0;
  for (const t of trades) { eq += riskDollars * t.R; peak = Math.max(peak, eq); dd = Math.max(dd, (peak - eq) / peak); }
  return {
    n, winPct: (100 * wins) / n, expR: sumR / n,
    ret: ((eq - startEq) / startEq) * 100, finalEq: eq, ddPct: dd * 100,
  };
}
const row = (s) => (s.n ? `n=${String(s.n).padStart(3)}  win%=${fmt(s.winPct, 0)}  exp=${fmt(s.expR, 3)}R  ret=${fmt(s.ret)}%  DD=${fmt(s.ddPct, 0)}%` : 'no trades');

async function main() {
  const a = parseArgs(process.argv);
  const symbols = (a.symbols ? String(a.symbols).split(',') : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'LTCUSDT']).map((s) => s.trim());
  const gran = a.gran || '4H';
  const bars = Number(a.bars || 5000);
  const risk = Number(a.risk || 100);
  const cost = Number(a.fee ?? 0.0006) + Number(a.slip ?? 0.0004);
  const opts = { ...config.trend };
  if (a.trail) opts.trailMult = Number(a.trail);
  if (a.breakout) opts.breakoutLen = Number(a.breakout);

  console.log(`Trend-Breakout backtest — ${gran} · ${symbols.length} symbols · EMA${opts.emaFast}/${opts.emaSlow} + ${opts.breakoutLen}-bar breakout · ${opts.trailMult}×ATR trail · $${risk} risk/trade · ${(cost * 100).toFixed(2)}%/side`);

  const all = [], train = [], test = [], perSymbol = [];
  for (const sym of symbols) {
    const candles = await fetchHistory(sym, gran, bars);
    if (candles.length < opts.emaSlow + 20) { console.log(`  ${sym.padEnd(9)} insufficient data (${candles.length})`); continue; }
    const split = candles[Math.floor(candles.length * 0.6)].t;
    const tr = simulate(candles, opts, cost);
    tr.forEach((t) => { t.symbol = sym; all.push(t); (t.atTime <= split ? train : test).push(t); });
    perSymbol.push({ symbol: sym, stats: stats(tr, risk) });
    console.log(`  ${sym.padEnd(9)} ${row(stats(tr, risk))}`);
  }
  all.sort((x, y) => x.atTime - y.atTime);
  train.sort((x, y) => x.atTime - y.atTime);
  test.sort((x, y) => x.atTime - y.atTime);
  console.log('\n  ───────────── portfolio (shared book, chronological) ─────────────');
  console.log(`  ALL    ${row(stats(all, risk))}`);
  console.log(`  TRAIN  ${row(stats(train, risk))}`);
  console.log(`  TEST   ${row(stats(test, risk))}   <- out-of-sample`);

  if (a.log) {
    const file = a.log === true ? 'trend_breakout_log.md' : String(a.log);
    writeLog(file, { symbols, gran, bars, risk, cost, opts, all, train, test, perSymbol });
    console.log(`\n  → data log written to ${file} (${all.length} trades)`);
  }
}

function writeLog(file, ctx) {
  const { symbols, gran, bars, risk, cost, opts, all, train, test, perSymbol } = ctx;
  const dp = (p) => (p > 10000 ? 1 : p > 100 ? 2 : 4);
  const ts = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
  const L = [];
  L.push('# Trend-Breakout — Backtest Data');
  L.push('');
  L.push(`Generated: ${new Date().toISOString()}`);
  L.push(`Strategy details: see [strategy_details.md](strategy_details.md). Summary cross-referenced from [backtest_log.md](backtest_log.md).`);
  L.push('');
  L.push('## Setup');
  L.push('');
  L.push(`- **Timeframe:** ${gran}  |  **Universe:** ${symbols.length} symbols (${symbols.join(', ')})`);
  L.push(`- **History:** up to ${bars} candles/symbol  |  **Fees modeled:** ${(cost * 100).toFixed(2)}% per side (taker + slippage)`);
  L.push(`- **Rules:** EMA${opts.emaFast}/${opts.emaSlow} trend filter · ${opts.breakoutLen}-bar breakout entry · ${opts.trailMult}×ATR chandelier trailing stop · no fixed take-profit`);
  L.push(`- **Sizing:** $${risk} risk per trade (1R = initial stop distance) on a $10,000 book, one position per symbol`);
  L.push(`- **Validation:** chronological 60/40 train/test split (test = out-of-sample)`);
  L.push('');
  L.push('## Portfolio summary');
  L.push('');
  L.push('| Window | Trades | Win % | Expectancy (R) | Return | Final equity | Max DD |');
  L.push('|---|--:|--:|--:|--:|--:|--:|');
  for (const [name, tr] of [['ALL', all], ['TRAIN (in-sample)', train], ['TEST (out-of-sample)', test]]) {
    const s = stats(tr, risk);
    L.push(`| ${name} | ${s.n} | ${fmt(s.winPct, 0)}% | ${fmt(s.expR, 3)} | ${fmt(s.ret)}% | $${fmt(s.finalEq, 0)} | ${fmt(s.ddPct, 0)}% |`);
  }
  L.push('');
  L.push('## Per-symbol');
  L.push('');
  L.push('| Symbol | Trades | Win % | Expectancy (R) | Return | Max DD |');
  L.push('|---|--:|--:|--:|--:|--:|');
  for (const ps of perSymbol) {
    const s = ps.stats;
    L.push(`| ${ps.symbol} | ${s.n} | ${fmt(s.winPct, 0)}% | ${fmt(s.expR, 3)} | ${fmt(s.ret)}% | ${fmt(s.ddPct, 0)}% |`);
  }
  L.push('');
  L.push('## Trade ledger (chronological, shared book)');
  L.push('');
  L.push('| # | Entry time (UTC) | Exit time (UTC) | Pair | Side | Entry | Exit | Size | Result (R) | Balance Δ ($) | Balance ($) |');
  L.push('|--:|---|---|---|---|--:|--:|--:|--:|--:|--:|');
  let bal = 10000;
  all.forEach((t, idx) => {
    const qty = risk / t.risk;
    const pnl = risk * t.R;
    bal += pnl;
    L.push(`| ${idx + 1} | ${ts(t.atTime)} | ${ts(t.exitTime)} | ${t.symbol} | ${t.side} | ${fmt(t.entry, dp(t.entry))} | ${fmt(t.exit, dp(t.exit))} | ${fmt(qty, 4)} | ${t.R >= 0 ? '+' : ''}${fmt(t.R, 2)} | ${pnl >= 0 ? '+' : ''}${fmt(pnl)} | ${fmt(bal)} |`);
  });
  L.push('');
  fs.writeFileSync(path.resolve(process.cwd(), file), L.join('\n'));
}

main().catch((e) => { console.error(e); process.exit(1); });
