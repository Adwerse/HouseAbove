import type { Walk } from '../lib/types'

export type LonLat = [number, number]

export interface ReplayWalk {
  id: string
  path: LonLat[]
  /** Seconds since the walk started, one per path point. */
  timestamps: number[]
  /** Metres walked up to each path point. */
  cumulative: number[]
  captures: { building_id: string; position: LonLat; t: number }[]
  duration: number
  bounds: [LonLat, LonLat]
}

function haversine([lon1, lat1]: LonLat, [lon2, lat2]: LonLat) {
  const r = Math.PI / 180
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a))
}

/** The walk to replay: the longest one, so tiny test walks are skipped. */
export function pickWalk(walks: Walk[]) {
  return walks.reduce<Walk | undefined>((best, w) => (!best || (w.distance_m ?? 0) > (best.distance_m ?? 0) ? w : best), undefined)
}

/** walks.times are seconds since start from import_walk.py; mocks use ISO strings. Both work. */
export function prepareWalk(walk: Walk): ReplayWalk | null {
  const start = Date.parse(walk.started_at)
  const toSeconds = (t: number | string) => (typeof t === 'number' ? t : (Date.parse(t) - start) / 1000)
  const captures = (walk.captures ?? [])
    .filter((c) => Number.isFinite(c.lon) && Number.isFinite(c.lat))
    .map((c) => ({ building_id: c.building_id, position: [c.lon, c.lat] as LonLat, t: Math.max(0, toSeconds(c.t)) }))
    .sort((a, b) => a.t - b.t)

  let path = (walk.path?.coordinates ?? []).map(([lon, lat]) => [lon, lat] as LonLat)
  let timestamps = ((walk.times ?? []) as Array<number | string>).map(toSeconds)
  if (path.length < 2 || timestamps.length !== path.length) {
    path = captures.map((c) => c.position)
    timestamps = captures.map((c) => c.t)
  }
  if (path.length < 2) return null

  const cumulative = [0]
  for (let i = 1; i < path.length; i++) cumulative.push(cumulative[i - 1] + haversine(path[i - 1], path[i]))
  const all = [...path, ...captures.map((c) => c.position)]
  const lons = all.map((p) => p[0])
  const lats = all.map((p) => p[1])
  return {
    id: walk.id ?? (walk as unknown as { _id: string })._id,
    path,
    timestamps,
    cumulative,
    captures,
    duration: Math.max(timestamps[timestamps.length - 1], captures.at(-1)?.t ?? 0, 1),
    bounds: [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
  }
}

/** Position and metres walked at time t (linear between path points). */
export function sampleAt(walk: ReplayWalk, t: number): { position: LonLat; metres: number } {
  const { path, timestamps, cumulative } = walk
  if (t <= timestamps[0]) return { position: path[0], metres: 0 }
  for (let i = 1; i < path.length; i++) {
    if (t <= timestamps[i]) {
      const span = timestamps[i] - timestamps[i - 1] || 1
      const f = (t - timestamps[i - 1]) / span
      const [a, b] = [path[i - 1], path[i]]
      return {
        position: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f],
        metres: cumulative[i - 1] + (cumulative[i] - cumulative[i - 1]) * f,
      }
    }
  }
  return { position: path[path.length - 1], metres: cumulative[cumulative.length - 1] }
}
