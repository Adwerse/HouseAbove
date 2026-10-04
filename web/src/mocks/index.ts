import { displayStatus } from "../lib/status";
import {
  BADGE_IDS,
  SERVICE_KINDS,
  type AgentEvent,
  type Award,
  type Badge,
  type Building,
  type BuildingGeometry,
  type BuildingServicesResponse,
  type BuildingsGeoJson,
  type ContextBuildingsGeoJson,
  type EvalResult,
  type NearbyPoi,
  type PointGeometry,
  type Poi,
  type PolygonGeometry,
  type Position,
  type ServiceKind,
  type Services,
  type SimilarBuilding,
  type StreetSummary,
  type TimedAgentEvent,
  type UpperStatus,
  type Walk,
  type Walker,
  type WalkerProfileResponse,
} from "../lib/types";

/** Deterministic officer-console data for a useful static-mode first render. */
export const TALBOT_STREET = "Talbot Street";
export const DEFAULT_MOCK_WALKER_ID = "w_rodion";

const VISION_MODEL = "qwen2.5-vl-72b-instruct";
const VERIFIER_MODEL = "llama-3.2-90b-vision-instruct";

const point = (lon: number, lat: number): PointGeometry => ({
  type: "Point",
  coordinates: [lon, lat],
});

const polygon = (...coordinates: Position[]): PolygonGeometry => ({
  type: "Polygon",
  coordinates: [[...coordinates, coordinates[0]]],
});

const services = (
  bus_m: number | null,
  grocery_m: number | null,
  school_m: number | null,
  gp_or_pharmacy_m: number | null,
  park_m: number | null,
  score: number,
): Services => ({ bus_m, grocery_m, school_m, gp_or_pharmacy_m, park_m, score });

const verifier = (
  status: UpperStatus,
  agree: boolean,
  for_use: string[],
  against_use: string[],
) => ({ agree, for_use, against_use, status, model: VERIFIER_MODEL });

type BuildingSeed = Partial<Omit<Building, "display_status">> &
  Pick<Building, "id" | "label" | "location" | "footprint">;

const defaultBuilding: Omit<
  Building,
  "id" | "label" | "location" | "footprint" | "display_status"
> = {
  street: TALBOT_STREET,
  geo_method: "projected_contains",
  photo: null,
  source: "walker-upload",
  ground_floor: "open",
  upper_floors: 2,
  upper_status: "unclear",
  upper_signals: [],
  separate_entrance: "unclear",
  confidence: 0.5,
  evidence: "The upper floors are partly obscured in this capture.",
  verifier: verifier("unclear", true, [], ["The upper facade is partly obscured."]),
  needs_human: false,
  services: services(null, null, null, null, null, 0),
  registers: { derelict: false, protected: false },
  rank: null,
  height_m: 9.6,
  models: { vision: VISION_MODEL, verifier: VERIFIER_MODEL },
  human_label: null,
  shop_staff_answer: null,
  inspection: null,
  captured_by: DEFAULT_MOCK_WALKER_ID,
  captured_at: "2026-10-04T11:07:00Z",
  walk_id: "walk_talbot_morning",
  phash: "c3a5f0924e6b17d0",
};

function makeBuilding(seed: BuildingSeed): Building {
  const building = { ...defaultBuilding, ...seed };
  return { ...building, display_status: displayStatus(building) };
}

/** Eight nearby facades, deliberately covering every display-status path. */
export const mockBuildings: Building[] = [
  makeBuilding({
    id: "talbot_12",
    label: "Talbot St 12",
    location: point(-6.25179, 53.35164),
    footprint: null,
    geo_method: "projected_prism",
    photo: "/photos/talbot_12.jpg",
    upper_floors: 2,
    upper_status: "likely_underused",
    upper_signals: ["Two upper windows are shuttered in daylight.", "A separate door is visible beside the shopfront."],
    separate_entrance: "yes",
    confidence: 0.88,
    evidence: "Two upper windows are shuttered and the separate side entrance appears unused.",
    verifier: verifier(
      "likely_underused",
      true,
      ["The upper windows have closed shutters.", "The side entrance is distinct from the shop."],
      ["One lit room could indicate occasional use."],
    ),
    services: services(75, 160, 630, 520, 730, 5),
    registers: { derelict: false, protected: false },
    rank: 1,
    height_m: 9.6,
    shop_staff_answer: "The upstairs rooms have not been used for a while, as far as I know.",
    phash: "c3a5f0924e6b17d0",
  }),
  makeBuilding({
    id: "talbot_18",
    label: "Talbot St 18",
    location: point(-6.25158, 53.35171),
    footprint: polygon(
      [-6.25166, 53.35167],
      [-6.25151, 53.35170],
      [-6.25150, 53.35175],
      [-6.25165, 53.35172],
    ),
    photo: "/photos/talbot_18.jpg",
    upper_floors: 3,
    upper_status: "likely_used",
    upper_signals: ["Curtains and window boxes are visible on each upper floor.", "The entrance is shared with the active shop."],
    separate_entrance: "no",
    confidence: 0.91,
    evidence: "Curtains, window boxes and repeated signs of day-to-day use are visible upstairs.",
    verifier: verifier(
      "likely_used",
      true,
      ["Each upper floor has furnishings visible at the windows."],
      ["The rear elevation is not visible."],
    ),
    services: services(110, 90, null, 210, null, 3),
    registers: { derelict: false, protected: true },
    rank: 7,
    height_m: 12.8,
    captured_by: "w_aoife",
    captured_at: "2026-10-04T10:52:00Z",
    walk_id: "walk_talbot_early",
    phash: "b3a5e1125b6b20d1",
    shop_staff_answer: "A family lives above the shop.",
  }),
  makeBuilding({
    id: "talbot_21",
    label: "Talbot St 21",
    location: point(-6.25137, 53.35178),
    footprint: polygon(
      [-6.25144, 53.35174],
      [-6.25130, 53.35177],
      [-6.25128, 53.35182],
      [-6.25142, 53.35179],
    ),
    geo_method: "point_nearest",
    photo: "/photos/talbot_21.jpg",
    ground_floor: "unclear",
    upper_floors: null,
    upper_status: "unclear",
    upper_signals: ["The upper facade is in deep shadow."],
    separate_entrance: "unclear",
    confidence: 0.47,
    evidence: "Shadow and a delivery vehicle block a clear reading of the upper floors.",
    verifier: verifier(
      "unclear",
      true,
      ["No clear signs of occupation are visible."],
      ["No clear signs of disuse are visible."],
    ),
    services: services(460, 550, 740, 900, 450, 2),
    registers: { derelict: null, protected: null },
    rank: 5,
    height_m: 9.6,
    phash: "d9c2ee92101a0f55",
  }),
  makeBuilding({
    id: "talbot_28",
    label: "Talbot St 28",
    location: point(-6.25113, 53.35186),
    footprint: polygon(
      [-6.25120, 53.35182],
      [-6.25105, 53.35185],
      [-6.25103, 53.35190],
      [-6.25118, 53.35187],
    ),
    photo: "/photos/talbot_28.jpg",
    upper_floors: 2,
    upper_status: "likely_underused",
    upper_signals: ["A separate upper-floor entrance has a weathered noticeboard.", "Several windows are boarded from inside."],
    separate_entrance: "yes",
    confidence: 0.72,
    evidence: "The entrance and boarded upper windows suggest the floors may be underused.",
    verifier: verifier(
      "likely_used",
      false,
      ["One upper window has a recently maintained curtain."],
      ["The other upper windows appear closed for a long period."],
    ),
    needs_human: true,
    services: services(150, 220, 660, 410, 760, 5),
    registers: { derelict: false, protected: false },
    rank: 2,
    height_m: 9.6,
    captured_by: "w_aoife",
    captured_at: "2026-10-04T10:58:00Z",
    walk_id: "walk_talbot_early",
    phash: "be7ac912416b1d42",
  }),
  makeBuilding({
    id: "talbot_34",
    label: "Talbot St 34",
    location: point(-6.25087, 53.35194),
    footprint: polygon(
      [-6.25094, 53.35190],
      [-6.25080, 53.35193],
      [-6.25078, 53.35198],
      [-6.25092, 53.35195],
    ),
    geo_method: "point_contains",
    photo: "/photos/talbot_34.jpg",
    upper_floors: 2,
    upper_status: "likely_underused",
    upper_signals: ["The upper entrance is separate from the ground-floor café.", "No internal lights or furnishings are visible."],
    separate_entrance: "yes",
    confidence: 0.94,
    evidence: "A separate upper entrance and consistently bare windows supported an inspection.",
    verifier: verifier(
      "likely_underused",
      true,
      ["The separate entrance and bare upper rooms support the reading."],
      ["Curtains on one window could be historic."],
    ),
    services: services(135, 190, 700, 530, 600, 5),
    registers: { derelict: false, protected: false },
    rank: 3,
    height_m: 9.6,
    human_label: "likely_underused",
    inspection: {
      outcome: "confirmed_candidate",
      note: "Officer confirmed this as a candidate for inspection follow-up.",
      at: "2026-10-04T12:42:00Z",
    },
    phash: "e3da2204118e7490",
    shop_staff_answer: "The upstairs flat has been unused since the last tenant moved on.",
  }),
  makeBuilding({
    id: "talbot_42",
    label: "Talbot St 42",
    location: point(-6.25062, 53.35202),
    footprint: null,
    geo_method: "projected_prism",
    photo: "/photos/talbot_42.jpg",
    upper_floors: 1,
    upper_status: "likely_underused",
    upper_signals: ["The upper entrance is separate from the pharmacy."],
    separate_entrance: "yes",
    confidence: 0.77,
    evidence: "A separate entrance prompted a follow-up before the floors returned to use.",
    verifier: verifier(
      "likely_underused",
      true,
      ["The separate upper entrance is clearly visible."],
      ["A lit window suggests some activity."],
    ),
    services: services(280, 310, 740, 650, 815, 4),
    registers: { derelict: false, protected: false },
    rank: 4,
    height_m: 6.4,
    inspection: {
      outcome: "returned_to_use",
      note: "Owner confirmed the upper floor is now in residential use.",
      at: "2026-10-04T12:18:00Z",
    },
    captured_by: "w_aoife",
    captured_at: "2026-10-04T11:03:00Z",
    walk_id: "walk_talbot_early",
    phash: "a1be19dd4e03f724",
  }),
  makeBuilding({
    id: "talbot_55",
    label: "Talbot St 55",
    location: point(-6.25037, 53.35210),
    footprint: polygon(
      [-6.25044, 53.35206],
      [-6.25030, 53.35209],
      [-6.25028, 53.35214],
      [-6.25042, 53.35211],
    ),
    geo_method: "point_contains",
    photo: "/photos/talbot_55.jpg",
    upper_floors: 3,
    upper_status: "unclear",
    upper_signals: ["The upper doorway is separate but the windows are reflective."],
    separate_entrance: "yes",
    confidence: 0.58,
    evidence: "Reflective glazing made the first pass uncertain, so a human screen was recorded.",
    verifier: verifier(
      "likely_underused",
      false,
      ["The upper entry is distinct and has no current tenant sign."],
      ["Reflections prevent a reliable reading of the rooms."],
    ),
    needs_human: true,
    services: services(390, 450, null, 780, 620, 3),
    registers: { derelict: false, protected: true },
    rank: 6,
    height_m: 12.8,
    human_label: "likely_underused",
    phash: "c715987b3c93ae20",
  }),
  makeBuilding({
    id: "talbot_67",
    label: "Talbot St 67",
    location: point(-6.25012, 53.35218),
    footprint: polygon(
      [-6.25019, 53.35214],
      [-6.25005, 53.35217],
      [-6.25003, 53.35222],
      [-6.25017, 53.35219],
    ),
    geo_method: "projected_nearest",
    photo: "/photos/talbot_67.jpg",
    upper_floors: 2,
    upper_status: "likely_underused",
    upper_signals: ["The upper facade has closed blinds and no visible furnishings."],
    separate_entrance: "no",
    confidence: 0.67,
    evidence: "Closed blinds prompted a check, but the inspection found the floors unsuitable for reuse.",
    verifier: verifier(
      "likely_underused",
      true,
      ["The blinds have been closed across multiple windows."],
      ["No separate entrance is visible from this side."],
    ),
    services: services(200, 650, 850, 430, 920, 2),
    registers: { derelict: false, protected: false },
    rank: 8,
    height_m: 9.6,
    inspection: {
      outcome: "not_suitable",
      note: "The upper spaces are not suitable for this programme at present.",
      at: "2026-10-04T12:26:00Z",
    },
    phash: "0ac402cb7bd8c1e0",
  }),
];

export const mockBuildingsById: Record<string, Building> = Object.fromEntries(
  mockBuildings.map((building) => [building.id, building]),
);

function buildingFeature(building: Building) {
  const geometry = building.footprint ?? building.location;
  if (!geometry) throw new Error(`Mock building ${building.id} has no map geometry`);
  return {
    type: "Feature" as const,
    id: building.id,
    geometry,
    properties: building,
  };
}

export const mockBuildingsGeoJson: BuildingsGeoJson = {
  type: "FeatureCollection",
  features: mockBuildings.map(buildingFeature) as Array<{
    type: "Feature";
    id: string;
    geometry: BuildingGeometry;
    properties: Building;
  }>,
};

/** A small surrounding OSM layer for building-mass context on the officer map. */
export const mockContextBuildings: ContextBuildingsGeoJson = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: polygon(
        [-6.25203, 53.35156],
        [-6.25189, 53.35159],
        [-6.25187, 53.35164],
        [-6.25201, 53.35161],
      ),
      properties: { osm_id: "way/10410001", height_m: 12.0 },
    },
    {
      type: "Feature",
      geometry: polygon(
        [-6.25195, 53.35184],
        [-6.25180, 53.35187],
        [-6.25178, 53.35192],
        [-6.25193, 53.35189],
      ),
      properties: { osm_id: "way/10410002", height_m: 9.6 },
    },
    {
      type: "Feature",
      geometry: polygon(
        [-6.25075, 53.35167],
        [-6.25060, 53.35170],
        [-6.25058, 53.35175],
        [-6.25073, 53.35172],
      ),
      properties: { osm_id: "way/10410003", height_m: 15.0 },
    },
    {
      type: "Feature",
      geometry: polygon(
        [-6.25071, 53.35223],
        [-6.25056, 53.35226],
        [-6.25054, 53.35231],
        [-6.25069, 53.35228],
      ),
      properties: { osm_id: "way/10410004", height_m: 9.0 },
    },
  ],
};

export const mockPois: Poi[] = [
  { id: "node/5001", kind: "bus", name: "Talbot Street stop", lat: 53.35142, lon: -6.25214 },
  { id: "node/5002", kind: "grocery", name: "Marlborough Grocer", lat: 53.35166, lon: -6.25252 },
  { id: "way/5003", kind: "school", name: "O'Connell School", lat: 53.35510, lon: -6.25510 },
  { id: "node/5004", kind: "gp_or_pharmacy", name: "Talbot Pharmacy", lat: 53.35199, lon: -6.25053 },
  { id: "way/5005", kind: "park", name: "Mountjoy Square", lat: 53.35620, lon: -6.24870 },
];

const serviceDistanceKey: Record<ServiceKind, keyof Pick<Services, "bus_m" | "grocery_m" | "school_m" | "gp_or_pharmacy_m" | "park_m">> = {
  bus: "bus_m",
  grocery: "grocery_m",
  school: "school_m",
  gp_or_pharmacy: "gp_or_pharmacy_m",
  park: "park_m",
};

function nearbyPois(building: Building): NearbyPoi[] {
  if (!building.services) return [];
  return SERVICE_KINDS.flatMap((kind) => {
    const poi = mockPois.find((candidate) => candidate.kind === kind);
    const distance = building.services?.[serviceDistanceKey[kind]];
    return poi && typeof distance === "number" ? [{ ...poi, dist_m: distance }] : [];
  });
}

export const mockNearbyPoisByBuilding: Record<string, NearbyPoi[]> = Object.fromEntries(
  mockBuildings.map((building) => [building.id, nearbyPois(building)]),
);

export const mockServicesByBuilding: Record<string, BuildingServicesResponse> = Object.fromEntries(
  mockBuildings.map((building) => [
    building.id,
    { services: building.services, pois: mockNearbyPoisByBuilding[building.id] },
  ]),
);

export const mockReviewQueue = mockBuildings.filter((building) => building.display_status === "review");

export const mockStreetSummary: StreetSummary = {
  total: 8,
  processed: 8,
  likely_underused: 2,
  review: 1,
  confirmed: 1,
  home: 1,
};

export const mockSummary = {
  streets: { [TALBOT_STREET]: mockStreetSummary },
  all: mockStreetSummary,
};

const similarity = (id: string, score: number): SimilarBuilding => {
  const building = mockBuildingsById[id];
  return {
    id: building.id,
    label: building.label,
    score,
    display_status: building.display_status,
    photo: building.photo,
  };
};

export const mockSimilarByBuilding: Record<string, SimilarBuilding[]> = {
  talbot_12: [similarity("talbot_34", 0.9421), similarity("talbot_28", 0.8913), similarity("talbot_42", 0.8412)],
  talbot_18: [similarity("talbot_67", 0.7824), similarity("talbot_55", 0.7331)],
  talbot_21: [similarity("talbot_55", 0.7188), similarity("talbot_28", 0.6871)],
  talbot_28: [similarity("talbot_12", 0.8913), similarity("talbot_34", 0.8584), similarity("talbot_42", 0.8099)],
  talbot_34: [similarity("talbot_12", 0.9421), similarity("talbot_28", 0.8584), similarity("talbot_42", 0.8155)],
  talbot_42: [similarity("talbot_12", 0.8412), similarity("talbot_34", 0.8155), similarity("talbot_28", 0.8099)],
  talbot_55: [similarity("talbot_21", 0.7188), similarity("talbot_18", 0.7331)],
  talbot_67: [similarity("talbot_18", 0.7824), similarity("talbot_34", 0.7132)],
};

export const mockEval: EvalResult = {
  rows: [
    {
      id: "talbot_12",
      label: "Talbot St 12",
      street: TALBOT_STREET,
      ai: "likely_underused",
      ai_confidence: 0.88,
      verifier: "likely_underused",
      verifier_agrees: true,
      human: "likely_underused",
      ai_matches_human: true,
      escalated: false,
      shop_staff_answer: "The upstairs rooms have not been used for a while, as far as I know.",
      shop_staff_reading: "empty_upstairs",
      shop_staff_confirms_ai: true,
    },
    {
      id: "talbot_18",
      label: "Talbot St 18",
      street: TALBOT_STREET,
      ai: "likely_used",
      ai_confidence: 0.91,
      verifier: "likely_used",
      verifier_agrees: true,
      human: "likely_used",
      ai_matches_human: true,
      escalated: false,
      shop_staff_answer: "A family lives above the shop.",
      shop_staff_reading: "lives_upstairs",
      shop_staff_confirms_ai: true,
    },
    {
      id: "talbot_21",
      label: "Talbot St 21",
      street: TALBOT_STREET,
      ai: "unclear",
      ai_confidence: 0.47,
      verifier: "unclear",
      verifier_agrees: true,
      human: "unclear",
      ai_matches_human: true,
      escalated: false,
      shop_staff_answer: null,
      shop_staff_reading: null,
      shop_staff_confirms_ai: null,
    },
    {
      id: "talbot_28",
      label: "Talbot St 28",
      street: TALBOT_STREET,
      ai: "likely_underused",
      ai_confidence: 0.72,
      verifier: "likely_used",
      verifier_agrees: false,
      human: null,
      ai_matches_human: null,
      escalated: true,
      shop_staff_answer: null,
      shop_staff_reading: null,
      shop_staff_confirms_ai: null,
    },
    {
      id: "talbot_34",
      label: "Talbot St 34",
      street: TALBOT_STREET,
      ai: "likely_underused",
      ai_confidence: 0.94,
      verifier: "likely_underused",
      verifier_agrees: true,
      human: "likely_underused",
      ai_matches_human: true,
      escalated: false,
      shop_staff_answer: "The upstairs flat has been unused since the last tenant moved on.",
      shop_staff_reading: "empty_upstairs",
      shop_staff_confirms_ai: true,
    },
    {
      id: "talbot_42",
      label: "Talbot St 42",
      street: TALBOT_STREET,
      ai: "likely_underused",
      ai_confidence: 0.77,
      verifier: "likely_underused",
      verifier_agrees: true,
      human: "likely_underused",
      ai_matches_human: true,
      escalated: false,
      shop_staff_answer: null,
      shop_staff_reading: null,
      shop_staff_confirms_ai: null,
    },
    {
      id: "talbot_55",
      label: "Talbot St 55",
      street: TALBOT_STREET,
      ai: "unclear",
      ai_confidence: 0.58,
      verifier: "likely_underused",
      verifier_agrees: false,
      human: "likely_underused",
      ai_matches_human: false,
      escalated: true,
      shop_staff_answer: null,
      shop_staff_reading: null,
      shop_staff_confirms_ai: null,
    },
    {
      id: "talbot_67",
      label: "Talbot St 67",
      street: TALBOT_STREET,
      ai: "likely_underused",
      ai_confidence: 0.67,
      verifier: "likely_underused",
      verifier_agrees: true,
      human: "likely_used",
      ai_matches_human: false,
      escalated: false,
      shop_staff_answer: null,
      shop_staff_reading: null,
      shop_staff_confirms_ai: null,
    },
  ],
  agreement: "5/7",
  escalated: 2,
  shop_confirmed: "3/3",
  shop_answers_total: 3,
  shop_answers_unsure: 0,
  buildings_read_by_ai: 8,
  note: "Agreement with a human reading of the same photo is not accuracy. Shop-staff answers are the only real ground truth, and there are few of them.",
  generated_at: "2026-10-04T13:20:00Z",
};

export const mockBadges: Badge[] = [
  { id: "first_look", title: "First Look", description: "Capture your first main-street facade." },
  { id: "street_scout", title: "Street Scout", description: "Capture 10 facades." },
  { id: "main_street", title: "Main Street", description: "Capture 20 facades on one street." },
  { id: "five_k", title: "5K for Homes", description: "Walk 5 km while capturing facades." },
  { id: "streak_3", title: "Three-Day Streak", description: "Capture facades on three different days." },
  { id: "local_knowledge", title: "Local Knowledge", description: "Log a shop-staff answer." },
  { id: "second_look", title: "Second Look", description: "Re-capture a facade first captured by another walker." },
  { id: "homes_above", title: "Homes Above", description: "A facade you captured was confirmed by council inspection." },
  { id: "lights_on", title: "Lights On", description: "A building you captured returned to use as homes." },
];

// Keeps the literal badge catalog tied to the fixed contract ids at compile time.
const mockBadgeIds = new Set(mockBadges.map((badge) => badge.id));
for (const badgeId of BADGE_IDS) {
  if (!mockBadgeIds.has(badgeId)) throw new Error(`Mock badge catalog lacks ${badgeId}`);
}

export const mockWalker: Walker = {
  id: DEFAULT_MOCK_WALKER_ID,
  name: "Rodion Kuznetsov",
  town: "Dublin",
};

export const mockAwards: Award[] = [
  {
    id: "award_first_look_rodion",
    walker_id: DEFAULT_MOCK_WALKER_ID,
    badge_id: "first_look",
    building_id: "talbot_12",
    at: "2026-10-04T11:08:00Z",
    reason: "First facade captured.",
    title: "First Look",
  },
  {
    id: "award_street_scout_rodion",
    walker_id: DEFAULT_MOCK_WALKER_ID,
    badge_id: "street_scout",
    building_id: null,
    at: "2026-10-04T11:15:00Z",
    reason: "Ten facades captured.",
    title: "Street Scout",
  },
];

export const mockWalks: Walk[] = [
  {
    id: "walk_talbot_morning",
    walker_id: DEFAULT_MOCK_WALKER_ID,
    started_at: "2026-10-04T11:00:00Z",
    ended_at: "2026-10-04T11:24:00Z",
    path: {
      type: "LineString",
      coordinates: [
        [-6.25212, 53.35149],
        [-6.25179, 53.35164],
        [-6.25137, 53.35178],
        [-6.25087, 53.35194],
        [-6.25012, 53.35218],
      ],
    },
    times: [
      "2026-10-04T11:00:00Z",
      "2026-10-04T11:07:00Z",
      "2026-10-04T11:13:00Z",
      "2026-10-04T11:18:00Z",
      "2026-10-04T11:24:00Z",
    ],
    distance_m: 1840,
    building_ids: ["talbot_12", "talbot_21", "talbot_34", "talbot_55", "talbot_67"],
    captures: [
      { building_id: "talbot_12", lon: -6.25179, lat: 53.35164, t: "2026-10-04T11:07:00Z", thumb: "/photos/talbot_12.jpg" },
      { building_id: "talbot_21", lon: -6.25137, lat: 53.35178, t: "2026-10-04T11:13:00Z", thumb: "/photos/talbot_21.jpg" },
      { building_id: "talbot_34", lon: -6.25087, lat: 53.35194, t: "2026-10-04T11:18:00Z", thumb: "/photos/talbot_34.jpg" },
      { building_id: "talbot_55", lon: -6.25037, lat: 53.35210, t: "2026-10-04T11:21:00Z", thumb: "/photos/talbot_55.jpg" },
      { building_id: "talbot_67", lon: -6.25012, lat: 53.35218, t: "2026-10-04T11:24:00Z", thumb: "/photos/talbot_67.jpg" },
    ],
  },
];

export const mockWalkerProfile: WalkerProfileResponse = {
  walker: mockWalker,
  stats: { distance_m: 4820, minutes: 74, facades: 14, streets: 2, floors_scanned: 31, streak_days: 2 },
  awards: mockAwards,
  progress: [
    { badge_id: "main_street", current: 14, target: 20 },
    { badge_id: "five_k", current: 4820, target: 5000 },
    { badge_id: "streak_3", current: 2, target: 3 },
  ],
};

export const MOCK_AGENT_QUESTION = `Where on ${TALBOT_STREET} should we inspect first?`;

/** The same JSONL event shape that the real demo cache records. */
export const mockAgentTranscript: TimedAgentEvent[] = [
  { t_ms: 0, event: "tool_call", data: { id: "call_street", name: "street_candidates", args: { street: TALBOT_STREET } } },
  {
    t_ms: 180,
    event: "tool_result",
    data: {
      id: "call_street",
      name: "street_candidates",
      ms: 42,
      db_op: "$geoNear",
      summary: "8 Talbot Street facades ranked; talbot_12 is first.",
    },
  },
  { t_ms: 260, event: "tool_call", data: { id: "call_building", name: "building", args: { id: "talbot_12" } } },
  {
    t_ms: 410,
    event: "tool_result",
    data: {
      id: "call_building",
      name: "building",
      ms: 31,
      db_op: "findOne",
      summary: "talbot_12: likely underused, rank 1, two shuttered upper windows and a separate side entrance.",
    },
  },
  { t_ms: 485, event: "tool_call", data: { id: "call_services", name: "services_nearby", args: { id: "talbot_12" } } },
  {
    t_ms: 640,
    event: "tool_result",
    data: {
      id: "call_services",
      name: "services_nearby",
      ms: 54,
      db_op: "$geoNear",
      summary: "talbot_12 has services 5/5 within walking distance.",
    },
  },
  { t_ms: 820, event: "delta", data: { text: "Start with talbot_12 (rank 1). " } },
  { t_ms: 970, event: "delta", data: { text: "It is likely underused: two shuttered upper windows and a separate side entrance are visible. " } },
  { t_ms: 1130, event: "delta", data: { text: "Services 5/5 are within walking distance. " } },
  { t_ms: 1270, event: "delta", data: { text: "Both model passes agree, but a human should verify it before any next step." } },
  {
    t_ms: 1330,
    event: "done",
    data: {
      text: "Start with talbot_12 (rank 1). It is likely underused: two shuttered upper windows and a separate side entrance are visible. Services 5/5 are within walking distance. Both model passes agree, but a human should verify it before any next step.",
    },
  },
];

export const mockAgentTranscripts: Record<string, TimedAgentEvent[]> = {
  [MOCK_AGENT_QUESTION]: mockAgentTranscript,
};

export function getMockBuilding(id: string): Building | undefined {
  return mockBuildingsById[id];
}

export function getMockSimilar(id: string, k = 5): SimilarBuilding[] {
  return (mockSimilarByBuilding[id] ?? []).slice(0, Math.max(1, Math.min(k, 20)));
}

export function getMockAgentTranscript(question: string): TimedAgentEvent[] {
  return mockAgentTranscripts[question] ?? mockAgentTranscript;
}

/** Deep-copy fixtures before a static-mode write mutates them. */
export function cloneMockData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Convenient full state seed for the static API adapter. */
export function createMockState() {
  return {
    buildings: cloneMockData(mockBuildings),
    awards: cloneMockData(mockAwards),
    walks: cloneMockData(mockWalks),
  };
}

/** Allows static callers to consume replayed events as the un-timed SSE union. */
export function untimedAgentEvent(event: TimedAgentEvent): AgentEvent {
  const { t_ms: _tMs, ...untimed } = event;
  return untimed as AgentEvent;
}
