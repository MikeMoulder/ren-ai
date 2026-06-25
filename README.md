# ◆ ren.ai — Autonomous Trading Agent on Bitget

> An AI agent that fuses **five Agent Hub analyst lenses** into a single
> **confluence** decision, trades crypto perpetuals on Bitget, and shows
> **every signal, decision, and trade live** — then carries its subscribers
> along on every move.
>
> Built for the **Bitget AI Base Camp Hackathon S1** · Track 1 — Trading Agent.

ren.ai runs a complete, no-human-in-the-loop cycle every few seconds:

```
  PERCEIVE  →  CONFLUENCE  →  RISK-GATE  →  EXECUTE  →  SYNC
 (5 lenses)   (LLM fuses)     (sizing)     (Bitget)   (copy + alert)
```

It reads the market through five **Bitget Agent Hub** Skill-Hub lenses
(technical, sentiment, macro, market-intel, news), fuses them into one weighted
**conviction**, sizes each idea through a hard risk layer, executes on Bitget,
and **mirrors every trade to its subscribers' own accounts** — while streaming
its entire decision engine to a live web dashboard and a Telegram bot.

**It runs end-to-end with zero credentials.** With no keys set, ren.ai uses
**real Bitget market prices**, derived/simulated analyst lenses, a transparent
confluence rule engine, and an internal paper-fill engine — so a judge can
`npm start` and immediately watch it think and trade. Add an LLM key to upgrade
the brain to a **tool-calling** model that calls the skills itself; add Bitget
demo keys to route fills to Bitget Demo Trading; users bind keys in the Telegram
bot to turn on copy-trade.

---

## 1. The thesis (why this exists)

**Problem.** Traditional quant bots execute *predefined rules* over a single data
source. They can't reconcile a bullish chart against bearish positioning, a
risk-off macro tape, or a fresh news catalyst — and they can't explain
themselves. Most "copy trading" is opaque: you mirror a number, not a reason.

**What ren.ai does.** It closes the loop an agent uniquely can:
1. **Perceives** the market through **five analyst lenses** (the Bitget Agent Hub
   Skill Hub): `technical-analysis`, `sentiment-analyst`, `macro-analyst`,
   `market-intel`, `news-briefing`.
2. **Fuses** them into a single weighted **confluence** conviction — technical
   sets the regime; the other four confirm, dampen, or veto.
3. **Reasons** with an LLM that **calls the skills as tools** and returns
   *structured, explained* decisions — falling back to a transparent confluence
   rule engine so it's always runnable.
4. **Gates** every idea through ATR-based risk budgeting (it often chooses to do
   nothing — the hardest thing to encode in rules).
5. **Executes** on Bitget (paper / demo / live via one flag) and **syncs** the
   move to every subscriber's *own* account, scaled to *their* equity & risk.

**My take on AI trading.** The edge of an agent isn't faster execution; it's
*judgment under conflicting signals* and *legibility*. ren.ai is built so every
decision is inspectable — the Decision Engine shows each lens's score, its
provenance, and how they fused — and every risk rule wins ties against the model.
The agent is allowed to be smart, but never allowed to be reckless: the risk
layer is deterministic code the LLM cannot override. That separation is the whole
design.

---

## 2. What you get

| Surface | What it shows / does |
|---|---|
| **Web dashboard** | Animated, **light/dark** visualization of the agent: KPIs, equity curve, agent core, the **Decision Engine** (5-lens confluence → conviction → risk gate → action), market perception, an expandable **Reasoning Stream**, a full **Trade Log**, open positions, and **anonymized** community stats. No user PII, ever. |
| **Telegram bot** | The **only** place users participate: `/bind` Bitget keys (encrypted), pick `copy`/`alert`, set a `/risk` factor, and get real-time alerts with the agent's reasoning. |
| **Decision engine** | The autonomous loop: perceive (5 lenses) → confluence → risk → execute → copy-fanout → broadcast. |

---

## 3. Quick start

```bash
# 1. install (root installs both workspaces)
npm run install:all

# 2. (optional) configure — works with NO edits (paper mode + rule engine)
cp .env.example .env

# 3. build the UI and serve everything from one port:
npm start                 # → http://localhost:8787   (UI + API + WS + agent)
```

That single command serves the web UI, REST API, and WebSocket on **one origin**.
A terminal dashboard also redraws live in the process you launched.

**Prefer hot-reload?**
```bash
npm run dev:backend       # :8787  API + WS + agent loop + terminal dashboard
npm run dev:frontend      # :5173  Vite (proxies /api + /ws to :8787)
```

### Turn on the good stuff (all optional)

| Want… | Set in `.env` |
|---|---|
| **LLM brain** (calls skills as tools) | `OPENROUTER_API_KEY=...` (model defaults to `google/gemini-2.0-flash-001`) |
| **Bitget Qwen** brain instead | `LLM_PROVIDER=qwen` · `LLM_BASE_URL=https://hackathon.bitgetops.com/v1` · `LLM_MODEL=qwen3.6-plus` · `LLM_API_KEY=...` |
| **Live Agent Hub** skill reads | `AGENT_HUB_ENABLED=true` (+ bridge command) — lenses badge as `Agent Hub` instead of derived/sim |
| **Bitget Demo Trading** execution | `TRADING_MODE=demo` + `BITGET_API_KEY/SECRET/PASSPHRASE` (demo keys) |
| **Telegram bot** | `TELEGRAM_BOT_TOKEN=...` from @BotFather · `TELEGRAM_BOT_USERNAME=...` |
| **Live** (real funds) | `TRADING_MODE=live` + live keys ⚠️ |

---

## 4. The decision engine (the core)

Everything lives in [`backend/src/engine/`](backend/src/engine/). The loop is
[`agent.js`](backend/src/engine/agent.js). One cycle:

### Step 1 — Perceive · [`perception.js`](backend/src/engine/perception.js) + [`analysts.js`](backend/src/engine/analysts.js)
For each symbol we pull **200 live 15m candles + ticker** from Bitget's public API
(no auth). [`indicators.js`](backend/src/engine/indicators.js) computes EMA20/50,
RSI(14), ATR(14), and an ADX-style trend score, then `classifyRegime()` distills
the worldview (trend / range / unclear). [`analysts.js`](backend/src/engine/analysts.js)
then runs the **five Agent Hub lenses** over the snapshot, each returning a
normalized score in `[-1, 1]` with a **provenance** tag:

- `agent-hub` — a live read from a configured Agent Hub skill bridge
- `derived` — computed from real Bitget data (technical, funding/sentiment)
- `simulated` — a transparent, clearly-labeled placeholder (no extra keys)

`confluence()` fuses the lenses with configurable weights into one conviction:
`{ score, direction, agree, conflict, contributors }`.

### Step 2 — Reason · [`brain.js`](backend/src/engine/brain.js)
With an LLM key, the brain runs a **tool-calling loop**: the five skills are
exposed as OpenAI-style function tools (`read_technical`, `read_sentiment`, …).
The model calls the lenses it needs, we fulfil each via `analysts.js`, and it
returns strict-JSON decisions citing the deciding signals:

```json
{"decisions":[{"symbol":"BTCUSDT","action":"open_long","conviction":0.72,"sizePct":0.6,"reason":"technical + sentiment long, macro neutral, confluence +0.61"}]}
```

**With no LLM key**, a transparent **confluence rule engine** reads the same fused
signal and produces the same decision shape — so the agent is *always* runnable
and *always* explainable.

### Step 3 — Risk-gate & size · [`risk.js`](backend/src/engine/risk.js)
The brain proposes; risk disposes. `gateAndSize()` enforces a min conviction, max
concurrent positions, one position per symbol, and a daily loss halt; sizes by an
**ATR risk-budget** (risk ~1% of equity per trade, scaled by conviction) with a
leverage cap, stop = 2×ATR, take-profit = 3.2×ATR. **The risk layer is
deterministic code the model cannot override.**

### Step 4 — Execute · [`executor.js`](backend/src/engine/executor.js)
Routes the sized order: `paper` → internal [`paperBroker.js`](backend/src/engine/paperBroker.js);
`demo`/`live` → the **`bgc` CLI** (`bitget-client`). Stops/take-profits are checked
*before* new ideas each cycle.

### Step 5 — Sync · [`copytrader.js`](backend/src/engine/copytrader.js) + [`broadcaster.js`](backend/src/services/broadcaster.js)
On every fill we **fan out to subscribers**, trading each on *their own* account
(their encrypted keys, via `bgc`), sized **proportionally** to their equity ×
personal `riskFactor`. Simultaneously the event streams to every dashboard over
WebSocket and to Telegram with the human-readable reasoning.

---

## 5. Participation & privacy

**The website shows no user PII.** Account binding and copy-trade configuration
happen **only in the Telegram bot** — the site's "Trade with ren.ai" button
deep-links there. Keys are encrypted at rest with **AES-256-GCM**
([`secrets.js`](backend/src/secrets.js)); the public API exposes only **anonymized
community aggregates** (`subscribers`, `copying`, `alerting`, `totalMirrored`) —
never names, balances, or key tails. ren.ai only ever places **futures orders** —
never withdrawals.

```
/bind API_KEY SECRET PASSPHRASE   →  encrypted, verified
/mode copy | alert                →  mirror trades, or just get alerts
/risk 1.0                         →  scale your size vs a 1x mirror
/status                           →  agent + your subscription status
```

---

## 6. Project structure

```
backend/src/
  engine/      agent.js · perception.js · indicators.js · analysts.js
               brain.js · risk.js · executor.js · paperBroker.js · copytrader.js
  bitget/      publicClient.js (market data) · cli.js (bgc wrapper)
  services/    users.js (binding + community stats) · broadcaster.js (WS+TG hub)
  telegram/    bot.js (commands) · api.js (zero-dep Bot API)
  web/         server.js (Express REST + WebSocket)
  store.js · secrets.js · config.js · logger.js · tui.js · index.js
frontend/src/
  App.tsx · useRen.ts (WS+REST live state) · types.ts · theme.tsx
  lib/         format.ts · signals.ts
  components/  DecisionEngine · AgentCore · EquityChart · MarketGrid
               ThoughtStream · TradeTape · Positions · Community · TradeCTA
               Architecture · ThemeToggle · Background · ui
```

## 7. API reference

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/state` | Full snapshot: agent, positions, last tick (with signals + confluence), thoughts, trades, equity, **community aggregates**, capabilities |
| GET | `/api/thoughts` `/api/trades` `/api/equity` `/api/community` | Individual feeds (community = anonymized aggregates only) |
| POST | `/api/users/:id/{mode,risk,active}` | Admin controls (header `x-admin-token`) |
| WS | `/ws` | Live stream: `snapshot`, `tick`, `thought`, `trade`, `status` |

> There is **no web key-binding endpoint** — participation is Telegram-only by design.

---

## 8. Safety & honest scope

- **Default is paper.** No real orders until you explicitly set `demo`/`live` keys.
- The risk layer is deterministic and caps size/leverage regardless of the brain.
- `macro` / `market-intel` / `news` lenses are **simulated** unless the Agent Hub
  bridge is enabled — the dashboard labels every signal's provenance honestly.
- Copy-trade sizing is best-effort; always test with **Demo** keys.
- This is a hackathon MVP, not audited production software. **Not financial advice.**

Built with the Bitget Agent Hub toolchain (`bitget-client` / `bgc`) and an
OpenAI-compatible LLM. — *Perceive → Confluence → Risk → Execute → Sync.*
