import { describe, it, expect } from 'vitest'
import {
  buildGroupPath,
  filterTestMetadataByUid,
  stepMetadataUid
} from '@wdio/devtools-core'
import type { CommandLog, TestMetadataMap } from '@wdio/devtools-shared'

function cmd(overrides: Partial<CommandLog> = {}): CommandLog {
  return { command: 'click', args: ['#go'], timestamp: 1, ...overrides }
}

describe('buildGroupPath', () => {
  it('is empty when the command has no testUid', () => {
    expect(buildGroupPath(cmd())).toEqual([])
  })

  it('is a single node (the test) when there is no ancestry or step', () => {
    const meta: TestMetadataMap = new Map([
      ['t1', { title: 'logs in', specFile: 'a.js' }]
    ])
    expect(buildGroupPath(cmd({ testUid: 't1' }), meta)).toEqual([
      { uid: 't1', title: 'logs in' }
    ])
  })

  it('prepends the ancestry chain outermost-first', () => {
    const meta: TestMetadataMap = new Map([
      [
        't1',
        {
          title: 'valid login',
          specFile: 'login.feature',
          ancestry: [
            { uid: 'f1', title: 'Feature: Login', kind: 'feature' },
            { uid: 's1', title: 'Scenario: valid', kind: 'scenario' }
          ]
        }
      ]
    ])
    expect(buildGroupPath(cmd({ testUid: 't1' }), meta)).toEqual([
      { uid: 'f1', title: 'Feature: Login' },
      { uid: 's1', title: 'Scenario: valid' },
      { uid: 't1', title: 'valid login' }
    ])
  })

  it('appends the step below the test when stepUid is set', () => {
    const meta: TestMetadataMap = new Map([
      ['sc1', { title: 'Scenario', specFile: 'x.feature' }],
      ['st1', { title: 'When I log in', specFile: 'x.feature' }]
    ])
    expect(
      buildGroupPath(cmd({ testUid: 'sc1', stepUid: 'st1' }), meta)
    ).toEqual([
      { uid: 'sc1', title: 'Scenario' },
      { uid: 'st1', title: 'When I log in' }
    ])
  })

  it('falls back to the raw uid when a title is missing', () => {
    expect(buildGroupPath(cmd({ testUid: 'sc1', stepUid: 'st1' }))).toEqual([
      { uid: 'sc1', title: 'sc1' },
      { uid: 'st1', title: 'st1' }
    ])
  })

  // The chain a per-test trace slice actually goes through. Asserted end to end
  // because the two halves were individually defensible — the filter narrowed to
  // one test, the path fell back to the uid — and only their composition showed
  // the defect: every Gherkin step rendered as `stable-…:step:1` in the viewer.
  it('names steps from a per-test-filtered metadata map', () => {
    const all: TestMetadataMap = new Map([
      ['sc1', { title: 'Scenario', specFile: '/login.feature' }],
      [
        stepMetadataUid('sc1', 1),
        { title: 'When I log in', specFile: '/login.feature' }
      ],
      ['sc2', { title: 'Other', specFile: '/login.feature' }]
    ])
    const sliceMeta = filterTestMetadataByUid(all, 'sc1')
    expect(
      buildGroupPath(
        cmd({ testUid: 'sc1', stepUid: stepMetadataUid('sc1', 1) }),
        sliceMeta
      )
    ).toEqual([
      { uid: 'sc1', title: 'Scenario' },
      { uid: stepMetadataUid('sc1', 1), title: 'When I log in' }
    ])
  })
})

// Some runners report a test's FULL title (`<suite> <test>`), so nesting it
// under its own suite group rendered the suite name twice in the Actions tree.
describe('buildGroupPath duplicate titles', () => {
  const meta = (entries: Record<string, unknown>) =>
    new Map(Object.entries(entries)) as never

  it('strips an enclosing group name from the nested title', () => {
    const path = buildGroupPath(
      { command: 'click', args: [], timestamp: 0, testUid: 't1' } as never,
      meta({
        t1: {
          title: 'smoke test logs in with valid credentials',
          specFile: 'a.js',
          ancestry: [{ uid: 's1', title: 'smoke test' }]
        }
      })
    )
    expect(path.map((n) => n.title)).toEqual([
      'smoke test',
      'logs in with valid credentials'
    ])
  })

  it('leaves an already-short title alone', () => {
    const path = buildGroupPath(
      { command: 'click', args: [], timestamp: 0, testUid: 't1' } as never,
      meta({
        t1: {
          title: 'logs in',
          specFile: 'a.js',
          ancestry: [{ uid: 's1', title: 'smoke test' }]
        }
      })
    )
    expect(path.map((n) => n.title)).toEqual(['smoke test', 'logs in'])
  })

  it('keeps the full title when stripping would leave nothing', () => {
    const path = buildGroupPath(
      { command: 'click', args: [], timestamp: 0, testUid: 't1' } as never,
      meta({
        t1: {
          title: 'smoke test',
          specFile: 'a.js',
          ancestry: [{ uid: 's1', title: 'smoke test' }]
        }
      })
    )
    expect(path.map((n) => n.title)).toEqual(['smoke test', 'smoke test'])
  })
})
