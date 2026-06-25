export const usd = (n: number, d = 2) =>
  (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

export const usdc = (n: number) => `$${usd(n)}`;

export const pct = (n: number, d = 2) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(d)}%`;

export const signed = (n: number, d = 2) => `${n >= 0 ? '+' : ''}${usd(n, d)}`;

export const price = (n: number) =>
  n >= 1000 ? usd(n, 1) : n >= 1 ? usd(n, 2) : usd(n, 4);

export const ago = (t: number) => {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 5) return 'now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

export const clock = (t: number) =>
  new Date(t).toLocaleTimeString('en-US', { hour12: false });
