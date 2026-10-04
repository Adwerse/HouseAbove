import { ArcLayer, LineLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { TripsLayer } from "@deck.gl/geo-layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer } from "@deck.gl/core";
import maplibregl, { type GeoJSONSource, type MapGeoJSONFeature } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

import type { Building, NearbyPoi, ServiceKind, Walk } from "../lib/types";
import { demoCameras, TALBOT_STREET } from "../mocks";
import { hexToRgb, palette, serviceColors, statusColors } from "../theme/tokens";
import { registerMap } from "./controller";
import { outsetRing, pointInPolygon, ringAreaM2, ringBounds, squareAround, walkSeconds, positionAt, type LngLat, type Ring } from "./geometry";
import { useScene, type SceneState } from "./scene";
import {
  BUILDING_LAYER,
  FALLBACK_LAYER,
  FALLBACK_SOURCE,
  fallbackLayer,
  loadBaseStyle,
  TILE_SOURCE,
} from "./style";

/** Route lines, the walker and capture points draw over buildings, like a fitness-app route. */
const ON_TOP = { parameters: { depthCompare: "always", depthWriteEnabled: false } } as Record<string, unknown>;

/** Above this a footprint is a merged terrace, not one house. */
const MAX_HOUSE_AREA_M2 = 1200;
/** Overlays sit this much outside and above the white building they recolour. */
const OUTSET_M = 0.55;
const RAISE_M = 0.35;

type Match = { featureId: string | number; ring: Ring; height: number; area: number };

const SERVICE_ICON: Record<ServiceKind, string> = {
  bus: '<path d="M7 17V7a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v10M7 13h10M9 17v2M15 17v2" />',
  grocery: '<path d="M5 8h14l-1.5 11h-11zM9 8a3 3 0 0 1 6 0" />',
  school: '<path d="m3 9 9-5 9 5-9 5zM7 11v5c3 2 7 2 10 0v-5" />',
  gp_or_pharmacy: '<path d="M12 6v12M6 12h12" />',
  park: '<path d="M12 21v-6M8 15h8l-4-11z" />',
};

function iconSvg(kind: ServiceKind) {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${SERVICE_ICON[kind]}</svg>`;
}

function stateKey(b: Building, s: SceneState): string | null {
  if (s.visibleIds && !s.visibleIds.has(b.id)) return null;
  if (s.colorMode === "none") return null;
  if (s.colorMode === "captured") return "captured";
  if (s.revealed && !s.revealed.has(b.id)) return "captured";
  return b.display_status;
}

export default function MapStage() {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let map: maplibregl.Map | null = null;
    let overlay: MapboxOverlay | null = null;
    let frame = 0;
    let animating = false;
    let loaded = false;

    const matches = new Map<string, Match>();
    const fallbackIds = new Set<string>();
    const photoMarkers = new Map<string, maplibregl.Marker>();
    const poiMarkers = new Map<string, maplibregl.Marker>();
    let poiKey = "";

    const start = demoCameras[TALBOT_STREET] ?? { center: [-6.2553, 53.3506], zoom: 16.6, pitch: 60, bearing: 18 };

    // ------------------------------------------------------------ matching tiles to surveyed buildings
    const matchBuildings = () => {
      if (!map) return false;
      const { buildings } = useScene.getState();
      const todo = buildings.filter((b) => b.location && !matches.has(b.id));
      if (!todo.length) return false;
      const features = map.querySourceFeatures(TILE_SOURCE, { sourceLayer: BUILDING_LAYER });
      let changed = false;
      for (const b of todo) {
        const point = b.location!.coordinates as LngLat;
        let best: Match | null = null;
        for (const f of features) {
          if (f.id === undefined || f.id === null) continue;
          const g = f.geometry;
          const polygons = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
          for (const rings of polygons as LngLat[][][]) {
            const box = ringBounds(rings[0]);
            if (point[0] < box.minX || point[0] > box.maxX || point[1] < box.minY || point[1] > box.maxY) continue;
            if (!pointInPolygon(point, rings)) continue;
            const area = ringAreaM2(rings[0]);
            if (!best || area < best.area) {
              best = { featureId: f.id, ring: rings[0], height: Number(f.properties?.render_height ?? 9), area };
            }
          }
        }
        if (best) {
          matches.set(b.id, best);
          changed = true;
        }
      }
      return changed;
    };

    /**
     * The tiles merge neighbouring buildings into one feature, so surveyed buildings are
     * drawn as their own extrusion: our OSM footprint, else the single tile polygon if it
     * is house-sized, else a small square; as tall as the tile building at that point.
     */
    const shapeOf = (b: Building): { ring: LngLat[]; height: number } => {
      const m = matches.get(b.id);
      const own = b.footprint?.coordinates[0] as Ring | undefined;
      const ring = own && ringAreaM2(own) <= MAX_HOUSE_AREA_M2
        ? own
        : m && m.area <= MAX_HOUSE_AREA_M2
          ? m.ring
          : squareAround(b.location!.coordinates as LngLat, 4.6);
      return { ring, height: (m?.height ?? b.height_m ?? 9.6) + RAISE_M };
    };

    // ------------------------------------------------------------ building colours
    const applyBuildingStates = () => {
      if (!map || !map.getSource(FALLBACK_SOURCE)) return;
      const s = useScene.getState();
      const features: GeoJSON.Feature[] = [];
      const bounds = map.getBounds();
      for (const b of s.buildings) {
        const key = stateKey(b, s);
        if (!key || !b.location) continue;
        // wait for the tiles there, so the overlay knows how tall the real building is
        if (!matches.has(b.id) && !fallbackIds.has(b.id) && bounds.contains(b.location.coordinates as LngLat)) continue;
        const { ring, height } = shapeOf(b);
        features.push({
          type: "Feature",
          properties: { id: b.id, s: key, h: height },
          geometry: { type: "Polygon", coordinates: [outsetRing(ring as Ring, OUTSET_M)] },
        });
      }
      (map.getSource(FALLBACK_SOURCE) as GeoJSONSource).setData({ type: "FeatureCollection", features });
    };

    /** After tiles in view have loaded, unmatched buildings there get our own footprint. */
    const settleFallbacks = () => {
      if (!map) return;
      const bounds = map.getBounds();
      let changed = false;
      for (const b of useScene.getState().buildings) {
        if (b.location && !matches.has(b.id) && !fallbackIds.has(b.id) && bounds.contains(b.location.coordinates as LngLat)) {
          fallbackIds.add(b.id);
          changed = true;
        }
      }
      if (changed) applyBuildingStates();
    };

    // ------------------------------------------------------------ deck.gl layers
    const roofOf = shapeOf;

    const buildLayers = (now: number): Layer[] => {
      const s = useScene.getState();
      const layers: Layer[] = [];
      const byId = new Map(s.buildings.map((b) => [b.id, b]));
      const pulse = (now % 2200) / 2200;

      // walks
      const shown: Walk[] = s.focusWalkId ? s.walks.filter((w) => w.id === s.focusWalkId || !s.replay) : s.walks;
      if (shown.length) {
        layers.push(new PathLayer<Walk>({
          id: "walk-paths",
          ...ON_TOP,
          data: shown,
          getPath: (w) => w.path.coordinates.map(([x, y]) => [x, y, 0.4] as [number, number, number]),
          getColor: (w) => (s.replay ? [23, 178, 106, w.id === s.replay.walkId ? 70 : 40] : hexToRgb(palette.green, !s.focusWalkId || w.id === s.focusWalkId ? 225 : 90)),
          getWidth: (w) => (w.id === s.focusWalkId ? 6 : 4),
          widthUnits: "pixels",
          capRounded: true,
          jointRounded: true,
          updateTriggers: { getColor: [s.focusWalkId, s.replay?.walkId], getWidth: [s.focusWalkId] },
        }));
      }
      const replayWalk = s.replay ? s.walks.find((w) => w.id === s.replay!.walkId) : undefined;
      if (replayWalk && s.replay) {
        const secs = walkSeconds(replayWalk.times);
        layers.push(new TripsLayer<Walk>({
          id: "walk-replay",
          ...ON_TOP,
          data: [replayWalk],
          getPath: (w) => w.path.coordinates.map(([x, y]) => [x, y, 0.6] as [number, number, number]),
          getTimestamps: () => secs,
          getColor: hexToRgb(palette.volt),
          currentTime: s.replay.t,
          trailLength: 600,
          fadeTrail: true,
          widthMinPixels: 7,
          capRounded: true,
          jointRounded: true,
        }));
        const here = positionAt(replayWalk.path.coordinates as LngLat[], secs, s.replay.t).point;
        layers.push(new ScatterplotLayer({
          id: "walker-glow",
          ...ON_TOP,
          data: [here],
          getPosition: (p: LngLat) => [p[0], p[1], 0.8],
          getRadius: 10 + 6 * Math.sin(pulse * Math.PI * 2),
          radiusUnits: "pixels",
          getFillColor: [198, 243, 107, 70],
        }));
        layers.push(new ScatterplotLayer({
          id: "walker-dot",
          ...ON_TOP,
          data: [here],
          getPosition: (p: LngLat) => [p[0], p[1], 1],
          getRadius: 6,
          radiusUnits: "pixels",
          getFillColor: hexToRgb(palette.ink),
          stroked: true,
          getLineColor: hexToRgb(palette.volt),
          lineWidthUnits: "pixels",
          getLineWidth: 2.5,
        }));
      }
      const captures = shown.flatMap((w) => {
        if (!s.replay || w.id !== s.replay.walkId) return s.replay ? [] : w.captures;
        const t0 = Date.parse(String(w.times[0]));
        return w.captures.filter((c) => (Date.parse(c.t) - t0) / 1000 <= s.replay!.t);
      });
      if (captures.length && !s.photoPins) {
        layers.push(new ScatterplotLayer({
          id: "capture-points",
          ...ON_TOP,
          data: captures,
          getPosition: (c: Walk["captures"][number]) => [c.lon, c.lat, 1],
          getRadius: 5,
          radiusUnits: "pixels",
          getFillColor: [255, 255, 255, 255],
          stroked: true,
          getLineColor: hexToRgb(palette.green),
          lineWidthUnits: "pixels",
          getLineWidth: 2.5,
        }));
      }

      // services
      const target = s.services ? byId.get(s.services.buildingId) : undefined;
      if (target?.location && s.services) {
        const roof = roofOf(target);
        const from: [number, number, number] = [target.location.coordinates[0], target.location.coordinates[1], roof.height];
        layers.push(new ArcLayer<NearbyPoi>({
          id: "service-arcs",
          data: s.services.pois,
          getSourcePosition: () => from,
          getTargetPosition: (p) => [p.lon, p.lat, 0],
          getSourceColor: (p) => hexToRgb(serviceColors[p.kind], 230),
          getTargetColor: (p) => hexToRgb(serviceColors[p.kind], 230),
          getWidth: 3,
          widthUnits: "pixels",
          getHeight: 0.5,
          greatCircle: false,
        }));
        layers.push(new ScatterplotLayer<NearbyPoi>({
          id: "service-ends",
          data: s.services.pois,
          getPosition: (p) => [p.lon, p.lat, 0.5],
          getRadius: 10 + 14 * pulse,
          radiusUnits: "meters",
          getFillColor: (p) => hexToRgb(serviceColors[p.kind], Math.round(90 * (1 - pulse))),
        }));
      }

      // hover and selection
      const hover = s.hoverId && s.hoverId !== s.selectedId ? byId.get(s.hoverId) : undefined;
      if (hover?.location) {
        const roof = roofOf(hover);
        layers.push(new PathLayer({
          id: "hover-roof",
          data: [roof.ring],
          getPath: (r: LngLat[]) => r.map(([x, y]) => [x, y, roof.height + 0.3] as [number, number, number]),
          getColor: hexToRgb(palette.ink, 200),
          getWidth: 2,
          widthUnits: "pixels",
        }));
      }
      const selected = s.selectedId ? byId.get(s.selectedId) : undefined;
      if (selected?.location) {
        const roof = roofOf(selected);
        const [x, y] = selected.location.coordinates;
        const tone = s.colorMode === "status" ? statusColors[selected.display_status] : palette.green;
        layers.push(
          new ScatterplotLayer({
            id: "select-pulse",
            data: [0],
            getPosition: () => [x, y, 0.3],
            getRadius: 6 + 26 * pulse,
            radiusUnits: "meters",
            stroked: true,
            filled: true,
            getFillColor: hexToRgb(tone, Math.round(60 * (1 - pulse))),
            getLineColor: hexToRgb(tone, Math.round(220 * (1 - pulse))),
            lineWidthUnits: "pixels",
            getLineWidth: 2,
          }),
          new PathLayer({
            id: "select-roof",
            data: [roof.ring],
            getPath: (r: LngLat[]) => r.map(([px, py]) => [px, py, roof.height + 0.3] as [number, number, number]),
            getColor: hexToRgb(palette.ink),
            getWidth: 3,
            widthUnits: "pixels",
          }),
          new LineLayer({
            id: "select-pole",
            data: [0],
            getSourcePosition: () => [x, y, roof.height],
            getTargetPosition: () => [x, y, roof.height + 15],
            getColor: hexToRgb(palette.ink, 210),
            getWidth: 2,
          }),
          new ScatterplotLayer({
            id: "select-head",
            data: [0],
            getPosition: () => [x, y, roof.height + 15],
            getRadius: 8,
            radiusUnits: "pixels",
            billboard: true,
            getFillColor: hexToRgb(tone),
            stroked: true,
            getLineColor: [255, 255, 255, 255],
            lineWidthUnits: "pixels",
            getLineWidth: 3,
          }),
        );
      }
      return layers;
    };

    // ------------------------------------------------------------ HTML markers
    const syncPhotoPins = () => {
      if (!map) return;
      const s = useScene.getState();
      const want = new Map<string, Walk["captures"][number]>();
      if (s.photoPins) {
        for (const w of s.walks) {
          if (s.replay && w.id !== s.replay.walkId) continue;
          const t0 = Date.parse(String(w.times[0]));
          for (const c of w.captures) {
            if (s.replay && (Date.parse(c.t) - t0) / 1000 > s.replay.t) continue;
            want.set(c.building_id, c);
          }
        }
      }
      for (const [id, marker] of photoMarkers) {
        if (!want.has(id)) {
          marker.remove();
          photoMarkers.delete(id);
        }
      }
      for (const [id, c] of want) {
        const existing = photoMarkers.get(id);
        if (existing) {
          existing.getElement().classList.toggle("is-selected", s.selectedId === id);
          continue;
        }
        const el = document.createElement("button");
        el.className = "photo-pin";
        el.style.backgroundImage = c.thumb ? `url("${c.thumb}")` : "";
        el.setAttribute("aria-label", `Capture ${id}`);
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          useScene.getState().onSelect?.(id);
        });
        photoMarkers.set(id, new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -4] }).setLngLat([c.lon, c.lat]).addTo(map));
      }
    };

    const syncPoiPins = () => {
      if (!map) return;
      const s = useScene.getState();
      const key = s.services ? `${s.services.buildingId}:${s.services.pois.length}` : "";
      if (key === poiKey) return;
      poiKey = key;
      for (const m of poiMarkers.values()) m.remove();
      poiMarkers.clear();
      s.services?.pois.forEach((p, i) => {
        const el = document.createElement("div");
        el.className = "poi-pin";
        el.style.animationDelay = `${180 + i * 90}ms`;
        el.innerHTML = `<span class="icon" style="background:${serviceColors[p.kind]}">${iconSvg(p.kind)}</span>${p.dist_m} m`;
        el.title = p.name;
        poiMarkers.set(p.id, new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -6] }).setLngLat([p.lon, p.lat]).addTo(map!));
      });
    };

    // ------------------------------------------------------------ render loop
    const render = () => {
      if (!overlay) return;
      overlay.setProps({ layers: buildLayers(performance.now()) });
    };
    const needsAnimation = () => {
      const s = useScene.getState();
      return Boolean(s.selectedId || s.replay || s.services);
    };
    const loop = () => {
      render();
      if (needsAnimation()) frame = requestAnimationFrame(loop);
      else animating = false;
    };
    const kick = () => {
      if (!animating) {
        animating = true;
        frame = requestAnimationFrame(loop);
      }
    };
    const refresh = () => {
      matchBuildings();
      applyBuildingStates();
      syncPhotoPins();
      syncPoiPins();
      render();
      if (needsAnimation()) kick();
    };

    // ------------------------------------------------------------ map
    loadBaseStyle()
      .then((style) => {
        if (disposed || !container.current) return;
        map = new maplibregl.Map({
          container: container.current,
          style,
          center: start.center,
          zoom: start.zoom,
          pitch: start.pitch,
          bearing: start.bearing,
          maxPitch: 78,
          attributionControl: false,
          canvasContextAttributes: { antialias: true },
        });
        map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
        map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showZoom: true }), "bottom-right");
        overlay = new MapboxOverlay({ interleaved: true, layers: [] });
        map.addControl(overlay as unknown as maplibregl.IControl);

        map.on("load", () => {
          if (!map) return;
          map.addSource(FALLBACK_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          map.addLayer(fallbackLayer());
          loaded = true;
          registerMap(map);
          refresh();
        });
        const markZoom = () => container.current?.classList.toggle("map-far", (map?.getZoom() ?? 18) < 16.2);
        map.on("zoom", markZoom);
        markZoom();
        map.on("idle", () => {
          if (matchBuildings()) applyBuildingStates();
          settleFallbacks();
        });

        const pick = (point: maplibregl.PointLike): string | null => {
          if (!map) return null;
          const hits: MapGeoJSONFeature[] = map.queryRenderedFeatures(point, { layers: [FALLBACK_LAYER] });
          return hits.length ? String(hits[0].properties?.id) : null;
        };
        map.on("click", (e) => {
          const id = pick(e.point);
          if (id) useScene.getState().onSelect?.(id);
        });
        map.on("mousemove", (e) => {
          const id = pick(e.point);
          map!.getCanvas().style.cursor = id ? "pointer" : "";
          if (useScene.getState().hoverId !== id) useScene.getState().set({ hoverId: id });
        });
      })
      .catch((error: Error) => !disposed && setFailed(error.message));

    // not map.isStyleLoaded(): that is false whenever tiles are still loading, e.g. mid-flight
    const unsubscribe = useScene.subscribe(() => {
      if (loaded) refresh();
    });

    return () => {
      disposed = true;
      unsubscribe();
      cancelAnimationFrame(frame);
      registerMap(null);
      for (const m of photoMarkers.values()) m.remove();
      for (const m of poiMarkers.values()) m.remove();
      map?.remove();
    };
  }, []);

  return (
    <div className="map-root">
      {/* inline: maplibre-gl.css is unlayered and would override Tailwind's layered utilities */}
      <div ref={container} style={{ position: "absolute", inset: 0 }} aria-label="3D map of the surveyed streets" role="region" />
      {failed ? (
        <div className="absolute inset-0 grid place-items-center">
          <p className="glass rounded-card px-4 py-3 text-sm text-muted">The base map could not load ({failed}). Survey data still works.</p>
        </div>
      ) : null}
    </div>
  );
}
