import { create } from 'zustand'

/**
 * A one-shot camera instruction. `version` is monotonically increasing so a
 * second request for the same building remains observable to the map.
 */
export type FlyToRequest = Readonly<{
  buildingId: string
  version: number
}>

type FlyToListener = (request: FlyToRequest | null) => void

export type CityMapCameraState = {
  /** The latest instruction for a mounted CityMap to consume. */
  flyToRequest: FlyToRequest | null
  /** Kept after a request is cleared so versions never repeat in a session. */
  requestVersion: number
  /** Queue a fly-to instruction and return its version for safe acknowledgement. */
  requestFlyTo: (buildingId: string) => FlyToRequest
  /**
   * Acknowledge the active request. Supplying its version prevents an older
   * map effect from clearing a newer request that arrived while it was flying.
   */
  clearFlyTo: (version?: number) => boolean
}

/**
 * Shared camera command state for officer controls, the agent panel, and demo
 * keyboard shortcuts. Components may select from this hook; non-React callers
 * can use the `cityMapCamera` facade below.
 */
export const useCityMapCameraStore = create<CityMapCameraState>((set, get) => ({
  flyToRequest: null,
  requestVersion: 0,
  requestFlyTo: (buildingId) => {
    const version = get().requestVersion + 1
    const request: FlyToRequest = { buildingId, version }

    set({ requestVersion: version, flyToRequest: request })
    return request
  },
  clearFlyTo: (version) => {
    const activeRequest = get().flyToRequest
    if (!activeRequest || (version !== undefined && activeRequest.version !== version)) {
      return false
    }

    set({ flyToRequest: null })
    return true
  },
}))

/**
 * Imperative companion to the hook. It is safe to import from event handlers,
 * streamed agent responses, or keyboard listeners without mounting React.
 */
export const cityMapCamera = {
  flyTo(buildingId: string): FlyToRequest {
    return useCityMapCameraStore.getState().requestFlyTo(buildingId)
  },

  clear(version?: number): boolean {
    return useCityMapCameraStore.getState().clearFlyTo(version)
  },

  /**
   * Subscribe only to camera-command changes and return Zustand's unsubscribe
   * function. `emitCurrent` is useful when a map mounts after a command.
   */
  subscribe(listener: FlyToListener, options: { emitCurrent?: boolean } = {}): () => void {
    let previousRequest = useCityMapCameraStore.getState().flyToRequest
    const unsubscribe = useCityMapCameraStore.subscribe((state) => {
      if (state.flyToRequest === previousRequest) return

      previousRequest = state.flyToRequest
      listener(previousRequest)
    })

    // Subscribe first: an immediate listener can itself issue a camera command
    // without creating a gap in which that command would be missed.
    if (options.emitCurrent) {
      listener(previousRequest)
    }

    return unsubscribe
  },
}
