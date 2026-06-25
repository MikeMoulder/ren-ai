import { config, telegramEnabled } from '../config.js';
import { log } from '../logger.js';

// Minimal zero-dependency Telegram Bot API client (fetch + long polling).
const API = (method) => `https://api.telegram.org/bot${config.telegram.token}/${method}`;

export async function tgCall(method, body) {
  if (!telegramEnabled) return { ok: false, disabled: true };
  try {
    const res = await fetch(API(method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (e) {
    log.warn(`telegram ${method} failed:`, e.message);
    return { ok: false, error: e.message };
  }
}

export function sendMessage(chatId, text, extra = {}) {
  return tgCall('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

export async function getUpdates(offset) {
  if (!telegramEnabled) return [];
  try {
    const res = await fetch(API('getUpdates'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offset, timeout: 25, allowed_updates: ['message'] }),
    });
    const j = await res.json();
    return j.ok ? j.result : [];
  } catch (e) {
    return [];
  }
}
