import { useState } from "react"
import CityMap from "../map/CityMap"

const TALBOT_STREET_VIEW = {
  longitude: -6.2512,
  latitude: 53.3519,
  zoom: 17.2,
  bearing: -18,
  pitch: 58,
}

export default function OfficerConsole() {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  return (
    <main className="min-h-[100dvh] bg-dusk-background p-3 sm:p-5" aria-labelledby="officer-console-title">
      <section className="relative min-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-panel border border-white/[0.07] bg-dusk-elevated shadow-panel sm:min-h-[calc(100dvh-2.5rem)]">
        <div className="absolute inset-0 [&_.city-map]:h-full [&_.city-map]:min-h-0 [&_.city-map]:rounded-none [&_.city-map]:border-0">
          <CityMap mode="officer" initialViewState={TALBOT_STREET_VIEW} onSelect={setSelectedId} />
        </div>

        <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-3 sm:p-5">
          <div className="pointer-events-auto max-w-[min(100%,25rem)] rounded-panel border border-white/[0.07] bg-dusk-glass px-4 py-3 shadow-panel backdrop-blur-glass">
            <p className="font-mono text-dusk-xs uppercase tracking-[0.08em] text-dusk-primary">HomesAbove</p>
            <h1 id="officer-console-title" className="mt-1 text-dusk-lg font-semibold tracking-[-0.01em] text-dusk-text sm:text-dusk-xl">
              Officer console
            </h1>
            <p className="mt-1 hidden text-dusk-sm leading-5 text-dusk-muted sm:block">
              Floors above Talbot Street shops, ready for inspection planning.
            </p>
          </div>

          <div className="pointer-events-auto hidden rounded-chip border border-white/[0.07] bg-dusk-glass px-3 py-2 font-mono text-dusk-xs text-dusk-muted shadow-panel backdrop-blur-glass sm:block">
            3D street view
          </div>
        </header>

        <aside
          aria-live="polite"
          className="pointer-events-none absolute inset-x-3 bottom-3 z-10 sm:inset-x-auto sm:bottom-5 sm:right-5"
        >
          <div className="pointer-events-auto rounded-panel border border-white/[0.07] bg-dusk-glass px-4 py-3 shadow-panel backdrop-blur-glass">
            <p className="font-mono text-dusk-xs uppercase tracking-[0.08em] text-dusk-muted">Selection</p>
            <p className="mt-1 text-dusk-sm text-dusk-text">
              {selectedId ? <><span className="font-mono text-dusk-primary">{selectedId}</span> selected</> : "Select a building to inspect"}
            </p>
          </div>
        </aside>
      </section>
    </main>
  )
}
