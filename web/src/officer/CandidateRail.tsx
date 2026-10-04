import { useState } from "react";
import { CircleCheck, CircleHelp, TriangleAlert } from "lucide-react";

import { STATUS_COLORS, STATUS_LABELS, displayStatus } from "../lib/status";
import type { Building, DisplayStatus } from "../lib/types";
import { duskColors, numericStyle } from "../theme/tokens";
import { Chip, Skeleton } from "../ui";
import { cn, focusRingClass, withAlpha } from "../ui/utils";

export const CANDIDATE_FILTERS = ["all", "likely_underused", "review", "confirmed"] as const;
export type CandidateFilter = (typeof CANDIDATE_FILTERS)[number];

const filterLabels: Record<CandidateFilter, string> = {
  all: "All",
  likely_underused: "Likely underused",
  review: "Needs human",
  confirmed: "Confirmed",
};

export interface CandidateRailProps {
  /** Buildings may come from the live buildings endpoint or the static demo data. */
  buildings: Building[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  /** Used by the map shell to give a row a lightweight hover highlight. */
  onHover?: (id: string | null) => void;
  /** Optional controlled filter; omit it to let the rail own its filter state. */
  filter?: CandidateFilter;
  onFilterChange?: (filter: CandidateFilter) => void;
  className?: string;
}

function confidencePercent(confidence: number | null) {
  if (confidence === null || !Number.isFinite(confidence)) return 0;
  const fractionalConfidence = confidence > 1 ? confidence / 100 : confidence;
  return Math.round(Math.max(0, Math.min(1, fractionalConfidence)) * 100);
}

function serviceScore(building: Building) {
  return Math.max(0, Math.min(5, Math.round(building.services?.score ?? 0)));
}

function statusFor(building: Building): DisplayStatus {
  // Re-derive rather than trusting a stale optimistic `display_status` value.
  return displayStatus(building);
}

function sortCandidates(buildings: Building[]) {
  return [...buildings].sort((a, b) => {
    const aRank = a.rank ?? Number.MAX_SAFE_INTEGER;
    const bRank = b.rank ?? Number.MAX_SAFE_INTEGER;

    if (aRank !== bRank) return aRank - bRank;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });
}

function ModelAgreement({ building }: { building: Building }) {
  if (building.verifier?.agree) {
    return (
      <span
        className="inline-flex shrink-0 text-dusk-primary"
        title="Two independent model families agree"
        aria-label="Two independent model families agree"
      >
        <CircleCheck size={15} strokeWidth={2.25} aria-hidden="true" />
      </span>
    );
  }

  if (building.verifier && !building.verifier.agree) {
    return (
      <span
        className="inline-flex shrink-0 text-status-review"
        title="The model families disagree; this facade was sent to human review"
        aria-label="The model families disagree; this facade was sent to human review"
      >
        <TriangleAlert size={15} strokeWidth={2.25} aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      className="inline-flex shrink-0 text-dusk-muted"
      title="Independent verification is not available yet"
      aria-label="Independent verification is not available yet"
    >
      <CircleHelp size={15} strokeWidth={2.25} aria-hidden="true" />
    </span>
  );
}

function CandidateThumbnail({ building }: { building: Building }) {
  const [failed, setFailed] = useState(false);

  return (
    <span
      className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-card border border-white/[0.07] bg-dusk-elevated"
      aria-hidden="true"
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-dusk-muted">HA</span>
      {building.photo && !failed ? (
        <img
          src={building.photo}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : null}
    </span>
  );
}

function CandidateRow({
  building,
  listIndex,
  selected,
  onSelect,
  onHover,
}: {
  building: Building;
  listIndex: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onHover?: (id: string | null) => void;
}) {
  const status = statusFor(building);
  const statusColor = STATUS_COLORS[status];
  const confidence = confidencePercent(building.confidence);
  const rank = building.rank ?? listIndex + 1;

  return (
    <li>
      <button
        type="button"
        className={cn(
          "group relative flex w-full items-start gap-2.5 rounded-card border p-2.5 text-left",
          "transition-[background-color,border-color,transform] duration-dusk-fast ease-dusk-out",
          "hover:bg-white/[0.055] active:translate-y-px",
          focusRingClass,
        )}
        style={{
          backgroundColor: selected ? withAlpha(statusColor, "14") : "rgba(255, 255, 255, 0.025)",
          borderColor: selected ? withAlpha(statusColor, "88") : duskColors.border,
        }}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(building.id)}
        onFocus={() => onHover?.(building.id)}
        onBlur={() => onHover?.(null)}
        onMouseEnter={() => onHover?.(building.id)}
        onMouseLeave={() => onHover?.(null)}
      >
        <span
          className="mt-0.5 w-5 shrink-0 font-mono text-dusk-xs font-semibold text-dusk-muted"
          style={numericStyle}
          aria-label={`Rank ${rank}`}
        >
          {String(rank).padStart(2, "0")}
        </span>

        <CandidateThumbnail building={building} />

        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-start justify-between gap-2">
            <span className="truncate text-dusk-sm font-semibold leading-5 text-dusk-text">
              {building.label ?? building.id}
            </span>
            <ModelAgreement building={building} />
          </span>

          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Chip status={status} className="max-w-full whitespace-nowrap" />
            <span className="text-dusk-xs text-dusk-muted">Services {serviceScore(building)}/5</span>
          </span>

          <span className="mt-2 flex items-center gap-2">
            <span
              className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.08]"
              role="progressbar"
              aria-label={`${confidence}% confidence`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={confidence}
            >
              <span
                className="block h-full rounded-full transition-[width] duration-dusk-normal ease-dusk-out"
                style={{ width: `${confidence}%`, backgroundColor: statusColor }}
              />
            </span>
            <span className="w-8 text-right font-mono text-dusk-xs text-dusk-muted" style={numericStyle}>
              {confidence}%
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * The ranked officer-facing candidate list.  The live console controls
 * selection and may optionally control its filter; the component deliberately
 * has no data-fetching dependency, so static-mode and API data stay identical.
 */
export function CandidateRail({
  buildings,
  selectedId,
  onSelect,
  onHover,
  filter,
  onFilterChange,
  className,
}: CandidateRailProps) {
  const [uncontrolledFilter, setUncontrolledFilter] = useState<CandidateFilter>("all");
  const activeFilter = filter ?? uncontrolledFilter;
  const sortedBuildings = sortCandidates(buildings);
  const candidates = sortedBuildings.filter((building) =>
    activeFilter === "all" ? true : statusFor(building) === activeFilter,
  );

  function chooseFilter(nextFilter: CandidateFilter) {
    if (filter === undefined) setUncontrolledFilter(nextFilter);
    onFilterChange?.(nextFilter);
  }

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-full max-w-[360px] flex-col overflow-hidden rounded-panel border border-white/[0.07] bg-dusk-glass shadow-panel backdrop-blur-glass",
        className,
      )}
      aria-label="Ranked candidates for inspection"
    >
      <div className="border-b border-white/[0.07] px-3 pb-3 pt-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="font-mono text-dusk-xs uppercase tracking-[0.08em] text-dusk-primary">Prioritise</p>
            <h2 className="mt-1 text-dusk-base font-semibold tracking-[-0.01em] text-dusk-text">
              Candidate for inspection
            </h2>
          </div>
          <span className="font-mono text-dusk-xs text-dusk-muted" style={numericStyle}>
            {candidates.length}/{buildings.length}
          </span>
        </div>

        <div className="mt-3 flex gap-1 overflow-x-auto pb-0.5" role="tablist" aria-label="Candidate filters">
          {CANDIDATE_FILTERS.map((candidateFilter) => {
            const active = candidateFilter === activeFilter;

            return (
              <button
                key={candidateFilter}
                type="button"
                role="tab"
                aria-selected={active}
                className={cn(
                  "shrink-0 rounded-chip border px-2.5 py-1 text-dusk-xs font-semibold",
                  "transition-[background-color,border-color,color] duration-dusk-fast ease-dusk-out",
                  focusRingClass,
                )}
                style={{
                  color: active ? duskColors.background : duskColors.muted,
                  backgroundColor: active ? duskColors.primary : "rgba(255, 255, 255, 0.04)",
                  borderColor: active ? duskColors.primary : duskColors.border,
                }}
                onClick={() => chooseFilter(candidateFilter)}
              >
                {filterLabels[candidateFilter]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {candidates.length ? (
          <ol className="space-y-2">
            {candidates.map((building, index) => (
              <CandidateRow
                key={building.id}
                building={building}
                listIndex={index}
                selected={selectedId === building.id}
                onSelect={onSelect}
                onHover={onHover}
              />
            ))}
          </ol>
        ) : (
          <div className="grid min-h-36 place-items-center px-5 text-center">
            <p className="max-w-52 text-dusk-sm leading-5 text-dusk-muted">
              No facades match this view yet.
            </p>
          </div>
        )}
      </div>

      <p className="border-t border-white/[0.07] px-3 py-2.5 text-dusk-xs leading-4 text-dusk-muted">
        Ranks combine upper-floor signals and services within walking distance.
      </p>
    </aside>
  );
}

/** A dimensionally stable loading state for the live buildings request. */
export function CandidateRailSkeleton({ className }: { className?: string }) {
  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-full max-w-[360px] flex-col overflow-hidden rounded-panel border border-white/[0.07] bg-dusk-glass shadow-panel backdrop-blur-glass",
        className,
      )}
      aria-label="Loading ranked candidates"
    >
      <div className="border-b border-white/[0.07] p-3.5">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-2 h-5 w-44" />
        <div className="mt-4 flex gap-2">
          <Skeleton className="h-7 w-12 rounded-full" />
          <Skeleton className="h-7 w-28 rounded-full" />
          <Skeleton className="h-7 w-24 rounded-full" />
        </div>
      </div>
      <div className="space-y-2 p-2">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="flex gap-2.5 rounded-card border border-white/[0.07] p-2.5">
            <Skeleton className="mt-1 h-3 w-5" />
            <Skeleton shape="rect" className="h-12 w-12 shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-1.5 w-full" />
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

export { STATUS_LABELS };
