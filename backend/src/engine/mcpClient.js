import { spawn } from 'node:child_process';
import { log } from '../logger.js';

// ---------------------------------------------------------------------------
// Minimal, dependency-free MCP (Model Context Protocol) stdio client.
//
// The Bitget Agent Hub ships an MCP server (`npx -y bitget-mcp-server`) that
// speaks JSON-RPC 2.0 over newline-delimited stdio. This client spawns it once,
// performs the `initialize` handshake, and exposes `listTools()` / `callTool()`.
// It auto-reconnects on crash and times out hung requests so a flaky bridge can
// never stall the trading loop — callers always degrade gracefully on throw.
// ---------------------------------------------------------------------------

const PROTOCOL_VERSION = '2024-11-05';

export class McpStdioClient {
  constructor(command, { env = {}, requestTimeoutMs = 20000 } = {}) {
    // command is a full shell-style command, e.g. "npx -y bitget-mcp-server"
    const [cmd, ...args] = command.split(/\s+/).filter(Boolean);
    this.cmd = cmd;
    this.args = args;
    this.env = env;
    this.requestTimeoutMs = requestTimeoutMs;

    this.proc = null;
    this.ready = null; // Promise<void> resolved after initialize handshake
    this.buf = '';
    this.nextId = 1;
    this.pending = new Map(); // id -> { resolve, reject, timer }
    this.toolsCache = null;
  }

  // Lazily (re)connect and complete the initialize handshake. Concurrent
  // callers share one in-flight connection promise.
  connect() {
    if (this.ready) return this.ready;
    this.ready = this._spawnAndInit().catch((e) => {
      // Reset so a later call can retry from scratch.
      this.ready = null;
      throw e;
    });
    return this.ready;
  }

  async _spawnAndInit() {
    this.proc = spawn(this.cmd, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.env },
    });

    this.proc.on('error', (e) => this._teardown(e));
    this.proc.on('exit', (code) => this._teardown(new Error(`mcp server exited (${code})`)));
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => this._onData(chunk));
    // Surface server diagnostics but don't let them crash us.
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', () => {});

    const init = await this._request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'ren.ai', version: '1.0.0' },
    });
    // Spec requires the client to confirm initialization.
    this._notify('notifications/initialized', {});
    log.ok('Agent Hub MCP connected:', init?.serverInfo?.name || this.cmd);
  }

  _teardown(err) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(err);
    }
    this.pending.clear();
    this.toolsCache = null;
    this.ready = null;
    if (this.proc) { try { this.proc.kill(); } catch {} this.proc = null; }
  }

  _onData(chunk) {
    this.buf += chunk;
    let nl;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const entry = this.pending.get(msg.id);
      if (!entry) continue; // notification or unmatched response
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) entry.reject(new Error(msg.error.message || 'mcp error'));
      else entry.resolve(msg.result);
    }
  }

  _send(obj) {
    if (!this.proc || !this.proc.stdin.writable) throw new Error('mcp not connected');
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  _notify(method, params) {
    this._send({ jsonrpc: '2.0', method, params });
  }

  _request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`mcp ${method} timed out`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this._send({ jsonrpc: '2.0', id, method, params }); }
      catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }

  async listTools() {
    await this.connect();
    if (this.toolsCache) return this.toolsCache;
    const res = await this._request('tools/list', {});
    this.toolsCache = res?.tools || [];
    return this.toolsCache;
  }

  async callTool(name, args) {
    await this.connect();
    return this._request('tools/call', { name, arguments: args });
  }

  close() { this._teardown(new Error('closed')); }
}
