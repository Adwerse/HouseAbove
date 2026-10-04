/** Small geometry helpers in lon/lat. Distances use a local metre grid, exact enough at street scale. */

export type LngLat = [number, number];
export type Ring = LngLat[];

const M_PER_DEG = 111_320;

export function metresPerDegree(lat: number) {
  return { x: M_PER_DEG * Math.cos((lat * Math.PI) / 180), y: M_PER_DEG };
}

export function distanceM(a: LngLat, b: LngLat) {
  const k = metresPerDegree((a[1] + b[1]) / 2);
  return Math.hypot((a[0] - b[0]) * k.x, (a[1] - b[1]) * k.y);
}

export function pointInRing([x, y]: LngLat, ring: Ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** GeoJSON Polygon coordinates: inside the outer ring and outside every hole. */
export function pointInPolygon(point: LngLat, rings: Ring[]) {
  if (!rings.length || !pointInRing(point, rings[0])) return false;
  return !rings.slice(1).some((hole) => pointInRing(point, hole));
}

export function ringAreaM2(ring: Ring) {
  if (ring.length < 3) return 0;
  const k = metresPerDegree(ring[0][1]);
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] * k.x) * (ring[i][1] * k.y) - (ring[i][0] * k.x) * (ring[j][1] * k.y);
  }
  return Math.abs(sum) / 2;
}

export function ringBounds(ring: Ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** A square footprint around a point, for buildings no footprint could be found for. */
export function squareAround([lon, lat]: LngLat, halfM = 5): Ring {
  const k = metresPerDegree(lat);
  const dx = halfM / k.x;
  const dy = halfM / k.y;
  return [[lon - dx, lat - dy], [lon + dx, lat - dy], [lon + dx, lat + dy], [lon - dx, lat + dy], [lon - dx, lat - dy]];
}

/** Compass bearing from a to b, in degrees. */
export function bearing(a: LngLat, b: LngLat) {
  const k = metresPerDegree(a[1]);
  return ((Math.atan2((b[0] - a[0]) * k.x, (b[1] - a[1]) * k.y) * 180) / Math.PI + 360) % 360;
}

export function centroid(points: LngLat[]): LngLat {
  const n = points.length || 1;
  return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
}

/** Seconds since the walk started for each path vertex, whatever format the times come in. */
export function walkSeconds(times: Array<string | number>): number[] {
  if (!times.length) return [];
  if (typeof times[0] === "number") return times as number[];
  const t0 = Date.parse(times[0] as string);
  return (times as string[]).map((t) => (Date.parse(t) - t0) / 1000);
}

/** Position along a timed path at time t (seconds), and the heading there. */
export function positionAt(path: LngLat[], seconds: number[], t: number): { point: LngLat; heading: number } {
  if (path.length < 2) return { point: path[0] ?? [0, 0], heading: 0 };
  let i = seconds.findIndex((s) => s > t);
  if (i <= 0) i = i === 0 ? 1 : path.length - 1;
  const a = path[i - 1];
  const b = path[i];
  const span = seconds[i] - seconds[i - 1] || 1;
  const f = Math.max(0, Math.min(1, (t - seconds[i - 1]) / span));
  return { point: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], heading: bearing(a, b) };
}

/** Grow a ring outwards by `metres` (mitred corners), so an overlay hides the building under it. */
export function outsetRing(ring: Ring, metres: number): Ring {
  const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring.slice();
  if (pts.length < 3) return ring;
  const k = metresPerDegree(pts[0][1]);
  const xy = pts.map(([x, y]) => [x * k.x, y * k.y]);
  let signed = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i];
    const [x2, y2] = xy[(i + 1) % xy.length];
    signed += x1 * y2 - x2 * y1;
  }
  const outward = signed > 0 ? 1 : -1; // counter-clockwise rings: outward normal is to the right
  const out: Ring = xy.map(([x, y], i) => {
    const [px, py] = xy[(i - 1 + xy.length) % xy.length];
    const [nx, ny] = xy[(i + 1) % xy.length];
    const n1 = normal(px, py, x, y, outward);
    const n2 = normal(x, y, nx, ny, outward);
    let bx = n1[0] + n2[0];
    let by = n1[1] + n2[1];
    const len = Math.hypot(bx, by) || 1;
    bx /= len;
    by /= len;
    const cos = Math.max(0.35, bx * n1[0] + by * n1[1]); // limit spikes at sharp corners
    return [(x + (bx * metres) / cos) / k.x, (y + (by * metres) / cos) / k.y];
  });
  out.push(out[0]);
  return out;
}

function normal(x1: number, y1: number, x2: number, y2: number, outward: number): [number, number] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  return [(dy / len) * outward, (-dx / len) * outward];
}
