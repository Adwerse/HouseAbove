import {
  AmbientLight,
  DirectionalLight,
  LightingEffect,
  type Color,
  type Layer,
  type Material,
  type PickingInfo,
} from "@deck.gl/core"
import { MapboxOverlay } from "@deck.gl/mapbox"
import {
  ArcLayer,
  ColumnLayer,
  IconLayer,
  PolygonLayer,
  ScatterplotLayer,
  TextLayer,
} from "@deck.gl/layers"
import * as maplibregl from "maplibre-gl"
import type { StyleSpecification } from "maplibre-gl"
import Map, {
  AttributionControl,
  NavigationControl,
  useControl,
  type MapRef,
} from "react-map-gl/maplibre"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import type {
  Building,
  ContextBuildingsGeoJson,
  DisplayStatus,
  NearbyPoi,
  PointGeometry,
  PolygonGeometry,
  ServiceKind,
} from "../lib/types"
import {
  mockBuildings,
  mockContextBuildings,
  mockNearbyPoisByBuilding,
} from "../mocks"
import MapLegend, {
  type RegisterLayer,
  type RegisterLayerVisibility,
} from "./MapLegend"
import { cityMapCamera } from "./camera-store"

export type CityMapMode = "officer" | "walker"

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
  /** Called when a surveyed building is selected from a rendered layer. */
  onSelect?: (id: string) => void
  /** Optional live survey data. The deterministic Talbot Street data remains the fallback. */
  buildings?: Building[]
  /** Optional live OSM massing around the surveyed street. */
  contextBuildings?: ContextBuildingsGeoJson
  /** A lightweight external hover outline, used by the officer candidate rail. */
  highlightId?: string | null
  children?: ReactNode
}

type DeckPosition = [longitude: number, latitude: number, elevation: number]
type DeckPolygon = DeckPosition[][]
type MappableBuilding = Building & { location: PointGeometry }
type FootprintBuilding = MappableBuilding & { footprint: PolygonGeometry }
type ServiceLink = {
  poi: NearbyPoi
  source: DeckPosition
  target: DeckPosition
}

const TALBOT_VIEW: Required<CityMapViewState> = {
  longitude: -6.2512,
  latitude: 53.3519,
  zoom: 17.2,
  bearing: -18,
  pitch: 58,
}

const DARK_MATTER_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
const DUSK_FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "dusk-background",
      type: "background",
      paint: { "background-color": "#0A0F1E" },
    },
  ],
}
const GROUND_HEIGHT_M = 3.4
const DEFAULT_HEIGHT_M = 9.6
const BUILDING_MATERIAL: Material = { ambient: 0.35, diffuse: 0.6, shininess: 40 }
const CONTEXT_COLOR: Color = [26, 34, 64]
const GROUND_COLOR: Color = [42, 51, 84]
const OUTLINE_COLOR: Color = [255, 255, 255, 235]
const VIOLET: Color = [139, 92, 246]
const PROTECTED: Color = [124, 156, 255]
const PULSE_TRANSITION = { getFillColor: { duration: 1150 } }

const STATUS_RGB: Record<DisplayStatus, Color> = {
  likely_underused: [255, 90, 78],
  review: [255, 176, 32],
  unclear: [148, 163, 184],
  likely_used: [71, 85, 105],
  confirmed: [139, 92, 246],
  home: [255, 209, 102],
}

const SERVICE_COLORS: Record<ServiceKind, Color> = {
  bus: [124, 156, 255],
  grocery: [111, 207, 168],
  school: [177, 149, 255],
  gp_or_pharmacy: [255, 147, 153],
  park: [157, 209, 121],
}

const SERVICE_ICON_MAPPING = {
  bus: { x: 0, y: 0, width: 64, height: 64, anchorY: 32 },
  grocery: { x: 64, y: 0, width: 64, height: 64, anchorY: 32 },
  school: { x: 128, y: 0, width: 64, height: 64, anchorY: 32 },
  gp_or_pharmacy: { x: 192, y: 0, width: 64, height: 64, anchorY: 32 },
  park: { x: 256, y: 0, width: 64, height: 64, anchorY: 32 },
} as const

/* A tiny self-contained white SVG atlas: IconLayer tints each service kind. */
const SERVICE_ICON_ATLAS = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="320" height="64" viewBox="0 0 320 64">
    <g fill="white">
      <g transform="translate(0 0)"><rect x="12" y="16" width="40" height="32" rx="6"/><rect x="18" y="22" width="12" height="9" fill="#0A0F1E"/><rect x="34" y="22" width="12" height="9" fill="#0A0F1E"/><circle cx="23" cy="49" r="5" fill="#0A0F1E"/><circle cx="41" cy="49" r="5" fill="#0A0F1E"/></g>
      <g transform="translate(64 0)"><path d="M13 25h38l-4 25H17z"/><path d="M23 25c0-10 18-10 18 0" fill="none" stroke="white" stroke-width="6"/></g>
      <g transform="translate(128 0)"><path d="M10 28 32 11l22 17v24H10z"/><path d="M20 35h24v17H20z" fill="#0A0F1E"/></g>
      <g transform="translate(192 0)"><circle cx="32" cy="32" r="23"/><path d="M27 17h10v10h10v10H37v10H27V37H17V27h10z" fill="#0A0F1E"/></g>
      <g transform="translate(256 0)"><rect x="28" y="35" width="8" height="18"/><circle cx="32" cy="19" r="14"/><circle cx="18" cy="31" r="11"/><circle cx="46" cy="31" r="11"/></g>
    </g>
  </svg>`)}`

const LIGHTING_EFFECTS = [
  new LightingEffect({
    ambient: new AmbientLight({ color: [197, 211, 255], intensity: 0.55 }),
    west: new DirectionalLight({ color: [255, 209, 128], intensity: 1.45, direction: [-1, -2, -1] }),
  }),
]

const isMappableBuilding = (building: Building): building is MappableBuilding => Boolean(building.location)
const hasFootprint = (building: MappableBuilding): building is FootprintBuilding => Boolean(building.footprint)

function buildingHeight(building: Building) {
  return Math.max(building.height_m ?? DEFAULT_HEIGHT_M, GROUND_HEIGHT_M)
}

function upperHeight(building: Building) {
  return Math.max(buildingHeight(building) - GROUND_HEIGHT_M, 0.15)
}

function footprintAt(footprint: PolygonGeometry, elevation: number): DeckPolygon {
  return footprint.coordinates.map((ring) => ring.map(([lon, lat]) => [lon, lat, elevation]))
}

function squareAt(location: PointGeometry, elevation: number, radiusM = 4.5): DeckPolygon {
  const [longitude, latitude] = location.coordinates
  const latitudeDelta = radiusM / 111_320
  const longitudeDelta = radiusM / (111_320 * Math.cos((latitude * Math.PI) / 180))

  return [[
    [longitude - longitudeDelta, latitude - latitudeDelta, elevation],
    [longitude + longitudeDelta, latitude - latitudeDelta, elevation],
    [longitude + longitudeDelta, latitude + latitudeDelta, elevation],
    [longitude - longitudeDelta, latitude + latitudeDelta, elevation],
    [longitude - longitudeDelta, latitude - latitudeDelta, elevation],
  ]]
}

function outlinePolygon(building: MappableBuilding): DeckPolygon {
  const elevation = buildingHeight(building) + 0.14
  return building.footprint
    ? footprintAt(building.footprint, elevation)
    : squareAt(building.location, elevation, 5.1)
}

function buildingPosition(building: MappableBuilding, elevation = 0): DeckPosition {
  const [longitude, latitude] = building.location.coordinates
  return [longitude, latitude, elevation]
}

function hidePoiLabels(map: ReturnType<NonNullable<MapRef>["getMap"]>) {
  for (const layer of map.getStyle().layers ?? []) {
    const layerId = layer.id.toLowerCase()
    const sourceLayer = "source-layer" in layer ? layer["source-layer"]?.toLowerCase() : ""
    if (
      layer.type === "symbol" &&
      /(poi|amenity|airport|station|transit|housenumber)/.test(`${layerId} ${sourceLayer ?? ""}`)
    ) {
      map.setLayoutProperty(layer.id, "visibility", "none")
    }
  }
}

/**
 * The only deck.gl bridge. `useControl` lets MapLibre own the shared WebGL2
 * context while MapboxOverlay renders deck.gl layers interleaved with the map.
 */
function DeckMapOverlay({ layers }: { layers: Layer[] }) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay({
    interleaved: true,
    layers,
    effects: LIGHTING_EFFECTS,
  }))

  useEffect(() => {
    overlay.setProps({ layers, effects: LIGHTING_EFFECTS })
  }, [layers, overlay])

  return null
}

export default function CityMap({
  mode,
  extraLayers,
  initialViewState,
  onSelect,
  buildings,
  contextBuildings,
  highlightId,
  children,
}: CityMapProps) {
  const mapRef = useRef<MapRef | null>(null)
  const initialViewRef = useRef<Required<CityMapViewState> | null>(null)
  const onSelectRef = useRef(onSelect)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pulseStep, setPulseStep] = useState(0)
  const [registerVisibility, setRegisterVisibility] = useState<RegisterLayerVisibility>({
    derelict: true,
    protected: true,
  })
  const [useFallbackStyle, setUseFallbackStyle] = useState(false)

  /* Recompute only when the API snapshot changes, never as a side effect of camera animation. */
  const surveyBuildings = useMemo(
    () => (buildings ?? mockBuildings).filter(isMappableBuilding),
    [buildings],
  )
  const buildingsById = useMemo(
    () => new globalThis.Map(surveyBuildings.map((building) => [building.id, building])),
    [surveyBuildings],
  )
  const footprintBuildings = useMemo(() => surveyBuildings.filter(hasFootprint), [surveyBuildings])
  const prismBuildings = useMemo(() => surveyBuildings.filter((building) => !building.footprint), [surveyBuildings])
  const reviewBuildings = useMemo(
    () => surveyBuildings.filter((building) => building.display_status === "review"),
    [surveyBuildings],
  )
  const homeBuildings = useMemo(
    () => surveyBuildings.filter((building) => building.display_status === "home"),
    [surveyBuildings],
  )
  const derelictBuildings = useMemo(
    () => surveyBuildings.filter((building) => building.registers.derelict === true),
    [surveyBuildings],
  )
  const protectedBuildings = useMemo(
    () => surveyBuildings.filter((building) => building.registers.protected === true),
    [surveyBuildings],
  )

  if (!initialViewRef.current) {
    initialViewRef.current = {
      longitude: initialViewState?.longitude ?? TALBOT_VIEW.longitude,
      latitude: initialViewState?.latitude ?? TALBOT_VIEW.latitude,
      zoom: initialViewState?.zoom ?? TALBOT_VIEW.zoom,
      bearing: initialViewState?.bearing ?? TALBOT_VIEW.bearing,
      pitch: initialViewState?.pitch ?? TALBOT_VIEW.pitch,
    }
  }

  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  /* Pulse at a measured cadence, rather than rebuilding WebGL layers every frame. */
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined

    const timer = window.setInterval(() => {
      setPulseStep((step) => (step + 1) % 2)
    }, 1200)

    return () => window.clearInterval(timer)
  }, [])

  const selectAndFlyTo = useCallback((id: string) => {
    const building = buildingsById.get(id)
    if (!building || !isMappableBuilding(building)) return

    setSelectedId(id)
    onSelectRef.current?.(id)

    const [longitude, latitude] = building.location.coordinates
    mapRef.current?.flyTo({
      center: [longitude, latitude],
      zoom: 18.3,
      pitch: 62,
      bearing: -18,
      duration: 1400,
      essential: true,
    })
  }, [buildingsById])

  useEffect(() => cityMapCamera.subscribe((request) => {
    if (!request) return
    selectAndFlyTo(request.buildingId)
    cityMapCamera.clear(request.version)
  }, { emitCurrent: true }), [selectAndFlyTo])

  const selectedMappableBuilding = selectedId ? buildingsById.get(selectedId) ?? null : null
  const highlightedMappableBuilding = highlightId && highlightId !== selectedId
    ? buildingsById.get(highlightId) ?? null
    : null
  const selectedServices = useMemo<ServiceLink[]>(() => {
    if (mode !== "officer" || !selectedMappableBuilding) return []

    return (mockNearbyPoisByBuilding[selectedMappableBuilding.id] ?? []).map((poi) => ({
      poi,
      source: buildingPosition(selectedMappableBuilding, buildingHeight(selectedMappableBuilding) + 0.6),
      target: [poi.lon, poi.lat, 0],
    }))
  }, [mode, selectedMappableBuilding])

  const onRegisterLayerChange = useCallback((layer: RegisterLayer, visible: boolean) => {
    setRegisterVisibility((current) => ({ ...current, [layer]: visible }))
  }, [])

  const layers = useMemo<Layer[]>(() => {
    const deckLayers: Layer[] = [
      new PolygonLayer({
        id: "context-buildings",
        data: (contextBuildings ?? mockContextBuildings).features,
        extruded: true,
        filled: true,
        stroked: false,
        getPolygon: (feature) => footprintAt(feature.geometry, 0),
        getElevation: (feature) => feature.properties.height_m,
        getFillColor: CONTEXT_COLOR,
        material: BUILDING_MATERIAL,
      }),
    ]

    if (mode !== "officer") return deckLayers

    deckLayers.push(
      new PolygonLayer<FootprintBuilding>({
        id: "surveyed-footprints-ground",
        data: footprintBuildings,
        extruded: true,
        filled: true,
        stroked: false,
        getPolygon: (building) => footprintAt(building.footprint, 0),
        getElevation: GROUND_HEIGHT_M,
        getFillColor: GROUND_COLOR,
        material: BUILDING_MATERIAL,
        pickable: true,
        onClick: (info: PickingInfo<FootprintBuilding>) => {
          if (info.object) selectAndFlyTo(info.object.id)
        },
      }),
      new PolygonLayer<FootprintBuilding>({
        id: "surveyed-footprints-upper",
        data: footprintBuildings,
        extruded: true,
        filled: true,
        stroked: false,
        getPolygon: (building) => footprintAt(building.footprint, GROUND_HEIGHT_M),
        getElevation: upperHeight,
        getFillColor: (building) => STATUS_RGB[building.display_status],
        material: BUILDING_MATERIAL,
        pickable: true,
        onClick: (info: PickingInfo<FootprintBuilding>) => {
          if (info.object) selectAndFlyTo(info.object.id)
        },
      }),
      new ColumnLayer<MappableBuilding>({
        id: "surveyed-prisms-ground",
        data: prismBuildings,
        diskResolution: 4,
        radius: 4.5,
        extruded: true,
        getPosition: (building) => buildingPosition(building),
        getElevation: GROUND_HEIGHT_M,
        getFillColor: GROUND_COLOR,
        material: BUILDING_MATERIAL,
        pickable: true,
        onClick: (info: PickingInfo<MappableBuilding>) => {
          if (info.object) selectAndFlyTo(info.object.id)
        },
      }),
      new ColumnLayer<MappableBuilding>({
        id: "surveyed-prisms-upper",
        data: prismBuildings,
        diskResolution: 4,
        radius: 4.5,
        extruded: true,
        getPosition: (building) => buildingPosition(building, GROUND_HEIGHT_M),
        getElevation: upperHeight,
        getFillColor: (building) => STATUS_RGB[building.display_status],
        material: BUILDING_MATERIAL,
        pickable: true,
        onClick: (info: PickingInfo<MappableBuilding>) => {
          if (info.object) selectAndFlyTo(info.object.id)
        },
      }),
      new ColumnLayer<MappableBuilding>({
        id: "review-beacons",
        data: reviewBuildings,
        diskResolution: 4,
        radius: 0.8,
        extruded: true,
        getPosition: (building) => buildingPosition(building, buildingHeight(building) + 0.2),
        getElevation: 15,
        getFillColor: [255, 176, 32, pulseStep === 0 ? 80 : 170],
        material: BUILDING_MATERIAL,
        transitions: PULSE_TRANSITION,
      }),
      new ScatterplotLayer<MappableBuilding>({
        id: "home-ground-halo",
        data: homeBuildings,
        radiusUnits: "meters",
        radiusMinPixels: 6,
        filled: true,
        stroked: true,
        billboard: false,
        getPosition: (building) => buildingPosition(building, 0.05),
        getRadius: pulseStep === 0 ? 6.6 : 8.5,
        getFillColor: [255, 209, 102, pulseStep === 0 ? 24 : 66],
        getLineColor: [255, 209, 102, pulseStep === 0 ? 100 : 170],
        getLineWidth: 1.2,
        transitions: PULSE_TRANSITION,
      }),
    )

    if (registerVisibility.derelict) {
      deckLayers.push(new ScatterplotLayer<MappableBuilding>({
        id: "derelict-register-ring",
        data: derelictBuildings,
        radiusUnits: "meters",
        radiusMinPixels: 7,
        filled: false,
        stroked: true,
        billboard: false,
        getPosition: (building) => buildingPosition(building, buildingHeight(building) + 0.32),
        getRadius: 7.5,
        getLineColor: VIOLET,
        getLineWidth: 1.6,
      }))
    }

    if (registerVisibility.protected) {
      deckLayers.push(new ScatterplotLayer<MappableBuilding>({
        id: "protected-structure-ring",
        data: protectedBuildings,
        radiusUnits: "meters",
        radiusMinPixels: 7,
        filled: false,
        stroked: true,
        billboard: false,
        getPosition: (building) => buildingPosition(building, buildingHeight(building) + 0.48),
        getRadius: 9.7,
        getLineColor: PROTECTED,
        getLineWidth: 1.4,
      }))
    }

    if (selectedMappableBuilding) {
      deckLayers.push(new PolygonLayer<MappableBuilding>({
        id: "selected-building-outline",
        data: [selectedMappableBuilding],
        filled: false,
        stroked: true,
        extruded: false,
        lineWidthUnits: "pixels",
        lineWidthMinPixels: 2,
        getPolygon: outlinePolygon,
        getLineColor: OUTLINE_COLOR,
        getLineWidth: 2,
      }))
    }

    if (highlightedMappableBuilding) {
      deckLayers.push(new PolygonLayer<MappableBuilding>({
        id: "candidate-rail-hover-outline",
        data: [highlightedMappableBuilding],
        filled: false,
        stroked: true,
        extruded: false,
        lineWidthUnits: "pixels",
        lineWidthMinPixels: 2,
        getPolygon: outlinePolygon,
        getLineColor: [168, 190, 255, 215],
        getLineWidth: 2,
      }))
    }

    if (selectedServices.length > 0) {
      deckLayers.push(
        new ArcLayer<ServiceLink>({
          id: "selected-building-services-arcs",
          data: selectedServices,
          getSourcePosition: (link) => link.source,
          getTargetPosition: (link) => link.target,
          getSourceColor: (link) => SERVICE_COLORS[link.poi.kind],
          getTargetColor: (link) => SERVICE_COLORS[link.poi.kind],
          getWidth: 1.5,
          widthUnits: "pixels",
          widthMinPixels: 1.5,
          getHeight: 0.24,
        }),
        new IconLayer<ServiceLink>({
          id: "selected-building-services-icons",
          data: selectedServices,
          iconAtlas: SERVICE_ICON_ATLAS,
          iconMapping: SERVICE_ICON_MAPPING,
          getIcon: (link) => link.poi.kind,
          getPosition: (link) => link.target,
          getColor: (link) => SERVICE_COLORS[link.poi.kind],
          getSize: 22,
          sizeUnits: "pixels",
          sizeMinPixels: 18,
          billboard: true,
          pickable: true,
        }),
        new TextLayer<ServiceLink>({
          id: "selected-building-services-distances",
          data: selectedServices,
          getPosition: (link) => link.target,
          getText: (link) => `${Math.round(link.poi.dist_m)} m`,
          getColor: (link) => SERVICE_COLORS[link.poi.kind],
          getSize: 11,
          sizeUnits: "pixels",
          getPixelOffset: [14, -7],
          getTextAnchor: "start",
          getAlignmentBaseline: "center",
          fontFamily: "Inter, sans-serif",
          fontWeight: 600,
          billboard: true,
        }),
      )
    }

    return deckLayers
  }, [
    contextBuildings,
    derelictBuildings,
    footprintBuildings,
    highlightedMappableBuilding,
    homeBuildings,
    mode,
    prismBuildings,
    protectedBuildings,
    pulseStep,
    registerVisibility,
    reviewBuildings,
    selectAndFlyTo,
    selectedMappableBuilding,
    selectedServices,
  ])

  const handleMapError = useCallback((event: { error?: Error }) => {
    const message = event.error?.message.toLowerCase() ?? ""
    if (!useFallbackStyle && /(cartocdn|style|fetch|network)/.test(message)) {
      setUseFallbackStyle(true)
    }
  }, [useFallbackStyle])

  return (
    <section aria-label={`${mode === "officer" ? "Officer" : "Walker"} map`} className="city-map" data-map-mode={mode}>
      <div className="city-map__canvas">
        <Map
          ref={mapRef}
          attributionControl={false}
          initialViewState={initialViewRef.current}
          mapLib={maplibregl}
          mapStyle={useFallbackStyle ? DUSK_FALLBACK_STYLE : DARK_MATTER_STYLE}
          maxPitch={70}
          onError={handleMapError}
          onLoad={(event) => hidePoiLabels(event.target)}
        >
          <AttributionControl
            compact
            position="bottom-right"
          />
          <NavigationControl position="bottom-right" showCompass />
          <DeckMapOverlay layers={layers} />
        </Map>
      </div>

      {mode === "officer" ? (
        <MapLegend onLayerChange={onRegisterLayerChange} visibility={registerVisibility} />
      ) : null}
      {(extraLayers || children) && <div className="city-map__overlay">{extraLayers}{children}</div>}
    </section>
  )
}

export { cityMapCamera } from "./camera-store"
