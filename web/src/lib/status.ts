import { statusColors } from "../theme/tokens";
import type { Building, DisplayStatus, UpperStatus } from "./types";

/** Display-status colours, from the "Fresh air" palette in theme/tokens.ts. */
export const STATUS_COLORS: Record<DisplayStatus, string> = statusColors;

export const STATUS_LABELS: Record<DisplayStatus, string> = {
  likely_underused: "Likely underused",
  review: "Needs a human",
  unclear: "Unclear",
  likely_used: "Likely used",
  confirmed: "Confirmed candidate",
  home: "Returned to use",
};

/** The minimum input required to derive the shared display status. */
export type BuildingStatusSource = Pick<
  Building,
  "inspection" | "needs_human" | "human_label" | "upper_status"
>;

/**
 * Contract v1.1 display-status precedence. This must stay in lockstep with the
 * API so optimistic/static updates look identical to live data.
 */
export function displayStatus(building: BuildingStatusSource): DisplayStatus {
  const outcome = building.inspection?.outcome;

  if (outcome === "returned_to_use") return "home";
  if (outcome === "confirmed_candidate") return "confirmed";
  if (outcome === "not_suitable") return "likely_used";
  if (building.needs_human && !building.human_label) return "review";

  return (building.human_label ?? building.upper_status ?? "unclear") as UpperStatus;
}
