import type { PreservedAttempt } from './types.js'

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

// ─── HTTP request/response contracts ────────────────────────────────────────

/** POST /api/baseline/preserve body. */
export interface BaselinePreserveRequest {
  testUid: string
  scope: 'test' | 'suite'
}

/** 200 response from /api/baseline/preserve. */
export interface BaselinePreserveResponse {
  ok: true
  attempt: PreservedAttempt
}

/** POST /api/baseline/clear body. */
export interface BaselineClearRequest {
  testUid: string
}

/** 200 response from /api/baseline/clear. */
export interface BaselineClearResponse {
  ok: true
  removed: boolean
}

/** URL params for GET /api/baseline/:testUid. */
export interface BaselineGetParams {
  testUid: string
}

/** Querystring for GET /api/baseline/:testUid. */
export interface BaselineGetQuery {
  scope?: 'test' | 'suite'
}

/** Response from GET /api/baseline/:testUid. */
export interface BaselineGetResponse {
  baseline: PreservedAttempt | undefined
  latest: PreservedAttempt | undefined
}

/** 4xx response shape from any baseline endpoint. */
export interface BaselineErrorResponse {
  error: string
}

// ─── WebSocket broadcast payloads ───────────────────────────────────────────

/** Payload broadcast under BASELINE_WS_SCOPE.saved. */
export interface BaselineSavedWsPayload {
  testUid: string
  attempt: PreservedAttempt
}

/** Payload broadcast under BASELINE_WS_SCOPE.cleared. */
export interface BaselineClearedWsPayload {
  testUid: string
}
