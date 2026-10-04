/** The only supported front-end data modes. API mode is the safe default. */
export const isStaticDataMode = import.meta.env.VITE_DATA_MODE === 'static'

export const dataMode = isStaticDataMode ? 'static' : 'api'
