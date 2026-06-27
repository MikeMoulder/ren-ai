import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { log } from '../logger.js';

// ---------------------------------------------------------------------------
// Append-only trade ledger — a durable, human-referenceable record of every
// fill, separate from the capped `trades` array in the JSON store (which only
// keeps the most recent 800). One CSV row per executed open/close, with the
// fields needed to audit the agent after the fact: timestamp, pair, side,
// price, size, balance changes, and — in demo/live — the Bitget order id that
// proves the order reached the exchange.
//
// CSV is intentional: it opens straight in a spreadsheet for review. The full,
// nested fill object still lives in renai.json for the dashboard.
// ---------------------------------------------------------------------------

const CSV_FILE = path.join(config.dataDir, 'trades.csv');

const COLUMNS = [
  'time_iso', 'time_ms', 'mode', 'type', 'symbol', 'side', 'action',
  'price', 'size', 'notional', 'leverage', 'margin_usd',
  'stop', 'take_profit', 'pnl', 'balance_change',
  'equity_before', 'equity_after', 'realized_pnl',
  'exchange', 'exchange_order_id', 'reason',
];

function ensureHeader() {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
  if (!fs.existsSync(CSV_FILE)) fs.writeFileSync(CSV_FILE, COLUMNS.join(',') + '\n');
}

function csv(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Append one fill record to the ledger. Best-effort: a failed write is logged
// but never throws into the trading loop.
export function appendTradeLog(rec) {
  try {
    ensureHeader();
    const row = {
      time_iso: new Date(rec.at || Date.now()).toISOString(),
      time_ms: rec.at || Date.now(),
      mode: config.tradingMode,
      type: rec.type,                       // open | close
      symbol: rec.symbol,
      side: rec.side,                        // long | short
      action: rec.action,                    // open_long | open_short | close
      price: rec.price,
      size: rec.size,
      notional: rec.notional,
      leverage: rec.leverage,
      margin_usd: rec.marginUsd,
      stop: rec.stopPrice,
      take_profit: rec.takeProfit,
      pnl: rec.pnl,                          // realized pnl on close
      balance_change: rec.balanceChange,     // equityAfter - equityBefore
      equity_before: rec.equityBefore,
      equity_after: rec.equityAfter,
      realized_pnl: rec.realizedPnl,         // running realized pnl after this fill
      exchange: rec.exchange,                // filled | error:... | paper
      exchange_order_id: rec.exchangeOrderId,
      reason: rec.reason || rec.why,
    };
    fs.appendFileSync(CSV_FILE, COLUMNS.map((c) => csv(row[c])).join(',') + '\n');
  } catch (e) {
    log.warn('trade ledger append failed:', e.message);
  }
}

export const TRADE_LOG_FILE = CSV_FILE;
