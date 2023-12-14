import { createContext } from '@lit/context'
import { type TraceLog } from '@wdio/devtools-service/types'

const contextKey = Symbol('contextKey')
export const context = createContext<Partial<TraceLog>>(contextKey)
export { type TraceLog }

const CACHE_ID = 'wdio-trace-cache'

async function fetchData () {
  const hasSocketConnection = await connectSocket()
  if (hasSocketConnection) {
    return
  }

  const cachedTraceFile = loadCachedTraceData()
  if (cachedTraceFile) {
    context.__context__ = cachedTraceFile
  }
}

async function connectSocket () {
  /**
   * expect application to be served from backend
   */
  console.log(`Connecting to ws://${window.location}`)
  const ws = new WebSocket(`ws://${window.location}`)

  if (ws.readyState === WebSocket.CLOSED) {
    return undefined
  }

  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve({})
    ws.onerror = reject
  })
}

function loadCachedTraceData () {
  try {
    const localStorageValue = localStorage.getItem(CACHE_ID)
    return localStorageValue ? JSON.parse(localStorageValue) as TraceLog : undefined
  } catch (e: unknown) {
    console.warn(`Failed to parse cached trace file: ${(e as Error).message}`)
  }
}

export function cacheTraceData (traceLog: TraceLog) {
  localStorage.setItem(CACHE_ID, JSON.stringify(traceLog))
  context.__context__ = traceLog
}

fetchData()
