import { createContext } from '@lit/context'
import type {
  Metadata,
  MetadataBySession,
  CommandLog,
  PreservedAttempt,
  TracePlayerFrame
} from '@wdio/devtools-shared'
import type { SuiteStatsFragment } from './types.js'

export const mutationContext = createContext<TraceMutation[]>(
  Symbol('mutationContext')
)
export const logContext = createContext<string[]>(Symbol('logContext'))
export const consoleLogContext = createContext<ConsoleLogs[]>(
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

/** Screenshot filmstrip reconstructed from a trace.zip — populated only in
 *  trace-player mode (`pnpm show-trace`). */
export const framesContext = createContext<TracePlayerFrame[]>(
  Symbol('framesContext')
)
