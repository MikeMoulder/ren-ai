import { config, llmEnabled, bitgetConfigured, telegramEnabled } from './config.js';
import { log, setQuiet } from './logger.js';
import { loadStore } from './store.js';
import { startWebServer } from './web/server.js';
import { startAgent } from './engine/agent.js';
import { startTelegramBot } from './telegram/bot.js';
import { startTUI } from './tui.js';

// ------------------------------- bootstrap ---------------------------------
function banner() {
  const line = '─'.repeat(58);
  log.info(`\n┌${line}┐`);
  log.info('│  ren.ai — Autonomous Trading Agent on Bitget              │');
  log.info(`└${line}┘`);
  log.info(`mode        : ${config.tradingMode}`);
  log.info(`symbols     : ${config.symbols.join(', ')}`);
  log.info(`brain       : ${llmEnabled ? `${config.llm.provider}:${config.llm.model}` : 'confluence-rules (no LLM key set)'}`);
  log.info(`bitget keys : ${bitgetConfigured ? 'configured' : 'not set (paper mode ok)'}`);
  log.info(`telegram    : ${telegramEnabled ? 'enabled' : 'disabled (set TELEGRAM_BOT_TOKEN)'}`);
  log.info(`dashboard   : http://localhost:${config.port}`);
  if (config.tradingMode === 'live') log.warn('LIVE MODE — real funds at risk.');
}

function main() {
  banner();
  loadStore();
  startWebServer();
  if (process.env.RENAI_NO_AGENT !== '1' && process.env.ATLAS_NO_AGENT !== '1') startAgent();
  startTelegramBot();
  // Hand the terminal over to the live dashboard (silences line-logs so the
  // frame stays clean). Set RENAI_NO_TUI=1 to keep plain scrolling logs.
  setTimeout(() => {
    const on = startTUI();
    if (on) setQuiet(true);
  }, 900);
}

process.on('unhandledRejection', (e) => log.err('unhandledRejection:', e?.message || e));
process.on('uncaughtException', (e) => log.err('uncaughtException:', e?.message || e));

main();
