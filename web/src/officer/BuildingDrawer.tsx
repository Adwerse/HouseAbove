import { type ReactNode } from "react";
import {
  AlertTriangle,
  Building2,
  Check,
  CircleDashed,
  ExternalLink,
  Landmark,
  MapPin,
  Pill,
  School,
  ShoppingBasket,
  ThumbsDown,
  ThumbsUp,
  TrainFront,
  Trees,
  X,
} from "lucide-react";

import type {
  Building,
  BuildingServicesResponse,
  DisplayStatus,
  NearbyPoi,
  ServiceKind,
  Services,
  SimilarBuilding,
} from "../lib/types";
import { Chip, Skeleton } from "../ui";
import { cn } from "../ui/utils";

const OFFICIAL_GRANT_FAQ =
  "https://www.sdcc.ie/en/services/housing/vacant-homes/vacant-above-the-shop-grant-faqs.pdf";

type ServiceMeta = {
  kind: ServiceKind;
  label: string;
  key: keyof Omit<Services, "score">;
  threshold: number;
  Icon: typeof TrainFront;
};

const SERVICE_ROWS: ServiceMeta[] = [
  { kind: "bus", label: "Bus", key: "bus_m", threshold: 400, Icon: TrainFront },
  { kind: "grocery", label: "Grocery", key: "grocery_m", threshold: 400, Icon: ShoppingBasket },
  { kind: "school", label: "School", key: "school_m", threshold: 800, Icon: School },
  { kind: "gp_or_pharmacy", label: "GP or pharmacy", key: "gp_or_pharmacy_m", threshold: 800, Icon: Pill },
  { kind: "park", label: "Park", key: "park_m", threshold: 800, Icon: Trees },
];

export interface BuildingDrawerProps {
  /** The full building returned by GET /api/buildings/{id}. Null gives a helpful empty state. */
  building: Building | null;
  services?: BuildingServicesResponse | null;
  similar?: SimilarBuilding[] | null;
  loading?: boolean;
  error?: Error | string | null;
  onSelectSimilar?: (id: string) => void;
  /** The console owns writes, so it can insert review and inspection controls here. */
  actionSlot?: ReactNode;
  children?: ReactNode;
  className?: string;
}

function modelFamily(model: string | null | undefined) {
  if (!model) return "Model pending";
  const source = model.toLowerCase();
  if (source.includes("qwen")) return "Qwen vision family";
  if (source.includes("llama")) return "Llama vision family";
  if (source.includes("gemma")) return "Gemma vision family";
  if (source.includes("mistral")) return "Mistral vision family";
  return model.split(/[-_/\s]/)[0] || "Model pending";
}

function safeCopy(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  // The pipeline should already follow the wording rules. This keeps an older
  // record from reintroducing prohibited wording into the officer interface.
  return value
    .replace(/\bvacant\b/gi, "appears unused")
    .replace(/\bempty\b/gi, "without visible signs of use");
}

function confidence(value: number | null) {
  return value === null ? "Not scored" : `${Math.round(value * 100)}% confidence`;
}

function photoAlt(building: Building) {
  return `Facade photograph for ${building.label ?? building.id}`;
}

function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading building details" role="status">
      <Skeleton shape="rect" className="h-56 w-full" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton shape="rect" className="h-40 w-full" />
        <Skeleton shape="rect" className="h-40 w-full" />
      </div>
      <Skeleton shape="rect" className="h-28 w-full" />
      <Skeleton shape="rect" className="h-44 w-full" />
    </div>
  );
}

function StatusChip({ status }: { status: DisplayStatus }) {
  return <Chip status={status} className="max-w-full" />;
}

function ServiceRow({
  meta,
  poi,
  services,
}: {
  meta: ServiceMeta;
  poi?: NearbyPoi;
  services: Services | null;
}) {
  const distance = services?.[meta.key] ?? poi?.dist_m ?? null;
  const withinWalkingDistance = distance !== null && distance <= meta.threshold;
  const Icon = meta.Icon;

  return (
    <li className="grid grid-cols-[1.35rem_minmax(0,1fr)_3.75rem_1.25rem] items-center gap-2 py-2 text-sm">
      <Icon aria-hidden="true" size={17} className="text-dusk-muted" />
      <span className="min-w-0 truncate" title={poi?.name ?? undefined}>
        {poi?.name ?? meta.label}
      </span>
      <span className="font-mono text-right text-dusk-muted">
        {distance === null ? "—" : `${Math.round(distance)} m`}
      </span>
      <span
        aria-label={withinWalkingDistance ? `${meta.label} is within walking distance` : `${meta.label} is not within walking distance`}
        className={withinWalkingDistance ? "text-[#5EE0A1]" : "text-dusk-muted"}
      >
        {withinWalkingDistance ? <Check aria-hidden="true" size={17} /> : <X aria-hidden="true" size={17} />}
      </span>
    </li>
  );
}

function RegisterFlags({ building }: { building: Building }) {
  const { derelict, protected: protectedStructure } = building.registers;
  if (derelict !== true && protectedStructure !== true && derelict !== null && protectedStructure !== null) return null;

  return (
    <section aria-labelledby="registers-heading" className="rounded-card border border-white/[0.07] bg-white/[0.03] p-3">
      <h3 id="registers-heading" className="text-sm font-semibold text-dusk-text">Registers</h3>
      <div className="mt-2 space-y-2 text-sm leading-5 text-dusk-muted">
        {derelict === true ? (
          <p className="flex gap-2 text-dusk-text"><Landmark aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-status-review" />On DCC Derelict Sites Register</p>
        ) : null}
        {protectedStructure === true ? (
          <p className="flex gap-2 text-dusk-text"><Landmark aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-status-confirmed" />Protected structure: conversion needs extra consent</p>
        ) : null}
        {derelict === null || protectedStructure === null ? (
          <p className="flex gap-2"><CircleDashed aria-hidden="true" size={16} className="mt-0.5 shrink-0" />Register check is still pending.</p>
        ) : null}
      </div>
    </section>
  );
}

function SimilarStrip({
  similar,
  onSelect,
}: {
  similar: SimilarBuilding[] | null | undefined;
  onSelect?: (id: string) => void;
}) {
  return (
    <section aria-labelledby="similar-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="similar-heading" className="text-sm font-semibold text-dusk-text">Similar facades</h3>
        <span className="font-mono text-dusk-xs text-dusk-muted">vector search</span>
      </div>
      {similar?.length ? (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1" aria-label="Similar facade results">
          {similar.map((match) => (
            <button
              key={match.id}
              type="button"
              onClick={() => onSelect?.(match.id)}
              className="group w-28 shrink-0 overflow-hidden rounded-card border border-white/[0.07] bg-white/[0.03] text-left transition hover:border-dusk-primary/70 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A8BEFF]"
            >
              <div className="relative h-14 overflow-hidden bg-dusk-elevated">
                {match.photo ? (
                  <img
                    src={match.photo}
                    alt=""
                    className="h-full w-full object-cover opacity-80 transition group-hover:scale-[1.03]"
                    onError={(event) => { event.currentTarget.style.display = "none"; }}
                  />
                ) : <Building2 aria-hidden="true" size={20} className="absolute left-3 top-4 text-dusk-muted" />}
                <span className="absolute right-1.5 top-1.5 rounded-chip bg-dusk-background/85 px-1.5 py-0.5 font-mono text-[10px] text-dusk-text">
                  {Math.round(match.score * 100)}%
                </span>
              </div>
              <span className="block truncate px-2 py-1.5 text-xs font-medium text-dusk-text">{match.label ?? match.id}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-dusk-muted">No comparable facade vectors are available yet.</p>
      )}
    </section>
  );
}

/**
 * Presentation-only officer drawer. Data fetching and mutations intentionally
 * stay in OfficerConsole so the same panel works with the live API and mocks.
 */
export default function BuildingDrawer({
  building,
  services: serviceResponse,
  similar,
  loading = false,
  error,
  onSelectSimilar,
  actionSlot,
  children,
  className,
}: BuildingDrawerProps) {
  if (!building && !loading) {
    return (
      <aside className={cn("flex min-h-72 items-center justify-center rounded-panel border border-white/[0.07] bg-dusk-glass p-6 text-center shadow-panel backdrop-blur-glass", className)} aria-label="Building detail">
        <div>
          <MapPin aria-hidden="true" size={24} className="mx-auto text-dusk-primary" />
          <h2 className="mt-3 text-base font-semibold text-dusk-text">Choose a candidate</h2>
          <p className="mt-1 text-sm leading-5 text-dusk-muted">Select a facade from the ranked list or street map to review its upper floors.</p>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={cn(
        "flex min-h-0 w-full max-w-[440px] flex-col overflow-hidden rounded-panel border border-white/[0.07] bg-dusk-glass shadow-panel backdrop-blur-glass",
        className,
      )}
      aria-label={building ? `${building.label ?? building.id} details` : "Building detail"}
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/[0.07] px-4 py-3">
        <div className="min-w-0">
          <p className="font-mono text-dusk-xs text-dusk-primary">{building?.id ?? "Loading"}</p>
          <h2 className="mt-0.5 truncate text-dusk-lg font-semibold tracking-[-0.01em] text-dusk-text">{building?.label ?? "Building detail"}</h2>
        </div>
        {building ? <StatusChip status={building.display_status} /> : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading && !building ? <DetailSkeleton /> : null}
        {building ? (
          <div className="space-y-4">
            {error ? (
              <div role="alert" className="flex gap-2 rounded-card border border-status-review/50 bg-status-review/10 p-3 text-sm leading-5 text-dusk-text">
                <AlertTriangle aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-status-review" />
                <span>Some supporting information could not be refreshed. Showing the most recent building record.</span>
              </div>
            ) : null}

            <section className="relative h-52 overflow-hidden rounded-card border border-white/[0.07] bg-dusk-elevated" aria-label="Facade photo with verifier crop line">
              <div className="absolute inset-0 grid place-items-center text-dusk-muted"><Building2 aria-hidden="true" size={32} /></div>
              {building.photo ? (
                <img
                  src={building.photo}
                  alt={photoAlt(building)}
                  className="relative h-full w-full object-cover"
                  onError={(event) => { event.currentTarget.style.display = "none"; }}
                />
              ) : null}
              <div className="pointer-events-none absolute inset-x-0 top-[45%] border-t border-dashed border-dusk-warm/90" />
              <span className="pointer-events-none absolute left-2 top-[calc(45%+0.35rem)] rounded-chip bg-dusk-background/90 px-2 py-1 text-[10px] font-semibold text-dusk-warm shadow-panel">
                Verifier sees only above this line
              </span>
            </section>

            <section aria-label="Independent model readings" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-card border border-white/[0.07] bg-white/[0.03] p-3">
                <p className="text-xs font-semibold text-dusk-text">Pass 1 · Facade reader</p>
                <p className="mt-1 font-mono text-[11px] leading-4 text-dusk-muted">{modelFamily(building.models.vision)}</p>
                <div className="mt-2"><StatusChip status={(building.upper_status ?? "unclear") as DisplayStatus} /></div>
                <p className="mt-2 text-xs text-dusk-muted">{confidence(building.confidence)}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {building.upper_signals.length ? building.upper_signals.slice(0, 3).map((signal) => (
                    <Chip key={signal} tone="neutral" label={safeCopy(signal, "Signal recorded")} className="max-w-full text-left font-normal" />
                  )) : <span className="text-xs text-dusk-muted">No upper-floor signals recorded.</span>}
                </div>
              </div>

              <div className="rounded-card border border-white/[0.07] bg-white/[0.03] p-3">
                <p className="text-xs font-semibold text-dusk-text">Pass 2 · Independent verifier</p>
                <p className="mt-1 font-mono text-[11px] leading-4 text-dusk-muted">{modelFamily(building.verifier?.model ?? building.models.verifier)}</p>
                <div className="mt-2">
                  <StatusChip status={(building.verifier?.status ?? "unclear") as DisplayStatus} />
                </div>
                <div className="mt-2 space-y-1.5 text-xs leading-4 text-dusk-muted">
                  {building.verifier?.for_use?.slice(0, 2).map((signal) => (
                    <p key={`for-${signal}`} className="flex gap-1.5"><ThumbsUp aria-hidden="true" size={13} className="mt-0.5 shrink-0 text-[#5EE0A1]" />{safeCopy(signal, "Sign for use recorded")}</p>
                  ))}
                  {building.verifier?.against_use?.slice(0, 2).map((signal) => (
                    <p key={`against-${signal}`} className="flex gap-1.5"><ThumbsDown aria-hidden="true" size={13} className="mt-0.5 shrink-0 text-status-likely-underused" />{safeCopy(signal, "Sign against use recorded")}</p>
                  ))}
                  {!building.verifier ? <p>Independent verification is pending.</p> : null}
                </div>
              </div>
            </section>

            {building.verifier ? (
              <div className={cn("flex gap-2 rounded-card border p-3 text-sm leading-5", building.verifier.agree ? "border-[#5EE0A1]/40 bg-[#5EE0A1]/10 text-dusk-text" : "border-status-review/50 bg-status-review/10 text-dusk-text")}>
                {building.verifier.agree ? <Check aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-[#5EE0A1]" /> : <AlertTriangle aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-status-review" />}
                <span>{building.verifier.agree ? "Two independent model families agree" : "Disagreement: sent to human"}</span>
              </div>
            ) : null}

            <section aria-labelledby="evidence-heading">
              <h3 id="evidence-heading" className="text-sm font-semibold text-dusk-text">Visible evidence</h3>
              <p className="mt-1 text-sm leading-5 text-dusk-muted">{safeCopy(building.evidence, "No evidence sentence has been recorded yet.")}</p>
            </section>

            <section aria-labelledby="services-heading" className="rounded-card border border-white/[0.07] bg-white/[0.03] p-3">
              <div className="flex items-baseline justify-between gap-3">
                <h3 id="services-heading" className="text-sm font-semibold text-dusk-text">Services within walking distance</h3>
                <span className="font-mono text-sm text-dusk-warm">{serviceResponse?.services?.score ?? building.services?.score ?? 0}/5</span>
              </div>
              <ul className="mt-1 divide-y divide-white/[0.07]">
                {SERVICE_ROWS.map((meta) => (
                  <ServiceRow
                    key={meta.kind}
                    meta={meta}
                    services={serviceResponse?.services ?? building.services}
                    poi={serviceResponse?.pois.find((poi) => poi.kind === meta.kind)}
                  />
                ))}
              </ul>
            </section>

            <RegisterFlags building={building} />
            <SimilarStrip similar={similar} onSelect={onSelectSimilar} />
            {actionSlot}
            {children}
          </div>
        ) : null}
      </div>

      {building ? (
        <footer className="shrink-0 border-t border-white/[0.07] bg-dusk-elevated/80 px-4 py-3 text-xs leading-5 text-dusk-muted">
          <p><span className="font-semibold text-dusk-text">Grant amounts:</span> €95,000 for one home, €115,000 for two, €135,000 for three or more; up to €25,000 additional energy upgrades.</p>
          <a href={OFFICIAL_GRANT_FAQ} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 font-medium text-dusk-primary underline decoration-dusk-primary/50 underline-offset-2 hover:text-white">
            Official council FAQ <ExternalLink aria-hidden="true" size={12} />
          </a>
        </footer>
      ) : null}
    </aside>
  );
}
