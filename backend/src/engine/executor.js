import { config } from '../config.js';
import { log } from '../logger.js';
import { db } from '../store.js';
import { openPaper, closePaper } from './paperBroker.js';
import { placeFuturesMarket } from '../bitget/cli.js';

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

  if (config.tradingMode === 'paper') {
    const { fillPrice, pos } = openPaper({
      symbol, side, size: sized.size, price,
      stopPrice: sized.stopPrice, takeProfit: sized.takeProfit, reason: decision.reason,
    });
    return fillRecord({ symbol, action: decision.action, side, size: sized.size, price: fillPrice, sized, reason: decision.reason });
  }

  // demo / live via bgc
  const res = await placeFuturesMarket(config.bitget, {
    symbol, side: decision.action, size: sized.size,
  });
  // mirror into local book regardless, so the dashboard stays coherent
  openPaper({
    symbol, side, size: sized.size, price,
    stopPrice: sized.stopPrice, takeProfit: sized.takeProfit, reason: decision.reason,
  });
  return fillRecord({
    symbol, action: decision.action, side, size: sized.size, price, sized,
    reason: decision.reason, exchange: res.ok ? 'filled' : `error:${res.error}`,
  });
}

export async function closeAgent(symbol, price, why) {
  const pos = db().positions[symbol];
  if (!pos) return null;

  if (config.tradingMode !== 'paper') {
    const side = pos.side === 'long' ? 'close_long' : 'close_short';
    await placeFuturesMarket(config.bitget, { symbol, side, size: pos.size, reduceOnly: true });
  }
  const closed = closePaper({ symbol, price, why });
  if (!closed) return null;
  return {
    type: 'close', symbol, action: 'close', side: closed.side, size: closed.size,
    price: closed.fillPrice, entry: closed.entry, pnl: closed.pnl, why, at: Date.now(),
  };
}

function fillRecord({ symbol, action, side, size, price, sized, reason, exchange = 'filled' }) {
  return {
    type: 'open', symbol, action, side, size, price,
    notional: sized.notional, leverage: sized.leverage,
    stopPrice: sized.stopPrice, takeProfit: sized.takeProfit, riskUsd: sized.riskUsd,
    reason, exchange, at: Date.now(),
  };
}
