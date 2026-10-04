import { BadgeCheck, CircleAlert, ClipboardCheck } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useState } from "react";

export type Toast = { id: string; title: string; body?: string; tone: "success" | "badge" | "error" };

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setToasts((all) => [...all.slice(-3), { ...t, id }]);
    window.setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), 5200);
  }, []);
  return { toasts, push };
}

const ICON = { success: ClipboardCheck, badge: BadgeCheck, error: CircleAlert };

export default function Toasts({ toasts, className = "right-4 top-[76px]" }: { toasts: Toast[]; className?: string }) {
  return (
    <div className={`pointer-events-none absolute z-50 flex w-[340px] flex-col gap-2 ${className}`} aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => {
          const Icon = ICON[t.tone];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: -10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 30 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              className={`pointer-events-auto flex items-start gap-3 rounded-2xl px-4 py-3 shadow-[var(--shadow-panel)] ${t.tone === "badge" ? "bg-ink text-white" : "glass"}`}
            >
              <Icon size={18} className={t.tone === "badge" ? "text-volt" : t.tone === "error" ? "text-danger" : "text-green"} />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold leading-5">{t.title}</p>
                {t.body ? <p className={`text-[12px] leading-4 ${t.tone === "badge" ? "text-white/70" : "text-muted"}`}>{t.body}</p> : null}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
