import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, CircleAlert, Info, MapPinned } from "lucide-react"

import { api } from "../lib/api"
import { displayStatus } from "../lib/status"
import { useEventStream } from "../lib/sse"
import type { Building, StreetSummary } from "../lib/types"
import CityMap, { cityMapCamera } from "../map/CityMap"
import { TALBOT_STREET, mockBuildings, mockContextBuildings } from "../mocks"
import BuildingDrawer from "../officer/BuildingDrawer"
import { CandidateRail, CandidateRailSkeleton } from "../officer/CandidateRail"

const TALBOT_STREET_VIEW = {
  longitude: -6.2512,
  latitude: 53.3519,
  zoom: 17.2,
  bearing: -18,
  pitch: 58,
}

function summaryFor(buildings: Building[]): StreetSummary {
  const statuses = buildings.map(displayStatus)
  return {
    total: buildings.length,
    processed: buildings.filter((building) => Boolean(building.models.vision)).length,
    likely_underused: statuses.filter((status) => status === "likely_underused").length,
    review: statuses.filter((status) => status === "review").length,
    confirmed: statuses.filter((status) => status === "confirmed").length,
    home: statuses.filter((status) => status === "home").length,
  }
}

function sameStreet(building: Building, street: string) {
  return building.street?.trim().toLocaleLowerCase() === street.trim().toLocaleLowerCase()
}

function PipelineStrip({ summary, loading }: { summary: StreetSummary; loading: boolean }) {
  const steps = [
    [summary.total, "facades"],
    [summary.processed, "read by AI"],
    [summary.likely_underused, "likely underused"],
    [summary.review, "sent to human"],
    [summary.confirmed, "confirmed"],
  ] as const

  return (
    <div className="min-w-0 overflow-x-auto" aria-label="Pipeline summary">
      <ol className="flex min-w-max items-center gap-1.5 font-mono text-dusk-xs text-dusk-muted">
        {steps.map(([value, label], index) => (
          <li className="flex items-center gap-1.5" key={label}>
            {index > 0 ? <span aria-hidden="true" className="text-dusk-primary/70">›</span> : null}
            <span className="whitespace-nowrap">
              <strong className="font-semibold text-dusk-text">{loading ? "–" : value}</strong> {label}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function MapEmptyState() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center p-5">
      <div className="max-w-64 rounded-card border border-white/[0.08] bg-dusk-glass px-4 py-3 text-center shadow-panel backdrop-blur-glass">
        <MapPinned aria-hidden="true" className="mx-auto text-dusk-primary" size={20} />
        <p className="mt-2 text-dusk-sm font-semibold text-dusk-text">No surveyed facades on this street yet</p>
        <p className="mt-1 text-dusk-xs leading-4 text-dusk-muted">Choose another street or wait for the next capture to be processed.</p>
      </div>
    </div>
  )
}

export default function OfficerConsole() {
  const queryClient = useQueryClient()
  const [street, setStreet] = useState(TALBOT_STREET)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)

  const buildingsQuery = useQuery({
    queryKey: ["officer-buildings", street],
    queryFn: () => api.getBuildings({ street }),
  })
  const contextQuery = useQuery({
    queryKey: ["officer-context-buildings"],
    queryFn: api.getContextBuildings,
  })
  const summaryQuery = useQuery({
    queryKey: ["officer-street-summary", street],
    queryFn: () => api.getStreetSummary(street),
  })

  const liveBuildings = buildingsQuery.data?.features.map((feature) => feature.properties)
  const fallbackBuildings = useMemo(
    () => mockBuildings.filter((building) => sameStreet(building, street)),
    [street],
  )
  // A successful empty response is meaningful; only a failed or pending request falls back to demo data.
  const buildings = liveBuildings ?? fallbackBuildings
  const fallbackSummary = useMemo(() => summaryFor(buildings), [buildings])
  const summary = summaryQuery.data ?? fallbackSummary
  const selectedBuilding = selectedId ? buildings.find((building) => building.id === selectedId) ?? null : null
  const buildingDetailQuery = useQuery({
    queryKey: ["officer-building", selectedId],
    queryFn: () => api.getBuilding(selectedId!),
    enabled: Boolean(selectedId),
  })
  const servicesQuery = useQuery({
    queryKey: ["officer-building-services", selectedId],
    queryFn: () => api.getBuildingServices(selectedId!),
    enabled: Boolean(selectedId),
  })
  const similarQuery = useQuery({
    queryKey: ["officer-building-similar", selectedId],
    queryFn: () => api.getSimilarBuildings(selectedId!, 5),
    enabled: Boolean(selectedId),
  })
  const detailBuilding = buildingDetailQuery.data ?? selectedBuilding
  const detailError = buildingDetailQuery.error ?? servicesQuery.error ?? similarQuery.error ?? null

  const streetOptions = useMemo(() => {
    const options = new Set([TALBOT_STREET, street])
    for (const building of buildings) if (building.street) options.add(building.street)
    return [...options]
  }, [buildings, street])

  useEventStream((event) => {
    if (event.type === "building.updated" || event.type === "inspection.recorded") {
      void queryClient.invalidateQueries({ queryKey: ["officer-buildings"] })
      void queryClient.invalidateQueries({ queryKey: ["officer-street-summary"] })
      void queryClient.invalidateQueries({ queryKey: ["officer-building"] })
      void queryClient.invalidateQueries({ queryKey: ["officer-building-services"] })
      void queryClient.invalidateQueries({ queryKey: ["officer-building-similar"] })
    }
  })

  const selectBuilding = (id: string) => {
    setSelectedId(id)
    cityMapCamera.flyTo(id)
  }

  return (
    <main className="min-h-[100dvh] bg-dusk-background p-3 sm:p-5" aria-labelledby="officer-console-title">
      <section className="grid min-h-[calc(100dvh-1.5rem)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-panel border border-white/[0.07] bg-dusk-elevated shadow-panel sm:min-h-[calc(100dvh-2.5rem)]">
        <header className="relative z-20 flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-white/[0.07] bg-dusk-glass px-3 py-3 backdrop-blur-glass sm:px-5">
          <div className="flex items-center gap-3">
            <div>
              <p className="font-mono text-dusk-xs uppercase tracking-[0.1em] text-dusk-primary">HomesAbove</p>
              <h1 id="officer-console-title" className="mt-0.5 text-dusk-lg font-semibold tracking-[-0.01em] text-dusk-text">
                Officer console
              </h1>
            </div>
            <details className="relative">
              <summary className="flex size-8 cursor-pointer list-none items-center justify-center rounded-chip border border-white/[0.1] text-dusk-muted transition-colors hover:border-dusk-primary hover:text-dusk-primary [&::-webkit-details-marker]:hidden" aria-label="Data safeguards">
                <Info aria-hidden="true" size={16} />
              </summary>
              <div className="absolute left-0 top-10 z-30 w-72 rounded-card border border-white/[0.1] bg-dusk-elevated p-3 text-dusk-sm leading-5 text-dusk-muted shadow-panel">
                EU-hosted inference, zero data retention. Addresses stay with councils.
              </div>
            </details>
          </div>

          <label className="flex min-w-0 items-center gap-2 rounded-card border border-white/[0.08] bg-white/[0.04] px-2.5 py-2 text-dusk-sm text-dusk-text">
            <span className="sr-only">Street</span>
            <select
              className="min-w-0 cursor-pointer appearance-none bg-transparent pr-1 text-dusk-sm font-semibold outline-none"
              value={street}
              onChange={(event) => {
                setStreet(event.target.value)
                setSelectedId(null)
                setHighlightId(null)
              }}
            >
              {streetOptions.map((option) => <option className="bg-dusk-elevated" key={option} value={option}>{option}</option>)}
            </select>
            <ChevronDown aria-hidden="true" className="shrink-0 text-dusk-muted" size={15} />
          </label>

          <div className="order-last w-full min-w-0 lg:order-none lg:flex-1">
            <PipelineStrip summary={summary} loading={summaryQuery.isPending} />
          </div>
        </header>

        <div className="grid min-h-0 grid-cols-1 gap-px bg-white/[0.07] xl:grid-cols-[360px_minmax(0,1fr)_440px]">
          <aside className="min-h-[28rem] bg-dusk-background p-2 sm:p-3 xl:min-h-0">
            {buildingsQuery.isPending && !buildingsQuery.data ? (
              <CandidateRailSkeleton className="max-w-none" />
            ) : (
              <>
                {buildingsQuery.isError ? (
                  <div className="mb-2 flex items-start gap-2 rounded-card border border-status-review/30 bg-status-review/10 px-3 py-2 text-dusk-xs leading-4 text-dusk-muted" role="status">
                    <CircleAlert aria-hidden="true" className="mt-0.5 shrink-0 text-status-review" size={14} />
                    <span>Live data is unavailable. Showing the local demonstration street.</span>
                  </div>
                ) : null}
                <CandidateRail
                  buildings={buildings}
                  selectedId={selectedId}
                  onHover={setHighlightId}
                  onSelect={selectBuilding}
                  className="max-w-none"
                />
              </>
            )}
          </aside>

          <section className="relative min-h-[34rem] bg-dusk-background xl:min-h-0" aria-label="3D survey map">
            <CityMap
              mode="officer"
              buildings={buildings}
              contextBuildings={contextQuery.data ?? mockContextBuildings}
              highlightId={highlightId}
              initialViewState={TALBOT_STREET_VIEW}
              onSelect={setSelectedId}
            />
            {liveBuildings?.length === 0 ? <MapEmptyState /> : null}
          </section>

          <aside className="min-h-[28rem] min-w-0 bg-dusk-background p-2 sm:p-3 xl:min-h-0" aria-label="Building detail">
            <BuildingDrawer
              building={detailBuilding}
              services={servicesQuery.data}
              similar={similarQuery.data}
              loading={buildingDetailQuery.isPending || servicesQuery.isPending || similarQuery.isPending}
              error={detailError}
              onSelectSimilar={selectBuilding}
              className="h-full max-w-none"
            />
          </aside>
        </div>
      </section>
    </main>
  )
}
