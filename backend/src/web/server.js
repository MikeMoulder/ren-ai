import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
import { config, llmEnabled, bitgetConfigured, telegramEnabled } from '../config.js';
import { log } from '../logger.js';
import { db } from '../store.js';
import { bus } from '../services/broadcaster.js';
import { agentSnapshot } from '../engine/agent.js';
import { communityStats, setMode, setRisk, setActive } from '../services/users.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function startWebServer() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  // ---- REST API ----
  app.get('/api/health', (_req, res) => res.json({ ok: true, t: Date.now() }));

  app.get('/api/state', (_req, res) => {
    const s = db();
    res.json({
      ...agentSnapshot(),
      thoughts: s.thoughts.slice(-60),
      trades: s.trades.slice(-60),
      equityCurve: s.equityCurve.slice(-600),
      community: communityStats(),
      capabilities: {
        llm: llmEnabled ? config.llm.model : 'confluence-rules',
        llmProvider: config.llm.provider,
        bitget: bitgetConfigured,
        telegram: telegramEnabled,
        telegramBot: config.telegram.botUsername,
        agentHub: config.agentHub.enabled,
        mode: config.tradingMode,
      },
    });
  });

  app.get('/api/thoughts', (_req, res) => res.json(db().thoughts.slice(-200)));
  app.get('/api/trades', (_req, res) => res.json(db().trades.slice(-200)));
  app.get('/api/equity', (_req, res) => res.json(db().equityCurve.slice(-1000)));
  // Public, anonymized community aggregates only — no per-user identity.
  app.get('/api/community', (_req, res) => res.json(communityStats()));

  // Account binding & configuration happen ONLY in the Telegram bot, never on
  // the web (the site shows no user PII). Admin controls below are token-gated.
  const admin = (req, res, next) => {
    const token = req.headers['x-admin-token'] || req.query.token;
    if (token !== config.adminToken) return res.status(401).json({ ok: false, error: 'unauthorized' });
    next();
  };
  app.post('/api/users/:id/mode', admin, (req, res) => res.json({ ok: !!setMode(req.params.id, req.body.mode) }));
  app.post('/api/users/:id/risk', admin, (req, res) => res.json({ ok: !!setRisk(req.params.id, req.body.riskFactor) }));
  app.post('/api/users/:id/active', admin, (req, res) => res.json({ ok: !!setActive(req.params.id, req.body.active) }));

  // ---- Serve frontend build if present ----
  const distDir = path.resolve(__dirname, '../../../frontend/dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
    log.ok('Serving built frontend from /frontend/dist');
  } else {
    app.get('/', (_req, res) =>
      res.type('html').send('<h1>ren.ai backend running</h1><p>Run the frontend dev server (<code>npm run dev:frontend</code>) or build it. API is live at <code>/api/state</code>.</p>'));
  }

  const server = http.createServer(app);

  // ---- WebSocket ----
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    bus.addClient(ws);
    // send a full snapshot immediately on connect
    const s = db();
    ws.send(JSON.stringify({
      type: 'snapshot',
      payload: {
        ...agentSnapshot(),
        thoughts: s.thoughts.slice(-60),
        trades: s.trades.slice(-60),
        equityCurve: s.equityCurve.slice(-600),
        community: communityStats(),
      },
      t: Date.now(),
    }));
  });

  server.listen(config.port, () => {
    log.ok(`Web + WS + API listening on http://localhost:${config.port}`);
  });

  return server;
}
