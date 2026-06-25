import { db } from './store.js';
import { config, llmEnabled } from './config.js';
import { logBuffer } from './logger.js';

// ---------------------------------------------------------------------------
// Live terminal dashboard. Redraws a full ANSI frame every second from the
// store: agent state, account, market regimes, open positions, recent trades,
// reasoning, and subscribers. No dependencies. Disable with RENAI_NO_TUI=1.
// ---------------------------------------------------------------------------

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
  mag: '\x1b[35m', blue: '\x1b[34m', white: '\x1b[97m', gray: '\x1b[90m',
  bgCyan: '\x1b[46m', black: '\x1b[30m',
};
const STATUS_COLOR = { booting: C.gray, idle: C.cyan, thinking: C.mag, trading: C.yellow };
const STATUS_LABEL = { booting: 'BOOTING', idle: 'MONITORING', thinking: 'REASONING', trading: 'EXECUTING' };

let startTime = Date.now();
let timer = null;
let W = 88;

export function startTUI() {
  if (process.env.RENAI_NO_TUI === '1' || process.env.ATLAS_NO_TUI === '1') return false;
  if (!process.stdout.isTTY && process.env.RENAI_FORCE_TUI !== '1' && process.env.ATLAS_FORCE_TUI !== '1') return false;
  startTime = Date.now();
  process.stdout.write('\x1b[?25l'); // hide cursor
  const cleanup = () => { process.stdout.write('\x1b[?25h\x1b[0m\n'); };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  draw();
  timer = setInterval(draw, 1000);
  return true;
}

// ---- layout helpers --------------------------------------------------------
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const visLen = (s) => stripAnsi(s).length;
function pad(s, n) {
  const len = visLen(s);
  return len >= n ? s : s + ' '.repeat(n - len);
}
function trunc(s, n) {
  if (visLen(s) <= n) return s;
  // truncate ignoring ansi (assume plain for content lines)
  return stripAnsi(s).slice(0, n - 1) + '…';
}

function top() { return C.gray + '╭' + '─'.repeat(W - 2) + '╮' + C.reset; }
function bottom() { return C.gray + '╰' + '─'.repeat(W - 2) + '╯' + C.reset; }
function row(content) {
  const inner = W - 4;
  return `${C.gray}│${C.reset} ${pad(trunc(content, inner), inner)} ${C.gray}│${C.reset}`;
}
function section(title, color = C.cyan) {
  const label = ` ${color}${C.bold}${title}${C.reset} `;
  const used = visLen(label) + 2;
  const fill = '─'.repeat(Math.max(0, W - 2 - used));
  return `${C.gray}├─${C.reset}${label}${C.gray}${fill}┤${C.reset}`;
}

// ---- frame -----------------------------------------------------------------
function draw() {
  W = Math.min(process.stdout.columns || 88, 104);
  const s = db();
  const a = s.agent;
  const sc = STATUS_COLOR[a.status] || C.cyan;
  const out = [];

  // Header
  out.push(top());
  const title = `${C.bold}${C.cyan}◆ ren.ai${C.reset}${C.gray} · Autonomous Trading Agent on Bitget${C.reset}`;
  const stat = `${sc}● ${STATUS_LABEL[a.status] || a.status}${C.reset}`;
  const innerW = W - 4;
  out.push(row(title + ' '.repeat(Math.max(1, innerW - visLen(title) - visLen(stat))) + stat));
  out.push(row(`${C.gray}mode${C.reset} ${a.mode}   ${C.gray}brain${C.reset} ${llmEnabled ? config.llm.model : 'confluence-rules'}   ${C.gray}loop${C.reset} ${config.loopSeconds}s   ${C.gray}uptime${C.reset} ${uptime()}`));

  // Account
  const net = (a.equity || 0) - (a.startEquity || 0);
  const netPct = a.startEquity ? (net / a.startEquity) * 100 : 0;
  const netC = net >= 0 ? C.green : C.red;
  out.push(section('ACCOUNT'));
  out.push(row(
    `${C.gray}Equity${C.reset} ${C.bold}${C.white}$${fmt(a.equity)}${C.reset}    ` +
    `${C.gray}Net P&L${C.reset} ${netC}${sgn(net)} (${sgn(netPct, 2)}%)${C.reset}    ` +
    `${C.gray}Realized${C.reset} ${a.realizedPnl >= 0 ? C.green : C.red}${sgn(a.realizedPnl)}${C.reset}`
  ));

  // Market
  out.push(section('MARKET PERCEPTION', C.cyan));
  const snaps = s.lastTick?.snapshots || [];
  if (!snaps.length) out.push(row(`${C.gray}scanning the market…${C.reset}`));
  for (const m of snaps) {
    const biasC = m.bias === 'long' ? C.green : m.bias === 'short' ? C.red : C.gray;
    const arrow = m.bias === 'long' ? '↑' : m.bias === 'short' ? '↓' : '·';
    out.push(row(
      `${C.bold}${pad(m.symbol, 9)}${C.reset} ${C.white}$${pad(fmt(m.price), 11)}${C.reset} ` +
      `${pad(m.regime, 8)} ${biasC}${arrow} ${pad(m.bias, 6)}${C.reset} ` +
      `${C.gray}RSI${C.reset} ${pad(String(m.metrics.rsi), 5)} ${C.gray}ADX${C.reset} ${pad(String(m.metrics.adx), 5)} ${C.gray}fund${C.reset} ${(m.funding * 100).toFixed(3)}%`
    ));
  }

  // Positions
  const pos = Object.values(s.positions);
  out.push(section(`OPEN POSITIONS (${pos.length})`, C.yellow));
  if (!pos.length) out.push(row(`${C.gray}flat — no open exposure${C.reset}`));
  for (const p of pos) {
    const sideC = p.side === 'long' ? C.green : C.red;
    const up = (p.uPnl ?? 0) >= 0;
    out.push(row(
      `${sideC}${pad(p.side.toUpperCase(), 5)}${C.reset} ${C.bold}${pad(p.symbol, 9)}${C.reset} ` +
      `${pad(String(p.size), 8)} @ ${pad(fmt(p.entry), 11)} ${C.gray}mark${C.reset} ${pad(fmt(p.markPrice ?? p.entry), 11)} ` +
      `${C.gray}uPnL${C.reset} ${up ? C.green : C.red}${sgn(p.uPnl ?? 0)}${C.reset}`
    ));
  }

  // Recent trades — the headline
  out.push(section('TRADES EXECUTED', C.green));
  const trades = s.trades.slice(-6).reverse();
  if (!trades.length) out.push(row(`${C.gray}no trades yet — the agent is being selective${C.reset}`));
  for (const t of trades) {
    if (t.type === 'close') {
      const pc = (t.pnl ?? 0) >= 0 ? C.green : C.red;
      out.push(row(
        `${C.gray}${clock(t.at)}${C.reset} ${C.yellow}CLOSE${C.reset} ${pad(t.symbol, 9)} @ ${pad(fmt(t.price), 11)} ` +
        `${C.gray}PnL${C.reset} ${pc}${sgn(t.pnl ?? 0)}${C.reset} ${C.gray}(${t.why || ''})${C.reset}`
      ));
    } else {
      const dc = t.side === 'long' ? C.green : C.red;
      const arrow = t.side === 'long' ? '▲' : '▼';
      out.push(row(
        `${C.gray}${clock(t.at)}${C.reset} ${dc}OPEN ${arrow} ${pad(t.side.toUpperCase(), 5)}${C.reset} ${pad(t.symbol, 9)} ` +
        `${pad(String(t.size), 8)} @ ${pad(fmt(t.price), 11)} ${C.gray}${t.leverage || ''}x${C.reset}`
      ));
    }
  }

  // Reasoning
  out.push(section('REASONING STREAM', C.mag));
  const thoughts = s.thoughts.slice(-4).reverse();
  if (!thoughts.length) out.push(row(`${C.gray}warming up…${C.reset}`));
  for (const th of thoughts) {
    const ok = th.allowed ? `${C.green}✓${C.reset}` : `${C.gray}·${C.reset}`;
    out.push(row(`${C.gray}${clock(th.at)}${C.reset} ${pad(th.symbol, 9)} ${pad(th.action, 11)} ${ok} ${C.dim}${th.reason}${C.reset}`));
  }

  // Footer: subscribers + last log
  out.push(section('SYNC', C.blue));
  const users = s.users;
  const copy = users.filter((u) => u.mode === 'copy' && u.credentials).length;
  const mirrored = users.reduce((n, u) => n + (u.stats?.copied || 0), 0);
  out.push(row(`${C.gray}Subscribers${C.reset} ${users.length}   ${C.gray}auto-copy${C.reset} ${C.cyan}${copy}${C.reset}   ${C.gray}trades mirrored${C.reset} ${C.cyan}${mirrored}${C.reset}   ${C.gray}web${C.reset} http://localhost:${config.port}`));
  const lastErr = [...logBuffer].reverse().find((l) => l.tag === '[error]' || l.tag === '[warn ]');
  if (lastErr) out.push(row(`${C.yellow}⚠ ${C.dim}${lastErr.line}${C.reset}`));
  out.push(bottom());

  // paint
  process.stdout.write('\x1b[H\x1b[2J' + out.join('\n') + '\n');
}

// ---- formatting ------------------------------------------------------------
function fmt(n) {
  n = Number(n) || 0;
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const sgn = (n, d = 2) => `${n >= 0 ? '+' : ''}${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const clock = (t) => new Date(t).toLocaleTimeString('en-US', { hour12: false });
function uptime() {
  const s = Math.floor((Date.now() - startTime) / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}
