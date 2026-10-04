import { fitPoints, type Camera } from "../map/controller";
import { centroid, type LngLat } from "../map/geometry";
import type { Building } from "../lib/types";
import { demoCameras } from "../mocks";

export function streetsOf(buildings: Building[]) {
  const counts = new Map<string, number>();
  for (const b of buildings) if (b.street) counts.set(b.street, (counts.get(b.street) ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

export function byRank(a: Building, b: Building) {
  return (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.id.localeCompare(b.id);
}

/** A good camera for a street: the demo's hand-tuned one, else framed on its buildings. */
export function streetCamera(street: string, buildings: Building[]): Camera {
  const known = demoCameras[street];
  if (known) return known;
  const points = buildings.filter((b) => b.street === street && b.location).map((b) => b.location!.coordinates as LngLat);
  const center = points.length ? centroid(points) : ([-6.2553, 53.3506] as LngLat);
  return { center, zoom: 17.1, pitch: 60, bearing: 18 };
}

/** Fly to frame a street's surveyed buildings, looking at them from the street's best side. */
export function frameStreet(street: string, buildings: Building[], options: { pitch?: number; duration?: number } = {}) {
  const points = buildings.filter((b) => b.street === street && b.location).map((b) => b.location!.coordinates as LngLat);
  const camera = streetCamera(street, buildings);
  if (points.length < 2) return false;
  fitPoints(points, { pitch: options.pitch ?? 60, bearing: camera.bearing, duration: options.duration ?? 2200, maxZoom: 17.8 });
  return true;
}
