import {
  TraceType,
  type CommandLog,
  type TracePlayerData
} from '@wdio/devtools-shared'
import { describe, expect, it } from 'vitest'
import { captureSource, snapshotSourceOf } from '../src/capture-source.js'

const NAVIGATE: CommandLog = {
  command: 'url',
  title: `Page.navigate("/${'x'.repeat(300)}")`,
  args: [],
  callId: 'call@1',
  timestamp: 1200
}
const READ: CommandLog = {
  command: 'getText',
  args: [],
  callId: 'call@2',
  timestamp: 1300
}

const DATA: TracePlayerData = {
  trace: {
    mutations: [],
    logs: [],
    consoleLogs: [],
    networkRequests: [],
    metadata: { type: TraceType.Standalone },
    commands: [NAVIGATE, READ],
    sources: {},
    suites: []
  },
  frames: [],
  startTime: 1000,
  duration: 300,
  snapshotSources: {
    'call@1': { timestamp: 1200, ownerCallId: 'call@1' },
    'call@2': { timestamp: 1200, ownerCallId: 'call@1' }
  }
}

describe('captureSource', () => {
  it('names the owner, its title cut, and says the capture is its own', () => {
    const source = captureSource(DATA, 'call@1', 1200, 'call@1')
    expect(source).toMatchObject({ timeMs: 200, callId: 'call@1', own: true })
    expect(source.title).toMatch(/^Page\.navigate\("\/x+… \(cut, 318 chars\)$/)
    expect(source.title!.length).toBeLessThanOrEqual(100)
  })

  it("says an action showing an earlier action's capture is not its owner", () => {
    expect(captureSource(DATA, 'call@2', 1200, 'call@1')).toMatchObject({
      callId: 'call@1',
      own: false
    })
  })

  it('credits a screencast frame to no action', () => {
    expect(captureSource(DATA, 'call@2', 1250)).toEqual({
      timeMs: 250,
      own: false
    })
  })
})

describe('snapshotSourceOf', () => {
  it('reads the capture the reader recorded for an action', () => {
    expect(snapshotSourceOf(DATA, 'call@2')).toEqual({
      timestamp: 1200,
      ownerCallId: 'call@1'
    })
  })

  it.each(['__proto__', 'toString', 'call@9'])(
    'finds nothing for %s, which no action recorded',
    (callId) => {
      expect(snapshotSourceOf(DATA, callId)).toBeUndefined()
    }
  )
})
