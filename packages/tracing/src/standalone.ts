import fs from 'node:fs/promises'
import path from 'node:path'
import { TraceRecorder } from './recorder.js'
import type { TraceRecorderOptions } from './recorder.js'
import { registerOverwrites } from './register-overwrites.js'

export interface TracingHandle {
  recorder: TraceRecorder
  stop(): Promise<void>
}

export function startTracing(
  browser: WebdriverIO.Browser,
  options?: TraceRecorderOptions
): TracingHandle {
  const recorder = new TraceRecorder(browser, options)
  recorder.start()
  registerOverwrites(browser, recorder)

  return {
    recorder,
    async stop() {
      const zip = await recorder.stop()
      const outputDir = options?.outputDir ?? process.cwd()
      await fs.mkdir(outputDir, { recursive: true })
      await fs.writeFile(path.join(outputDir, `trace-${Date.now()}.zip`), zip)
    }
  }
}
