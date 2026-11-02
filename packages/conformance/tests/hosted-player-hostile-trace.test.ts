import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { TracePlayerData } from '@wdio/devtools-shared'
import { parseTraceZip } from '@wdio/devtools-trace/trace-reader'

import {
  HOSTILE_TRACE_TITLES,
  writeHostileTrace
} from '../hosted-player/hostile-trace.js'

let dir: string
let parsed: TracePlayerData

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-hostile-'))
  const zip = await writeHostileTrace(dir)
  parsed = parseTraceZip(new Uint8Array(fs.readFileSync(zip)))
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

// The reader passes a recorded page through untouched, so what the hosted check proves is the player's own defence.
describe('the hostile trace the hosted check opens', () => {
  it('reads back with its action rows', () => {
    const titles = parsed.trace.commands.map(({ command }) => command)

    expect(titles).toEqual(['url', 'click'])
    expect(HOSTILE_TRACE_TITLES).toHaveLength(2)
  })

  it('still carries every script path into the player', () => {
    const stream = JSON.stringify(parsed.trace.mutations)

    expect(stream).toContain('"onload"')
    expect(stream).toContain('javascript:')
    expect(stream).toContain('"script"')
    expect(
      parsed.trace.mutations.some(
        (m) => m.type === 'attributes' && m.attributeName === 'onload'
      )
    ).toBe(true)
  })
})
