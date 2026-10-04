import { ClipboardCheck, RotateCcw, ShieldCheck, ThumbsDown, ThumbsUp } from "lucide-react";

import type { Building, InspectionOutcome, UpperStatus } from "../lib/types";
import { Button, Chip } from "../ui";

export interface BuildingActionsProps {
  /** The selected officer-facing building. A missing selection has no actions. */
  building: Building | null;
  /** Controlled by the console's POST /human-label mutation. */
  isLabelPending: boolean;
  /** Controlled by the console's POST /inspection mutation. */
  isInspectionPending: boolean;
  onHumanLabel: (label: UpperStatus) => void;
  onInspection: (outcome: InspectionOutcome) => void;
}

const HUMAN_LABELS: Array<{
  label: UpperStatus;
  title: string;
  Icon: typeof ThumbsUp;
}> = [
  { label: "likely_underused", title: "Likely underused", Icon: ThumbsUp },
  { label: "likely_used", title: "Likely used", Icon: ThumbsDown },
  { label: "unclear", title: "Unclear", Icon: ClipboardCheck },
];

const INSPECTION_OUTCOMES: Array<{
  outcome: InspectionOutcome;
  title: string;
  variant: "primary" | "secondary" | "warm";
  Icon: typeof ShieldCheck;
}> = [
  {
    outcome: "confirmed_candidate",
    title: "Confirmed candidate",
    variant: "primary",
    Icon: ShieldCheck,
  },
  {
    outcome: "not_suitable",
    title: "Not suitable",
    variant: "secondary",
    Icon: ThumbsDown,
  },
  {
    outcome: "returned_to_use",
    title: "Returned to use",
    variant: "warm",
    Icon: RotateCcw,
  },
];

/**
 * Mutation controls for the officer drawer. The parent retains API ownership,
 * allowing static-mode event simulation and the live API to use identical UI.
 */
export function BuildingActions({
  building,
  isLabelPending,
  isInspectionPending,
  onHumanLabel,
  onInspection,
}: BuildingActionsProps) {
  if (!building) return null;

  // The API supplies the canonical display status. Use it directly here so a
  // record remains reviewable even while the parent is reconciling an update.
  const needsHumanScreen = building.display_status === "review";
  const mutationsPending = isLabelPending || isInspectionPending;

  return (
    <section
      className="space-y-4 rounded-card border border-white/[0.07] bg-white/[0.03] p-3"
      aria-label="Officer actions"
    >
      {needsHumanScreen ? (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-dusk-text">Human screen</h3>
              <p className="mt-0.5 text-xs leading-4 text-dusk-muted">
                Record the reviewer&apos;s reading of the upper floors.
              </p>
            </div>
            <Chip status="review" label="Needs human" />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {HUMAN_LABELS.map(({ label, title, Icon }) => (
              <Button
                key={label}
                size="sm"
                variant="secondary"
                fullWidth
                disabled={mutationsPending}
                onClick={() => onHumanLabel(label)}
                leadingIcon={<Icon size={14} />}
              >
                {title}
              </Button>
            ))}
          </div>
          {isLabelPending ? (
            <p className="mt-2 text-xs text-dusk-muted" role="status">
              Recording human screen…
            </p>
          ) : null}
        </div>
      ) : null}

      <div className={needsHumanScreen ? "border-t border-white/[0.07] pt-4" : undefined}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-dusk-text">Log inspection outcome</h3>
            <p className="mt-0.5 text-xs leading-4 text-dusk-muted">
              An officer records this; the recommendation remains human-led.
            </p>
          </div>
          <Chip tone="neutral" icon={<ClipboardCheck size={13} />} label="Officer record" />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {INSPECTION_OUTCOMES.map(({ outcome, title, variant, Icon }) => (
            <div key={outcome} className="min-w-0">
              <Button
                size="sm"
                variant={variant}
                fullWidth
                disabled={mutationsPending}
                onClick={() => onInspection(outcome)}
                leadingIcon={<Icon size={14} />}
              >
                {title}
              </Button>
              {outcome === "returned_to_use" ? (
                <p className="mt-1.5 rounded-chip border border-white/[0.07] px-2 py-1 text-[10px] leading-3 text-dusk-muted">
                  Simulated for demo: real conversions take months
                </p>
              ) : null}
            </div>
          ))}
        </div>
        {isInspectionPending ? (
          <p className="mt-2 text-xs text-dusk-muted" role="status">
            Recording inspection outcome…
          </p>
        ) : null}
      </div>
    </section>
  );
}

export default BuildingActions;
