import {
  cloneMockData,
  createMockState,
  mockBadges,
  mockBuildingsGeoJson,
  mockContextBuildings,
  mockEval,
  mockSummary,
  mockServicesByBuilding,
  mockSimilarByBuilding,
  mockWalkerProfile,
  mockWalks,
} from '../mocks'
import { displayStatus } from './status'
import { isStaticDataMode } from './data-mode'
import { emitLocalEvent } from './sse'
import type {
  Award,
  Badge,
  BadgeId,
  Building,
  BuildingGeometry,
  BuildingServicesResponse,
  BuildingsGeoJson,
  ContextBuildingsGeoJson,
  DisplayStatus,
  EvalResult,
  InspectionOutcome,
  InspectionResponse,
  SimilarBuilding,
  StreetSummary,
  UpperStatus,
  Walk,
  WalkerProfileResponse,
} from './types'

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export const API_PREFIX = '/api'
export const AGENT_ASK_PATH = `${API_PREFIX}/agent/ask`

type StaticWalkerExport = {
  profile: WalkerProfileResponse
  walks: Walk[]
  awards: Award[]
}

type ExportSummary = {
  streets: Record<string, StreetSummary>
  all: StreetSummary
}

type StaticState = ReturnType<typeof createMockState>

let staticState: StaticState = createMockState()
let staticBuildingsLoad: Promise<Building[]> | undefined

function clone<T>(value: T): T {
  return cloneMockData(value)
}

function publicBuilding(building: Building): Building {
  return { ...clone(building), display_status: displayStatus(building) }
}

function buildingFeature(building: Building) {
  const geometry = building.footprint ?? building.location
  if (!geometry) return null
  return { type: 'Feature' as const, id: building.id, geometry: geometry as BuildingGeometry, properties: publicBuilding(building) }
}

function buildGeoJson(buildings: Building[]): BuildingsGeoJson {
  return { type: 'FeatureCollection', features: buildings.map(buildingFeature).filter((feature): feature is NonNullable<typeof feature> => Boolean(feature)) }
}

async function staticJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(path, { cache: 'no-store' })
    if (!response.ok) throw new Error(`Static file unavailable: ${path}`)
    return await response.json() as T
  } catch {
    return clone(fallback)
  }
}

async function staticBuildings(): Promise<Building[]> {
  if (!staticBuildingsLoad) {
    staticBuildingsLoad = staticJson('/data/buildings.geojson', mockBuildingsGeoJson).then((collection) => {
      staticState.buildings = collection.features.map((feature) => publicBuilding(feature.properties))
      return staticState.buildings
    })
  }
  return staticBuildingsLoad
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API_PREFIX}${path}`, { ...init, headers })
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`
    try {
      const body = await response.json() as { detail?: string }
      detail = body.detail ?? detail
    } catch {
      // Keep the useful HTTP message when an upstream proxy returns plain text.
    }
    throw new ApiError(response.status, detail)
  }
  return await response.json() as T
}

function staticSummary(buildings: Building[]): StreetSummary {
  const statuses = buildings.map(displayStatus)
  return {
    total: buildings.length,
    processed: buildings.filter((building) => Boolean(building.models.vision)).length,
    likely_underused: statuses.filter((status) => status === 'likely_underused').length,
    review: statuses.filter((status) => status === 'review').length,
    confirmed: statuses.filter((status) => status === 'confirmed').length,
    home: statuses.filter((status) => status === 'home').length,
  }
}

function staticBuildingOrThrow(buildings: Building[], id: string) {
  const building = buildings.find((candidate) => candidate.id === id)
  if (!building) throw new ApiError(404, `No building ${id}`)
  return building
}

function staticBadgeTitle(id: BadgeId) {
  return mockBadges.find((badge) => badge.id === id)?.title ?? id.replaceAll('_', ' ')
}

export async function health() {
  return isStaticDataMode ? { ok: true } : request<{ ok: true }>('/health')
}

export async function getBuildings(filters: { street?: string; status?: DisplayStatus } = {}) {
  if (isStaticDataMode) {
    const buildings = await staticBuildings()
    const normalizedStreet = filters.street?.trim().toLowerCase()
    return buildGeoJson(buildings.filter((building) =>
      (!normalizedStreet || building.street?.toLowerCase() === normalizedStreet) &&
      (!filters.status || displayStatus(building) === filters.status),
    ))
  }
  const params = new URLSearchParams()
  if (filters.street) params.set('street', filters.street)
  if (filters.status) params.set('status', filters.status)
  return request<BuildingsGeoJson>(`/buildings${params.size ? `?${params}` : ''}`)
}

export async function getBuilding(id: string) {
  if (isStaticDataMode) return publicBuilding(staticBuildingOrThrow(await staticBuildings(), id))
  return request<Building>(`/buildings/${encodeURIComponent(id)}`)
}

export async function getBuildingServices(id: string) {
  if (isStaticDataMode) {
    staticBuildingOrThrow(await staticBuildings(), id)
    return clone(mockServicesByBuilding[id] ?? { services: null, pois: [] })
  }
  return request<BuildingServicesResponse>(`/buildings/${encodeURIComponent(id)}/services`)
}

export async function getSimilarBuildings(id: string, k = 5) {
  if (isStaticDataMode) {
    staticBuildingOrThrow(await staticBuildings(), id)
    return clone((mockSimilarByBuilding[id] ?? []).slice(0, Math.max(1, Math.min(k, 20))))
  }
  return request<SimilarBuilding[]>(`/buildings/${encodeURIComponent(id)}/similar?k=${Math.max(1, Math.min(k, 20))}`)
}

export async function getReviewQueue() {
  if (isStaticDataMode) return (await staticBuildings()).filter((building) => displayStatus(building) === 'review').map(publicBuilding)
  return request<Building[]>('/review-queue')
}

export async function setHumanLabel(id: string, label: UpperStatus | null) {
  if (!isStaticDataMode) return request<Building>(`/buildings/${encodeURIComponent(id)}/human-label`, {
    method: 'POST', body: JSON.stringify({ label }),
  })
  const building = staticBuildingOrThrow(await staticBuildings(), id)
  building.human_label = label
  building.display_status = displayStatus(building)
  emitLocalEvent({ type: 'building.updated', data: { id } })
  return publicBuilding(building)
}

export async function recordInspection(id: string, outcome: InspectionOutcome, note: string | null = null) {
  if (!isStaticDataMode) return request<InspectionResponse>(`/buildings/${encodeURIComponent(id)}/inspection`, {
    method: 'POST', body: JSON.stringify({ outcome, note }),
  })
  const building = staticBuildingOrThrow(await staticBuildings(), id)
  building.inspection = { outcome, note, at: new Date().toISOString() }
  building.display_status = displayStatus(building)
  const awards: Award[] = []
  const badgeId = outcome === 'confirmed_candidate' ? 'homes_above' : outcome === 'returned_to_use' ? 'lights_on' : null
  if (badgeId && building.captured_by && !staticState.awards.some((award) => award.badge_id === badgeId && award.building_id === id)) {
    const award: Award = {
      id: `local_${badgeId}_${id}`,
      walker_id: building.captured_by,
      badge_id: badgeId,
      building_id: id,
      at: building.inspection.at,
      reason: outcome === 'confirmed_candidate' ? 'A captured facade was confirmed by council inspection.' : 'A captured building returned to use as homes.',
      title: staticBadgeTitle(badgeId),
    }
    staticState.awards.push(award)
    awards.push(award)
  }
  emitLocalEvent({ type: 'building.updated', data: { id } })
  emitLocalEvent({ type: 'inspection.recorded', data: { id, outcome } })
  for (const award of awards) {
    emitLocalEvent({ type: 'badge.awarded', data: { walker_id: award.walker_id, badge_id: award.badge_id, building_id: award.building_id, title: award.title ?? staticBadgeTitle(award.badge_id) } })
  }
  return { building: publicBuilding(building), awards: clone(awards) }
}

export async function getStreetSummary(street: string) {
  if (isStaticDataMode) {
    const buildings = await staticBuildings()
    const snapshot = await staticJson<ExportSummary>('/data/summary.json', mockSummary)
    return snapshot.streets[street] ?? staticSummary(buildings.filter((building) => building.street?.toLowerCase() === street.trim().toLowerCase()))
  }
  return request<StreetSummary>(`/streets/${encodeURIComponent(street)}/summary`)
}

export async function getContextBuildings() {
  if (isStaticDataMode) return staticJson('/data/context.geojson', mockContextBuildings)
  return request<ContextBuildingsGeoJson>('/context-buildings')
}

export async function getEval() {
  if (isStaticDataMode) return staticJson('/data/eval.json', mockEval)
  return request<EvalResult>('/eval')
}

async function staticWalkerExport(id: string): Promise<StaticWalkerExport> {
  const fallback: StaticWalkerExport = {
    profile: { ...mockWalkerProfile, walker: { ...mockWalkerProfile.walker, id } },
    walks: mockWalks.filter((walk) => walk.walker_id === id),
    awards: staticState.awards.filter((award) => award.walker_id === id),
  }
  const exported = await staticJson(`/data/walkers/${encodeURIComponent(id)}.json`, fallback)
  return {
    profile: { ...exported.profile, awards: exported.awards ?? exported.profile.awards },
    walks: exported.walks,
    awards: exported.awards,
  }
}

export async function getWalker(id: string) {
  if (isStaticDataMode) return clone((await staticWalkerExport(id)).profile)
  return request<WalkerProfileResponse>(`/walkers/${encodeURIComponent(id)}`)
}

export async function getWalkerWalks(id: string) {
  if (isStaticDataMode) return clone((await staticWalkerExport(id)).walks)
  return request<Walk[]>(`/walkers/${encodeURIComponent(id)}/walks`)
}

export async function evaluateWalker(id: string) {
  if (isStaticDataMode) return { awards: [] as Award[] }
  return request<{ awards: Award[] }>(`/walkers/${encodeURIComponent(id)}/evaluate`, { method: 'POST' })
}

export async function getBadges() {
  if (isStaticDataMode) return staticJson('/data/badges.json', mockBadges)
  return request<Badge[]>('/badges')
}

export const api = {
  health,
  getBuildings,
  getBuilding,
  getBuildingServices,
  getSimilarBuildings,
  getReviewQueue,
  setHumanLabel,
  recordInspection,
  getStreetSummary,
  getContextBuildings,
  getEval,
  getWalker,
  getWalkerWalks,
  evaluateWalker,
  getBadges,
}
