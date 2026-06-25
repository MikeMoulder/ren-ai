const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
};

const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

// When the TUI dashboard is active we silence line-logging so it doesn't
// corrupt the frame, but keep a ring buffer of recent messages to show in the
// dashboard's log strip.
let quiet = false;
export const logBuffer = [];
export function setQuiet(v) { quiet = v; }

function emit(color, tag, args) {
  const line = `${tag} ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  logBuffer.push({ t: Date.now(), tag: tag.trim(), line, color });
  if (logBuffer.length > 60) logBuffer.shift();
  if (quiet) return;
  // eslint-disable-next-line no-console
  console.log(`${COLORS.dim}${ts()}${COLORS.reset} ${color}${tag}${COLORS.reset}`, ...args);
}

export const log = {
  info: (...a) => emit(COLORS.cyan, '[ren.ai]', a),
  ok: (...a) => emit(COLORS.green, '[ ok  ]', a),
  warn: (...a) => emit(COLORS.yellow, '[warn ]', a),
  err: (...a) => emit(COLORS.red, '[error]', a),
  brain: (...a) => emit(COLORS.magenta, '[brain]', a),
  trade: (...a) => emit(COLORS.blue, '[trade]', a),
};
