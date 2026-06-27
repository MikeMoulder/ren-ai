import { motion } from 'framer-motion';
import { Radar } from 'lucide-react';
import type { RenState, Snapshot } from '../types';
import { Panel, Pill, ScoreBar } from './ui';
import { price as fmtPrice, pct } from '../lib/format';
import { scoreVar, fmtScore } from '../lib/signals';

const REGIME_TONE: Record<string, string> = { trend: 'brand', range: 'ai', unclear: 'edge' };

export function MarketGrid({ s }: { s: RenState }) {
  const snaps = s.tick?.snapshots ?? [];
  const src = s.tick?.dataSource;

  return (
    <Panel
      title="Market Perception"
      icon={<Radar size={15} />}
      right={src && <Pill tone={src === 'live' ? 'up' : 'warn'}>{src === 'live' ? 'live data' : 'synthetic'}</Pill>}
    >
      {snaps.length === 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => <div key={i} className="skel h-40 w-full" />)}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {snaps.map((snap, i) => <Card key={snap.symbol} snap={snap} delay={i * 0.05} />)}
        </div>
      )}
    </Panel>
  );
}

function Card({ snap, delay }: { snap: Snapshot; delay: number }) {
  const m = snap.metrics;
  const up = (snap.change24h ?? 0) >= 0;
  const conf = snap.confluence;
  const score = conf?.score ?? 0;
  const tr = snap.trend;
  const brk = tr?.active ? tr.side : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="rounded-xl border border-edge bg-panel2/40 p-3.5 card-hover"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="display text-[15px] font-bold">{snap.symbol.replace('USDT', '')}</span>
          <span className="text-[11px] text-faint">USDT</span>
        </div>
        <Pill tone={REGIME_TONE[snap.regime]}>{snap.regime}</Pill>
      </div>

      <div className="mt-2 flex items-baseline justify-between">
        <span className="num text-[18px] font-semibold">${fmtPrice(snap.price)}</span>
        <span className={`num text-[12px] font-medium ${up ? 'text-up' : 'text-down'}`}>{pct((snap.change24h ?? 0) / 100)}</span>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="eyebrow">Breakout signal</span>
        {brk ? (
          <Pill tone={brk === 'long' ? 'up' : 'down'}>{brk === 'long' ? '▲ LONG break' : '▼ SHORT break'}</Pill>
        ) : (
          <span className="text-[11px] text-faint">— watching</span>
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between">
        <span className="eyebrow">Confluence gate</span>
        <span className="num text-[12px] font-semibold" style={{ color: scoreVar(score) }}>{fmtScore(score)}</span>
      </div>
      <div className="mt-1.5"><ScoreBar score={score} /></div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Metric label="RSI" value={m.rsi.toFixed(0)} />
        <Metric label="ADX" value={m.adx.toFixed(0)} />
        <Metric label="ATR%" value={m.atrPct.toFixed(1)} />
      </div>
    </motion.div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-edge/60 bg-elev/40 py-1.5">
      <div className="eyebrow">{label}</div>
      <div className="num text-[13px] font-semibold mt-0.5">{value}</div>
    </div>
  );
}
