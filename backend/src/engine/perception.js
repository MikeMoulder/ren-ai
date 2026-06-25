import { getTicker, getCandles } from '../bitget/publicClient.js';
import { classifyRegime } from './indicators.js';
import { gatherSignals, confluence } from './analysts.js';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// The agent's "senses". For each symbol we fetch live candles + ticker and
// distill them into a compact, model-friendly snapshot: regime, directional
// bias, key indicator values, funding (a positioning/sentiment proxy).
//
// We then run the five Agent Hub analyst lenses (technical, sentiment, macro,
// market-intel, news) over the snapshot and fuse them into a `confluence`
// conviction read — the multi-signal core of the strategy.
// ---------------------------------------------------------------------------

export async function perceive() {
  const snapshots = [];
  let dataSource = 'live';

  for (const symbol of config.symbols) {
    const [{ candles, source }, ticker] = await Promise.all([
      getCandles(symbol, 200),
      getTicker(symbol),
    ]);
    if (source !== 'live' || ticker.source !== 'live') dataSource = 'synthetic';

    const closes = candles.map((c) => c.c);
    const regime = classifyRegime({ closes, candles });

    // Funding sign as a crowd-positioning signal: very positive funding =>
    // crowded longs (fade risk); very negative => crowded shorts.
    const funding = ticker.fundingRate ?? 0;
    const positioning =
      funding > 0.0003 ? 'crowded-long' : funding < -0.0003 ? 'crowded-short' : 'balanced';

    const snapshot = {
      symbol,
      price: ticker.price,
      change24h: ticker.change24h,
      regime: regime.regime,
      bias: regime.bias,
      metrics: regime.metrics,
      funding: Number(funding.toFixed?.(6) ?? funding),
      positioning,
      signals: [], // five analyst lenses, filled below
      confluence: null, // fused conviction read
    };

    // Run the five analyst lenses and fuse them.
    snapshot.signals = await gatherSignals(snapshot);
    snapshot.confluence = confluence(snapshot.signals);

    snapshots.push(snapshot);
  }

  return { at: Date.now(), dataSource, snapshots };
}
