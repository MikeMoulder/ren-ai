import { useMemo } from 'react';
import { Panel } from './ui';
import { LineChart } from 'lucide-react';
import type { RenState } from '../types';
import { usd } from '../lib/format';

export function EquityChart({ s }: { s: RenState }) {
  const data = s.equityCurve.length ? s.equityCurve : [{ t: Date.now(), equity: s.agent.equity }];
  const W = 760;
  const H = 220;
  const P = 8;

  const { area, line, last, min, max, up } = useMemo(() => {
    const vals = data.map((d) => d.equity);
    const mn = Math.min(...vals, s.agent.startEquity);
    const mx = Math.max(...vals, s.agent.startEquity);
    const span = mx - mn || 1;
    const xy = data.map((d, i) => {
      const x = P + (i / Math.max(data.length - 1, 1)) * (W - P * 2);
      const y = P + (1 - (d.equity - mn) / span) * (H - P * 2);
      return [x, y];
    });
    const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    const area = `${line} L${xy[xy.length - 1][0].toFixed(1)} ${H} L${xy[0][0].toFixed(1)} ${H} Z`;
    return { area, line, last: xy[xy.length - 1], min: mn, max: mx, up: vals[vals.length - 1] >= s.agent.startEquity };
  }, [data, s.agent.startEquity]);

  const stroke = up ? 'var(--up)' : 'var(--down)';

  return (
    <Panel title="Equity Curve" icon={<LineChart size={15} />} right={<span className="num text-xs text-muted">{data.length} pts · {s.agent.mode}</span>}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 220 }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.32" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {(() => {
          const span = max - min || 1;
          const y = P + (1 - (s.agent.startEquity - min) / span) * (H - P * 2);
          return <line x1={0} x2={W} y1={y} y2={y} stroke="var(--edge2)" strokeDasharray="4 5" strokeWidth={1} />;
        })()}
        <path d={area} fill="url(#eqfill)" />
        <path d={line} fill="none" stroke={stroke} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
        {last && (
          <>
            <circle cx={last[0]} cy={last[1]} r={4} fill={stroke} />
            <circle cx={last[0]} cy={last[1]} r={8} fill={stroke} opacity={0.25}>
              <animate attributeName="r" values="6;12;6" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.3;0;0.3" dur="2s" repeatCount="indefinite" />
            </circle>
          </>
        )}
      </svg>
      <div className="mt-2 flex justify-between text-xs text-muted num">
        <span>low ${usd(min)}</span>
        <span>start ${usd(s.agent.startEquity)}</span>
        <span>high ${usd(max)}</span>
      </div>
    </Panel>
  );
}
