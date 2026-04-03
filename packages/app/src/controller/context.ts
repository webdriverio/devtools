import { createContext } from '@lit/context'
import type { Metadata, CommandLog } from '@wdio/devtools-service/types'
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
