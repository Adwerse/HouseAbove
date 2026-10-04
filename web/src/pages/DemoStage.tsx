import { useCallback, useEffect, useState } from "react"
import { BadgeCheck, Keyboard, MonitorPlay, Smartphone, Sparkles } from "lucide-react"

import { useEventStream } from "../lib/sse"
import { DEFAULT_MOCK_WALKER_ID } from "../mocks"
import { AGENT_SUGGESTIONS } from "../officer/AgentPanel"
import { officerDemoControls } from "../officer/demo-controls"
import WalkerApp from "../walker"
import OfficerConsole from "./OfficerConsole"

const TOP_CANDIDATE_ID = "talbot_12"
const DISAGREEMENT_ID = "talbot_28"
const DEMO_WALKER_ID = import.meta.env.VITE_DEMO_WALKER || DEFAULT_MOCK_WALKER_ID

type DemoStep = 1 | 2 | 3 | 4 | 5 | 6

const stepCopy: Record<DemoStep, string> = {
  1: "Street overview — the survey’s upper floors come into view.",
  2: "Top candidate — fly to the highest-ranked facade.",
  3: "Independent disagreement — open the human-check case.",
  4: "Services — show the walking-distance links from the top candidate.",
  5: "MCP in action — ask where a human should inspect first.",
  6: "Human decision — record a confirmed candidate and award the walker badge.",
}

function DemoPhone({ walkerId }: { walkerId: string }) {
  const [award, setAward] = useState<string | null>(null)

  useEventStream((event) => {
    if (event.type === "badge.awarded" && event.data.walker_id === walkerId) {
      setAward(event.data.title)
    }
  })

  return (
    <aside className="mx-auto flex h-[min(100%,52rem)] w-full max-w-[25rem] flex-col" aria-label={`${walkerId} walker phone`}>
      <div className="mb-2 flex items-center justify-between px-2 text-dusk-xs text-dusk-muted">
        <span className="inline-flex items-center gap-1.5"><Smartphone aria-hidden="true" size={14} /> Walker view</span>
        <span className="font-mono">{walkerId}</span>
      </div>
      <div className="relative min-h-0 flex-1 rounded-[2.25rem] border-[7px] border-[#252d48] bg-[#050914] p-1.5 shadow-[0_20px_55px_rgba(0,0,0,0.55)]">
        <div aria-hidden="true" className="absolute left-1/2 top-2 z-20 h-5 w-24 -translate-x-1/2 rounded-full bg-[#050914]" />
        <div className="relative h-full overflow-hidden rounded-[1.75rem] bg-dusk-background pt-3 [&>main]:!h-full [&>main]:!min-h-0 [&>main]:!p-3 [&>main>section]:!p-4">
          <WalkerApp />
        </div>
        {award ? (
          <div className="absolute inset-x-3 bottom-4 z-30 animate-[pulse_2.2s_ease-in-out_infinite] rounded-card border border-dusk-warm/60 bg-dusk-elevated/95 p-3 shadow-panel backdrop-blur-glass" role="status">
            <p className="flex items-center gap-1.5 text-dusk-xs font-semibold text-dusk-warm"><BadgeCheck aria-hidden="true" size={15} /> New walker badge</p>
            <p className="mt-1 text-dusk-sm font-semibold text-dusk-text">{award}</p>
            <p className="mt-0.5 text-dusk-xs leading-4 text-dusk-muted">Walking and coverage made this follow-up possible.</p>
          </div>
        ) : null}
      </div>
    </aside>
  )
}

export default function DemoStage() {
  const [presenterCaption, setPresenterCaption] = useState(true)
  const [activeStep, setActiveStep] = useState<DemoStep>(1)

  const runStep = useCallback((step: DemoStep) => {
    setActiveStep(step)
    if (step === 1) {
      officerDemoControls.dispatch({ type: "overview" })
      return
    }
    if (step === 2 || step === 4) {
      // Selecting the top candidate makes CityMap reveal the service arcs.
      officerDemoControls.dispatch({ type: "select", buildingId: TOP_CANDIDATE_ID })
      return
    }
    if (step === 3) {
      officerDemoControls.dispatch({ type: "select", buildingId: DISAGREEMENT_ID })
      return
    }
    if (step === 5) {
      officerDemoControls.dispatch({ type: "ask", question: AGENT_SUGGESTIONS[0] })
      return
    }
    officerDemoControls.dispatch({
      type: "inspection",
      buildingId: TOP_CANDIDATE_ID,
      outcome: "confirmed_candidate",
    })
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) return

      if (event.key.toLowerCase() === "p") {
        event.preventDefault()
        setPresenterCaption((visible) => !visible)
        return
      }

      const numeric = Number(event.key)
      if (numeric >= 1 && numeric <= 6) {
        event.preventDefault()
        runStep(numeric as DemoStep)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [runStep])

  return (
    <main className="h-[100dvh] min-h-[42rem] overflow-hidden bg-dusk-background p-3" aria-labelledby="demo-stage-title">
      <h1 id="demo-stage-title" className="sr-only">HomesAbove guided demo stage</h1>
      <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[minmax(0,7fr)_minmax(18rem,3fr)]">
        <section className="min-h-0 overflow-hidden rounded-panel border border-white/[0.07] shadow-panel" aria-label="Officer console demonstration">
          <OfficerConsole embedded />
        </section>

        <section className="relative min-h-0 overflow-hidden rounded-panel border border-white/[0.07] bg-[radial-gradient(circle_at_50%_18%,rgba(124,156,255,0.16),transparent_38%),#0A0F1E] p-3 shadow-panel">
          <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-dusk-primary/10 to-transparent" />
          <div className="relative flex h-full min-h-0 flex-col">
            <div className="mb-3 flex items-center gap-2 px-1">
              <span className="grid size-8 place-items-center rounded-card border border-dusk-primary/35 bg-dusk-primary/10 text-dusk-primary"><MonitorPlay aria-hidden="true" size={16} /></span>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-dusk-primary">Live companion</p>
                <p className="text-dusk-sm font-semibold text-dusk-text">One inspection, shared event</p>
              </div>
            </div>
            <DemoPhone walkerId={DEMO_WALKER_ID} />
          </div>
        </section>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
        <div className="pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto rounded-chip border border-white/[0.1] bg-dusk-glass px-3 py-2 shadow-panel backdrop-blur-glass" aria-label="Demo keyboard controls">
          <Keyboard aria-hidden="true" size={15} className="shrink-0 text-dusk-primary" />
          {([1, 2, 3, 4, 5, 6] as DemoStep[]).map((step) => (
            <button
              key={step}
              type="button"
              onClick={() => runStep(step)}
              className={`shrink-0 rounded-chip border px-2 py-1 font-mono text-[10px] transition-colors ${activeStep === step ? "border-dusk-primary bg-dusk-primary/20 text-dusk-text" : "border-white/[0.1] text-dusk-muted hover:border-dusk-primary/60 hover:text-dusk-text"}`}
              title={stepCopy[step]}
            >
              {step}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPresenterCaption((visible) => !visible)}
            className="shrink-0 rounded-chip border border-white/[0.1] px-2 py-1 font-mono text-[10px] text-dusk-muted hover:border-dusk-primary/60 hover:text-dusk-text"
            title="Toggle presenter caption"
          >
            P
          </button>
        </div>
      </div>

      {presenterCaption ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-16 z-30 flex justify-center px-4">
          <p className="max-w-xl rounded-card border border-dusk-primary/30 bg-dusk-elevated/95 px-4 py-2 text-center text-dusk-sm leading-5 text-dusk-text shadow-panel backdrop-blur-glass">
            <Sparkles aria-hidden="true" size={14} className="mr-1 inline text-dusk-warm" />
            {stepCopy[activeStep]}
          </p>
        </div>
      ) : null}
    </main>
  )
}
