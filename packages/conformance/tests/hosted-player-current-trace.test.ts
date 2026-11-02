import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { TracePlayerData } from '@wdio/devtools-shared'
import { parseTraceZip } from '@wdio/devtools-trace/trace-reader'

import {
  CURRENT_TRACE_TITLES,
  writeCurrentTrace
} from '../hosted-player/current-trace.js'

let dir: string
let parsed: TracePlayerData

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-current-'))
  const zip = await writeCurrentTrace(dir)
  parsed = parseTraceZip(new Uint8Array(fs.readFileSync(zip)))
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('the trace the hosted check writes with the current writer', () => {
  it('reads back with the titles the check expects as action rows', () => {
    expect(
      parsed.trace.commands.map((command) => command.title).sort()
    ).toEqual(CURRENT_TRACE_TITLES)
  })

  it('nests the read under the wait that issued it', () => {
    const wait = parsed.trace.commands.find(
      (command) => command.title === 'Browser.waitForFunction()'
    )
    const read = parsed.trace.commands.find(
      (command) => command.title === 'Page.getTitle()'
    )
    expect(read?.parentId).toBeDefined()
    expect(read?.parentId).toBe(wait?.id)
  })

  it('carries filmstrip frames', () => {
    expect(parsed.frames.length).toBeGreaterThan(1)
  })
})
