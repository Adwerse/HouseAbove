/**
 * Public API shapes shared by the officer console and walker experience.
 *
 * These mirror `contracts/CONTRACT.md`, rather than database documents: buildings
 * use `id` (not Mongo's `_id`) and never expose an embedding. Keep this module
 * dependency-free so either product surface can import it safely.
 */

export const UPPER_STATUSES = ["likely_underused", "likely_used", "unclear"] as const;
export type UpperStatus = (typeof UPPER_STATUSES)[number];

export const DISPLAY_STATUSES = [
  "likely_underused",
  "review",
  "unclear",
  "likely_used",
  "confirmed",
  "home",
] as const;
export type DisplayStatus = (typeof DISPLAY_STATUSES)[number];

export const INSPECTION_OUTCOMES = [
  "confirmed_candidate",
  "not_suitable",
  "returned_to_use",
] as const;
export type InspectionOutcome = (typeof INSPECTION_OUTCOMES)[number];

export const SERVICE_KINDS = ["bus", "grocery", "school", "gp_or_pharmacy", "park"] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

export const BADGE_IDS = [
  "first_look",
  "street_scout",
  "main_street",
  "five_k",
  "streak_3",
  "local_knowledge",
  "second_look",
  "homes_above",
  "lights_on",
] as const;
export type BadgeId = (typeof BADGE_IDS)[number];

export type IsoDateTime = string;
export type Position = [longitude: number, latitude: number];

export interface PointGeometry {
  type: "Point";
  coordinates: Position;
}

export interface LineStringGeometry {
  type: "LineString";
  coordinates: Position[];
}

export interface PolygonGeometry {
  type: "Polygon";
  coordinates: Position[][];
}

export type Geometry = PointGeometry | LineStringGeometry | PolygonGeometry;

export interface GeoJsonFeature<
  TProperties = Record<string, unknown>,
  TGeometry extends Geometry | null = Geometry | null,
> {
  type: "Feature";
  id?: string;
  geometry: TGeometry;
  properties: TProperties;
}

export interface FeatureCollection<
  TProperties = Record<string, unknown>,
  TGeometry extends Geometry | null = Geometry | null,
> {
  type: "FeatureCollection";
  features: Array<GeoJsonFeature<TProperties, TGeometry>>;
}

export interface Verifier {
  agree: boolean;
  for_use: string[];
  against_use: string[];
  status: UpperStatus;
  model: string;
}

export interface Services {
  bus_m: number | null;
  grocery_m: number | null;
  school_m: number | null;
  gp_or_pharmacy_m: number | null;
  park_m: number | null;
  score: number;
}

export interface Registers {
  /** null means the corresponding register has not been checked yet. */
  derelict: boolean | null;
  protected: boolean | null;
}

export interface ModelPair {
  vision: string | null;
  verifier: string | null;
}

export interface Inspection {
  outcome: InspectionOutcome;
  note: string | null;
  at: IsoDateTime;
}

/** A building returned by the public building endpoints. */
export interface Building {
  id: string;
  label: string | null;
  street: string | null;
  location: PointGeometry | null;
  footprint: PolygonGeometry | null;
  geo_method: string | null;
  photo: string | null;
  source: string | null;
  ground_floor: "open" | "vacant" | "unclear" | null;
  upper_floors: number | null;
  upper_status: UpperStatus | null;
  upper_signals: string[];
  separate_entrance: "yes" | "no" | "unclear" | null;
  confidence: number | null;
  evidence: string | null;
  verifier: Verifier | null;
  needs_human: boolean;
  services: Services | null;
  registers: Registers;
  rank: number | null;
  height_m: number | null;
  models: ModelPair;
  human_label: UpperStatus | null;
  shop_staff_answer: string | null;
  inspection: Inspection | null;
  /** Capture metadata is owned by the walker flow and may be absent before import. */
  captured_by?: string | null;
  captured_at?: IsoDateTime | null;
  walk_id?: string | null;
  phash?: string | null;
  display_status: DisplayStatus;
}

/** Database-only additions. Never send this type to an officer-facing view. */
export interface BuildingDocument extends Omit<Building, "id" | "display_status"> {
  _id: string;
  embedding: number[];
}

export type BuildingGeometry = PointGeometry | PolygonGeometry;
export type BuildingsGeoJson = FeatureCollection<Building, BuildingGeometry>;

export interface Poi {
  id: string;
  kind: ServiceKind;
  name: string;
  lat: number;
  lon: number;
}

export interface NearbyPoi extends Poi {
  dist_m: number;
}

export interface BuildingServicesResponse {
  services: Services | null;
  pois: NearbyPoi[];
}

export interface SimilarBuilding {
  id: string;
  label: string | null;
  score: number;
  display_status: DisplayStatus;
  photo: string | null;
}

export interface StreetSummary {
  total: number;
  processed: number;
  likely_underused: number;
  review: number;
  confirmed: number;
  home: number;
}

export interface ContextBuildingProperties {
  osm_id?: string;
  height_m: number;
}

export type ContextBuildingsGeoJson = FeatureCollection<ContextBuildingProperties, PolygonGeometry>;

export interface EvalRow {
  id: string;
  label: string | null;
  street: string | null;
  ai: UpperStatus;
  ai_confidence: number | null;
  verifier: UpperStatus | null;
  verifier_agrees: boolean | null;
  human: UpperStatus | null;
  ai_matches_human: boolean | null;
  escalated: boolean;
  shop_staff_answer: string | null;
  shop_staff_reading: "lives_upstairs" | "empty_upstairs" | "unsure" | null;
  shop_staff_confirms_ai: boolean | null;
}

export interface EvalResult {
  rows: EvalRow[];
  /** Agreement with a human screen of the same image, never an accuracy claim. */
  agreement: string;
  escalated: number;
  shop_confirmed: string;
  shop_answers_total?: number;
  shop_answers_unsure?: number;
  buildings_read_by_ai?: number;
  note?: string;
  generated_at?: IsoDateTime;
}

export interface Walker {
  id: string;
  name: string;
  town: string;
}

export interface Capture {
  building_id: string;
  lon: number;
  lat: number;
  t: IsoDateTime;
  thumb: string | null;
}

/** Walker-safe route data; it deliberately contains no AI status fields. */
export interface Walk {
  id: string;
  walker_id: string;
  started_at: IsoDateTime;
  ended_at: IsoDateTime;
  path: LineStringGeometry;
  times: IsoDateTime[];
  distance_m: number;
  building_ids: string[];
  captures: Capture[];
}

export interface Award {
  id: string;
  walker_id: string;
  badge_id: BadgeId;
  building_id: string | null;
  at: IsoDateTime;
  reason: string;
  title?: string;
}

export type BadgeTier = "bronze" | "silver" | "gold" | "civic";

export interface Badge {
  id: BadgeId;
  title: string;
  description: string;
  /** From the badge engine's catalog; optional so older exports still parse. */
  tier?: BadgeTier;
  icon?: string;
  target?: number;
  unit?: string;
}

export interface BadgeProgress {
  badge_id: BadgeId;
  current: number;
  target: number;
}

export interface WalkerStats {
  distance_m: number;
  minutes: number;
  facades: number;
  streets: number;
  floors_scanned: number;
  streak_days: number;
}

export interface WalkerProfileResponse {
  walker: Walker;
  stats: WalkerStats;
  awards: Award[];
  progress: BadgeProgress[];
}

export interface InspectionResponse {
  building: Building;
  awards: Award[];
}

export interface BuildingUpdatedEvent {
  type: "building.updated";
  data: { id: string };
}

export interface InspectionRecordedEvent {
  type: "inspection.recorded";
  data: { id: string; outcome: InspectionOutcome };
}

export interface BadgeAwardedEvent {
  type: "badge.awarded";
  data: { walker_id: string; badge_id: BadgeId; building_id: string | null; title: string };
}

export type HomesAboveEvent = BuildingUpdatedEvent | InspectionRecordedEvent | BadgeAwardedEvent;
export type HomesAboveEventType = HomesAboveEvent["type"];

export interface AgentToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AgentToolResult {
  id: string;
  name: string;
  ms: number | null;
  db_op: string;
  summary: string;
}

export type AgentEvent =
  | { event: "tool_call"; data: AgentToolCall }
  | { event: "tool_result"; data: AgentToolResult }
  | { event: "delta"; data: { text: string } }
  | { event: "done"; data: { text: string; error?: boolean } };

/** An agent event recorded for deterministic static-mode replay. */
export type TimedAgentEvent = AgentEvent & { t_ms: number };
