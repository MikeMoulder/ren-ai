import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Receipt, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import type { RenState, Trade } from '../types';
import { Panel, Pill } from './ui';
import { price, signed, clock } from '../lib/format';

type Filter = 'all' | 'open' | 'close';

function Row({ t }: { t: Trade }) {
  const isClose = t.type === 'close';
  const long = t.side === 'long';
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3 py-2 border-b border-edge/40 last:border-0"
    >
      <span className={`grid place-items-center h-7 w-7 rounded-lg ${long ? 'bg-up/10 text-up' : 'bg-down/10 text-down'}`}>
        {long ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="display font-semibold text-sm">{t.symbol.replace('USDT', '')}</span>
          <Pill tone={isClose ? 'warn' : long ? 'up' : 'down'}>{isClose ? `close ${t.why || ''}` : t.action.replace('_', ' ')}</Pill>
        </div>
        <div className="num text-[11px] text-muted truncate">@ ${price(t.price)} · {t.size}{t.leverage ? ` · ${t.leverage}x` : ''}</div>
      </div>
      <div className="text-right">
        {isClose && t.pnl !== undefined
          ? <span className={`num text-sm font-semibold ${t.pnl >= 0 ? 'text-up' : 'text-down'}`}>{signed(t.pnl)}</span>
          : <span className="num text-[11px] text-muted">${t.notional ? Math.round(t.notional) : ''}</span>}
        <div className="num text-[10px] text-faint">{clock(t.at)}</div>
      </div>
    </motion.div>
  );
}

export function TradeTape({ s }: { s: RenState }) {
  const [filter, setFilter] = useState<Filter>('all');
  const all = [...s.trades].reverse();
  const items = (filter === 'all' ? all : all.filter((t) => t.type === filter)).slice(0, 50);

  return (
    <Panel
      title="Trade Log"
      icon={<Receipt size={15} />}
      right={
        <div className="flex items-center gap-1">
          {(['all', 'open', 'close'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-2 py-1 text-[11px] font-semibold capitalize transition ${filter === f ? 'bg-brand/15 text-brand' : 'text-muted hover:text-ink'}`}
            >
              {f}
            </button>
          ))}
        </div>
      }
      className="h-full"
    >
      <div className="max-h-[460px] overflow-y-auto pr-1">
        <AnimatePresence initial={false}>
          {items.length === 0
            ? <div className="text-muted text-sm py-6 text-center">No trades yet — the agent is being selective.</div>
            : items.map((t, i) => <Row key={`${t.at}-${i}`} t={t} />)}
        </AnimatePresence>
      </div>
    </Panel>
  );
}
