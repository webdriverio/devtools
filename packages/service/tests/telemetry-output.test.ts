import { describe, expect, it } from 'vitest'
import DevToolsHookService from '../src/index.js'

describe('service console and stdout capture per mode', () => {
  it('leaves console and stdout unpatched in telemetry mode', () => {
    const write = process.stdout.write
    const log = console.log
    new DevToolsHookService({ mode: 'telemetry' })
    expect([process.stdout.write, console.log]).toEqual([write, log])
  })

  it('patches them in trace mode, which reads them into the trace', () => {
    const write = process.stdout.write
    const log = console.log
    new DevToolsHookService({ mode: 'trace' })
    const patched = process.stdout.write !== write && console.log !== log
    process.stdout.write = write
    console.log = log
    expect(patched).toBe(true)
  })
})
