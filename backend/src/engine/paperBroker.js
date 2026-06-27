import { db, persist } from '../store.js';
import { nextTrailStop } from './strategies/trendBreakout.js';

// ---------------------------------------------------------------------------
// Internal paper exchange for the agent's OWN book. Fills at the live mark
// price with a touch of slippage, tracks unrealized PnL, and realizes PnL on
// close. Used in TRADING_MODE=paper. (In demo/live mode the real Bitget demo
// engine fills instead and we mirror its positions.)
// ---------------------------------------------------------------------------

const SLIPPAGE = 0.0004; // 4 bps each way

export function openPaper({ symbol, side, size, price, stopPrice, takeProfit, reason, strategy = null, trailDist = null }) {
  const s = db();
  const fill = price * (1 + (side === 'long' ? SLIPPAGE : -SLIPPAGE));
  const entry = round(fill, priceDp(price));
  const pos = {
    symbol,
    side, // long | short
    size,
    entry,
    notional: round(size * fill, 2),
    stopPrice,
    takeProfit,
    strategy, // e.g. 'trend' — drives trailing-stop management
    trailDist, // chandelier ratchet distance (price points)
    peak: entry, // best price reached since entry (for trailing)
    openedAt: Date.now(),
    uPnl: 0,
    reason,
  };
  s.positions[symbol] = pos;
  persist();
  return { fillPrice: pos.entry, pos };
}

export function closePaper({ symbol, price, why = 'signal' }) {
  const s = db();
  const pos = s.positions[symbol];
  if (!pos) return null;
  const fill = price * (1 - (pos.side === 'long' ? SLIPPAGE : -SLIPPAGE));
  const pnl = pnlOf(pos, fill);
  const equityBefore = s.agent.equity;
  s.agent.equity = round(s.agent.equity + pnl, 2);
  s.agent.realizedPnl = round(s.agent.realizedPnl + pnl, 2);
  delete s.positions[symbol];
  persist();
  return {
    fillPrice: round(fill, priceDp(price)), pnl: round(pnl, 2),
    side: pos.side, size: pos.size, entry: pos.entry, why,
    equityBefore, equityAfter: s.agent.equity, realizedPnl: s.agent.realizedPnl,
  };
}

// Mark all positions to current prices; returns total unrealized + equity.
export function markToMarket(priceMap) {
  const s = db();
  let uPnlTotal = 0;
  for (const pos of Object.values(s.positions)) {
    const px = priceMap[pos.symbol];
    if (!px) continue;
    pos.uPnl = round(pnlOf(pos, px), 2);
    pos.markPrice = round(px, priceDp(px));
    uPnlTotal += pos.uPnl;
  }
  const marketEquity = round(s.agent.equity + uPnlTotal, 2);
  return { uPnlTotal: round(uPnlTotal, 2), marketEquity };
}

// Ratchet trailing stops for positions that use one (e.g. trend-breakout).
// Updates the running extreme and tightens stopPrice in our favour only.
export function trailStops(priceMap) {
  const s = db();
  let changed = false;
  for (const pos of Object.values(s.positions)) {
    if (pos.strategy !== 'trend' || !pos.trailDist) continue;
    const px = priceMap[pos.symbol];
    if (!px) continue;
    pos.peak = pos.side === 'long' ? Math.max(pos.peak ?? pos.entry, px) : Math.min(pos.peak ?? pos.entry, px);
    const newStop = nextTrailStop(pos.side, pos.peak, pos.trailDist, pos.stopPrice);
    if (newStop !== pos.stopPrice) { pos.stopPrice = round(newStop, priceDp(px)); changed = true; }
  }
  if (changed) persist();
}

// Check stops/targets; returns array of symbols to force-close with reason.
export function checkStops(priceMap) {
  const s = db();
  const hits = [];
  for (const pos of Object.values(s.positions)) {
    const px = priceMap[pos.symbol];
    if (!px) continue;
    const hasTp = pos.takeProfit != null; // trend trades exit on the trail only
    if (pos.side === 'long') {
      if (px <= pos.stopPrice) hits.push({ symbol: pos.symbol, why: 'stop-loss' });
      else if (hasTp && px >= pos.takeProfit) hits.push({ symbol: pos.symbol, why: 'take-profit' });
    } else {
      if (px >= pos.stopPrice) hits.push({ symbol: pos.symbol, why: 'stop-loss' });
      else if (hasTp && px <= pos.takeProfit) hits.push({ symbol: pos.symbol, why: 'take-profit' });
    }
  }
  return hits;
}

function pnlOf(pos, price) {
  const dir = pos.side === 'long' ? 1 : -1;
  return (price - pos.entry) * pos.size * dir;
}

const priceDp = (p) => (p > 10000 ? 1 : p > 100 ? 2 : 4);
const round = (x, d = 2) => Number(Number(x).toFixed(d));
