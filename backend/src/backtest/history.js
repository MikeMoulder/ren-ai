import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

// Paginated historical candle fetch from Bitget public v2 mix endpoint.
// Walks backwards via endTime in 1000-candle pages. Caches to data/cache so
// repeated backtests don't re-hit the network.

const BASE = 'https://api.bitget.com';
const cacheDir = path.resolve(config.dataDir, 'cache');

async function getJSON(url, ms = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchHistory(symbol, granularity = '15m', bars = 4000, { cache = true } = {}) {
  const cacheFile = path.join(cacheDir, `${symbol}_${granularity}_${bars}.json`);
  if (cache && fs.existsSync(cacheFile)) {
    try {
      const j = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (Array.isArray(j) && j.length) return j;
    } catch { /* fall through to refetch */ }
  }

  const out = new Map(); // t -> candle (dedupe across pages)
  let endTime = undefined;
  while (out.size < bars) {
    const url = `${BASE}/api/v2/mix/market/candles?symbol=${symbol}&productType=${config.productType}` +
      `&granularity=${granularity}&limit=1000${endTime ? `&endTime=${endTime}` : ''}`;
    const j = await getJSON(url);
    const rows = j?.data;
    if (!Array.isArray(rows) || !rows.length) break;
    const page = rows
      .map((c) => ({ t: Number(c[0]), o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5] }))
      .sort((a, b) => a.t - b.t);
    for (const k of page) out.set(k.t, k);
    const oldest = page[0].t;
    if (endTime && oldest >= endTime) break; // no progress
    endTime = oldest;
    if (page.length < 1000) break; // ran out of history
  }

  const candles = [...out.values()].sort((a, b) => a.t - b.t).slice(-bars);
  if (cache && candles.length) {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(candles));
  }
  return candles;
}
