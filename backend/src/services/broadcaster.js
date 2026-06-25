import { EventEmitter } from 'node:events';
import { sendMessage } from '../telegram/api.js';
import { alertableUsers } from './users.js';
import { log } from '../logger.js';

// ---------------------------------------------------------------------------
// Central event hub. The engine emits events; we fan them to (a) every
// connected WebSocket dashboard and (b) Telegram subscribers (for trade
// events). Decoupled so the engine never needs to know who is listening.
// ---------------------------------------------------------------------------

class Broadcaster extends EventEmitter {
  constructor() {
    super();
    this.wsClients = new Set();
  }

  addClient(ws) {
    this.wsClients.add(ws);
    ws.on('close', () => this.wsClients.delete(ws));
    ws.on('error', () => this.wsClients.delete(ws));
  }

  // Push to all dashboards.
  emitWs(type, payload) {
    const msg = JSON.stringify({ type, payload, t: Date.now() });
    for (const ws of this.wsClients) {
      if (ws.readyState === 1) {
        try { ws.send(msg); } catch { this.wsClients.delete(ws); }
      }
    }
    this.emit(type, payload);
  }

  // High-level event helpers used by the agent loop.
  thought(thought) { this.emitWs('thought', thought); }
  tick(tick) { this.emitWs('tick', tick); }
  status(status) { this.emitWs('status', status); }

  async trade(fill, copyResults = []) {
    this.emitWs('trade', { fill, copyResults });
    await this.telegramTrade(fill, copyResults);
  }

  async telegramTrade(fill, copyResults) {
    const users = alertableUsers();
    if (!users.length) return;
    const text = formatTradeAlert(fill, copyResults);
    await Promise.all(users.map((u) => sendMessage(u.telegramChatId, text).catch(() => {})));
  }
}

function formatTradeAlert(fill, copyResults) {
  const dirEmoji = fill.side === 'long' ? '🟢' : '🔴';
  const copied = copyResults.filter((r) => r?.ok).length;
  if (fill.type === 'close') {
    const pnlEmoji = fill.pnl >= 0 ? '✅' : '🛑';
    return [
      `${pnlEmoji} <b>ren.ai closed ${fill.side?.toUpperCase()} ${fill.symbol}</b>`,
      `Exit: <code>${fill.price}</code>  (${fill.why})`,
      `PnL: <b>${fill.pnl >= 0 ? '+' : ''}${fill.pnl} USDT</b>`,
      copyResults.length ? `Mirrored to ${copied}/${copyResults.length} subscribers.` : '',
    ].filter(Boolean).join('\n');
  }
  return [
    `${dirEmoji} <b>ren.ai opened ${fill.side?.toUpperCase()} ${fill.symbol}</b>`,
    `Entry: <code>${fill.price}</code>  ·  Size: <code>${fill.size}</code>  ·  ${fill.leverage}x`,
    `🎯 TP <code>${fill.takeProfit}</code>   🛡 SL <code>${fill.stopPrice}</code>`,
    `🧠 ${fill.reason}`,
    copyResults.length ? `Mirrored to ${copied}/${copyResults.length} subscribers.` : 'No copy subscribers yet.',
  ].filter(Boolean).join('\n');
}

export const bus = new Broadcaster();
