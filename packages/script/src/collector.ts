import { getLogs, clearLogs } from './logger.js'
import { ConsoleLogCollector } from './collectors/consoleLogs.js'
import { NetworkRequestCollector } from './collectors/networkRequests.js'

class DataCollector {
  #metadata = {
    url: window.location.href,
    viewport: window.visualViewport!
  }
  #errors: string[] = []
  #mutations: TraceMutation[] = []
  #consoleLogs = new ConsoleLogCollector()
  #networkRequests = new NetworkRequestCollector()

  captureError(err: Error) {
    const error = err.stack || err.message
    this.#errors.push(error)
  }

  captureMutation(mutations: TraceMutation[]) {
    this.#mutations.push(...mutations)
  }

  reset() {
    this.#errors = []
    this.#mutations = []
    this.#consoleLogs.clear()
    this.#networkRequests.clear()
    clearLogs()
  }

  getMetadata() {
    return this.#metadata
  }

  getTraceData() {
    const data = {
      errors: this.#errors,
      mutations: this.#mutations,
      consoleLogs: this.#consoleLogs.getArtifacts(),
      networkRequests: this.#networkRequests.getArtifacts(),
      traceLogs: getLogs(),
      metadata: this.getMetadata()
    } as const
    this.reset()
    return data
  }
}

export type DataCollectorType = DataCollector
export const collector = (window.wdioTraceCollector = new DataCollector())
