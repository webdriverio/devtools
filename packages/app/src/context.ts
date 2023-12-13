import { createContext } from '@lit/context'
import { type TraceLog } from '@wdio/devtools-service/types'

const contextKey = Symbol('contextKey')
export const context = createContext<TraceLog>(contextKey)
export { type TraceLog }
