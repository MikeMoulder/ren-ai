import { db, persist } from '../store.js';
import { encryptSecret, decryptSecret, maskKey } from '../secrets.js';

// ---------------------------------------------------------------------------
// Subscriber management. A user binds their OWN Bitget API keys (encrypted at
// rest with AES-256-GCM) and a risk factor. When the agent trades, the
// copy-trader mirrors the position to each active copy user, scaled by their
// risk factor and their own equity.
// ---------------------------------------------------------------------------

export function upsertUser({ id, name, telegramChatId }) {
  const s = db();
  let u = s.users.find((x) => x.id === id);
  if (!u) {
    u = {
      id,
      name: name || `user-${String(id).slice(-4)}`,
      telegramChatId: telegramChatId ?? null,
      mode: 'copy', // copy | alert
      riskFactor: 1.0, // size relative to a 1x mirror of the agent
      credentials: null,
      active: true,
      createdAt: Date.now(),
      stats: { copied: 0, errors: 0, lastCopyAt: null },
    };
    s.users.push(u);
    persist();
  } else if (telegramChatId && !u.telegramChatId) {
    u.telegramChatId = telegramChatId;
    persist();
  }
  return u;
}

export function bindCredentials(id, { apiKey, secretKey, passphrase }) {
  const s = db();
  const u = s.users.find((x) => x.id === id);
  if (!u) return null;
  u.credentials = {
    apiKey: encryptSecret(apiKey),
    secretKey: encryptSecret(secretKey),
    passphrase: encryptSecret(passphrase),
    tail: maskKey(apiKey),
    boundAt: Date.now(),
  };
  persist();
  return u;
}

export function decryptCreds(u) {
  if (!u?.credentials) return null;
  return {
    apiKey: decryptSecret(u.credentials.apiKey),
    secretKey: decryptSecret(u.credentials.secretKey),
    passphrase: decryptSecret(u.credentials.passphrase),
  };
}

export function setMode(id, mode) {
  return patch(id, (u) => { u.mode = mode === 'alert' ? 'alert' : 'copy'; });
}
export function setRisk(id, factor) {
  const f = Math.max(0.05, Math.min(5, Number(factor) || 1));
  return patch(id, (u) => { u.riskFactor = f; });
}
export function setActive(id, active) {
  return patch(id, (u) => { u.active = !!active; });
}

function patch(id, fn) {
  const u = db().users.find((x) => x.id === id);
  if (!u) return null;
  fn(u);
  persist();
  return u;
}

// Anonymized aggregate view for the public API/UI — NO names, key tails,
// Telegram handles, or any per-user identity. The website only ever sees these
// community-level counters; individual identity stays server-side.
export function communityStats() {
  const users = db().users;
  const copying = users.filter((u) => u.active && u.mode === 'copy' && u.credentials).length;
  const alerting = users.filter((u) => u.active && u.mode === 'alert').length;
  const totalMirrored = users.reduce((a, u) => a + (u.stats?.copied || 0), 0);
  return {
    subscribers: users.length,
    copying,
    alerting,
    totalMirrored,
  };
}

export const activeCopyUsers = () => db().users.filter((u) => u.active && u.mode === 'copy' && u.credentials);
export const alertableUsers = () => db().users.filter((u) => u.active && u.telegramChatId);
