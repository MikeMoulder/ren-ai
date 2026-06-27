import { AnimatePresence, motion } from 'framer-motion';
import { Send, X, KeyRound, SlidersHorizontal, ShieldCheck } from 'lucide-react';
import type { RenState } from '../types';

// Participation happens ONLY in the Telegram bot — this modal explains the flow
// and deep-links there. No keys are ever entered on the website.
export function TradeCTA({ open, onClose, s }: { open: boolean; onClose: () => void; s: RenState }) {
  const handle = s.capabilities?.telegramBot || 'renai_tradingbot';
  const url = `https://t.me/${handle}`;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 grid place-items-center bg-void/70 backdrop-blur-sm p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            onClick={(e) => e.stopPropagation()}
            className="card sheen w-full max-w-[440px] p-6 relative"
          >
            <button onClick={onClose} className="absolute top-4 right-4 text-faint hover:text-ink transition"><X size={18} /></button>

            <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand/15 border border-brand/30 text-brand">
              <Send size={20} />
            </div>
            <h2 className="display text-[19px] font-bold mt-3">Trade with ren.ai</h2>
            <p className="text-[13px] text-muted mt-1.5 leading-relaxed">
              Onboarding and key-binding happen entirely inside our Telegram bot — your API
              keys never touch this website.
            </p>

            <div className="mt-5 space-y-3">
              <Step icon={<KeyRound size={15} />} n="1" title="Bind your Bitget keys" desc="Send /bind in the bot. Keys are encrypted (AES-256-GCM) server-side." />
              <Step icon={<SlidersHorizontal size={15} />} n="2" title="Configure the bot" desc="Pick /mode copy or alert, and set /risk to scale your sizing." />
              <Step icon={<ShieldCheck size={15} />} n="3" title="Mirror every move" desc="ren.ai mirrors trades to your own account, scaled to your equity & risk." />
            </div>

            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="mt-6 flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-[14px] font-semibold text-void hover:brightness-110 transition"
            >
              <Send size={16} /> Open the Telegram bot
            </a>
            <p className="text-[11px] text-faint mt-3 text-center">
              {s.capabilities?.telegram ? 'Bot online.' : 'Bot launching soon — '}@{handle}
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Step({ icon, n, title, desc }: { icon: React.ReactNode; n: string; title: string; desc: string }) {
  return (
    <div className="flex gap-3">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-edge bg-elev/50 text-brand">{icon}</div>
      <div>
        <div className="text-[13px] font-semibold flex items-center gap-1.5">
          <span className="num text-faint">{n}.</span>{title}
        </div>
        <div className="text-[12px] text-muted leading-snug mt-0.5">{desc}</div>
      </div>
    </div>
  );
}
