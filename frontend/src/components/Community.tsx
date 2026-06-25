import { Users, Send, Copy, Bell } from 'lucide-react';
import type { RenState } from '../types';
import { Panel, AnimatedNumber } from './ui';

export function Community({ s, onTrade }: { s: RenState; onTrade: () => void }) {
  const c = s.community || { subscribers: 0, copying: 0, alerting: 0, totalMirrored: 0 };
  return (
    <Panel title="Community" icon={<Users size={15} />}>
      <div className="grid grid-cols-2 gap-2.5">
        <Stat icon={<Users size={14} />} label="Subscribers" value={c.subscribers} tone="text-ink" />
        <Stat icon={<Copy size={14} />} label="Auto-copying" value={c.copying} tone="text-brand" />
        <Stat icon={<Bell size={14} />} label="Alert-only" value={c.alerting} tone="text-ink2" />
        <Stat icon={<Send size={14} />} label="Trades mirrored" value={c.totalMirrored} tone="text-ai" />
      </div>

      <div className="mt-4 rounded-xl border border-edge bg-elev/30 p-4">
        <div className="text-[13px] font-semibold">Trade alongside ren.ai</div>
        <p className="text-[12px] text-muted mt-1.5 leading-relaxed">
          Bind your Bitget keys and configure copy-trading securely in the Telegram bot —
          never on this site. Every move mirrors to your own account, scaled to your risk.
        </p>
        <button
          onClick={onTrade}
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand px-3.5 py-2 text-[13px] font-semibold text-void hover:brightness-110 transition"
        >
          <Send size={14} /> Trade with ren.ai
        </button>
      </div>

      <p className="mt-3 text-[10.5px] text-faint leading-relaxed">
        Privacy by design: this dashboard shows only anonymized aggregates — no names,
        balances, or keys are ever exposed.
      </p>
    </Panel>
  );
}

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-edge bg-panel2/40 px-3 py-3">
      <div className="flex items-center gap-1.5 text-muted">{icon}<span className="eyebrow">{label}</span></div>
      <div className={`num text-[22px] font-semibold mt-1.5 leading-none ${tone}`}>
        <AnimatedNumber value={value} decimals={0} />
      </div>
    </div>
  );
}
