import { Check, ChevronDown, Info } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";

import { cn, CountUp, Ring, StatusChip, Thumb } from "../../components/primitives";
import { STATUS_COLORS } from "../../lib/status";
import type { Building, DisplayStatus, StreetSummary } from "../../lib/types";

export const FILTERS = [
  { id: "all", label: "All" },
  { id: "likely_underused", label: "Underused" },
  { id: "review", label: "Needs a human" },
  { id: "confirmed", label: "Confirmed" },
] as const;
export type Filter = (typeof FILTERS)[number]["id"];

const ORDER: DisplayStatus[] = ["likely_underused", "review", "confirmed", "home", "unclear", "likely_used"];

function CompositionBar({ buildings }: { buildings: Building[] }) {
  const counts = ORDER.map((s) => [s, buildings.filter((b) => b.display_status === s).length] as const).filter(([, n]) => n);
  const total = buildings.length || 1;
  return (
    <div className="flex h-2.5 w-full gap-[3px] overflow-hidden rounded-full">
      {counts.map(([status, n], i) => (
        <motion.span
          key={status}
          className="h-full rounded-full"
          style={{ background: STATUS_COLORS[status] }}
          initial={{ width: 0 }}
          animate={{ width: `${(n / total) * 100}%` }}
          transition={{ duration: 0.9, delay: 0.05 * i, ease: [0.22, 1, 0.36, 1] }}
          title={`${n} ${status.replaceAll("_", " ")}`}
        />
      ))}
    </div>
  );
}

function StatTile({ label, value, total, color }: { label: string; value: number; total?: number; color: string }) {
  return (
    <div className="rounded-2xl bg-surface-alt px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted">
        <span className="size-1.5 rounded-full" style={{ background: color }} />
        {label}
      </div>
      <div className="mt-0.5 text-[22px] font-bold leading-7 tracking-[-0.03em] text-ink">
        <CountUp value={value} />
        {total !== undefined ? <span className="text-[13px] font-semibold text-faint"> / {total}</span> : null}
      </div>
    </div>
  );
}

function ServiceDots({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center gap-[3px]" title={`Services ${score}/5 within walking distance`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={cn("size-[5px] rounded-full", i < score ? "bg-green" : "bg-black/10")} />
      ))}
    </span>
  );
}

function Row({ b, selected, onSelect, onHover, index }: {
  b: Building; selected: boolean; onSelect: (id: string) => void; onHover: (id: string | null) => void; index: number;
}) {
  const confidence = b.confidence ?? 0;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index, 12) * 0.03, ease: [0.22, 1, 0.36, 1] }}
    >
      <button
        type="button"
        onClick={() => onSelect(b.id)}
        onMouseEnter={() => onHover(b.id)}
        onMouseLeave={() => onHover(null)}
        className={cn(
          "group flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left transition-colors duration-200",
          selected ? "bg-ink text-white" : "hover:bg-black/[0.035]",
        )}
      >
        <span className={cn("w-6 text-[13px] font-bold tabular-nums", selected ? "text-volt" : "text-faint")}>
          {String(b.rank ?? "–").padStart(2, "0")}
        </span>
        <Thumb src={b.photo} alt="" className="size-12 shrink-0 rounded-xl" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold tracking-[-0.01em]">{b.label ?? b.id}</span>
          <span className="mt-1 flex items-center gap-2">
            <StatusChip status={b.display_status} />
            <ServiceDots score={b.services?.score ?? 0} />
          </span>
        </span>
        <Ring
          value={confidence}
          size={36}
          stroke={3.5}
          color={STATUS_COLORS[b.display_status]}
          track={selected ? "rgba(255,255,255,0.14)" : "rgba(11,16,13,0.08)"}
        >
          <span className={cn("text-[10px] font-bold", selected ? "text-white" : "text-ink")}>{Math.round(confidence * 100)}</span>
        </Ring>
      </button>
    </motion.li>
  );
}

export default function CandidateList({
  street, streets, onStreet, buildings, summary, selectedId, onSelect, onHover, filter, onFilter, loading,
}: {
  street: string | null;
  streets: { name: string; count: number }[];
  onStreet: (name: string) => void;
  buildings: Building[];
  summary: StreetSummary;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  filter: Filter;
  onFilter: (f: Filter) => void;
  loading: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const shown = useMemo(() => (filter === "all" ? buildings : buildings.filter((b) => b.display_status === filter)), [buildings, filter]);

  return (
    <motion.aside
      initial={{ x: -40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -40, opacity: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 30 }}
      className="glass pointer-events-auto absolute bottom-4 left-4 top-[76px] flex w-[384px] flex-col overflow-hidden rounded-panel"
      aria-label="Candidates for inspection"
    >
      <div className="px-5 pb-3 pt-5">
        <p className="eyebrow text-green-700">Survey · Dublin 1</p>
        <div className="relative mt-1">
          <button type="button" onClick={() => setMenu((m) => !m)} className="inline-flex items-center gap-1.5 text-[26px] font-bold leading-8 tracking-[-0.03em] text-ink">
            {street ?? "No street yet"}
            <ChevronDown size={20} className={cn("text-faint transition-transform", menu && "rotate-180")} />
          </button>
          <AnimatePresence>
            {menu ? (
              <motion.ul
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.18 }}
                className="absolute left-0 top-10 z-10 w-64 rounded-2xl border border-black/5 bg-white p-1.5 shadow-[var(--shadow-panel)]"
              >
                {streets.map((s) => (
                  <li key={s.name}>
                    <button
                      type="button"
                      onClick={() => { onStreet(s.name); setMenu(false); }}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-surface-alt"
                    >
                      <span className="flex items-center gap-2">
                        {s.name === street ? <Check size={14} className="text-green" /> : <span className="w-[14px]" />}
                        {s.name}
                      </span>
                      <span className="text-xs text-faint">{s.count}</span>
                    </button>
                  </li>
                ))}
              </motion.ul>
            ) : null}
          </AnimatePresence>
        </div>
        <p className="mt-1 text-[13px] text-muted">
          <CountUp value={summary.total} /> facades photographed · <CountUp value={summary.processed} /> read by AI
        </p>
        <div className="mt-4"><CompositionBar buildings={buildings} /></div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <StatTile label="Underused" value={summary.likely_underused} color={STATUS_COLORS.likely_underused} />
          <StatTile label="Need a human" value={summary.review} color={STATUS_COLORS.review} />
          <StatTile label="Confirmed" value={summary.confirmed} color={STATUS_COLORS.confirmed} />
        </div>
      </div>

      <div className="flex gap-1 px-4 pb-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onFilter(f.id)}
            className={cn("relative rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors", filter === f.id ? "text-ink" : "text-muted hover:text-ink")}
          >
            {filter === f.id ? <motion.span layoutId="filter-pill" className="absolute inset-0 -z-10 rounded-full bg-black/[0.06]" /> : null}
            {f.label}
          </button>
        ))}
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {loading ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-14 rounded-2xl" />)}
          </div>
        ) : shown.length ? (
          <ul className="space-y-0.5">
            <AnimatePresence initial>
              {shown.map((b, i) => (
                <Row key={b.id} b={b} index={i} selected={b.id === selectedId} onSelect={onSelect} onHover={onHover} />
              ))}
            </AnimatePresence>
          </ul>
        ) : (
          <p className="px-4 py-10 text-center text-sm text-muted">Nothing here yet on this street.</p>
        )}
      </div>

      <p className="flex items-start gap-2 border-t border-black/5 px-5 py-3 text-[11px] leading-4 text-muted">
        <Info size={13} className="mt-px shrink-0" />
        Ranked: likely underused first, then a separate entrance, more services within walking distance, higher confidence.
      </p>
    </motion.aside>
  );
}
