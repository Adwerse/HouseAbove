import { useQuery } from '@tanstack/react-query'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import { mockWalks } from '../mocks'
import { Card } from '../ui'
import { WalkMap, webglAvailable, type DrawFn } from './WalkMap'
import { WalkSvg } from './WalkSvg'
import { pickWalk, prepareWalk, sampleAt } from './replay'

const SPEEDS = [1, 8, 32] as const

/** Replay of the walker's longest walk: trail, capture pins, ticking counters. */
export function WalkReplay({ walkerId }: { walkerId: string }) {
  const walks = useQuery({ queryKey: ['walker-walks', walkerId], queryFn: () => api.getWalkerWalks(walkerId) })
  const sample = walks.isError
  const walk = useMemo(() => {
    const chosen = pickWalk(walks.data ?? (sample ? mockWalks : []))
    return chosen ? prepareWalk(chosen) : null
  }, [walks.data, sample])

  const [useSvg, setUseSvg] = useState(() => !webglAvailable())
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(32)

  const timeRef = useRef(0)
  const drawRef = useRef<DrawFn | null>(null)
  const kmRef = useRef<HTMLSpanElement>(null)
  const minRef = useRef<HTMLSpanElement>(null)
  const facadesRef = useRef<HTMLSpanElement>(null)

  /** Draws the view and writes the counters straight into the DOM: no React state per frame. */
  const render = useCallback((t: number) => {
    if (!walk) return
    drawRef.current?.(t)
    if (kmRef.current) kmRef.current.textContent = (sampleAt(walk, t).metres / 1000).toFixed(2)
    if (minRef.current) minRef.current.textContent = String(Math.floor(t / 60))
    if (facadesRef.current) facadesRef.current.textContent = String(walk.captures.filter((c) => c.t <= t).length)
  }, [walk])

  const register = useCallback((draw: DrawFn) => {
    drawRef.current = draw
    render(timeRef.current)
  }, [render])

  useEffect(() => {
    timeRef.current = 0
    render(0)
  }, [render])

  useEffect(() => {
    if (!playing || !walk) return
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const t = Math.min(walk.duration, timeRef.current + ((now - last) / 1000) * speed)
      last = now
      timeRef.current = t
      render(t)
      if (t >= walk.duration) setPlaying(false)
      else frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, walk, render])

  const togglePlay = () => {
    if (!walk) return
    if (!playing && timeRef.current >= walk.duration) timeRef.current = 0
    setPlaying((p) => !p)
  }

  if (walks.isPending) return <p className="p-6 text-dusk-sm text-dusk-muted">Loading your walk…</p>
  if (!walk) return <p className="p-6 text-dusk-sm text-dusk-muted">No walk yet. Your first capture starts one.</p>

  return (
    <div className="relative h-full overflow-hidden">
      {useSvg ? <WalkSvg walk={walk} register={register} /> : <WalkMap walk={walk} register={register} onFail={() => setUseSvg(true)} />}

      <Card className="absolute inset-x-3 bottom-3 z-10" padding="md" variant="elevated">
        {sample ? <p className="mb-2 text-dusk-xs text-dusk-warm">Showing a sample walk: could not load yours.</p> : null}
        <div className="grid grid-cols-3 gap-3" style={{ fontFeatureSettings: '"tnum" 1, "lnum" 1' }}>
          <div><span ref={kmRef} className="block text-dusk-lg font-semibold">0.00</span><span className="text-dusk-xs text-dusk-muted">km</span></div>
          <div><span ref={minRef} className="block text-dusk-lg font-semibold">0</span><span className="text-dusk-xs text-dusk-muted">minutes</span></div>
          <div><span ref={facadesRef} className="block text-dusk-lg font-semibold">0</span><span className="text-dusk-xs text-dusk-muted">facades</span></div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}
            className="grid h-10 w-10 place-items-center rounded-full bg-dusk-warm text-dusk-background">
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button type="button" onClick={() => { timeRef.current = 0; render(0); setPlaying(true) }} aria-label="Restart"
            className="grid h-10 w-10 place-items-center rounded-full border border-white/10 text-dusk-muted">
            <RotateCcw size={16} />
          </button>
          <div className="ml-auto flex rounded-full border border-white/10 p-0.5">
            {SPEEDS.map((s) => (
              <button key={s} type="button" onClick={() => setSpeed(s)} aria-pressed={speed === s}
                className={`min-w-11 rounded-full px-2 py-1.5 text-dusk-xs font-semibold ${speed === s ? 'bg-dusk-elevated text-dusk-text' : 'text-dusk-muted'}`}>
                {s}x
              </button>
            ))}
          </div>
        </div>
      </Card>
    </div>
  )
}
