import { telegramEnabled } from '../config.js';
import { log } from '../logger.js';
import { db } from '../store.js';
import { getUpdates, sendMessage, tgCall } from './api.js';
import { upsertUser, bindCredentials, setMode, setRisk } from '../services/users.js';
import { verifyCredentials } from '../bitget/cli.js';

// ---------------------------------------------------------------------------
// Telegram bot. Long-polls for commands. Lets a user register, bind their own
// Bitget API keys (encrypted server-side), pick copy/alert mode, set a risk
// factor, and check status. Trade alerts are pushed by the broadcaster.
// ---------------------------------------------------------------------------

const HELP = [
  '<b>◆ ren.ai — Autonomous Trading Agent</b>',
  '',
  'I trade crypto perps on Bitget and can mirror every move to <b>your</b> account.',
  '',
  '<b>Commands</b>',
  '/bind <code>API_KEY SECRET PASSPHRASE</code> — link your Bitget keys (copy-trade)',
  '/mode <code>copy</code> | <code>alert</code> — mirror trades, or just get alerts',
  '/risk <code>1.0</code> — scale your size vs a 1x mirror (0.05–5)',
  '/status — agent + your subscription status',
  '/unbind — remove your keys',
  '/help — this message',
  '',
  '⚠️ Use a <b>Demo Trading</b> API key while testing. Delete the /bind message after sending.',
].join('\n');

export function startTelegramBot() {
  if (!telegramEnabled) {
    log.warn('Telegram disabled (no TELEGRAM_BOT_TOKEN). Web dashboard still fully works.');
    return;
  }
  log.ok('Telegram bot starting (long-poll)…');
  tgCall('setMyCommands', {
    commands: [
      { command: 'start', description: 'Register / welcome' },
      { command: 'bind', description: 'Link Bitget API keys' },
      { command: 'mode', description: 'copy or alert' },
      { command: 'risk', description: 'Set risk factor' },
      { command: 'status', description: 'Agent + your status' },
      { command: 'help', description: 'Help' },
    ],
  });
  poll(0);
}

async function poll(offset) {
  let next = offset;
  try {
    const updates = await getUpdates(next);
    for (const u of updates) {
      next = u.update_id + 1;
      if (u.message) await handle(u.message).catch((e) => log.warn('handle err:', e.message));
    }
  } catch (e) {
    log.warn('poll err:', e.message);
  }
  setTimeout(() => poll(next), 250);
}

async function handle(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const name = msg.from?.first_name || msg.from?.username || 'trader';
  if (!text.startsWith('/')) return;

  const [cmd, ...args] = text.split(/\s+/);
  const id = `tg-${chatId}`;
  upsertUser({ id, name, telegramChatId: chatId });

  switch (cmd.toLowerCase().replace(/@.*/, '')) {
    case '/start':
      return sendMessage(chatId, HELP);
    case '/help':
      return sendMessage(chatId, HELP);

    case '/bind': {
      if (args.length < 3) {
        return sendMessage(chatId, 'Usage: <code>/bind API_KEY SECRET PASSPHRASE</code>\nUse a Demo Trading key while testing.');
      }
      const [apiKey, secretKey, passphrase] = args;
      await sendMessage(chatId, '🔐 Verifying your keys with Bitget…');
      const check = await verifyCredentials({ apiKey, secretKey, passphrase });
      bindCredentials(id, { apiKey, secretKey, passphrase });
      // best-effort delete the message containing secrets
      tgCall('deleteMessage', { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
      if (!check.ok) {
        return sendMessage(chatId, `⚠️ Keys saved, but a test call failed: <code>${esc(check.error)}</code>\nIf you're on Demo, ensure TRADING_MODE matches. You can still receive alerts.`);
      }
      return sendMessage(chatId, '✅ Keys verified & encrypted. You are now <b>copy-trading</b> ren.ai.\nSet sizing with <code>/risk 1.0</code> or switch with <code>/mode alert</code>.');
    }

    case '/unbind': {
      const u = db().users.find((x) => x.id === id);
      if (u) { u.credentials = null; }
      return sendMessage(chatId, '🧹 Your keys were removed. You will get alerts only.');
    }

    case '/mode': {
      const m = (args[0] || '').toLowerCase();
      if (!['copy', 'alert'].includes(m)) return sendMessage(chatId, 'Usage: <code>/mode copy</code> or <code>/mode alert</code>');
      setMode(id, m);
      return sendMessage(chatId, `Mode set to <b>${m}</b>.`);
    }

    case '/risk': {
      const f = Number(args[0]);
      if (!f || f <= 0) return sendMessage(chatId, 'Usage: <code>/risk 1.0</code> (0.05–5)');
      const u = setRisk(id, f);
      return sendMessage(chatId, `Risk factor set to <b>${u.riskFactor}x</b>.`);
    }

    case '/status': {
      const a = db().agent;
      const u = db().users.find((x) => x.id === id);
      const pnl = (a.equity - a.startEquity).toFixed(2);
      const lines = [
        `<b>ren.ai</b> — ${a.status} · mode <code>${a.mode}</code>`,
        `Equity: <b>${a.equity}</b> USDT (${pnl >= 0 ? '+' : ''}${pnl})`,
        `Open positions: ${Object.keys(db().positions).length}`,
        '',
        `<b>You</b>: ${u?.mode || 'alert'} · risk ${u?.riskFactor || 1}x · ${u?.credentials ? 'keys bound ✅' : 'no keys ⚪'}`,
        `Copied trades: ${u?.stats?.copied || 0}`,
      ];
      return sendMessage(chatId, lines.join('\n'));
    }

    default:
      return sendMessage(chatId, 'Unknown command. Try /help');
  }
}

const esc = (s) => String(s || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
