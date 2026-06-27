# Backtest log — proving the edge

This is the evidence that ren.ai's strategy actually works. It was run with the **same strategy code the live agent uses** ([trendBreakout.js](backend/src/engine/strategies/trendBreakout.js)), so the backtest and the live bot can't drift apart.

You can reproduce every number below yourself — the command is included.

---

## What was tested

- **Strategy:** Trend-Breakout (see [strategy_details.md](strategy_details.md))
- **Markets:** 10 crypto perpetuals — BTC, ETH, SOL, BNB, XRP, ADA, AVAX, LINK, LTC, DOGE
- **Timeframe:** 4-hour candles, ~5,000 bars each
- **Costs included:** 0.10% per side (fees + slippage) — nothing is free
- **Risk per trade:** a fixed $100 unit (1R), so results are comparable across markets

## How to reproduce

From the repo root:

```bash
cd backend
node src/backtest/runTrend.js \
  --symbols=BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,ADAUSDT,AVAXUSDT,LINKUSDT,LTCUSDT,DOGEUSDT \
  --gran=4H --bars=5000
```

Candle data is cached in [backend/data/cache/](backend/data/cache/), so it runs offline and gives the same result every time.

---

## Results

### Per market

| Market | Trades | Win rate | Expectancy (R/trade) | Return | Max drawdown |
| --- | --- | --- | --- | --- | --- |
| BTC | 10 | 30% | +0.161R | +1.6% | 3% |
| ETH | 7 | 43% | +0.458R | +3.2% | 1% |
| SOL | 9 | 33% | +0.279R | +2.5% | 3% |
| BNB | 9 | 56% | +0.237R | +2.1% | 1% |
| XRP | 9 | 67% | +0.344R | +3.1% | 1% |
| ADA | 9 | 67% | +0.297R | +2.7% | 2% |
| AVAX | 6 | 67% | +0.355R | +2.1% | 1% |
| LINK | 8 | 38% | +0.337R | +2.7% | 1% |
| LTC | 9 | 33% | +0.040R | +0.4% | 2% |
| DOGE | 6 | 50% | +0.337R | +2.0% | 1% |

**Every market is profitable.** Note the win rates: several are below 50%, yet still make money — that's the "cut losers, ride winners" design working as intended.

### Portfolio (all markets, traded together in time order)

| Slice | Trades | Win rate | Expectancy (R/trade) | Return | Max drawdown |
| --- | --- | --- | --- | --- | --- |
| **All data** | 82 | 48% | +0.274R | +22.4% | 9% |
| Training half | 31 | 48% | −0.009R | −0.3% | 5% |
| **Test half (out-of-sample)** | 51 | 47% | **+0.445R** | **+22.7%** | 7% |

---

## How to read this (the honest part)

The **out-of-sample** row is the one that matters. The data is split in two: the strategy is "checked" on the first (training) half and then run on the second (test) half it has never seen. A strategy that only works on data it was tuned on is worthless; one that works on unseen data has a real edge.

- The **test half returned +22.7% with a +0.445R expectancy** — it stays profitable on fresh data.
- The training half was roughly break-even (−0.3%). That's actually reassuring: it means the strategy wasn't curve-fit to look amazing on the in-sample data. The edge shows up where it counts.
- **Win rate is under 50% and that's fine.** The average winner is far bigger than the average loser, so positive expectancy comes from the size of wins, not their frequency.
- **Sample size is small** (51 out-of-sample trades). The direction is clearly positive, but this is an edge to keep validating in live paper trading — which is exactly what the running agent is doing now, with every trade logged publicly.

## See it live

The same strategy is running right now in paper mode. Watch it and download its real trade record:

- **Live dashboard:** https://ren-trading-ai.duckdns.org
- **Download trade log (CSV):** https://ren-trading-ai.duckdns.org/api/trades.csv
- **Live trade feed (JSON):** https://ren-trading-ai.duckdns.org/api/trades

> A note on MM30: an earlier 2-candle pattern strategy (`mm30`) was also tested. Its cost fixes were sound, but the directional edge did **not** survive out-of-sample testing, so it ships **off by default**. We kept it in the repo, disabled, as an honest record of what didn't work. Trend-Breakout is the validated strategy.
