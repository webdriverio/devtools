import { createContext, ContextProvider } from '@lit/context'
import type { ReactiveController, ReactiveControllerHost } from 'lit'
import type {
  Metadata,
  CommandLog,
  TraceLog
} from '@wdio/devtools-service/types'

const CACHE_ID = 'wdio-trace-cache'

export const mutationContext = createContext<TraceMutation[]>(
  Symbol('mutationContext')
)
export const logContext = createContext<string[]>(Symbol('logContext'))
export const consoleLogContext = createContext<ConsoleLogs[]>(
  Symbol('consoleLogContext')
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
export const suiteContext = createContext<Record<string, any>[]>(
  Symbol('suiteContext')
)

const hasConnection = createContext<boolean>(Symbol('hasConnection'))

interface SocketMessage<T extends keyof TraceLog = keyof TraceLog> {
  scope: T
  data: TraceLog[T]
}

export class DataManagerController implements ReactiveController {
  #ws?: WebSocket
  #host: ReactiveControllerHost & HTMLElement

  mutationsContextProvider: ContextProvider<typeof mutationContext>
  logsContextProvider: ContextProvider<typeof logContext>
  consoleLogsContextProvider: ContextProvider<typeof consoleLogContext>
  metadataContextProvider: ContextProvider<typeof metadataContext>
  commandsContextProvider: ContextProvider<typeof commandContext>
  sourcesContextProvider: ContextProvider<typeof sourceContext>
  suitesContextProvider: ContextProvider<typeof suiteContext>

  hasConnectionProvider: ContextProvider<typeof hasConnection>

  constructor(host: ReactiveControllerHost & HTMLElement) {
    ;(this.#host = host).addController(this)
    this.mutationsContextProvider = new ContextProvider(this.#host, {
      context: mutationContext,
      initialValue: []
    })
    this.logsContextProvider = new ContextProvider(this.#host, {
      context: logContext,
      initialValue: []
    })
    this.consoleLogsContextProvider = new ContextProvider(this.#host, {
      context: consoleLogContext,
      initialValue: []
    })
    this.metadataContextProvider = new ContextProvider(this.#host, {
      context: metadataContext
    })
    this.commandsContextProvider = new ContextProvider(this.#host, {
      context: commandContext,
      initialValue: []
    })
    this.sourcesContextProvider = new ContextProvider(this.#host, {
      context: sourceContext
    })
    this.suitesContextProvider = new ContextProvider(this.#host, {
      context: suiteContext
    })
    this.hasConnectionProvider = new ContextProvider(this.#host, {
      context: hasConnection,
      initialValue: false
    })
  }

  get hasConnection() {
    return this.hasConnectionProvider.value
  }

  get traceType() {
    return this.metadataContextProvider.value?.type
  }

  /**
   * connect to backend to receive data
   */
  hostConnected() {
    /**
     * expect application to be served from backend
     */
    const wsUrl = `ws://${window.location.host}/client`
    console.log(`Connecting to ${wsUrl}`)
    const ws = (this.#ws = new WebSocket(wsUrl))

    /**
     * if a connection to the backend is established we can
     * start fetching data
     */
    ws.addEventListener('open', () => {
      this.hasConnectionProvider.setValue(true)
      ws.addEventListener('message', this.#handleSocketMessage.bind(this))
      return this.#host.requestUpdate()
    })

    /**
     * otherwise attempt to load cached trace file
     */
    ws.addEventListener('error', () => {
      try {
        const localStorageValue = JSON.parse(
          localStorage.getItem(CACHE_ID) || ''
        ) as TraceLog
        this.loadTraceFile(localStorageValue)
      } catch (e: unknown) {
        console.warn(
          `Failed to parse cached trace file: ${(e as Error).message}`
        )
      }
    })
  }

  hostDisconnected() {
    if (this.#ws) {
      return this.#ws.close()
    }
  }

  #handleSocketMessage(event: MessageEvent) {
    try {
      const { scope, data } = JSON.parse(event.data) as SocketMessage
      if (!data) {
        return
      }

      if (scope === 'mutations') {
        this.mutationsContextProvider.setValue([
          ...this.mutationsContextProvider.value,
          ...(data as TraceMutation[])
        ])
      } else if (scope === 'commands') {
        this.commandsContextProvider.setValue([
          ...this.commandsContextProvider.value,
          ...(data as CommandLog[])
        ])
      } else if (scope === 'metadata') {
        this.metadataContextProvider.setValue({
          ...this.metadataContextProvider.value,
          ...(data as Metadata)
        })
      } else if (scope === 'consoleLogs') {
        this.consoleLogsContextProvider.setValue([
          ...this.consoleLogsContextProvider.value,
          ...(data as string[])
        ])
      } else if (scope === 'sources') {
        const merged = {
          ...(this.sourcesContextProvider.value || {}),
          ...(data as Record<string, string>)
        }
        this.sourcesContextProvider.setValue(merged)
        console.debug('Merged sources keys', Object.keys(merged))
      } else {
        const providerMap = {
          mutations: this.mutationsContextProvider,
          logs: this.logsContextProvider,
          consoleLogs: this.consoleLogsContextProvider,
          metadata: this.metadataContextProvider,
          commands: this.commandsContextProvider,
          sources: this.sourcesContextProvider,
          suites: this.suitesContextProvider
        } as const
        const provider = providerMap[scope as keyof typeof providerMap]
        if (provider) {
          provider.setValue(data as any)
        }
      }

      this.#host.requestUpdate()
    } catch (e: unknown) {
      console.warn(`Failed to parse socket message: ${(e as Error).message}`)
    }
  }

  loadTraceFile(traceFile: TraceLog) {
    localStorage.setItem(CACHE_ID, JSON.stringify(traceFile))
    this.mutationsContextProvider.setValue(traceFile.mutations)
    this.logsContextProvider.setValue(traceFile.logs)
    this.consoleLogsContextProvider.setValue(traceFile.consoleLogs)
    this.metadataContextProvider.setValue(traceFile.metadata)
    this.commandsContextProvider.setValue(traceFile.commands)
    this.sourcesContextProvider.setValue(traceFile.sources)
    this.suitesContextProvider.setValue(traceFile.suites || [])
  }
}

/**
 * re-export types used for context
 */
export { type Metadata, type CommandLog, type TraceLog, type TraceMutation }
