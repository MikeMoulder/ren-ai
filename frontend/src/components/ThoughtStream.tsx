import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BrainCircuit, Check, Ban, ChevronDown } from 'lucide-react';
import type { RenState, Thought } from '../types';
import { Panel, Pill, ScoreBar } from './ui';
import { clock } from '../lib/format';
import { SKILL_META, SOURCE_META, scoreVar, fmtScore } from '../lib/signals';

const ACTION_LABEL: Record<string, string> = {
  open_long: 'LONG', open_short: 'SHORT', close: 'CLOSE', hold: 'HOLD',
};
const ACTION_TONE: Record<string, string> = {
  open_long: 'up', open_short: 'down', close: 'warn', hold: 'edge',
};

export function ThoughtStream({ s }: { s: RenState }) {
  const thoughts = [...s.thoughts].reverse().slice(0, 40);
  return (
    <Panel
      title="Reasoning Stream"
      icon={<BrainCircuit size={15} />}
      right={<span className="num text-[11px] text-muted">{s.capabilities?.llm || 'confluence-rules'}</span>}
      bodyClass="overflow-y-auto max-h-[460px]"
    >
      {thoughts.length === 0 ? (
        <div className="text-muted text-sm py-6 text-center">Waiting for the first decision…</div>
      ) : (
        <div className="space-y-1.5">
          <AnimatePresence initial={false}>
            {thoughts.map((t) => <Row key={t.at + t.symbol} t={t} />)}
          </AnimatePresence>
        </div>
      )}
    </Panel>
  );
}

function Row({ t }: { t: Thought }) {
  const [open, setOpen] = useState(false);
  const tone = ACTION_TONE[t.action] || 'edge';
  const conf = t.confluence;
  const hasDetail = (t.signals?.length ?? 0) > 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="rounded-lg border border-edge/70 bg-panel2/40 overflow-hidden"
    >
      <button
        onClick={() => hasDetail && setOpen((o) => !o)}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
      >
        <span className="mt-0.5">
          {t.allowed ? <Check size={14} className="text-up" /> : <Ban size={14} className="text-muted" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="num text-[12px] font-bold">{t.symbol.replace('USDT', '')}</span>
            <Pill tone={tone}>{ACTION_LABEL[t.action] || t.action}</Pill>
            {conf && (
              <span className="num text-[11px] font-semibold" style={{ color: scoreVar(conf.score) }}>
                conf {fmtScore(conf.score)}
              </span>
            )}
            <span className="num text-[10.5px] text-faint ml-auto">{clock(t.at)}</span>
          </div>
          <div className="text-[12px] text-ink2 mt-1 leading-snug">{t.reason}</div>
          {!t.allowed && t.gate !== 'passed' && (
            <div className="text-[10.5px] text-warn mt-1">gate: {t.gate}</div>
          )}
        </div>
        {hasDetail && (
          <ChevronDown size={14} className={`mt-0.5 text-faint transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && hasDetail && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="px-3 pb-3 pt-0.5 border-t border-edge/60"
          >
            <div className="eyebrow mt-2 mb-2">Signal confluence</div>
            <div className="space-y-2">
              {t.signals!.map((sig) => {
                const meta = SKILL_META[sig.skill];
                const src = SOURCE_META[sig.source];
                return (
                  <div key={sig.skill} className="flex items-center gap-2.5">
                    <span className="w-[88px] shrink-0 text-[11px] text-muted">{meta?.label || sig.skill}</span>
                    <div className="flex-1"><ScoreBar score={sig.score} height={6} /></div>
                    <span className="num w-10 text-right text-[11px] font-semibold" style={{ color: scoreVar(sig.score) }}>{fmtScore(sig.score)}</span>
                    <Pill tone={src.tone}>{src.label}</Pill>
                  </div>
                );
              })}
            </div>
            {t.sized && (
              <div className="num mt-3 grid grid-cols-3 gap-2 text-[11px] text-muted">
                <span>size {t.sized.size}</span>
                <span>lev {t.sized.leverage}x</span>
                <span>risk ${t.sized.riskUsd}</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
