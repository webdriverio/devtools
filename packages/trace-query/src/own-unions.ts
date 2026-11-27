import type {
  LogLevel,
  LogSource,
  NetworkCaptureSource,
  RequestType,
  StatusKind
} from '@wdio/devtools-shared'
import type {
  ConsoleLevel,
  ConsoleSource,
  NetworkSource,
  RequestStatusKind,
  RequestType as OwnRequestType
} from './types.js'

// Each table is typed both ways, so a member added to either shared's union or this package's restatement fails to compile.
type Both<Shared extends string, Own extends string> = Record<Shared, Own> &
  Record<Own, Shared>

const LEVELS: Both<LogLevel, ConsoleLevel> = {
  trace: 'trace',
  debug: 'debug',
  log: 'log',
  info: 'info',
  warn: 'warn',
  error: 'error'
}

const SOURCES: Both<LogSource, ConsoleSource> = {
  browser: 'browser',
  test: 'test',
  terminal: 'terminal'
}

const STATUS_KINDS: Both<StatusKind, RequestStatusKind> = {
  ok: 'ok',
  redirect: 'redirect',
  error: 'error',
  pending: 'pending',
  unknown: 'unknown'
}

const REQUEST_TYPES: Both<RequestType, OwnRequestType> = {
  document: 'document',
  stylesheet: 'stylesheet',
  script: 'script',
  image: 'image',
  font: 'font',
  fetch: 'fetch',
  xhr: 'xhr',
  other: 'other'
}

const NETWORK_SOURCES: Both<NetworkCaptureSource, NetworkSource> = {
  'resource-timing': 'resource-timing'
}

export const ownLevel = (level: LogLevel): ConsoleLevel => LEVELS[level]
/** A foreign zip can name any source, so one outside the vocabulary reads as none. */
export const ownSource = (source: string): ConsoleSource | undefined =>
  Object.prototype.hasOwnProperty.call(SOURCES, source)
    ? SOURCES[source as LogSource]
    : undefined
export const ownStatusKind = (kind: StatusKind): RequestStatusKind =>
  STATUS_KINDS[kind]
export const ownRequestType = (type: RequestType): OwnRequestType =>
  REQUEST_TYPES[type]
export const ownNetworkSource = (source: NetworkCaptureSource): NetworkSource =>
  NETWORK_SOURCES[source]
