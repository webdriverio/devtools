import { createContext } from '@lit/context'
import { type TraceLog } from '@devtools/hook/types'

const contextKey = Symbol('contextKey')
export const context = createContext<TraceLog>(contextKey)
export { type TraceLog }
