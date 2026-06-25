import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, ArrowRight, ShieldCheck, ShieldAlert } from 'lucide-react';
import type { RenState, Signal, Snapshot, Thought } from '../types';
import { Panel, Pill, ScoreBar } from './ui';
import { SKILL_ORDER, SKILL_META, SOURCE_META, scoreVar, fmtScore, textTone, softTone } from '../lib/signals';

const ACTION_META: Record<string, { label: string; tone: string }> = {
  open_long: { label: 'OPEN LONG', tone: 'up' },
  open_short: { label: 'OPEN SHORT', tone: 'down' },
  close: { label: 'CLOSE', tone: 'warn' },
  hold: { label: 'HOLD', tone: 'edge' },
};

export function DecisionEngine({ s }: { s: RenState }) {
  const snaps = s.tick?.snapshots ?? [];
  const symbols = snaps.map((x) => x.symbol);
  const [sym, setSym] = useState<string | null>(null);
  const active = sym && symbols.includes(sym) ? sym : symbols[0];

  const snap = snaps.find((x) => x.symbol === active);
  const thought = useMemo<Thought | undefined>(
    () => [...s.thoughts].reverse().find((t) => t.symbol === active),
    [s.thoughts, active],
  );

  return (
    <Panel
      title="Decision Engine"
      icon={<Brain size={15} />}
      right={
        <div className="flex items-center gap-1">
          {symbols.map((x) => (
            <button
              key={x}
              onClick={() => setSym(x)}
              className={`num rounded-md px-2 py-1 text-[11px] font-semibold transition ${x === active ? 'bg-brand/15 text-brand border border-brand/30' : 'text-muted hover:text-ink border border-transparent'}`}
            >
              {x.replace('USDT', '')}
            </button>
          ))}
        </div>
      }
    >
      {!snap ? (
        <Loading />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
          {/* Lenses */}
          <div className="space-y-2.5">
            <div className="eyebrow mb-1">Agent Hub analyst lenses</div>
            {SKILL_ORDER.map((skill, i) => {
              const sig = (snap.signals || []).find((x) => x.skill === skill);
              return <SignalRow key={skill} skill={skill} sig={sig} delay={i * 0.05} />;
            })}
          </div>

          {/* Fusion -> conviction -> gate -> action */}
          <div className="flex flex-col gap-4 lg:border-l lg:border-edge lg:pl-5">
            <Confluence snap={snap} />
            <Pipeline snap={snap} thought={thought} />
          </div>
        </div>
      )}
    </Panel>
  );
}

function SignalRow({ skill, sig, delay }: { skill: string; sig?: Signal; delay: number }) {
  const meta = SKILL_META[skill];
  const Icon = meta.icon;
  const score = sig?.score ?? 0;
  const src = sig ? SOURCE_META[sig.source] : null;
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay }}
      className="flex items-center gap-3"
    >
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-edge bg-elev/50 text-muted">
        <Icon size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12.5px] font-semibold text-ink2">{meta.label}</span>
          <div className="flex items-center gap-2">
            {src && <Pill tone={src.tone}>{src.label}</Pill>}
            <span className="num text-[12px] font-semibold tabular" style={{ color: scoreVar(score) }}>{fmtScore(score)}</span>
          </div>
        </div>
        <div className="mt-1.5"><ScoreBar score={score} /></div>
        {sig?.summary && <div className="mt-1 text-[11px] text-muted truncate">{sig.summary}</div>}
      </div>
    </motion.div>
  );
}

function Confluence({ snap }: { snap: Snapshot }) {
  const c = snap.confluence;
  const score = c?.score ?? 0;
  const tone = score > 0.12 ? 'up' : score < -0.12 ? 'down' : 'muted';
  const dirLabel = c?.direction === 'long' ? 'Bullish' : c?.direction === 'short' ? 'Bearish' : 'Neutral';
  return (
    <div className="rounded-xl border border-edge bg-elev/30 p-4 text-center">
      <div className="eyebrow">Weighted Confluence</div>
      <motion.div
        key={score}
        initial={{ scale: 0.9, opacity: 0.6 }}
        animate={{ scale: 1, opacity: 1 }}
        className="num text-4xl font-bold mt-2 leading-none"
        style={{ color: scoreVar(score) }}
      >
        {fmtScore(score)}
      </motion.div>
      <div className={`text-[12px] font-semibold mt-1.5 ${textTone(tone)}`}>{dirLabel}</div>
      <div className="mt-3"><ScoreBar score={score} height={9} /></div>
      <div className="mt-3 flex justify-center gap-4 text-[11px] num text-muted">
        <span><b className="text-up">{c?.agree ?? 0}</b> agree</span>
        <span><b className="text-down">{c?.conflict ?? 0}</b> conflict</span>
      </div>
    </div>
  );
}

function Pipeline({ snap, thought }: { snap: Snapshot; thought?: Thought }) {
  const passed = thought?.allowed;
  const action = thought?.action || 'hold';
  const am = ACTION_META[action] || ACTION_META.hold;
  const conviction = thought ? Math.round((thought.conviction || 0) * 100) : null;

  return (
    <div className="space-y-2.5">
      <Step label="Conviction" tone="ai">
        {conviction === null ? <span className="text-muted">—</span> : <span className="num font-semibold">{conviction}%</span>}
      </Step>
      <Flow />
      <Step label="Risk Gate" tone={passed ? 'up' : 'warn'}>
        <span className="flex items-center gap-1.5 text-[12px] font-semibold">
          {passed ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
          {thought ? (passed ? 'Passed' : 'Held') : '—'}
        </span>
      </Step>
      <Flow />
      <AnimatePresence mode="wait">
        <motion.div
          key={action}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          className={`rounded-lg border px-3 py-2.5 text-center ${softTone(am.tone)}`}
        >
          <div className="eyebrow">Action · {snap.symbol.replace('USDT', '')}</div>
          <div className={`num text-[15px] font-bold mt-1 ${textTone(am.tone)}`}>{am.label}</div>
        </motion.div>
      </AnimatePresence>
      {thought?.reason && <div className="text-[11px] text-muted leading-relaxed pt-1">{thought.reason}</div>}
    </div>
  );
}

function Step({ label, tone, children }: { label: string; tone: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-edge bg-panel2/50 px-3 py-2">
      <span className="eyebrow">{label}</span>
      <span className={textTone(tone)}>{children}</span>
    </div>
  );
}
function Flow() {
  return (
    <div className="flex justify-center text-faint">
      <ArrowRight size={14} className="rotate-90" />
    </div>
  );
}
function Loading() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skel h-9 w-full" />)}
    </div>
  );
}
