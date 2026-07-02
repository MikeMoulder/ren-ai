import { config } from '../config.js';
import { log } from '../logger.js';
import { db, persist, pushCapped } from '../store.js';
import { perceive } from './perception.js';
import { decide } from './brain.js';
import { gateAndSize, RISK } from './risk.js';
import { executeAgent, closeAgent } from './executor.js';
import { markToMarket, checkStops, trailStops } from './paperBroker.js';
import { fanoutTrade } from './copytrader.js';
import { bus } from '../services/broadcaster.js';
import { appendTradeLog } from '../services/tradeLog.js';

// ---------------------------------------------------------------------------
// THE LOOP. Every LOOP_SECONDS:
//   1. PERCEIVE   real market -> regime/indicators snapshot
//   2. MARK       update unrealized PnL + equity curve, broadcast a tick
//   3. PROTECT    force-close any position that hit its stop / take-profit
//   4. REASON     ask the brain (LLM or rules) for decisions
//   5. RISK       gate + size each decision
//   6. EXECUTE    place on the agent's account
//   7. FANOUT     mirror to copy subscribers + broadcast + Telegram
// Each step streams to the dashboard so the agent "thinks out loud".
// ---------------------------------------------------------------------------

let timer = null;
let running = false;

export function startAgent() {
  const s = db();
  s.agent.status = 'idle';
  s.agent.mode = config.tradingMode;
  persist();
  log.ok(`ren.ai online · mode=${config.tradingMode} · symbols=${config.symbols.join(',')} · loop=${config.loopSeconds}s`);
  if (config.trend.enabled) {
    log.ok(`Trend-Breakout ENABLED · ${config.candleGranularity} candles · EMA${config.trend.emaFast}/${config.trend.emaSlow} + ${config.trend.breakoutLen}-bar breakout · ${config.trend.trailMult}×ATR trailing stop · confluence-${config.trend.requireConfluence ? 'gated' : 'advisory'}`);
  }
  if (config.mm30.enabled) {
    log.ok(`MM30 trigger ENABLED · ${config.candleGranularity} candles · trend-gate EMA${config.mm30.emaStackFilter} · ${config.mm30.rr}R · confluence-${config.mm30.requireConfluence ? 'gated' : 'advisory'} (re-validate in paper — see backtest_log.md)`);
  }
  tick(); // run immediately
  timer = setInterval(tick, config.loopSeconds * 1000);
}

export function stopAgent() {
  if (timer) clearInterval(timer);
}

export function agentSnapshot() {
  const s = db();
  return {
    agent: s.agent,
    positions: Object.values(s.positions),
    tick: s.lastTick,
    risk: RISK,
    config: {
      mode: config.tradingMode,
      symbols: config.symbols,
      loopSeconds: config.loopSeconds,
      granularity: config.candleGranularity,
      strategy: config.trend.enabled ? 'Trend-Breakout' : config.mm30.enabled ? 'MM30' : 'Confluence',
    },
  };
}

async function tick() {
  if (running) return; // never overlap
  running = true;
  const s = db();
  try {
    setStatus('thinking');

    // 1. PERCEIVE
    const perception = await perceive();
    const priceMap = Object.fromEntries(perception.snapshots.map((x) => [x.symbol, x.price]));

    // Snapshot each open position's last good reference price BEFORE markToMarket
    // overwrites markPrice with this tick's (possibly bad) price. Used by the
    // stop circuit-breaker below.
    const refPrice = {};
    for (const p of Object.values(s.positions)) refPrice[p.symbol] = p.markPrice ?? p.entry;

    // 2. MARK
    const { uPnlTotal, marketEquity } = markToMarket(priceMap);
    recordEquity(marketEquity);
    const tickPayload = {
      at: perception.at,
      dataSource: perception.dataSource,
      snapshots: perception.snapshots,
      equity: s.agent.equity,
      marketEquity,
      uPnl: uPnlTotal,
      positions: Object.values(s.positions),
    };
    s.lastTick = tickPayload;
    bus.tick(tickPayload);

    // 3. PROTECT — ratchet trailing stops, then close anything that hit a stop/target
    trailStops(priceMap);
    for (const hit of checkStops(priceMap)) {
      const px = priceMap[hit.symbol];
      const ref = refPrice[hit.symbol];
      // Circuit-breaker: never realize a stop/target against a price that jumped
      // implausibly since the last tick (bad ticker / synthetic fallback). Hold
      // the position and re-evaluate next tick rather than book a fabricated PnL.
      if (config.maxTickMove > 0 && ref && Math.abs(px - ref) / ref > config.maxTickMove) {
        log.warn(`ren.ai: ignoring ${hit.why} on ${hit.symbol} — implausible price ${px} vs ${ref} (${perception.dataSource}); holding position`);
        continue;
      }
      const closed = await closeAgent(hit.symbol, px, hit.why);
      if (closed) await emitTrade(closed);
    }

    // 4. REASON
    const dayPnlPct = dayPnl(marketEquity);
    const brain = await decide({
      perception,
      positions: s.positions,
      equity: s.agent.equity,
      risk: { ...RISK, dayPnlPct: round(dayPnlPct, 4) },
    });
    s.agent.lastDecisionAt = Date.now();

    // 5/6/7 — per decision: gate, size, execute, fan out
    for (const decision of brain.decisions) {
      const snapshot = perception.snapshots.find((x) => x.symbol === decision.symbol);
      if (!snapshot) continue;

      const sized = gateAndSize({
        decision, snapshot, equity: s.agent.equity, positions: s.positions, dayPnlPct,
      });

      recordThought({ decision, sized, brainSource: brain.source, snapshot });

      if (!sized.allow) continue;

      if (sized.action === 'close') {
        setStatus('trading');
        const closed = await closeAgent(decision.symbol, snapshot.price, decision.reason || 'signal');
        if (closed) await emitTrade(closed);
        continue;
      }

      // open
      setStatus('trading');
      const fill = await executeAgent({ decision, sized, snapshot });
      pushCapped('trades', fill, 800);
      appendTradeLog(fill);
      log.trade(`${fill.action} ${fill.symbol} size=${fill.size} @ ${fill.price} (${fill.leverage}x) — ${fill.reason}`);
      const copyResults = await fanoutTrade(fill, s.agent.equity);
      await bus.trade(fill, copyResults);
    }

    setStatus('idle');
  } catch (e) {
    log.err('tick error:', e.message);
    setStatus('idle');
  } finally {
    running = false;
  }
}

async function emitTrade(closed) {
  pushCapped('trades', closed, 800);
  appendTradeLog(closed);
  log.trade(`CLOSE ${closed.symbol} @ ${closed.price} pnl=${closed.pnl} (${closed.why})`);
  const copyResults = await fanoutTrade(closed, db().agent.equity);
  await bus.trade(closed, copyResults);
}

function recordThought({ decision, sized, brainSource, snapshot }) {
  const t = {
    at: Date.now(),
    symbol: decision.symbol,
    action: decision.action,
    conviction: decision.conviction,
    reason: decision.reason,
    allowed: sized.allow,
    gate: sized.allow ? 'passed' : sized.reason,
    source: brainSource,
    regime: snapshot.regime,
    bias: snapshot.bias,
    price: snapshot.price,
    metrics: snapshot.metrics,
    signals: snapshot.signals || [],
    confluence: snapshot.confluence || null,
    sized: sized.allow && sized.action !== 'close'
      ? { size: sized.size, notional: sized.notional, leverage: sized.leverage, stop: sized.stopPrice, tp: sized.takeProfit, riskUsd: sized.riskUsd }
      : null,
  };
  db().agent.lastThought = t;
  pushCapped('thoughts', t, 400);
  bus.thought(t);
}

function recordEquity(marketEquity) {
  const s = db();
  const last = s.equityCurve[s.equityCurve.length - 1];
  // sample at most every ~20s to keep the curve light
  if (!last || Date.now() - last.t > 20000) {
    pushCapped('equityCurve', { t: Date.now(), equity: marketEquity }, 2000);
  }
}

function dayPnl(marketEquity) {
  const s = db();
  const dayStart = s.equityCurve.find((p) => p.t > Date.now() - 24 * 3600 * 1000);
  const base = dayStart?.equity || s.agent.startEquity;
  return (marketEquity - base) / base;
}

function setStatus(status) {
  const s = db();
  if (s.agent.status !== status) {
    s.agent.status = status;
    bus.status({ status, mode: s.agent.mode, at: Date.now() });
    persist();
  }
}

const round = (x, d = 2) => Number(Number(x).toFixed(d));
