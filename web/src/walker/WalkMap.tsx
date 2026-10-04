import { MapboxOverlay } from '@deck.gl/mapbox'
import { TripsLayer } from '@deck.gl/geo-layers'
import { ScatterplotLayer } from '@deck.gl/layers'
import type { Layer } from '@deck.gl/core'
import * as maplibregl from 'maplibre-gl'
import { useEffect, useMemo, useRef } from 'react'
import Map, { AttributionControl, useControl } from 'react-map-gl/maplibre'
import { sampleAt, type LonLat, type ReplayWalk } from './replay'

const DARK_MATTER_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
const GOLD: [number, number, number] = [255, 209, 102]
const TRAIL_SECONDS = 120

export type DrawFn = (t: number) => void

/** Deck layers for time t. Captures are a neutral gold outline only: no status colours. */
function layersAt(walk: ReplayWalk, t: number): Layer[] {
  const head = sampleAt(walk, t).position
  const shown = walk.captures.filter((c) => c.t <= t)
  return [
    new TripsLayer<{ path: LonLat[]; timestamps: number[] }>({
      id: 'walk-trail',
      data: [{ path: walk.path, timestamps: walk.timestamps }],
      getPath: (d) => d.path,
      getTimestamps: (d) => d.timestamps,
      getColor: GOLD,
      widthMinPixels: 5,
      capRounded: true,
      jointRounded: true,
      fadeTrail: true,
      trailLength: TRAIL_SECONDS,
      currentTime: t,
    }),
    new ScatterplotLayer<{ position: LonLat }>({
      id: 'walk-captures',
      data: shown,
      getPosition: (d) => d.position,
      radiusUnits: 'pixels',
      getRadius: 7,
      filled: true,
      stroked: true,
      getFillColor: [...GOLD, 40],
      getLineColor: [...GOLD, 230],
      lineWidthUnits: 'pixels',
      getLineWidth: 2,
    }),
    new ScatterplotLayer<LonLat>({
      id: 'walk-head-glow',
      data: [head],
      getPosition: (d) => d,
      radiusUnits: 'pixels',
      getRadius: 16,
      getFillColor: [...GOLD, 70],
    }),
    new ScatterplotLayer<LonLat>({
      id: 'walk-head',
      data: [head],
      getPosition: (d) => d,
      radiusUnits: 'pixels',
      getRadius: 6,
      getFillColor: [255, 244, 214],
      stroked: true,
      getLineColor: GOLD,
      lineWidthUnits: 'pixels',
      getLineWidth: 2,
    }),
  ]
}

function DeckOverlay({ walk, register }: { walk: ReplayWalk; register: (draw: DrawFn) => void }) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay({ interleaved: false, layers: [] }))
  useEffect(() => {
    register((t) => overlay.setProps({ layers: layersAt(walk, t) }))
  }, [overlay, register, walk])
  return null
}

/** The walk on a dark basemap. onFail lets the caller switch to the SVG fallback. */
export function WalkMap({ walk, register, onFail }: { walk: ReplayWalk; register: (draw: DrawFn) => void; onFail: () => void }) {
  const failed = useRef(false)
  const initialViewState = useMemo(() => ({
    bounds: walk.bounds,
    fitBoundsOptions: { padding: { top: 48, bottom: 230, left: 36, right: 36 } },
  }), [walk])

  const fail = () => {
    if (!failed.current) {
      failed.current = true
      onFail()
    }
  }

  return (
    <Map
      mapLib={maplibregl}
      mapStyle={DARK_MATTER_STYLE}
      initialViewState={initialViewState}
      attributionControl={false}
      dragRotate={false}
      style={{ position: 'absolute', inset: 0 }}
      onError={(e) => {
        // A missing tile is fine; a broken style or WebGL context is not.
        const message = e.error?.message?.toLowerCase() ?? ''
        if (/(style|webgl|context)/.test(message)) fail()
      }}
    >
      <AttributionControl compact position="top-right" />
      <DeckOverlay walk={walk} register={register} />
    </Map>
  )
}

export function webglAvailable() {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'))
  } catch {
    return false
  }
}
