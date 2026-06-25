import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { log } from '../logger.js';

// ---------------------------------------------------------------------------
// Thin wrapper over the `bgc` CLI (bitget-client). We pass credentials via a
// per-invocation env, which lets us execute on ANY account — the agent's own
// account OR a copy-trade subscriber's account — using the exact same tested
// code path. `paper` adds --paper-trading (Bitget Demo Trading).
// ---------------------------------------------------------------------------

function run(args, creds) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      BITGET_API_KEY: creds.apiKey,
      BITGET_SECRET_KEY: creds.secretKey,
      BITGET_PASSPHRASE: creds.passphrase,
    };
    const child = spawn('bgc', args, { env });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => resolve({ ok: false, error: `spawn failed: ${e.message}` }));
    child.on('close', (code) => {
      if (code !== 0) return resolve({ ok: false, error: err.trim() || `exit ${code}` });
      try {
        resolve({ ok: true, data: JSON.parse(out) });
      } catch {
        resolve({ ok: true, data: out.trim() });
      }
    });
  });
}

function withMode(args) {
  return config.tradingMode === 'demo' ? ['--paper-trading', ...args] : args;
}

// Place a market futures order on an arbitrary account.
// side: 'open_long' | 'open_short' | 'close_long' | 'close_short'
export async function placeFuturesMarket(creds, { symbol, side, size, reduceOnly }) {
  const order = {
    symbol,
    productType: config.productType,
    marginCoin: 'USDT',
    size: String(size),
    side,
    orderType: 'market',
  };
  if (reduceOnly) order.reduceOnly = 'YES';
  const args = withMode(['futures', 'futures_place_order', '--orders', JSON.stringify([order])]);
  const res = await run(args, creds);
  if (!res.ok) log.warn(`bgc place order failed (${symbol} ${side}):`, res.error);
  return res;
}

export async function getPositions(creds) {
  const args = withMode(['futures', 'futures_get_positions', '--productType', config.productType]);
  return run(args, creds);
}

export async function getAccount(creds) {
  const args = withMode(['account', 'get_account_assets']);
  return run(args, creds);
}

// Quick connectivity/credential check for user binding.
export async function verifyCredentials(creds) {
  const res = await getAccount(creds);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}
