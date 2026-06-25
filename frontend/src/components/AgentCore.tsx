import { motion } from 'framer-motion';
import type { RenState } from '../types';
import { AnimatedNumber } from './ui';
import { signed, pct } from '../lib/format';

const STATUS: Record<string, { label: string; color: string; sub: string }> = {
  booting: { label: 'Booting', color: 'var(--muted)', sub: 'initializing' },
  idle: { label: 'Monitoring', color: 'var(--brand)', sub: 'scanning the market' },
  thinking: { label: 'Reasoning', color: 'var(--ai)', sub: 'fusing signals' },
  trading: { label: 'Executing', color: 'var(--warn)', sub: 'placing orders' },
};

export function AgentCore({ s }: { s: RenState }) {
  const st = STATUS[s.agent.status] || STATUS.idle;
  const pnl = (s.agent.equity || 0) - (s.agent.startEquity || 0);
  const pnlPct = s.agent.startEquity ? pnl / s.agent.startEquity : 0;
  const up = pnl >= 0;
  const c = st.color;

  return (
    <div className="flex flex-col items-center w-full">
      <div className="eyebrow self-start mb-1">Agent Core</div>

      <div className="relative h-[150px] w-[150px] my-2">
        <span className="absolute inset-0 rounded-full border" style={{ borderColor: c, opacity: 0.25, animation: 'ring 2.8s ease-out infinite' }} />
        <div className="absolute inset-1 rounded-full border border-dashed border-edge2/70" style={{ animation: 'spin-slow 26s linear infinite' }} />
        <div className="absolute inset-4 rounded-full border border-edge/60" />

        <motion.div
          className="absolute inset-[26%] rounded-full grid place-items-center"
          animate={{ scale: s.agent.status === 'thinking' ? [1, 1.06, 1] : [1, 1.02, 1] }}
          transition={{ duration: s.agent.status === 'thinking' ? 1.1 : 2.6, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            background: `radial-gradient(circle at 35% 30%, color-mix(in oklab, ${c} 30%, transparent), var(--panel) 72%)`,
            border: `1px solid color-mix(in oklab, ${c} 45%, transparent)`,
            boxShadow: `0 0 34px -10px ${c}`,
          }}
        >
          <span className="display text-[12px] font-bold tracking-wider" style={{ color: c }}>◆</span>
        </motion.div>

        <span className="absolute left-1/2 -top-0.5 -translate-x-1/2 h-2 w-2 rounded-full" style={{ background: c, boxShadow: `0 0 8px ${c}`, animation: 'spin-slow 8s linear infinite' }} />
      </div>

      <div className="flex items-center gap-2 mt-1">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
        <span className="text-[13px] font-semibold" style={{ color: c }}>{st.label}</span>
        <span className="text-muted text-[12px]">· {st.sub}</span>
      </div>

      <div className="w-full mt-4 pt-4 border-t border-edge text-center">
        <div className="eyebrow">Net Asset Value</div>
        <div className="num text-3xl font-semibold mt-1.5"><AnimatedNumber value={s.agent.equity || 0} prefix="$" /></div>
        <div className={`num text-[12.5px] font-medium mt-1.5 ${up ? 'text-up' : 'text-down'}`}>
          {signed(pnl)} · {pct(pnlPct)}
        </div>
      </div>
    </div>
  );
}
