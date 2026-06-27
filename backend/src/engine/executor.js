import { config } from '../config.js';
import { log } from '../logger.js';
import { db } from '../store.js';
import { openPaper, closePaper } from './paperBroker.js';
import { placeFuturesMarket, extractOrderId } from '../bitget/cli.js';

const round = (x, d = 2) => Number(Number(x).toFixed(d));

// ---------------------------------------------------------------------------
// Executes a *gated + sized* decision on the AGENT's own account.
//   - paper        -> internal simulator
//   - demo / live  -> Bitget via bgc (demo adds --paper-trading); we still
//                     keep the local book as the UI source of truth and mark
//                     it against live prices.
// Returns a normalized fill record for the trade log / broadcast.
// ---------------------------------------------------------------------------

export async function executeAgent({ decision, sized, snapshot }) {
  const symbol = decision.symbol;
  const price = snapshot.price;

  if (decision.action === 'close') return closeAgent(symbol, price, decision.reason || 'signal');

  const side = decision.action === 'open_long' ? 'long' : 'short';

  const equityBefore = db().agent.equity; // opening doesn't realize PnL

  if (config.tradingMode === 'paper') {
    const { fillPrice } = openPaper({
      symbol, side, size: sized.size, price,
      stopPrice: sized.stopPrice, takeProfit: sized.takeProfit, reason: decision.reason,
      strategy: sized.strategy, trailDist: sized.trailDist,
    });
    return fillRecord({ symbol, action: decision.action, side, size: sized.size, price: fillPrice, sized, reason: decision.reason, equityBefore, exchange: 'paper' });
  }

  // demo / live via bgc — place on the real Bitget account first.
  const res = await placeFuturesMarket(config.bitget, {
    symbol, side: decision.action, size: sized.size,
  });
  const orderId = extractOrderId(res);
  // mirror into local book regardless, so the dashboard stays coherent
  openPaper({
    symbol, side, size: sized.size, price,
    stopPrice: sized.stopPrice, takeProfit: sized.takeProfit, reason: decision.reason,
    strategy: sized.strategy, trailDist: sized.trailDist,
  });
  return fillRecord({
    symbol, action: decision.action, side, size: sized.size, price, sized,
    reason: decision.reason, equityBefore,
    exchange: res.ok ? 'filled' : `error:${res.error}`, exchangeOrderId: orderId,
  });
}

export async function closeAgent(symbol, price, why) {
  const pos = db().positions[symbol];
  if (!pos) return null;

  let exchange = 'paper';
  let exchangeOrderId = null;
  if (config.tradingMode !== 'paper') {
    const side = pos.side === 'long' ? 'close_long' : 'close_short';
    const res = await placeFuturesMarket(config.bitget, { symbol, side, size: pos.size, reduceOnly: true });
    exchange = res.ok ? 'filled' : `error:${res.error}`;
    exchangeOrderId = extractOrderId(res);
  }
  const closed = closePaper({ symbol, price, why });
  if (!closed) return null;
  return {
    type: 'close', symbol, action: 'close', side: closed.side, size: closed.size,
    price: closed.fillPrice, entry: closed.entry, pnl: closed.pnl, why, at: Date.now(),
    balanceChange: round(closed.equityAfter - closed.equityBefore),
    equityBefore: closed.equityBefore, equityAfter: closed.equityAfter, realizedPnl: closed.realizedPnl,
    exchange, exchangeOrderId,
  };
}

function fillRecord({ symbol, action, side, size, price, sized, reason, equityBefore, exchange = 'filled', exchangeOrderId = null }) {
  const equityAfter = db().agent.equity; // unchanged on open; margin is reserved, not realized
  return {
    type: 'open', symbol, action, side, size, price,
    notional: sized.notional, leverage: sized.leverage,
    marginUsd: sized.leverage ? round(sized.notional / sized.leverage) : sized.notional,
    stopPrice: sized.stopPrice, takeProfit: sized.takeProfit, riskUsd: sized.riskUsd,
    balanceChange: round(equityAfter - equityBefore), equityBefore, equityAfter,
    realizedPnl: db().agent.realizedPnl,
    reason, exchange, exchangeOrderId, at: Date.now(),
  };
}
