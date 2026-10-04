import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";

import { mapStateColors, palette, statusColors } from "../theme/tokens";

/**
 * The base map: OpenFreeMap's Positron (OpenStreetMap data, no API key), recoloured
 * to the "Fresh air" palette, with every building extruded in 3D from the tiles'
 * own heights. Surveyed buildings are recoloured in place through feature-state,
 * so they keep the exact outline of the real building.
 */
export const BASE_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
export const TILE_SOURCE = "openmaptiles";
export const BUILDING_LAYER = "building";
export const BUILDINGS_3D = "buildings-3d";
export const FALLBACK_SOURCE = "survey-fallback";
export const FALLBACK_LAYER = "survey-fallback-3d";

const BUILDING_COLORS: Record<string, string> = {
  ...statusColors,
  captured: mapStateColors.captured,
  pending: mapStateColors.pending,
};

/** Colour by the `s` feature-state (or property) a surveyed building carries; white otherwise. */
export function buildingColor(input: ExpressionSpecification): ExpressionSpecification {
  const cases: (string | ExpressionSpecification)[] = [];
  for (const [key, color] of Object.entries(BUILDING_COLORS)) cases.push(key, color);
  return ["match", ["coalesce", input, "none"], ...cases, mapStateColors.base] as unknown as ExpressionSpecification;
}

const RECOLOR: Record<string, Record<string, unknown>> = {
  background: { "background-color": "#EDF0EA" },
  park: { "fill-color": palette.park, "fill-opacity": 0.9 },
  landcover_wood: { "fill-color": "#CFE4C8" },
  landuse_residential: { "fill-color": "#EBEEE8" },
  water: { "fill-color": palette.water },
  waterway: { "line-color": "#BFD7DF" },
  highway_path: { "line-color": "#F8F9F6" },
  highway_minor: { "line-color": "#FFFFFF" },
  highway_major_casing: { "line-color": "#DCE1D9" },
  highway_major_inner: { "line-color": "#FFFFFF" },
  highway_major_subtle: { "line-color": "#F1F3EE" },
  highway_motorway_casing: { "line-color": "#DCE1D9" },
  highway_motorway_subtle: { "line-color": "#EEF1EB" },
  railway_transit: { "line-color": "#D6DBD3" },
  railway_service: { "line-color": "#D6DBD3" },
  railway: { "line-color": "#D6DBD3" },
  road_area_pier: { "fill-color": "#EDF0EA" },
};

const TEXT: Record<string, string> = {
  "highway-name-path": "#8C968F",
  "highway-name-minor": "#6E7973",
  "highway-name-major": "#56615A",
  water_name_point_label: "#5D8590",
  water_name_line_label: "#5D8590",
  label_other: "#4A544E",
  label_village: "#2E3631",
  label_town: "#2E3631",
  label_city: "#1F2622",
  label_city_capital: "#1F2622",
};

const HIDE = /^(boundary|aeroway|airport|highway-shield|road_shield|landcover_(ice|glacier)|tunnel)/;

export async function loadBaseStyle(): Promise<StyleSpecification> {
  const response = await fetch(BASE_STYLE_URL);
  if (!response.ok) throw new Error(`Base map style unavailable (${response.status})`);
  const style = (await response.json()) as StyleSpecification;

  const layers: LayerSpecification[] = [];
  for (const layer of style.layers) {
    if (HIDE.test(layer.id)) continue;
    const paint = { ...(("paint" in layer && layer.paint) || {}) } as Record<string, unknown>;
    Object.assign(paint, RECOLOR[layer.id] ?? {});
    if (layer.type === "symbol" && TEXT[layer.id]) {
      paint["text-color"] = TEXT[layer.id];
      paint["text-halo-color"] = "rgba(255,255,255,0.92)";
      paint["text-halo-width"] = 1.4;
    }
    if (layer.id === "building") {
      // flat footprints only when zoomed out; from z14 the 3D layer takes over
      layers.push({ ...layer, maxzoom: 14, paint: { "fill-color": "#E3E7E0" } } as LayerSpecification);
      layers.push(buildings3d());
      continue;
    }
    layers.push({ ...layer, paint } as LayerSpecification);
  }
  style.layers = layers;
  style.light = { anchor: "map", color: "#ffffff", intensity: 0.32, position: [1.35, 210, 42] };
  style.sky = {
    "sky-color": "#E4EFF2",
    "horizon-color": "#F5F7F2",
    "fog-color": "#EEF1EB",
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.7,
    "fog-ground-blend": 0.35,
    "atmosphere-blend": 0,
  };
  return style;
}

function buildings3d(): LayerSpecification {
  return {
    id: BUILDINGS_3D,
    type: "fill-extrusion",
    source: TILE_SOURCE,
    "source-layer": BUILDING_LAYER,
    minzoom: 14,
    filter: ["!=", ["get", "hide_3d"], true],
    paint: {
      "fill-extrusion-color": mapStateColors.base,
      "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 14, 0, 14.8, ["coalesce", ["get", "render_height"], 6]],
      "fill-extrusion-base": ["interpolate", ["linear"], ["zoom"], 14, 0, 14.8, ["coalesce", ["get", "render_min_height"], 0]],
      "fill-extrusion-opacity": 1,
      "fill-extrusion-vertical-gradient": true,
    },
  } as LayerSpecification;
}

/** Surveyed buildings the tiles have no matching building for: drawn from our own footprint. */
export function fallbackLayer(): LayerSpecification {
  return {
    id: FALLBACK_LAYER,
    type: "fill-extrusion",
    source: FALLBACK_SOURCE,
    paint: {
      "fill-extrusion-color": buildingColor(["get", "s"]),
      "fill-extrusion-height": ["get", "h"],
      "fill-extrusion-base": 0,
      "fill-extrusion-opacity": 1,
      "fill-extrusion-vertical-gradient": true,
    },
  } as LayerSpecification;
}
