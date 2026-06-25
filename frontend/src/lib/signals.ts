import { Activity, Gauge, Globe, Boxes, Newspaper, type LucideIcon } from 'lucide-react';
import type { SignalSource } from '../types';

// Order + presentation metadata for the five Agent Hub analyst lenses.
export const SKILL_ORDER = ['technical', 'sentiment', 'macro', 'market-intel', 'news'] as const;

export const SKILL_META: Record<string, { label: string; hub: string; icon: LucideIcon; blurb: string }> = {
  technical: { label: 'Technical', hub: 'technical-analysis', icon: Activity, blurb: 'Regime · EMA/RSI/ADX/ATR' },
  sentiment: { label: 'Sentiment', hub: 'sentiment-analyst', icon: Gauge, blurb: 'Funding · positioning' },
  macro: { label: 'Macro', hub: 'macro-analyst', icon: Globe, blurb: 'Rates · DXY · risk-on/off' },
  'market-intel': { label: 'Market Intel', hub: 'market-intel', icon: Boxes, blurb: 'ETF flows · whales · on-chain' },
  news: { label: 'News', hub: 'news-briefing', icon: Newspaper, blurb: 'Narrative · headlines' },
};

export const SOURCE_META: Record<SignalSource, { label: string; tone: string }> = {
  'agent-hub': { label: 'Agent Hub', tone: 'brand' },
  derived: { label: 'Derived', tone: 'cyan' },
  simulated: { label: 'Sim', tone: 'edge' },
};

export const scoreTone = (score: number) => (score > 0.12 ? 'up' : score < -0.12 ? 'down' : 'muted');
export const scoreVar = (score: number) =>
  score > 0.12 ? 'var(--up)' : score < -0.12 ? 'var(--down)' : 'var(--muted)';
export const skillLabel = (skill: string) => SKILL_META[skill]?.label ?? skill;
export const fmtScore = (score: number) => `${score >= 0 ? '+' : ''}${score.toFixed(2)}`;

// Literal class maps — Tailwind v4 only generates classes it can see as full
// strings, so we never build class names by interpolation at the call site.
export const TEXT_TONE: Record<string, string> = {
  up: 'text-up', down: 'text-down', warn: 'text-warn', ai: 'text-ai',
  brand: 'text-brand', cyan: 'text-brand2', muted: 'text-muted', edge: 'text-muted',
};
export const SOFT_TONE: Record<string, string> = {
  up: 'border-up/30 bg-up/10', down: 'border-down/30 bg-down/10',
  warn: 'border-warn/30 bg-warn/10', ai: 'border-ai/30 bg-ai/10',
  brand: 'border-brand/30 bg-brand/10', cyan: 'border-brand2/30 bg-brand2/10',
  edge: 'border-edge2 bg-elev/40', muted: 'border-edge2 bg-elev/40',
};
export const textTone = (t: string) => TEXT_TONE[t] || TEXT_TONE.muted;
export const softTone = (t: string) => SOFT_TONE[t] || SOFT_TONE.edge;
