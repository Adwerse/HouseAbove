import { Check, Minus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { cn, CountUp, StatusChip } from "../../components/primitives";
import type { EvalResult, UpperStatus } from "../../lib/types";

function Big({ value, total, label, tone }: { value: number; total?: number; label: string; tone: string }) {
  return (
    <div className="rounded-2xl bg-surface-alt p-4">
      <p className="text-[34px] font-bold leading-10 tracking-[-0.04em]" style={{ color: tone }}>
        <CountUp value={value} />
        {total !== undefined ? <span className="text-[18px] text-faint">/{total}</span> : null}
      </p>
      <p className="mt-1 text-[12px] font-semibold leading-4 text-muted">{label}</p>
    </div>
  );
}

const split = (s: string) => s.split("/").map(Number) as [number, number];

export default function EvalModal({ open, onClose, result }: { open: boolean; onClose: () => void; result: EvalResult | undefined }) {
  const [agree, screened] = split(result?.agreement ?? "0/0");
  const [shop, shopTotal] = split(result?.shop_confirmed ?? "0/0");
  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="pointer-events-auto absolute inset-0 z-50 grid place-items-center bg-ink/25 p-6 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.section
            initial={{ y: 24, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 24, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[84vh] w-[min(880px,100%)] flex-col overflow-hidden rounded-panel bg-white shadow-[var(--shadow-panel)]"
            aria-label="Evaluation"
          >
            <header className="flex items-start justify-between px-6 pb-2 pt-5">
              <div>
                <p className="eyebrow text-green-700">Evaluation</p>
                <h2 className="text-[24px] font-bold tracking-[-0.03em]">How often the AI agrees with people</h2>
              </div>
              <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-full text-muted hover:bg-black/5"><X size={16} /></button>
            </header>
            <div className="grid grid-cols-3 gap-3 px-6 py-3">
              <Big value={agree} total={screened} label="agree with a human screening the same photo" tone="#0A7D47" />
              <Big value={result?.escalated ?? 0} label="sent to a human automatically" tone="#B26B00" />
              <Big value={shop} total={shopTotal} label="confirmed by shop staff, the only real ground truth" tone="#0B100D" />
            </div>
            <p className="px-6 text-[12px] text-muted">{result?.note ?? "Agreement, not accuracy: a human reading the same photo is also a judgement."}</p>
            <div className="scroll-thin mt-3 min-h-0 flex-1 overflow-auto px-6 pb-6">
              <table className="w-full text-left text-[12.5px]">
                <thead className="sticky top-0 bg-white text-[11px] uppercase tracking-[0.06em] text-faint">
                  <tr>
                    <th className="py-2 font-semibold">Building</th>
                    <th className="font-semibold">AI</th>
                    <th className="font-semibold">Verifier</th>
                    <th className="font-semibold">Human</th>
                    <th className="font-semibold">Match</th>
                    <th className="font-semibold">Shop staff</th>
                  </tr>
                </thead>
                <tbody>
                  {(result?.rows ?? []).map((r) => (
                    <tr key={r.id} className="border-t border-black/5">
                      <td className="py-2 pr-2 font-semibold">{r.label ?? r.id}</td>
                      <td><StatusChip status={r.ai} /></td>
                      <td>{r.verifier ? <StatusChip status={r.verifier} /> : "–"}</td>
                      <td>{r.human ? <StatusChip status={r.human as UpperStatus} /> : <span className="text-faint">–</span>}</td>
                      <td>{r.ai_matches_human === null ? <Minus size={14} className="text-faint" /> : r.ai_matches_human ? <Check size={15} strokeWidth={3} className="text-green" /> : <X size={15} strokeWidth={3} className="text-amber" />}</td>
                      <td className={cn("max-w-[220px] truncate", r.shop_staff_confirms_ai === false ? "text-amber" : "text-muted")} title={r.shop_staff_answer ?? ""}>
                        {r.shop_staff_answer ? `“${r.shop_staff_answer}”` : "–"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
