import { createContext } from '@lit/context'
import type {
  ConsoleLog,
  Metadata,
  MetadataBySession,
  CommandLog,
  ImageSize,
  NetworkRequest,
  PreservedAttempt,
  TraceActionChild,
  TracePlayerFrame
} from '@wdio/devtools-shared'
import type { TraceEntries } from './trace-entries.js'
import type { SuiteStatsFragment } from './types.js'

export const mutationContext = createContext<TraceMutation[]>(
  Symbol('mutationContext')
)
export const logContext = createContext<string[]>(Symbol('logContext'))
export const consoleLogContext = createContext<ConsoleLog[]>(
  Symbol('consoleLogContext')
)
export const networkRequestContext = createContext<NetworkRequest[]>(
  Symbol('networkRequestContext')
)
export const metadataContext = createContext<Metadata>(
  Symbol('metadataContext')
)
export const metadataBySessionContext = createContext<MetadataBySession>(
  Symbol('metadataBySessionContext')
)
export const commandContext = createContext<CommandLog[]>(
  Symbol('commandContext')
)
export const sourceContext = createContext<Record<string, string>>(
  Symbol('sourceContext')
)
export const suiteContext = createContext<Record<string, SuiteStatsFragment>[]>(
  Symbol('suiteContext')
)
export const hasConnectionContext = createContext<boolean>(
  Symbol('hasConnection')
)
export const activeRerunContext = createContext<string | undefined>(
  Symbol('activeRerunContext')
)
export const baselineContext = createContext<Map<string, PreservedAttempt>>(
  Symbol('baselineContext')
)
export const selectedTestUidContext = createContext<string | undefined>(
  Symbol('selectedTestUidContext')
)

/** Screenshot filmstrip reconstructed from a trace.zip, each frame named by
 *  its entry in `playerArchiveContext`; populated only in player mode. */
export const framesContext = createContext<TracePlayerFrame[]>(
  Symbol('framesContext')
)

/** The loaded trace's zip, whose images and stored bodies are read as they are shown; player mode only. */
export interface PlayerArchive {
  entries: TraceEntries
  /** The first frame's pixel size, known before any image is read. */
  frameSize?: ImageSize
  /** The largest frame's length in bytes, which bounds how many frame images the filmstrip holds. */
  frameBytes?: number
  /** Request id to the entry holding its response body. */
  responseBodies: Record<string, string>
}

export const playerArchiveContext = createContext<PlayerArchive | undefined>(
  Symbol('playerArchiveContext')
)

/** Root children of the trace player's action tree — populated only in player
 *  mode when the zip carried structural steps; absent means flat list. */
export const actionGroupsContext = createContext<
  TraceActionChild[] | undefined
>(Symbol('actionGroupsContext'))

/** Markdown run transcript from a loaded trace (`transcript.md`); undefined in
 *  live mode or when the zip carried none. */
export const transcriptContext = createContext<string | undefined>(
  Symbol('transcriptContext')
)
