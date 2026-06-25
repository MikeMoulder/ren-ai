import { Panel, Pill } from './ui';
import { Layers } from 'lucide-react';
import type { RenState } from '../types';
import { price, signed } from '../lib/format';

export function Positions({ s }: { s: RenState }) {
  const pos = s.positions || [];
  return (
    <Panel title="Open Positions" icon={<Layers size={15} />} right={<Pill tone="brand">{pos.length} live</Pill>}>
      {pos.length === 0 ? (
        <div className="text-muted text-sm py-6 text-center">Flat — no open exposure.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="py-1.5 font-medium">Symbol</th>
                <th className="font-medium">Side</th>
                <th className="font-medium text-right">Size</th>
                <th className="font-medium text-right">Entry</th>
                <th className="font-medium text-right">Mark</th>
                <th className="font-medium text-right">uPnL</th>
              </tr>
            </thead>
            <tbody className="num">
              {pos.map((p) => {
                const up = (p.uPnl ?? 0) >= 0;
                return (
                  <tr key={p.symbol} className="border-t border-edge/60">
                    <td className="py-2.5 display font-semibold">{p.symbol.replace('USDT', '')}</td>
                    <td><Pill tone={p.side === 'long' ? 'up' : 'down'}>{p.side}</Pill></td>
                    <td className="text-right">{p.size}</td>
                    <td className="text-right">${price(p.entry)}</td>
                    <td className="text-right">${price(p.markPrice ?? p.entry)}</td>
                    <td className={`text-right font-semibold ${up ? 'text-up' : 'text-down'}`}>{signed(p.uPnl ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
