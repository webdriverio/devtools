// Wire format for the WebSocket bridge between backend (sender) and app
// (receiver). Single source of truth — see CLAUDE.md §2.1 + §2.5.
//
// Every payload the backend pushes via `sendUpstream` has a matching scope
// here, and the generic discriminated-union maps scope → payload shape so
// the receiving side gets exact typing per branch.

import type {
  BaselineClearedWsPayload,
  BaselineSavedWsPayload
} from './baseline.js'
import type { ReplaceCommandWsPayload, TraceLog } from './types.js'

/** Scopes that piggyback the standard {@link TraceLog} payload shape. */
export type TraceScope = keyof TraceLog

/** Scopes that carry their own dedicated payload (defined in shared too). */
export type ControlScope =
  | 'testStopped'
  | 'clearExecutionData'
  | 'replaceCommand'
  | 'baseline:saved'
  | 'baseline:cleared'

export type WsMessageScope = TraceScope | ControlScope

/**
 * Payload broadcast under the `clearExecutionData` scope.
 *
 * Two unrelated events arrive under this one scope, and only the sender can
 * tell them apart: a RUN STARTING because someone pressed Run/Rerun, and a
 * single entry resetting inside a run already in flight (Nightwatch re-emits a
 * cucumber scenario suite that way). `runStart` marks the first, so a receiver
 * never has to infer it from the uid — inferring it from the uid is what made
 * the second rerun of a session keep the first one's console and network rows.
 */
export interface ClearExecutionDataWsPayload {
  uid?: string
  entryType?: 'suite' | 'test'
  clearSuiteTree?: boolean
  runStart?: boolean
}

/** Discriminated-union envelope for every message that crosses the WS. */
export interface SocketMessage<T extends WsMessageScope = WsMessageScope> {
  scope: T
  data: T extends keyof TraceLog
    ? TraceLog[T]
    : T extends 'clearExecutionData'
      ? ClearExecutionDataWsPayload
      : T extends 'replaceCommand'
        ? ReplaceCommandWsPayload
        : T extends 'baseline:saved'
          ? BaselineSavedWsPayload
          : T extends 'baseline:cleared'
            ? BaselineClearedWsPayload
            : unknown
}

/** Payload type for a given WS scope. Inverse of `SocketMessage<T>['data']` —
 *  useful at the SENDER boundary to constrain what callers may pass. */
export type WsPayloadFor<T extends WsMessageScope> = SocketMessage<T>['data']
