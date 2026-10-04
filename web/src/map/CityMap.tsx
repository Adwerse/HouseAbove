import { useEffect, useRef, type ReactNode } from 'react'
import { Map as MapLibreMap, NavigationControl } from 'maplibre-gl'

export type CityMapMode = 'officer' | 'walker'

export type CityMapViewState = {
  longitude?: number
  latitude?: number
  zoom?: number
  bearing?: number
  pitch?: number
}

export type CityMapProps = {
  mode: CityMapMode
  /** DOM overlay for map controls, markers, or a DeckGL overlay supplied by a caller. */
  extraLayers?: ReactNode
  initialViewState?: CityMapViewState
  /** Called when a rendered feature exposes an `id`, `_id`, or `building_id` property. */
  onSelect?: (id: string) => void
  children?: ReactNode
}

const DUBLIN_VIEW: Required<CityMapViewState> = {
  longitude: -6.2546,
  latitude: 53.3498,
  zoom: 15.25,
  bearing: 0,
  pitch: 0,
}

const DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

/**
 * A deliberately small MapLibre foundation. A2 adds data-driven building and
 * DeckGL layers without changing the public map API used by either console.
 */
export default function CityMap({
  mode,
  extraLayers,
  initialViewState,
  onSelect,
  children,
}: CityMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const onSelectRef = useRef(onSelect)
  const initialViewRef = useRef(initialViewState)

  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  useEffect(() => {
    const container = containerRef.current
    if (!container || mapRef.current) return

    const requestedView = initialViewRef.current
    const view: Required<CityMapViewState> = {
      longitude: requestedView?.longitude ?? DUBLIN_VIEW.longitude,
      latitude: requestedView?.latitude ?? DUBLIN_VIEW.latitude,
      zoom: requestedView?.zoom ?? DUBLIN_VIEW.zoom,
      bearing: requestedView?.bearing ?? DUBLIN_VIEW.bearing,
      pitch: requestedView?.pitch ?? DUBLIN_VIEW.pitch,
    }
    const map = new MapLibreMap({
      container,
      style: DARK_STYLE,
      center: [view.longitude, view.latitude],
      zoom: view.zoom,
      bearing: view.bearing,
      pitch: view.pitch,
      attributionControl: false,
    })

    map.addControl(new NavigationControl({ showCompass: true }), 'bottom-right')
    map.on('click', (event) => {
      const selected = map
        .queryRenderedFeatures(event.point)
        .find((feature) => feature.properties?.id ?? feature.properties?._id ?? feature.properties?.building_id ?? feature.id)
      const id = selected?.properties?.id ?? selected?.properties?._id ?? selected?.properties?.building_id ?? selected?.id

      if (typeof id === 'string' || typeof id === 'number') {
        onSelectRef.current?.(String(id))
      }
    })

    const observer = new ResizeObserver(() => map.resize())
    observer.observe(container)
    mapRef.current = map

    return () => {
      observer.disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [])

  return (
    <section aria-label={`${mode === 'officer' ? 'Officer' : 'Walker'} map`} className="city-map" data-map-mode={mode}>
      <div className="city-map__canvas" ref={containerRef} />
      {(extraLayers || children) && <div className="city-map__overlay">{extraLayers}{children}</div>}
    </section>
  )
}
