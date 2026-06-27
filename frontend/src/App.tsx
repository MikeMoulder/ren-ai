import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, Radar, Receipt, Layers, Users, GitBranch, LayoutDashboard,
  WifiOff, AlertTriangle, Send, BrainCircuit,
} from 'lucide-react';
import { Background } from './components/Background';
import { ThemeToggle } from './components/ThemeToggle';
import { AgentCore } from './components/AgentCore';
import { DecisionEngine } from './components/DecisionEngine';
import { EquityChart } from './components/EquityChart';
import { MarketGrid } from './components/MarketGrid';
import { ThoughtStream } from './components/ThoughtStream';
import { TradeTape } from './components/TradeTape';
import { Positions } from './components/Positions';
import { Community } from './components/Community';
import { TradeCTA } from './components/TradeCTA';
import { Architecture } from './components/Architecture';
import { Kpi, Pill } from './components/ui';
import { useRen } from './useRen';
import { signed, pct } from './lib/format';

const NAV = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'engine', label: 'Decision Engine', icon: Brain },
  { id: 'markets', label: 'Markets', icon: Radar },
  { id: 'reasoning', label: 'Reasoning', icon: BrainCircuit },
  { id: 'trades', label: 'Trades', icon: Receipt },
  { id: 'positions', label: 'Positions', icon: Layers },
  { id: 'community', label: 'Community', icon: Users },
  { id: 'architecture', label: 'Architecture', icon: GitBranch },
];

const STATUS_TEXT: Record<string, string> = { idle: 'monitoring', thinking: 'reasoning', trading: 'executing', booting: 'starting' };

export default function App() {
  const s = useRen();
  const [modal, setModal] = useState(false);
  const [active, setActive] = useState('overview');
  const [now, setNow] = useState(Date.now());
  const [hubReady, setHubReady] = useState(false);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setTimeout(() => setHubReady(true), 2000); return () => clearTimeout(t); }, []);

  const closed = s.trades.filter((t) => t.type === 'close');
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
  const winRate = closed.length ? (wins / closed.length) * 100 : 0;
  const net = (s.agent.equity || 0) - (s.agent.startEquity || 0);
  const netPct = s.agent.startEquity ? net / s.agent.startEquity : 0;
  const uPnl = s.tick?.uPnl ?? 0;
  const booting = s.agent.status === 'booting' && !s.connected;

  const go = (id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="min-h-screen flex text-ink">
      <Background />
      <TradeCTA open={modal} onClose={() => setModal(false)} s={s} />

      {/* ───────── Sidebar ───────── */}
      <aside className="hidden lg:flex w-[224px] shrink-0 flex-col border-r border-edge bg-base/70 backdrop-blur-xl sticky top-0 h-screen">
        <div className="flex items-center gap-2.5 px-5 h-16 border-b border-edge">
          <div className="leading-none">
            <div className="display text-[16px] font-bold">ren<span className="text-brand">.ai</span></div>
            <div className="eyebrow mt-1">Trading Agent</div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map((n) => {
            const on = active === n.id;
            return (
              <button
                key={n.id}
                onClick={() => go(n.id)}
                className={`group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition ${on ? 'bg-elev text-ink' : 'text-muted hover:text-ink hover:bg-elev/50'}`}
              >
                <n.icon size={16} className={on ? 'text-brand' : 'text-faint group-hover:text-muted'} />
                {n.label}
                {on && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand" />}
              </button>
            );
          })}
        </nav>

        <div className="px-4 py-4 border-t border-edge space-y-2.5">
          <Row k="Mode" v={<Pill tone="brand">{s.agent.mode}</Pill>} />
          <Row k="Brain" v={<span className="num text-[11px] text-ink2 truncate max-w-[120px]">{s.capabilities?.llm || 'confluence-rules'}</span>} />
          <Row k="Agent Hub" v={<Pill tone={s.capabilities?.agentHub || (s.capabilities?.agentHubConfigured && hubReady) ? 'up' : 'edge'}>{s.capabilities?.agentHub ? 'live' : s.capabilities?.agentHubConfigured ? (hubReady ? 'Connected' : 'connecting') : 'fallback'}</Pill>} />
        </div>
      </aside>

      {/* ───────── Main ───────── */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 px-5 sm:px-7 h-16 border-b border-edge bg-void/80 backdrop-blur-xl">
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <h1 className="display text-[17px] font-bold leading-none flex items-center gap-2">
                <span className="lg:hidden">ren<span className="text-brand">.ai</span></span>
                <span className="hidden lg:inline">Mission Control</span>
                <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-medium text-muted">
                  <span className="live-dot" /> {STATUS_TEXT[s.agent.status] || 'live'}
                </span>
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            {(() => {
              const since = s.lastUpdate ? Math.max(0, Math.round((now - s.lastUpdate) / 1000)) : null;
              const fresh = s.connected && since !== null && since < 8;
              return (
                <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold ${fresh ? 'border-up/30 text-up bg-up/10' : 'border-down/30 text-down bg-down/10'}`}>
                  {fresh ? <span className="live-dot" /> : <WifiOff size={11} />}
                  {fresh ? `LIVE · ${since}s` : 'reconnecting…'}
                </span>
              );
            })()}
            <span className="num hidden md:block text-[12px] text-muted tabular">{new Date(now).toLocaleTimeString('en-US', { hour12: false })}</span>
            <ThemeToggle />
            <button onClick={() => setModal(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-[13px] font-semibold text-void hover:brightness-110 transition">
              <Send size={14} /> <span className="hidden sm:inline">Trade with ren.ai</span><span className="sm:hidden">Trade</span>
            </button>
          </div>
        </header>

        <main className="flex-1 px-5 sm:px-7 py-6 space-y-6 max-w-[1500px] w-full mx-auto">
          <AnimatePresence>
            {booting && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-3 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-[13px] text-warn">
                <AlertTriangle size={16} className="shrink-0" />
                <span>Connecting to the ren.ai backend… If this persists, start it with <code className="num bg-void/40 px-1.5 py-0.5 rounded">npm run dev:backend</code> (API on :8787).</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* KPI strip */}
          <section id="overview" className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 scroll-mt-20">
            <Kpi label="Net Asset Value" accent="text-ink" delay={0}>${fmt(s.agent.equity)}</Kpi>
            <Kpi label="Net P&L" accent={net >= 0 ? 'text-up' : 'text-down'} sub={pct(netPct)} delay={0.04}>{signed(net)}</Kpi>
            <Kpi label="Unrealized" accent={uPnl >= 0 ? 'text-up' : 'text-down'} delay={0.08}>{signed(uPnl)}</Kpi>
            <Kpi label="Realized" accent={s.agent.realizedPnl >= 0 ? 'text-up' : 'text-down'} delay={0.12}>{signed(s.agent.realizedPnl)}</Kpi>
            <Kpi label="Win Rate" sub={`${wins}/${closed.length} closed`} delay={0.16}>{winRate.toFixed(0)}<span className="text-muted text-base">%</span></Kpi>
            <Kpi label="Subscribers" accent="text-brand" sub={`${s.community.copying} auto-copy`} delay={0.2}>{s.community.subscribers}</Kpi>
          </section>

          {/* Equity + Agent core */}
          <section className="grid gap-6 xl:grid-cols-[1fr_360px]">
            <EquityChart s={s} />
            <div className="card sheen flex items-center justify-center p-4"><AgentCore s={s} /></div>
          </section>

          {/* Decision engine — headline */}
          <div id="engine" className="scroll-mt-20"><DecisionEngine s={s} /></div>

          <div id="markets" className="scroll-mt-20"><MarketGrid s={s} /></div>

          <section className="grid gap-6 xl:grid-cols-2">
            <div id="reasoning" className="scroll-mt-20"><ThoughtStream s={s} /></div>
            <div id="trades" className="scroll-mt-20"><TradeTape s={s} /></div>
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <div id="positions" className="scroll-mt-20"><Positions s={s} /></div>
            <div id="community" className="scroll-mt-20"><Community s={s} onTrade={() => setModal(true)} /></div>
          </section>

          <div id="architecture" className="scroll-mt-20"><Architecture /></div>

          <footer className="flex flex-wrap items-center justify-between gap-2 pt-4 pb-8 text-[11.5px] text-faint border-t border-edge">
            <span className="flex items-center gap-1.5">
              <span className="font-semibold text-muted">ren<span className="text-brand">.ai</span></span>
              <span className="text-faint">·</span>
              <span>Autonomous trading intelligence for Bitget</span>
              <span className="text-faint">·</span>
              <span className="num">© {new Date().getFullYear()}</span>
            </span>
            <span>Mode <b className="text-muted">{s.agent.mode}</b> · Not financial advice</span>
          </footer>
        </main>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex items-center justify-between"><span className="eyebrow">{k}</span>{v}</div>;
}
function fmt(n: number) { return (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
