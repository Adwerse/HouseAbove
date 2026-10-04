import type { InspectionOutcome } from "../lib/types"

/**
 * Small, framework-neutral bridge from /demo keyboard cues to the mounted
 * officer console. Keeping this outside page props makes the normal console
 * and the embedded demo share precisely the same writes and event stream.
 */
export type OfficerDemoCommand =
  | { type: "overview" }
  | { type: "select"; buildingId: string }
  | { type: "ask"; question: string }
  | { type: "inspection"; buildingId: string; outcome: InspectionOutcome }

type Listener = (command: OfficerDemoCommand) => void

const listeners = new Set<Listener>()

export const officerDemoControls = {
  dispatch(command: OfficerDemoCommand) {
    for (const listener of listeners) listener(command)
  },

  subscribe(listener: Listener) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
