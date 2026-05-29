export const BASELINE_API = {
  preserve: '/api/baseline/preserve',
  clear: '/api/baseline/clear',
  get: '/api/baseline/:testUid'
} as const

export const BASELINE_WS_SCOPE = {
  saved: 'baseline:saved',
  cleared: 'baseline:cleared'
} as const

export type BaselineWsScope =
  (typeof BASELINE_WS_SCOPE)[keyof typeof BASELINE_WS_SCOPE]
