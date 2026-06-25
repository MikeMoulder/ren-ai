import { motion } from 'framer-motion';
import { Panel } from './ui';
import { Eye, BrainCircuit, ShieldHalf, Zap, Share2, ArrowRight } from 'lucide-react';

const STAGES = [
  { icon: Eye, name: 'Perceive', tone: 'var(--brand)', desc: 'Live Bitget candles + 5 Agent Hub analyst lenses (technical, sentiment, macro, market-intel, news).' },
  { icon: BrainCircuit, name: 'Confluence', tone: 'var(--ai)', desc: 'The LLM calls each skill as a tool and fuses them into one weighted conviction — rule engine fallback keeps it always runnable.' },
  { icon: ShieldHalf, name: 'Risk-gate', tone: 'var(--warn)', desc: 'ATR risk-budget sizing, max positions, conviction floor, daily loss halt — deterministic code the model cannot override.' },
  { icon: Zap, name: 'Execute', tone: 'var(--brand2)', desc: 'Market order on the agent account: paper sim, Bitget demo, or live — one flag.' },
  { icon: Share2, name: 'Sync', tone: 'var(--up)', desc: 'Mirror to each subscriber’s own account, scaled to their equity & risk; alert via Telegram + this dashboard.' },
];

export function Architecture() {
  return (
    <Panel title="How ren.ai thinks — the autonomous loop">
      <div className="grid gap-3 lg:grid-cols-5">
        {STAGES.map((st, i) => (
          <motion.div
            key={st.name}
            initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            transition={{ delay: i * 0.08 }}
            className="relative rounded-xl border border-edge bg-panel2/50 p-4"
          >
            <div className="grid h-10 w-10 place-items-center rounded-lg mb-3" style={{ background: `color-mix(in oklab, ${st.tone} 12%, transparent)`, color: st.tone }}>
              <st.icon size={18} />
            </div>
            <div className="display font-semibold">{i + 1}. {st.name}</div>
            <div className="text-[12px] text-muted mt-1 leading-snug">{st.desc}</div>
            {i < STAGES.length - 1 && (
              <ArrowRight size={16} className="hidden lg:block absolute -right-2.5 top-1/2 -translate-y-1/2 text-edge2 z-10" />
            )}
          </motion.div>
        ))}
      </div>
      <p className="text-[12px] text-muted mt-4 leading-relaxed">
        The loop runs every <span className="text-ink num">LOOP_SECONDS</span>. Stops &amp; take-profits are
        checked <i>before</i> new ideas each cycle, so risk management always wins the tie. Built on the
        Bitget Agent Hub toolchain — a full perceive→reason→act loop with no human in the middle.
      </p>
    </Panel>
  );
}
