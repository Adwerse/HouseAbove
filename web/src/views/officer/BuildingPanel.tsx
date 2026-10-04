import { ArrowUpRight, Bus, Check, CircleAlert, CircleCheck, GraduationCap, Landmark, Minus, ShieldCheck, ShoppingBasket, Stethoscope, TreePine, X, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";

import { cn, modelFamily, Ring, SERVICE_LABELS, SERVICE_LIMITS, StatusChip, Thumb } from "../../components/primitives";
import { STATUS_COLORS, STATUS_LABELS } from "../../lib/status";
import type { Building, BuildingServicesResponse, InspectionOutcome, ServiceKind, SimilarBuilding, UpperStatus } from "../../lib/types";
import { serviceColors } from "../../theme/tokens";

const SERVICE_ICONS: Record<ServiceKind, LucideIcon> = {
  bus: Bus,
  grocery: ShoppingBasket,
  school: GraduationCap,
  gp_or_pharmacy: Stethoscope,
  park: TreePine,
};

const GRANT_FAQ = "https://www.sdcc.ie/en/services/housing/vacant-homes/vacant-above-the-shop-grant-faqs.pdf";

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-t border-black/5 px-5 py-4">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="eyebrow text-muted">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function statusOf(s: UpperStatus | null | undefined) {
  return (s ?? "unclear") as UpperStatus;
}

function ModelCard({ pass, family, status, children }: { pass: string; family: string; status: UpperStatus; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-surface-alt p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">{pass}</p>
      <p className="text-[13px] font-bold text-ink">{family}</p>
      <div className="mt-2"><StatusChip status={status} /></div>
      <div className="mt-2.5 space-y-1">{children}</div>
    </div>
  );
}

function Sign({ ok, text }: { ok: boolean; text: string }) {
  const Icon = ok ? Check : X;
  return (
    <p className="flex items-start gap-1.5 text-[11.5px] leading-4 text-ink-3">
      <Icon size={12} strokeWidth={3} className={cn("mt-0.5 shrink-0", ok ? "text-green" : "text-amber")} />
      {text}
    </p>
  );
}

export default function BuildingPanel({
  building, services, similar, onClose, onSelect, onHumanLabel, onInspection, busy, demoData,
}: {
  building: Building;
  services: BuildingServicesResponse | undefined;
  similar: SimilarBuilding[] | undefined;
  onClose: () => void;
  onSelect: (id: string) => void;
  onHumanLabel: (label: UpperStatus) => void;
  onInspection: (outcome: InspectionOutcome) => void;
  busy: boolean;
  demoData: boolean;
}) {
  const v = building.verifier;
  const agree = v?.agree ?? null;
  const score = services?.services?.score ?? building.services?.score ?? 0;
  const pois = services?.pois ?? [];

  return (
    <motion.aside
      key={building.id}
      initial={{ x: 60, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 60, opacity: 0 }}
      transition={{ type: "spring", stiffness: 280, damping: 32 }}
      className="glass pointer-events-auto absolute bottom-4 right-4 top-[76px] flex w-[420px] flex-col overflow-hidden rounded-panel"
      aria-label={`Building ${building.label ?? building.id}`}
    >
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="relative">
          <Thumb src={building.photo} alt={`Facade of ${building.label ?? building.id}`} className="aspect-[4/3] w-full" label={demoData ? "Illustration" : undefined} />
          <div className="pointer-events-none absolute inset-x-0 top-[55%] border-t-2 border-dashed border-white/90">
            <span className="absolute -top-3 left-3 rounded-full bg-ink/80 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
              Verifier sees only above this line
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 grid size-8 place-items-center rounded-full bg-white/90 text-ink shadow backdrop-blur transition hover:scale-105">
            <X size={16} />
          </button>
          <span className="absolute left-3 top-3 rounded-full bg-ink px-2.5 py-1 text-[12px] font-bold text-volt">#{building.rank ?? "–"}</span>
        </div>

        <div className="px-5 pb-4 pt-4">
          <p className="font-mono text-[11px] text-faint">{building.id}</p>
          <h2 className="mt-0.5 text-[22px] font-bold leading-7 tracking-[-0.03em] text-ink">{building.label ?? building.id}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusChip status={building.display_status} size="md" />
            <span className="text-[12px] text-muted">{building.upper_floors ?? "?"} floors above the shop</span>
          </div>
          {building.evidence ? (
            <p className="mt-3 border-l-[3px] pl-3 text-[13.5px] leading-5 text-ink-3" style={{ borderColor: STATUS_COLORS[building.display_status] }}>
              {building.evidence}
            </p>
          ) : null}
        </div>

        <Section title="Two independent model passes">
          <div
            className={cn(
              "mb-3 flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-semibold",
              agree === false ? "bg-amber/15 text-[#8A5300]" : "bg-mint text-green-700",
            )}
          >
            {agree === false ? <CircleAlert size={15} /> : <CircleCheck size={15} />}
            {agree === false ? "They disagree: a human decides" : agree ? "Two model families agree" : "Not verified yet"}
            {building.confidence !== null ? <span className="ml-auto font-medium opacity-80">confidence {Math.round((building.confidence ?? 0) * 100)}%</span> : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <ModelCard pass="Pass 1 · whole facade" family={modelFamily(building.models.vision)} status={statusOf(building.upper_status)}>
              {building.upper_signals.length ? building.upper_signals.map((s) => <Sign key={s} ok={false} text={s} />) : <p className="text-[11.5px] text-muted">No signals of underuse</p>}
            </ModelCard>
            <ModelCard pass="Pass 2 · upper floors" family={modelFamily(v?.model ?? building.models.verifier)} status={statusOf(v?.status)}>
              {(v?.for_use ?? []).map((s) => <Sign key={`f${s}`} ok text={s} />)}
              {(v?.against_use ?? []).map((s) => <Sign key={`a${s}`} ok={false} text={s} />)}
              {!v ? <p className="text-[11.5px] text-muted">Waiting for the verifier</p> : null}
            </ModelCard>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-faint">An escalation trigger, not proof: two passes agreeing is not ground truth.</p>
        </Section>

        <Section title="Services within walking distance" aside={<Ring value={score / 5} size={34} stroke={3.5}><span className="text-[10px] font-bold">{score}/5</span></Ring>}>
          <ul className="space-y-1.5">
            {(["bus", "grocery", "school", "gp_or_pharmacy", "park"] as ServiceKind[]).map((kind) => {
              const p = pois.find((x) => x.kind === kind);
              const Icon = SERVICE_ICONS[kind];
              const ok = p ? p.dist_m <= SERVICE_LIMITS[kind] : false;
              return (
                <li key={kind} className="flex items-center gap-2.5">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full text-white" style={{ background: serviceColors[kind] }}>
                    <Icon size={14} strokeWidth={2.4} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-semibold text-ink">{SERVICE_LABELS[kind]}</span>
                    <span className="block truncate text-[11px] text-muted">{p?.name ?? "None within 1 km"}</span>
                  </span>
                  <span className="text-[12px] font-semibold tabular-nums text-ink-3">{p ? `${p.dist_m} m` : "–"}</span>
                  {ok ? <Check size={14} strokeWidth={3} className="text-green" /> : <Minus size={14} className="text-faint" />}
                </li>
              );
            })}
          </ul>
        </Section>

        <Section title="Public registers">
          <div className="flex flex-wrap gap-1.5">
            {building.registers.derelict ? <span className="inline-flex items-center gap-1 rounded-full bg-[#F4EBFF] px-2.5 py-1 text-[11px] font-semibold text-[#6941C6]"><Landmark size={12} /> On DCC Derelict Sites Register</span> : null}
            {building.registers.protected ? <span className="inline-flex items-center gap-1 rounded-full bg-[#EAF2FF] px-2.5 py-1 text-[11px] font-semibold text-[#1F5BB8]"><ShieldCheck size={12} /> Protected structure: conversion needs extra consent</span> : null}
            {building.registers.derelict === null || building.registers.protected === null ? (
              <span className="rounded-full bg-surface-alt px-2.5 py-1 text-[11px] font-semibold text-muted">Registers not checked yet</span>
            ) : !building.registers.derelict && !building.registers.protected ? (
              <span className="rounded-full bg-surface-alt px-2.5 py-1 text-[11px] font-semibold text-muted">Not near a register entry</span>
            ) : null}
          </div>
        </Section>

        {similar?.length ? (
          <Section title="Similar facades">
            <div className="scroll-thin -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {similar.slice(0, 5).map((s) => (
                <button key={s.id} type="button" onClick={() => onSelect(s.id)} className="w-[92px] shrink-0 text-left">
                  <Thumb src={s.photo} alt="" className="aspect-square w-full rounded-xl" />
                  <span className="mt-1 flex items-center justify-between text-[11px] font-semibold">
                    <span className="truncate">{s.id}</span>
                    <span className="text-green-700">{Math.round(s.score * 100)}%</span>
                  </span>
                </button>
              ))}
            </div>
          </Section>
        ) : null}

        {building.shop_staff_answer ? (
          <Section title="Shop staff said">
            <p className="text-[13px] italic leading-5 text-ink-3">“{building.shop_staff_answer}”</p>
          </Section>
        ) : null}

        <Section title={building.display_status === "review" ? "Your call" : "Record a decision"}>
          {building.display_status === "review" || building.human_label ? (
            <div className="mb-3">
              <p className="mb-1.5 text-[12px] text-muted">Human screen of the photo</p>
              <div className="grid grid-cols-3 gap-1.5">
                {(["likely_underused", "likely_used", "unclear"] as UpperStatus[]).map((label) => (
                  <button
                    key={label}
                    type="button"
                    disabled={busy}
                    onClick={() => onHumanLabel(label)}
                    className={cn(
                      "rounded-xl border px-2 py-2 text-[11.5px] font-semibold transition",
                      building.human_label === label ? "border-ink bg-ink text-white" : "border-black/10 bg-white hover:border-ink/40",
                    )}
                  >
                    {STATUS_LABELS[label]}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <p className="mb-1.5 text-[12px] text-muted">Inspection outcome</p>
          <div className="grid grid-cols-3 gap-1.5">
            {([
              ["confirmed_candidate", "Confirmed candidate"],
              ["not_suitable", "Not suitable"],
              ["returned_to_use", "Returned to use"],
            ] as [InspectionOutcome, string][]).map(([outcome, label]) => (
              <button
                key={outcome}
                type="button"
                disabled={busy}
                onClick={() => onInspection(outcome)}
                className={cn(
                  "rounded-xl px-2 py-2 text-[11.5px] font-semibold transition disabled:opacity-50",
                  building.inspection?.outcome === outcome
                    ? "bg-forest text-white"
                    : outcome === "confirmed_candidate"
                      ? "bg-green text-white hover:bg-green-600"
                      : "border border-black/10 bg-white hover:border-ink/40",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[10.5px] text-faint">“Returned to use” is simulated for the demo: real conversions take months.</p>
        </Section>
      </div>

      <a href={GRANT_FAQ} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 border-t border-black/5 bg-surface-alt px-5 py-3 text-[12px] text-muted transition hover:text-ink">
        <span>Vacant Above the Shop grant: €95k–€135k per building, plus up to €25k from SEAI. Eligibility is the council’s call.</span>
        <span className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-ink">Official FAQ <ArrowUpRight size={13} /></span>
      </a>
    </motion.aside>
  );
}
