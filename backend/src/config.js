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
  loopSeconds: num(process.env.LOOP_SECONDS, 30),
  startEquity: num(process.env.START_EQUITY, 10000),

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

  // Bitget Agent Hub Skill Hub bridge. When enabled, the analyst lenses can
  // pull live reads from the Agent Hub skills; otherwise they degrade to
  // derived/simulated reads so the loop always runs.
  agentHub: {
    enabled: bool(process.env.AGENT_HUB_ENABLED, false),
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
    botUsername: str(process.env.TELEGRAM_BOT_USERNAME, 'renai_trading_bot'),
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
