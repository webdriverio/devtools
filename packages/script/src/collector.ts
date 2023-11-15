import { getLogs, clearLogs } from './logger.js'

const consoleMethods = ['log', 'info', 'warn', 'error'] as const

class DataCollector {
  #metadata = {
    url: window.location.href,
    viewport: window.visualViewport!
  }
  #errors: string[] = []
  #mutations: TraceMutation[] = []
  #consoleLogs: ConsoleLogs[] = []

  constructor () {
    consoleMethods.forEach(this.#consolePatch.bind(this))
  }

  captureError (err: Error) {
    const error = err.stack || err.message
    this.#errors.push(error)
  }

  captureMutation (mutations: TraceMutation[]) {
    this.#mutations.push(...mutations)
  }

  reset () {
    this.#errors = []
    this.#mutations = []
    this.#consoleLogs = []
    clearLogs()
  }

  getTraceData () {
    const data = {
      errors: this.#errors,
      mutations: this.#mutations,
      consoleLogs: this.#consoleLogs,
      traceLogs: getLogs(),
      metadata: this.#metadata
    } as const
    this.reset()
    return data
  }

  #consolePatch (type: (typeof consoleMethods)[number]) {
    const orig = console[type]
    console[type] = (...args) => {
      this.#consoleLogs.push({
        timestamp: Date.now(),
        type,
        args
      })
      return orig(...args)
    }
  }
}

export type DataCollectorType = DataCollector
export const collector = window.wdioTraceCollector = new DataCollector()
