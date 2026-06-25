// Ambient backdrop — soft brand/ai glows + a faint dotted grid. Theme-aware:
// the glow opacity is tuned down in light mode via the .grid-bg token.
export function Background() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      <div className="absolute inset-0 grid-bg" />
      <div
        className="absolute -top-40 right-[-12%] h-[520px] w-[520px] rounded-full blur-[140px] opacity-25"
        style={{ background: 'radial-gradient(circle, var(--brand), transparent 60%)' }}
      />
      <div
        className="absolute bottom-[-18%] left-[-12%] h-[560px] w-[560px] rounded-full blur-[150px] opacity-20"
        style={{ background: 'radial-gradient(circle, var(--ai), transparent 60%)' }}
      />
    </div>
  );
}
