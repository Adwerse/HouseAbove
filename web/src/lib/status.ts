import type { Building, DisplayStatus, UpperStatus } from "./types";

/** Contract v1.1 status colours. Do not substitute theme colours here. */
export const STATUS_COLORS: Record<DisplayStatus, string> = {
  likely_underused: "#FF5A4E",
  review: "#FFB020",
  unclear: "#94A3B8",
  likely_used: "#475569",
  confirmed: "#8B5CF6",
  home: "#FFD166",
};

export const STATUS_LABELS: Record<DisplayStatus, string> = {
  likely_underused: "Likely underused",
  review: "Needs review",
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
