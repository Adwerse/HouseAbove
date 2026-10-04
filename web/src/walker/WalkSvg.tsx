import { useEffect, useMemo, useRef } from 'react'
import type { DrawFn } from './WalkMap'
import { sampleAt, type LonLat, type ReplayWalk } from './replay'

const W = 390
const H = 560
const PAD = 40

/** Fallback when the map cannot load: the path as an SVG polyline on a dark background. */
export function WalkSvg({ walk, register }: { walk: ReplayWalk; register: (draw: DrawFn) => void }) {
  const doneRef = useRef<SVGPolylineElement>(null)
  const headRef = useRef<SVGCircleElement>(null)
  const pinRefs = useRef<(SVGCircleElement | null)[]>([])

  const project = useMemo(() => {
    const [[minLon, minLat], [maxLon, maxLat]] = walk.bounds
    const kx = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180))
    const scale = Math.min((W - 2 * PAD) / ((maxLon - minLon) * kx || 1e-9), (H - 2 * PAD) / ((maxLat - minLat) || 1e-9))
    return ([lon, lat]: LonLat): [number, number] => [PAD + (lon - minLon) * kx * scale, H - PAD - (lat - minLat) * scale]
  }, [walk])

  const full = walk.path.map((p) => project(p).join(',')).join(' ')

  useEffect(() => {
    register((t) => {
      const points = walk.path.filter((_, i) => walk.timestamps[i] <= t).map(project)
      const head = project(sampleAt(walk, t).position)
      doneRef.current?.setAttribute('points', [...points, head].map((p) => p.join(',')).join(' '))
      headRef.current?.setAttribute('cx', String(head[0]))
      headRef.current?.setAttribute('cy', String(head[1]))
      walk.captures.forEach((c, i) => pinRefs.current[i]?.setAttribute('opacity', c.t <= t ? '1' : '0'))
    })
  }, [project, register, walk])

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMin meet" aria-label="Walk path">
      <rect width={W} height={H} fill="#0A0F1E" />
      <polyline points={full} fill="none" stroke="#FFD166" strokeOpacity={0.15} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      <polyline ref={doneRef} fill="none" stroke="#FFD166" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      {walk.captures.map((c, i) => {
        const [x, y] = project(c.position)
        return <circle key={c.building_id} ref={(el) => { pinRefs.current[i] = el }} cx={x} cy={y} r={6} fill="#FFD16628" stroke="#FFD166" strokeWidth={2} opacity={0} />
      })}
      <circle ref={headRef} r={7} fill="#FFF4D6" stroke="#FFD166" strokeWidth={2} style={{ filter: 'drop-shadow(0 0 8px #FFD166)' }} />
    </svg>
  )
}
