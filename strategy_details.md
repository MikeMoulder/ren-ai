# Strategy details — how ren.ai decides to trade

This explains, in plain language, exactly what the agent does. The full numbers behind it are in [backtest_log.md](backtest_log.md), and you can watch it work live at **https://ren-trading-ai.duckdns.org**.

---

## The idea in one sentence

**Trade only in the direction of the trend, get in when price breaks out, cut losses quickly, and let the winners run.**

That's it. It's a classic trend-following approach — the kind that has worked across markets for decades — built so that a few big winning trades pay for many small losing ones.

---

## The three rules

### Rule 1 — Only trade with the trend

ren.ai looks at two moving averages of the price: a fast one (50 candles) and a slow one (200 candles).

- Fast **above** slow → the market is trending **up** → the agent will only look for **buys (long)**.
- Fast **below** slow → the market is trending **down** → the agent will only look for **sells (short)**.

It never trades against the trend. This one filter does most of the work.

### Rule 2 — Get in on a breakout

Being in an uptrend isn't enough — the agent waits for proof the move is continuing.

- In an uptrend, it **buys** when price closes **above the highest high of the last 10 candles**.
- In a downtrend, it **sells short** when price closes **below the lowest low of the last 10 candles**.

A breakout in the direction of the trend is the trigger.

### Rule 3 — Cut losers, ride winners (the trailing stop)

This is where the money is made.

- When a trade is opened, a **stop-loss** is placed a set distance away (3× the market's recent volatility, measured by ATR). If price hits it, the trade is closed for a small loss.
- There is **no fixed profit target.** Instead, as a trade moves into profit, the stop **trails behind** the price — it only ever moves in the agent's favour, never backwards.
- A losing trade is closed fast at about **1R** (one unit of risk). A winning trade is left alone to run as far as the trend takes it.

The result: the agent is often wrong (win rate under 50%), but its winners are much bigger than its losers, so it still comes out ahead. **"R"** below just means "one unit of risk" — a trade that makes twice what it risked is +2R.

---

## The safety check — five-lens confluence

Before a breakout trade is actually placed, it has to pass a second opinion. ren.ai consults five independent "analyst lenses," modelled on the **Bitget Agent Hub** skills:

| Lens | Looks at |
| --- | --- |
| **Technical** | Trend strength, momentum, indicators |
| **Sentiment** | How the crowd is positioned (funding, fear/greed) |
| **Macro** | Rates, the dollar, risk-on vs risk-off |
| **Market-intel** | On-chain flows, ETF flows, whales |
| **News** | Headlines and narrative |

Each lens gives a score from bearish to bullish. They're blended into one **confluence score** (technical carries the most weight). If the lenses clearly disagree with the breakout, the trade is **skipped**. Confidence from the lenses also nudges how big the position is.

---

## The risk manager — always has the final say

No matter what the strategy or the lenses say, every trade passes through a hard risk layer that can veto or shrink it:

- **Risk only 1% of the account per trade** — position size is calculated from the stop distance, so a wider stop means a smaller position.
- **At most 2 positions open at once.**
- **Leverage is capped** so the account can't be over-exposed.
- **Daily loss limit:** after a -6% day, no new trades are opened.

The strategy proposes; risk disposes. This is what keeps a losing streak from becoming a blow-up.

---

## Why this approach

- **It's honest about being wrong.** It doesn't need to predict the future — it just follows trends and manages losses. Most trades lose a little; a few win big.
- **It's proven before it's trusted.** The exact same code was backtested on 10 markets and stayed profitable on data it had never seen (see [backtest_log.md](backtest_log.md)).
- **It's something only an agent can do well.** Running this loop across many markets, 24/7, weighing five different signal sources on every candle, and never breaking its own risk rules — that's the part a human can't do consistently, and an autonomous agent can.

---

## The settings (for reference)

| Setting | Value | Meaning |
| --- | --- | --- |
| Timeframe | 4-hour candles | The timeframe the edge was validated on |
| Trend filter | EMA 50 vs EMA 200 | Direction of the trend |
| Breakout | 10 candles | Recent high/low that price must break |
| Stop & trail | 3 × ATR | Stop distance and trailing distance |
| Risk per trade | 1% of equity | How much is risked on each trade |
| Max positions | 2 | Open trades at once |
| Daily loss limit | 6% | Pause new trades after a bad day |

All of these are configurable in `.env`. The defaults above are what the agent runs live.
