import type { Map as MapLibreMap, PaddingOptions } from "maplibre-gl";

import type { Building } from "../lib/types";

/**
 * Imperative camera control for the one shared map. Views call these; the map
 * instance registers itself on load. Calls made before load are replayed once.
 */
export type Camera = { center: [number, number]; zoom: number; pitch: number; bearing: number };

let map: MapLibreMap | null = null;
let pending: (() => void) | null = null;
let orbitFrame = 0;
let padding: PaddingOptions = { top: 0, right: 0, bottom: 0, left: 0 };

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function registerMap(instance: MapLibreMap | null) {
  map = instance;
  if (import.meta.env.DEV) (window as unknown as { __homesAboveMap?: MapLibreMap | null }).__homesAboveMap = instance;
  if (map && pending) {
    const run = pending;
    pending = null;
    run();
  }
}

export function getMap() {
  return map;
}

function withMap(run: (m: MapLibreMap) => void) {
  if (map) run(map);
  else pending = () => map && run(map);
}

/** Space taken by panels over the map, so the camera centres things in what is visible. */
export function setPadding(p: Partial<PaddingOptions>, animate = true) {
  padding = { ...padding, ...p };
  withMap((m) => {
    if (animate) m.easeTo({ padding, duration: 700, easing: ease });
    else m.setPadding(padding);
  });
}

export function flyTo(camera: Partial<Camera>, duration = 2200) {
  stopOrbit();
  withMap((m) => {
    if (reducedMotion()) {
      m.jumpTo({ ...camera, padding });
      return;
    }
    m.flyTo({ ...camera, padding, duration, curve: 1.25, speed: 0.9, essential: true, easing: ease });
  });
}

export function easeTo(camera: Partial<Camera>, duration = 1200) {
  withMap((m) => m.easeTo({ ...camera, padding, duration, easing: ease, essential: true }));
}

export function flyToBuilding(building: Building, options: Partial<Camera> & { duration?: number } = {}) {
  if (!building.location) return;
  const { duration = 1700, ...camera } = options;
  flyTo(
    {
      center: building.location.coordinates,
      zoom: camera.zoom ?? 18.25,
      pitch: camera.pitch ?? 64,
      bearing: camera.bearing ?? map?.getBearing(),
    },
    duration,
  );
}

/** A slow turn around the current centre, for idle and intro shots. */
export function startOrbit(degreesPerSecond = 2.4) {
  stopOrbit();
  if (reducedMotion()) return;
  let last = performance.now();
  const step = (now: number) => {
    if (!map) return;
    const dt = (now - last) / 1000;
    last = now;
    map.setBearing(map.getBearing() + degreesPerSecond * dt);
    orbitFrame = requestAnimationFrame(step);
  };
  withMap(() => {
    orbitFrame = requestAnimationFrame(step);
  });
}

export function stopOrbit() {
  if (orbitFrame) cancelAnimationFrame(orbitFrame);
  orbitFrame = 0;
}

/** Follow a moving point (walk replay) smoothly. */
export function follow(center: [number, number], bearing: number, zoom = 17.9) {
  withMap((m) => {
    m.easeTo({ center, bearing, zoom, pitch: 54, padding, duration: 900, easing: (t) => t, essential: true });
  });
}

/** Frame a set of points (e.g. a walk) at a pitched, readable angle. */
export function fitPoints(points: [number, number][], options: { pitch?: number; bearing?: number; duration?: number; maxZoom?: number } = {}) {
  if (!points.length) return;
  stopOrbit();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  withMap((m) => {
    const camera = m.cameraForBounds([[minX, minY], [maxX, maxY]], { padding: { top: (padding.top ?? 0) + 60, bottom: (padding.bottom ?? 0) + 60, left: (padding.left ?? 0) + 60, right: (padding.right ?? 0) + 60 }, bearing: options.bearing ?? m.getBearing() });
    if (!camera) return;
    m.flyTo({ ...camera, zoom: Math.min(options.maxZoom ?? 17.4, (camera.zoom ?? 16) + 0.15), pitch: options.pitch ?? 58, bearing: options.bearing ?? m.getBearing(), duration: options.duration ?? 2000, curve: 1.2, essential: true, easing: ease });
  });
}
