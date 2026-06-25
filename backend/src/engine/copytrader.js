import { config } from '../config.js';
import { log } from '../logger.js';
import { persist } from '../store.js';
import { activeCopyUsers, decryptCreds } from '../services/users.js';
import { placeFuturesMarket, getAccount } from '../bitget/cli.js';

// ---------------------------------------------------------------------------
// Copy-trade fanout. When the agent opens/closes, we mirror it to every active
// copy subscriber on THEIR OWN account, sized to THEIR equity and risk factor.
//
// Sizing model: the agent risked `riskUsd` (~1% of its equity). We translate
// that to the user's account as the same % notional weight, then apply the
// user's personal riskFactor. This keeps small accounts proportional instead
// of blindly copying the agent's raw contract size.
// ---------------------------------------------------------------------------

export async function fanoutTrade(fill, agentEquity) {
  const users = activeCopyUsers();
  if (!users.length) return [];

  const results = await Promise.all(
    users.map((u) => mirrorToUser(u, fill, agentEquity).catch((e) => ({
      userId: u.id, ok: false, error: e.message,
    })))
  );

  for (const u of users) {
    const r = results.find((x) => x.userId === u.id);
    if (r?.ok) { u.stats.copied += 1; u.stats.lastCopyAt = Date.now(); }
    else u.stats.errors += 1;
  }
  persist();
  return results;
}

async function mirrorToUser(user, fill, agentEquity) {
  const creds = decryptCreds(user);
  if (!creds) return { userId: user.id, ok: false, error: 'no credentials' };

  // Determine the user's equity (best-effort). Fall back to a notional weight.
  let userEquity = agentEquity;
  const acct = await getAccount(creds);
  if (acct.ok) {
    const eq = extractEquity(acct.data);
    if (eq > 0) userEquity = eq;
  }

  // Proportional sizing relative to the agent's position notional.
  const weight = (fill.notional || 0) / Math.max(agentEquity, 1); // notional fraction of agent equity
  const userNotional = userEquity * weight * user.riskFactor;
  const size = roundSize(userNotional / fill.price, fill.price);

  if (fill.type === 'close') {
    const side = fill.side === 'long' ? 'close_long' : 'close_short';
    const res = await placeFuturesMarket(creds, { symbol: fill.symbol, side, size, reduceOnly: true });
    return { userId: user.id, ok: res.ok, size, error: res.error };
  }

  if (size <= 0) return { userId: user.id, ok: false, error: 'size rounds to 0 for this account' };
  const side = fill.action; // open_long | open_short
  const res = await placeFuturesMarket(creds, { symbol: fill.symbol, side, size });
  return { userId: user.id, ok: res.ok, size, notional: round(userNotional, 2), error: res.error };
}

function extractEquity(data) {
  // bgc account assets shapes vary; try common fields.
  try {
    const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    const usdt = arr.find((a) => (a.marginCoin || a.coin) === 'USDT') || arr[0];
    return Number(usdt?.accountEquity || usdt?.usdtEquity || usdt?.available || 0);
  } catch {
    return 0;
  }
}

function roundSize(size, price) {
  if (price > 10000) return Number(size.toFixed(4));
  if (price > 100) return Number(size.toFixed(3));
  return Number(size.toFixed(1));
}
const round = (x, d = 2) => Number(Number(x).toFixed(d));
