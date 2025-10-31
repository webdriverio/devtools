import type { Collector } from './collector.js'

const consoleMethods = ['log', 'info', 'warn', 'error'] as const
export interface ConsoleLogs {
  type: 'log' | 'info' | 'warn' | 'error'
  args: any[]
  timestamp: number
}

export class ConsoleLogCollector implements Collector<ConsoleLogs> {
  #logs: ConsoleLogs[] = []
  constructor() {
    consoleMethods.forEach(this.#consolePatch.bind(this))
  }

  getArtifacts() {
    return this.#logs
  }

  clear(): void {
    this.#logs = []
  }

  #consolePatch(type: (typeof consoleMethods)[number]) {
    const orig = console[type]
    console[type] = (...args) => {
      this.#logs.push({
        timestamp: Date.now(),
        type,
        args
      })
      return orig(...args)
    }
  }
}
