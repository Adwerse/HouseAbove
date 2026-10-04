import {
  cloneMockData,
  createMockState,
  mockBadges,
  mockBuildingsGeoJson,
  mockContextBuildings,
  mockEval,
  mockServicesByBuilding,
  mockSimilarByBuilding,
  mockWalkerProfile,
  mockWalks,
  summaryFor,
} from '../mocks'
import { displayStatus } from './status'
import { isLocalData, isStaticDataMode, markApiUnavailable } from './data-mode'

export { useDataSource, type DataSource } from './data-mode'
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

function isUnreachable(error: unknown) {
  return error instanceof TypeError || (error instanceof ApiError && error.status >= 500)
}

/** Try the API; if it cannot be reached, switch to the local dataset for the rest of the session. */
async function either<T>(remote: () => Promise<T>, local: () => Promise<T>): Promise<T> {
  if (isLocalData()) return local()
  try {
    return await remote()
  } catch (error) {
    if (!isUnreachable(error)) throw error
    markApiUnavailable()
    return local()
  }
}

/** Decide early, so the first screen does not wait on a dead proxy. */
export async function probeApi(timeoutMs = 1800) {
  if (isStaticDataMode) return
  try {
    const response = await fetch(`${API_PREFIX}/health`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) markApiUnavailable()
  } catch {
    markApiUnavailable()
  }
}

type StaticWalkerExport = {
  profile: WalkerProfileResponse
  walks: Walk[]
  awards: Award[]
}

const staticState = createMockState()
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
  return { type: 'FeatureCollection', features: buildings.map(buildingFeature).filter((f): f is NonNullable<typeof f> => Boolean(f)) }
}

async function staticJson<T>(path: string, fallback: T): Promise<T> {
  if (!isStaticDataMode) return clone(fallback)
  try {
    const response = await fetch(path, { cache: 'no-store' })
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) throw new Error(path)
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
      // Keep the HTTP message when a proxy answers with plain text.
    }
    throw new ApiError(response.status, detail)
  }
  return await response.json() as T
}

function staticBuildingOrThrow(buildings: Building[], id: string) {
  const building = buildings.find((candidate) => candidate.id === id)
  if (!building) throw new ApiError(404, `No building ${id}`)
  return building
}

function staticBadgeTitle(id: BadgeId) {
  return mockBadges.find((badge) => badge.id === id)?.title ?? id.replaceAll('_', ' ')
}

const sameStreet = (b: Building, street?: string) =>
  !street || b.street?.trim().toLowerCase() === street.trim().toLowerCase()

export async function getBuildings(filters: { street?: string; status?: DisplayStatus } = {}) {
  return either(
    () => {
      const params = new URLSearchParams()
      if (filters.street) params.set('street', filters.street)
      if (filters.status) params.set('status', filters.status)
      return request<BuildingsGeoJson>(`/buildings${params.size ? `?${params}` : ''}`)
    },
    async () => buildGeoJson((await staticBuildings()).filter((b) =>
      sameStreet(b, filters.street) && (!filters.status || displayStatus(b) === filters.status))),
  )
}

export async function getBuilding(id: string) {
  return either(
    () => request<Building>(`/buildings/${encodeURIComponent(id)}`),
    async () => publicBuilding(staticBuildingOrThrow(await staticBuildings(), id)),
  )
}

export async function getBuildingServices(id: string) {
  return either(
    () => request<BuildingServicesResponse>(`/buildings/${encodeURIComponent(id)}/services`),
    async () => {
      staticBuildingOrThrow(await staticBuildings(), id)
      return clone(mockServicesByBuilding[id] ?? { services: null, pois: [] })
    },
  )
}

export async function getSimilarBuildings(id: string, k = 5) {
  const limit = Math.max(1, Math.min(k, 20))
  return either(
    () => request<SimilarBuilding[]>(`/buildings/${encodeURIComponent(id)}/similar?k=${limit}`),
    async () => {
      staticBuildingOrThrow(await staticBuildings(), id)
      return clone((mockSimilarByBuilding[id] ?? []).slice(0, limit))
    },
  )
}

export async function getReviewQueue() {
  return either(
    () => request<Building[]>('/review-queue'),
    async () => (await staticBuildings()).filter((b) => displayStatus(b) === 'review').map(publicBuilding),
  )
}

export async function setHumanLabel(id: string, label: UpperStatus | null) {
  return either(
    () => request<Building>(`/buildings/${encodeURIComponent(id)}/human-label`, { method: 'POST', body: JSON.stringify({ label }) }),
    async () => {
      const building = staticBuildingOrThrow(await staticBuildings(), id)
      building.human_label = label
      building.display_status = displayStatus(building)
      emitLocalEvent({ type: 'building.updated', data: { id } })
      return publicBuilding(building)
    },
  )
}

export async function recordInspection(id: string, outcome: InspectionOutcome, note: string | null = null) {
  return either(
    () => request<InspectionResponse>(`/buildings/${encodeURIComponent(id)}/inspection`, { method: 'POST', body: JSON.stringify({ outcome, note }) }),
    async () => {
      const building = staticBuildingOrThrow(await staticBuildings(), id)
      building.inspection = { outcome, note, at: new Date().toISOString() }
      building.display_status = displayStatus(building)
      const awards: Award[] = []
      const badgeId = outcome === 'confirmed_candidate' ? 'homes_above' : outcome === 'returned_to_use' ? 'lights_on' : null
      if (badgeId && building.captured_by && !staticState.awards.some((a) => a.badge_id === badgeId && a.building_id === id)) {
        const award: Award = {
          id: `local_${badgeId}_${id}`,
          walker_id: building.captured_by,
          badge_id: badgeId,
          building_id: id,
          at: building.inspection.at,
          reason: outcome === 'confirmed_candidate' ? 'A facade you captured was confirmed by a council inspection.' : 'A building you captured returned to use as homes.',
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
    },
  )
}

export async function getStreetSummary(street: string): Promise<StreetSummary> {
  return either(
    () => request<StreetSummary>(`/streets/${encodeURIComponent(street)}/summary`),
    async () => summaryFor((await staticBuildings()).filter((b) => sameStreet(b, street))),
  )
}

export async function getContextBuildings() {
  return either(
    () => request<ContextBuildingsGeoJson>('/context-buildings'),
    () => staticJson('/data/context.geojson', mockContextBuildings),
  )
}

export async function getEval() {
  return either(() => request<EvalResult>('/eval'), () => staticJson('/data/eval.json', mockEval))
}

async function staticWalkerExport(id: string): Promise<StaticWalkerExport> {
  const fallback: StaticWalkerExport = {
    profile: { ...mockWalkerProfile, walker: { ...mockWalkerProfile.walker, id } },
    walks: mockWalks.filter((walk) => walk.walker_id === id || id === mockWalkerProfile.walker.id),
    awards: staticState.awards.filter((award) => award.walker_id === id),
  }
  const exported = await staticJson(`/data/walkers/${encodeURIComponent(id)}.json`, fallback)
  const exportedAwards = exported.awards ?? exported.profile.awards ?? []
  // Exported walker files are snapshots: merge awards earned in this browser session.
  const localAwards = staticState.awards.filter((a) => a.walker_id === id && a.id.startsWith('local_'))
  const awards = Array.from(new Map([...exportedAwards, ...localAwards].map((a) => [a.id, a])).values())
  return { profile: { ...exported.profile, awards }, walks: exported.walks, awards }
}

export async function getWalker(id: string) {
  return either(
    () => request<WalkerProfileResponse>(`/walkers/${encodeURIComponent(id)}`),
    async () => clone((await staticWalkerExport(id)).profile),
  )
}

export async function getWalkerWalks(id: string) {
  return either(
    () => request<Walk[]>(`/walkers/${encodeURIComponent(id)}/walks`),
    async () => clone((await staticWalkerExport(id)).walks),
  )
}

export async function evaluateWalker(id: string) {
  return either(
    () => request<{ awards: Award[] }>(`/walkers/${encodeURIComponent(id)}/evaluate`, { method: 'POST' }),
    async () => ({ awards: [] as Award[] }),
  )
}

export async function getBadges() {
  return either(() => request<Badge[]>('/badges'), () => staticJson('/data/badges.json', mockBadges))
}

export async function health() {
  return either(() => request<{ ok: true }>('/health'), async () => ({ ok: true as const }))
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
