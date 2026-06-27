import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

// Load .env from repo root regardless of cwd
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const str = (v, d) => (v === undefined || v === '' ? d : String(v));
const list = (v, d) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : d);
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)));

export const config = {
  port: num(process.env.PORT, 8787),
  tradingMode: str(process.env.TRADING_MODE, 'paper'), // paper | demo | live
  symbols: list(process.env.SYMBOLS, ['BTCUSDT', 'ETHUSDT']),
  productType: str(process.env.PRODUCT_TYPE, 'USDT-FUTURES'),
  candleGranularity: str(process.env.CANDLE_GRANULARITY, '4H'), // 4H — the timeframe the live Trend-Breakout strategy is validated on
  loopSeconds: num(process.env.LOOP_SECONDS, 30),
  startEquity: num(process.env.START_EQUITY, 10000),

  // MM30 strategy trigger (the 2-candle continuation pattern). OPT-IN and OFF by
  // default: backtesting showed the cost fixes (maker entry + stop floor) are
  // structural, but the directional edge did NOT survive walk-forward — see
  // backtest_log.md. When enabled, MM30 acts as an entry TRIGGER that must be
  // confirmed by the live confluence() lenses, and only the trend gate (the one
  // filter that held up out-of-sample) is on by default. Re-validate in paper
  // mode over forward data before trusting it. Best run with CANDLE_GRANULARITY=30m.
  mm30: {
    enabled: bool(process.env.MM30_ENABLED, false),
    rr: num(process.env.MM30_RR, 1),
    stopMode: str(process.env.MM30_STOP_MODE, 'B'), // 'B' = just beyond candle B
    stopBufferPct: num(process.env.MM30_STOP_BUFFER_PCT, 0.02),
    minRiskPct: num(process.env.MM30_MIN_RISK_PCT, 0.5), // floor so fees can't exceed 1R
    maxRiskPct: num(process.env.MM30_MAX_RISK_PCT, 1.0), // skip if candle B is too big
    emaStackFilter: num(process.env.MM30_EMA_STACK, 50), // trend gate (held up out-of-sample)
    volFilter: num(process.env.MM30_VOL_FILTER, 0), // off: overfit in tests
    strongClose: num(process.env.MM30_STRONG_CLOSE, 0), // off: overfit in tests
    requireConfluence: bool(process.env.MM30_REQUIRE_CONFLUENCE, true), // confluence must not oppose
  },

  // Trend-Breakout strategy — the agent's DEFAULT live strategy. The validated
  // edge (positive out-of-sample on a 4H basket, net of fees; see
  // strategy_details.md, trend_breakout_log.md, runTrend.js). EMA trend filter +
  // breakout entry + chandelier trailing stop. Runs on CANDLE_GRANULARITY=4H.
  trend: {
    enabled: bool(process.env.TREND_ENABLED, true),
    emaFast: num(process.env.TREND_EMA_FAST, 50),
    emaSlow: num(process.env.TREND_EMA_SLOW, 200),
    breakoutLen: num(process.env.TREND_BREAKOUT_LEN, 10),
    atrPeriod: num(process.env.TREND_ATR_PERIOD, 14),
    trailMult: num(process.env.TREND_TRAIL_MULT, 3),
    requireConfluence: bool(process.env.TREND_REQUIRE_CONFLUENCE, true),
  },
  // How many candles to pull per perceive cycle. EMA200 needs > 200, so default
  // is comfortably above that for the trend strategy.
  candleLookback: num(process.env.CANDLE_LOOKBACK, 400),

  llm: {
    provider: str(process.env.LLM_PROVIDER, 'openrouter'),
    model: str(process.env.LLM_MODEL, 'google/gemini-2.0-flash-001'),
    baseUrl: str(process.env.LLM_BASE_URL, ''),
    // OpenRouter uses OPENROUTER_API_KEY; generic uses LLM_API_KEY
    apiKey: str(process.env.LLM_API_KEY, '') || str(process.env.OPENROUTER_API_KEY, ''),
  },

  bitget: {
    apiKey: str(process.env.BITGET_API_KEY, ''),
    secretKey: str(process.env.BITGET_SECRET_KEY, ''),
    passphrase: str(process.env.BITGET_PASSPHRASE, ''),
  },

  // Bitget Agent Hub Skill Hub bridge. When enabled, the analyst lenses pull
  // live reads from the Agent Hub skills via the MCP server (default) or a
  // custom bridge command; otherwise they degrade to derived/simulated reads so
  // the loop always runs. Enabled explicitly, or implicitly when a custom
  // bridge command is supplied.
  agentHub: {
    enabled: bool(process.env.AGENT_HUB_ENABLED, false) || !!str(process.env.AGENT_HUB_COMMAND, ''),
    // MCP transport: spawned and spoken to over JSON-RPC/stdio.
    mcpCommand: str(process.env.AGENT_HUB_MCP_COMMAND, 'npx -y bitget-mcp-server'),
    // Alternative transport: a custom command bridged per read (takes priority).
    command: str(process.env.AGENT_HUB_COMMAND, ''),
  },

  // Weights for the five-lens confluence fusion (need not sum to 1).
  confluenceWeights: {
    technical: num(process.env.W_TECHNICAL, 0.35),
    sentiment: num(process.env.W_SENTIMENT, 0.2),
    macro: num(process.env.W_MACRO, 0.15),
    'market-intel': num(process.env.W_MARKET_INTEL, 0.15),
    news: num(process.env.W_NEWS, 0.15),
  },

  telegram: {
    token: str(process.env.TELEGRAM_BOT_TOKEN, ''),
    // Public bot handle the website deep-links to (no @). Until the bot is
    // live this is a placeholder the CTA points at.
    botUsername: str(process.env.TELEGRAM_BOT_USERNAME, 'renai_tradingbot'),
  },

  adminToken: str(process.env.ADMIN_TOKEN, 'renai-admin'),
  encryptionKey: resolveEncryptionKey(),
  dataDir: path.resolve(__dirname, '../data'),
};

function resolveEncryptionKey() {
  const raw = str(process.env.SECRET_ENCRYPTION_KEY, '');
  if (raw && /^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  // Deterministic-but-local fallback so the app boots; warns in logger.
  return crypto.createHash('sha256').update(raw || 'renai-dev-insecure-key').digest();
}

// Derived flags
export const llmEnabled = !!config.llm.apiKey && config.llm.provider !== 'none';
export const bitgetConfigured =
  !!config.bitget.apiKey && !!config.bitget.secretKey && !!config.bitget.passphrase;
export const telegramEnabled = !!config.telegram.token;

export const LLM_BASE_URLS = {
  openrouter: 'https://openrouter.ai/api/v1',
  openai: 'https://api.openai.com/v1',
  qwen: 'https://hackathon.bitgetops.com/v1',
};
