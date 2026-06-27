import { motion } from 'framer-motion';
import { Panel } from './ui';
import { Eye, BrainCircuit, ShieldHalf, Zap, Share2 } from 'lucide-react';

const STAGES = [
  { icon: Eye, name: 'Perceive', tone: 'var(--brand)', desc: 'Live 4H Bitget candles → the Trend-Breakout signal (EMA50/200 + breakout) plus 5 Agent Hub lenses (technical, sentiment, macro, market-intel, news).' },
  { icon: BrainCircuit, name: 'Decide', tone: 'var(--ai)', desc: 'Two pillars: the mechanical breakout fires the entry; the LLM + confluence lenses confirm or VETO it. A validated edge, gated by agentic reasoning.' },
  { icon: ShieldHalf, name: 'Risk-gate', tone: 'var(--warn)', desc: 'ATR risk-budget sizing, max positions, conviction floor, daily loss halt — deterministic code the model cannot override.' },
  { icon: Zap, name: 'Execute', tone: 'var(--brand2)', desc: 'Market order on the agent account (paper / demo / live). A chandelier trailing stop ratchets to ride winners and cut losers — checked before new ideas.' },
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
          </motion.div>
        ))}
      </div>
      <p className="text-[12px] text-muted mt-4 leading-relaxed">
        Every cycle the trailing stop is ratcheted and any hit stop is closed <i>before</i> new ideas, so
        risk management always wins the tie. The strategy is a validated trend-breakout edge; the LLM and
        five Agent Hub lenses are the agentic layer that gates it — a full perceive → decide → act loop
        with no human in the middle.
      </p>
    </Panel>
  );
}
