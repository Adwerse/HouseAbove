import { create } from 'zustand'

/** VITE_DATA_MODE=static reads exported files instead of the API. */
export const isStaticDataMode = import.meta.env.VITE_DATA_MODE === 'static'

export const dataMode = isStaticDataMode ? 'static' : 'api'

/**
 * Where the data on screen comes from. "live": the API. "static": exported files.
 * "demo": the API could not be reached, so the bundled demo dataset is shown and
 * the UI says so.
 */
export type DataSource = 'live' | 'static' | 'demo'

export const useDataSource = create<{ source: DataSource }>(() => ({
  source: isStaticDataMode ? 'static' : 'live',
}))

let unavailable = false

export function isLocalData() {
  return isStaticDataMode || unavailable
}

export function markApiUnavailable() {
  if (unavailable || isStaticDataMode) return
  unavailable = true
  useDataSource.setState({ source: 'demo' })
}
