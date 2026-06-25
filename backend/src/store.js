import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { log } from './logger.js';

// ---------------------------------------------------------------------------
// Tiny durable JSON store. One file, atomic writes (write tmp -> rename).
// Holds everything ren.ai needs: users, the agent's decisions ("thoughts"),
// trades, the live equity curve, and current agent state. A real deployment
// would swap this for Postgres; the interface is intentionally small.
// ---------------------------------------------------------------------------

const FILE = path.join(config.dataDir, 'renai.json');
const LEGACY_FILE = path.join(config.dataDir, 'atlas.json'); // pre-rebrand

const DEFAULT = {
  meta: { createdAt: Date.now(), version: 1 },
  agent: {
    status: 'booting', // booting | idle | thinking | trading
    mode: config.tradingMode,
    equity: config.startEquity,
    startEquity: config.startEquity,
    realizedPnl: 0,
    lastDecisionAt: null,
    lastThought: null,
  },
  positions: {}, // symbol -> position object (agent's own book)
  lastTick: null, // latest market perception broadcast (for instant first paint)
  thoughts: [], // decision log (capped)
  trades: [], // executed trades (capped)
  equityCurve: [], // { t, equity }
  users: [], // bound copy-trade subscribers
};

let state = null;
let writeTimer = null;

function ensureDir() {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
}

export function loadStore() {
  ensureDir();
  try {
    const src = fs.existsSync(FILE) ? FILE : (fs.existsSync(LEGACY_FILE) ? LEGACY_FILE : null);
    if (src) {
      state = { ...structuredClone(DEFAULT), ...JSON.parse(fs.readFileSync(src, 'utf8')) };
      // keep mode in sync with current env on boot
      state.agent.mode = config.tradingMode;
    } else {
      state = structuredClone(DEFAULT);
    }
  } catch (e) {
    log.warn('store corrupt, starting fresh:', e.message);
    state = structuredClone(DEFAULT);
  }
  return state;
}

export function db() {
  if (!state) loadStore();
  return state;
}

// debounced atomic persist
export function persist() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      ensureDir();
      const tmp = `${FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, FILE);
    } catch (e) {
      log.err('persist failed:', e.message);
    }
  }, 250);
}

// helpers to push to capped arrays
export function pushCapped(key, item, cap = 500) {
  const s = db();
  s[key].push(item);
  if (s[key].length > cap) s[key].splice(0, s[key].length - cap);
  persist();
  return item;
}
