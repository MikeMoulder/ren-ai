import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';

// Smoothly-interpolated number (rAF tween). tabular for no layout jitter.
export function AnimatedNumber({ value, decimals = 2, prefix = '', suffix = '' }:
  { value: number; decimals?: number; prefix?: string; suffix?: string }) {
  const [display, setDisplay] = useState(value);
  const from = useRef(value);
  const raf = useRef(0);

  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    const b = value;
    const dur = 600;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      setDisplay(a + (b - a) * e);
      if (t < 1) raf.current = requestAnimationFrame(step);
      else from.current = b;
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);

  return (
    <span className="tabular">
      {prefix}
      {display.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}

// A panel with a tidy, consistent header. The workhorse surface.
export function Panel({ title, icon, right, children, className = '', bodyClass = '', delay = 0 }:
  { title?: string; icon?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; delay?: number }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.4, delay }}
      className={`card card-hover sheen flex flex-col ${className}`}
    >
      {title && (
        <header className="flex items-center justify-between gap-3 px-4 h-12 border-b border-edge/70 shrink-0">
          <div className="flex items-center gap-2 text-ink2">
            {icon && <span className="text-muted">{icon}</span>}
            <span className="text-[12.5px] font-semibold tracking-wide">{title}</span>
          </div>
          {right}
        </header>
      )}
      <div className={`p-4 flex-1 min-h-0 ${bodyClass}`}>{children}</div>
    </motion.section>
  );
}

const TONES: Record<string, string> = {
  edge: 'border-edge2 text-muted bg-elev/40',
  muted: 'border-edge2 text-muted bg-elev/40',
  brand: 'border-brand/30 text-brand bg-brand/10',
  teal: 'border-brand/30 text-brand bg-brand/10',
  cyan: 'border-brand2/30 text-brand2 bg-brand2/10',
  ai: 'border-ai/30 text-ai bg-ai/10',
  violet: 'border-ai/30 text-ai bg-ai/10',
  up: 'border-up/30 text-up bg-up/10',
  lime: 'border-up/30 text-up bg-up/10',
  down: 'border-down/30 text-down bg-down/10',
  rose: 'border-down/30 text-down bg-down/10',
  warn: 'border-warn/30 text-warn bg-warn/10',
  amber: 'border-warn/30 text-warn bg-warn/10',
};

export function Pill({ children, tone = 'edge', className = '' }: { children: ReactNode; tone?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${TONES[tone] || TONES.edge} ${className}`}>
      {children}
    </span>
  );
}

export function StatusDot({ on, tone = 'up' }: { on?: boolean; tone?: string }) {
  const map: Record<string, string> = { teal: 'brand', lime: 'up', cyan: 'brand2', violet: 'ai' };
  const c = on ? `var(--${map[tone] || tone})` : 'var(--faint)';
  return (
    <span className="relative inline-flex h-2 w-2">
      {on && <span className="absolute inline-flex h-full w-full rounded-full" style={{ background: c, animation: 'ring 1.8s ease-out infinite' }} />}
      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: c }} />
    </span>
  );
}

// Tiny inline sparkline from a number[]
export function Sparkline({ data, color = 'var(--brand)', width = 96, height = 28 }:
  { data: number[]; color?: string; width?: number; height?: number }) {
  if (!data || data.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / span) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Compact KPI used in the stat strip.
export function Kpi({ label, children, sub, accent, delay = 0 }:
  { label: string; children: ReactNode; sub?: ReactNode; accent?: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      className="card card-hover sheen px-4 py-3"
    >
      <div className="eyebrow">{label}</div>
      <div className={`num text-[22px] font-semibold mt-1.5 leading-none ${accent || 'text-ink'}`}>{children}</div>
      {sub && <div className="num text-[11px] text-muted mt-1.5">{sub}</div>}
    </motion.div>
  );
}

// Diverging score bar in [-1, 1] — center zero, fills right (bull) / left (bear).
export function ScoreBar({ score, height = 7 }: { score: number; height?: number }) {
  const s = Math.max(-1, Math.min(1, score));
  const pct = Math.abs(s) * 50;
  const color = s > 0.04 ? 'var(--up)' : s < -0.04 ? 'var(--down)' : 'var(--muted)';
  return (
    <div className="relative w-full rounded-full bg-elev overflow-hidden" style={{ height }}>
      <div className="absolute top-0 bottom-0 left-1/2 w-px bg-edge2" />
      <motion.div
        className="absolute top-0 bottom-0 rounded-full"
        style={{ background: color, [s >= 0 ? 'left' : 'right']: '50%' } as any}
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={{ type: 'spring', stiffness: 120, damping: 20 }}
      />
    </div>
  );
}
