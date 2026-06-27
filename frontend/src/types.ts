export type SignalSource = 'agent-hub' | 'derived' | 'simulated';

export interface Signal {
  skill: string;       // technical | sentiment | macro | market-intel | news
  hub: string;         // matching Agent Hub skill name
  label: string;
  score: number;       // -1..1 (bearish..bullish)
  summary: string;
  source: SignalSource;
}

export interface Confluence {
  score: number;       // -1..1 fused conviction
  direction: 'long' | 'short' | 'flat';
  strength: number;    // |score|
  agree: number;
  conflict: number;
  contributors: { skill: string; score: number; source: SignalSource }[];
}

export interface Metrics {
  price: number; ema20: number; ema50: number; emaSpreadPct: number;
  rsi: number; adx: number; atr: number; atrPct: number;
}
// Trend-Breakout mechanical signal (the strategy trigger).
export interface TrendSignal {
  active: boolean;
  side?: 'long' | 'short';
  stop?: number;        // initial stop
  trailDist?: number;   // chandelier trailing distance
  trailMult?: number;   // N in N×ATR
  strategy?: string;
}
export interface Snapshot {
  symbol: string; price: number; change24h: number;
  regime: 'trend' | 'range' | 'unclear'; bias: 'long' | 'short' | 'flat';
  metrics: Metrics; funding: number; positioning: string;
  trend?: TrendSignal;
  signals?: Signal[]; confluence?: Confluence | null;
}
export interface Position {
  symbol: string; side: 'long' | 'short'; size: number; entry: number;
  notional: number; uPnl: number; markPrice?: number; stopPrice: number;
  takeProfit: number | null; openedAt: number; reason: string;
  strategy?: string; trailDist?: number; peak?: number;
}
export interface Thought {
  at: number; symbol: string; action: string; conviction: number; reason: string;
  allowed: boolean; gate: string; source: string; regime: string; bias: string;
  price: number; metrics: Metrics;
  signals?: Signal[]; confluence?: Confluence | null;
  sized?: { size: number; notional: number; leverage: number; stop: number; tp: number; riskUsd: number } | null;
}
export interface Trade {
  type: 'open' | 'close'; symbol: string; action: string; side: string;
  size: number; price: number; notional?: number; leverage?: number;
  pnl?: number; reason?: string; why?: string; at: number;
}
export interface Community {
  subscribers: number; copying: number; alerting: number; totalMirrored: number;
}
export interface Agent {
  status: 'booting' | 'idle' | 'thinking' | 'trading'; mode: string;
  equity: number; startEquity: number; realizedPnl: number;
  lastDecisionAt: number | null;
}
export interface Capabilities {
  llm: string; llmProvider: string; bitget: boolean; telegram: boolean;
  telegramBot?: string; agentHub?: boolean; agentHubConfigured?: boolean; mode: string;
}
export interface RenState {
  agent: Agent;
  positions: Position[];
  risk: any;
  config: { mode: string; symbols: string[]; loopSeconds: number; granularity?: string; strategy?: string };
  thoughts: Thought[];
  trades: Trade[];
  equityCurve: { t: number; equity: number }[];
  community: Community;
  capabilities?: Capabilities;
  tick?: { snapshots: Snapshot[]; marketEquity: number; uPnl: number; dataSource: string };
  connected: boolean;
  lastUpdate: number;
}
