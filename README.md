# ren.ai — Autonomous Trading Agent on Bitget

**Bitget AI Base Camp Hackathon S1 · Track 1 · Trading Agent**

ren.ai is an AI trading agent that watches the crypto market on its own, decides when to trade, places the trades, and manages the risk — no human in the loop. Every decision and every trade is shown live on a public dashboard.

### 🔗 Live links (no login needed)

| What | Link |
| --- | --- |
| **Live dashboard** | **https://ren-trading-ai.duckdns.org** |
| **Download trade log (CSV)** | https://ren-trading-ai.duckdns.org/api/trades.csv |
| **Live trade feed (JSON)** | https://ren-trading-ai.duckdns.org/api/trades |
| **Backtest report** | [backtest_log.md](backtest_log.md) |
| **How the strategy works** | [strategy_details.md](strategy_details.md) |

---

## 1. What problem it solves

Most "trading bots" follow fixed if-this-then-that rules. They can't read the wider market — the trend, the crowd, the news, the macro backdrop — and weigh it all before acting.

ren.ai does. It runs a full loop every few seconds: **look at the market → form a view → check the risk → trade → record it.** It trades only when several independent signals agree, and a hard risk layer can always veto. The goal isn't to trade often — it's to trade only when the odds are genuinely in its favour, and to prove it openly with a live, downloadable record.

## 2. The strategy (the thesis)

The core edge is a **trend-breakout** strategy, validated on real Bitget data before going live. In plain words:

- **Only trade with the trend.** Go long only when the market is already trending up (fast moving average above slow), short only when trending down. Never fight the tide.
- **Enter on a breakout.** Buy when price breaks above its recent high; sell short when it breaks below its recent low. A breakout in the direction of the trend is the signal that a move is starting.
- **Cut losers fast, let winners run.** There's no fixed profit target. Losing trades are stopped out quickly at a small, fixed loss; winning trades are held with a trailing stop that follows the price. Most trades are small losses — but the occasional big winner more than pays for them.

That asymmetry (many small losses, a few large wins) is the whole point. Full detail and the exact rules are in **[strategy_details.md](strategy_details.md)**.

Before any trade is placed, the idea also has to pass a **five-lens confluence check** — technical, sentiment, macro, on-chain/market-intel, and news. If those lenses disagree with the trade, it's skipped. This is where the Bitget Agent Hub skills plug in.

## 3. How it works (and how to run it)

ren.ai runs one simple loop on a schedule:

```
Perceive  →  Decide  →  Risk  →  Execute  →  Sync
(market)     (signals)   (gate)   (order)    (dashboard)
```

1. **Perceive** — pull live 4-hour candles from Bitget, work out the trend and indicators.
2. **Decide** — run the trend-breakout strategy and the five confluence lenses.
3. **Risk** — size the position (risk 1% of equity per trade), enforce hard limits (max 2 open positions, capped leverage, daily loss limit). The risk layer always wins.
4. **Execute** — place the trade on the chosen account (paper / demo / live).
5. **Sync** — stream the decision and the trade to the dashboard, the trade log, and (optionally) a Telegram copy-trade bot.

### Run it locally

Requirements: **Node.js 20+**.

```bash
git clone <your-repo-url>
cd "Bitget AI"
npm run install:all          # installs root + backend + frontend
cp .env.example .env         # then edit .env (see below)
npm start                    # builds the frontend and starts the agent + dashboard
```

Open **http://localhost:8787** — the dashboard, API, and live trade feed are all served from there.

The agent runs in **paper mode by default — no API keys and no real money are needed** to see it work. To go further, set these in `.env`:

| Setting | What it does |
| --- | --- |
| `TRADING_MODE` | `paper` (default, simulated), `demo` (Bitget testnet), or `live` |
| `SYMBOLS` | Which markets to watch, e.g. `BTCUSDT,ETHUSDT` |
| `BITGET_API_KEY` / `SECRET_KEY` / `PASSPHRASE` | Needed only for `demo` / `live` |
| `AGENT_HUB_ENABLED` | Turn on the Bitget Agent Hub skill lenses |
| `LLM_API_KEY` | Optional — let an LLM narrate/assist the decision |

## 4. The trade log (the proof)

Every trade the agent makes is written to an **append-only CSV ledger** you can download and audit. Each row has the timestamp, market, direction, price, size, leverage, stop, profit/loss, and the account balance before and after — exactly the fields the hackathon asks for.

- **Download the live log:** https://ren-trading-ai.duckdns.org/api/trades.csv
- **Live JSON feed:** https://ren-trading-ai.duckdns.org/api/trades
- It's also in the repo at [backend/data/trades.csv](backend/data/trades.csv).

You can also click **CSV** / **JSON** in the dashboard's Trade Log panel to open either directly.

## 5. The backtest (the evidence)

The trend-breakout edge was tested on **10 crypto markets, 4-hour candles, ~5,000 bars each**, net of trading fees and slippage. Splitting the data into a training half and an unseen test half:

| | Trades | Win rate | Expectancy | Return | Max drawdown |
| --- | --- | --- | --- | --- | --- |
| **Out-of-sample (test)** | 51 | 47% | **+0.445R** | **+22.7%** | 7% |

The strategy stays profitable on data it never saw — which is the test that matters. The full report, the exact command to reproduce it, and the honest caveats are in **[backtest_log.md](backtest_log.md)**. The backtest uses the *same* strategy code the live agent runs, so the two can't drift apart.

---

## Tech stack

- **Backend:** Node.js, Express, WebSocket — the agent loop, Bitget data, risk, paper broker, trade ledger.
- **Frontend:** React + Vite + Tailwind — the live dashboard.
- **Bitget Agent Hub:** the five analyst skill lenses (macro, sentiment, technical, market-intel, news) feed the confluence check.
- **Deploy:** a single Node process serves the dashboard, the API, and the live feed; bound to a public HTTPS URL via Caddy.

## Repo map

| Path | What's there |
| --- | --- |
| [backend/src/engine/](backend/src/engine/) | the loop, strategies, risk, broker, confluence lenses |
| [backend/src/engine/strategies/trendBreakout.js](backend/src/engine/strategies/trendBreakout.js) | the live strategy (shared with the backtest) |
| [backend/src/backtest/](backend/src/backtest/) | reproducible backtests |
| [backend/data/trades.csv](backend/data/trades.csv) | the trade ledger |
| [frontend/src/](frontend/src/) | the dashboard |
| [strategy_details.md](strategy_details.md) · [backtest_log.md](backtest_log.md) | strategy + evidence |

## Disclaimer

ren.ai runs in **paper mode** by default and is built for the hackathon. Nothing here is financial advice. Live trading uses real money and real risk — only enable it if you understand and accept that.

*Built for Bitget AI Base Camp Hackathon S1.*
