import { useEffect, useRef, useState, useCallback } from 'react';
import type { RenState, Thought, Trade } from './types';

const EMPTY: RenState = {
  agent: { status: 'booting', mode: 'paper', equity: 0, startEquity: 0, realizedPnl: 0, lastDecisionAt: null },
  positions: [], risk: {}, config: { mode: 'paper', symbols: [], loopSeconds: 30 },
  thoughts: [], trades: [], equityCurve: [],
  community: { subscribers: 0, copying: 0, alerting: 0, totalMirrored: 0 },
  connected: false, lastUpdate: 0,
};

// Source-of-truth strategy (self-healing):
//   • REST poll every 3s  -> authoritative full state; always works on one origin.
//   • WebSocket            -> instant pushes (thought/trade/tick) between polls.
// `connected` reflects whichever channel is currently delivering data.
export function useRen(): RenState {
  const [state, setState] = useState<RenState>(EMPTY);
  const wsRef = useRef<WebSocket | null>(null);
  const lastOk = useRef(0);

  const merge = useCallback((p: Partial<RenState>) => setState((s) => ({ ...s, ...p })), []);

  useEffect(() => {
    let alive = true;

    const poll = async () => {
      try {
        const r = await fetch('/api/state', { cache: 'no-store' });
        const ct = r.headers.get('content-type') || '';
        if (!r.ok || !ct.includes('application/json')) throw new Error('offline');
        const d = await r.json();
        if (!alive) return;
        lastOk.current = Date.now();
        setState((s) => ({ ...s, ...d, connected: true, lastUpdate: Date.now() }));
      } catch {
        if (alive && Date.now() - lastOk.current > 6000) merge({ connected: false });
      }
    };
    poll();
    const pollTimer = setInterval(poll, 3000);

    const connect = () => {
      try {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${proto}://${location.host}/ws`);
        wsRef.current = ws;
        ws.onopen = () => { lastOk.current = Date.now(); merge({ connected: true }); };
        ws.onclose = () => { wsRef.current = null; if (alive) setTimeout(connect, 1500); };
        ws.onerror = () => ws.close();
        ws.onmessage = (ev) => {
          lastOk.current = Date.now();
          const { type, payload } = JSON.parse(ev.data);
          setState((s) => ({ ...applyEvent(s, type, payload), connected: true, lastUpdate: Date.now() }));
        };
      } catch { /* polling still covers us */ }
    };
    connect();

    return () => { alive = false; clearInterval(pollTimer); wsRef.current?.close(); };
  }, [merge]);

  return state;
}

function applyEvent(s: RenState, type: string, p: any): RenState {
  switch (type) {
    case 'snapshot':
      return { ...s, ...p };
    case 'status':
      return { ...s, agent: { ...s.agent, status: p.status, mode: p.mode } };
    case 'tick': {
      const eq = s.equityCurve.slice(-600);
      const last = eq[eq.length - 1];
      if (!last || p.at - last.t > 18000) eq.push({ t: p.at, equity: p.marketEquity });
      return {
        ...s,
        positions: p.positions ?? s.positions,
        equityCurve: eq,
        tick: { snapshots: p.snapshots, marketEquity: p.marketEquity, uPnl: p.uPnl, dataSource: p.dataSource },
        agent: { ...s.agent, equity: p.equity },
      };
    }
    case 'thought':
      return { ...s, thoughts: [...s.thoughts, p as Thought].slice(-80) };
    case 'trade':
      return { ...s, trades: [...s.trades, p.fill as Trade].slice(-80) };
    default:
      return s;
  }
}
