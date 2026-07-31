/**
 * Guards the ambient type surface the app relies on. A bad `import('…').X`
 * reference in `vite-env.d.ts` (a name the target module doesn't export) does
 * not fail the build — TypeScript silently degrades it to `any`, so every
 * listener on that event loses its checking. `app-test-run`/`app-test-stop`
 * pointed at `sidebar/test-suite`, which only re-imports `TestRunDetail`
 * without exporting it; both details were `any`.
 *
 * The `expectTypeOf` assertions below are compile-time only (this file is in
 * `packages/app/tsconfig.json`, so `tsc --noEmit` enforces them); the runtime
 * `expect`s pin the console filter to shared's canonical `ConsoleLog`.
 */

import { describe, expect, expectTypeOf, it } from 'vitest'
import type { ConsoleLog, LogLevel } from '@wdio/devtools-shared'
import {
  filterConsoleLogs,
  type ConsoleLevelFilter
} from '../src/components/workbench/console-filter.js'
import type { TestRunDetail } from '../src/components/sidebar/types.js'

describe('vite-env.d.ts event-map references', () => {
  it('resolves app-test-run detail to the canonical TestRunDetail', () => {
    type Detail = GlobalEventHandlersEventMap['app-test-run']['detail']
    expectTypeOf<Detail>().not.toBeAny()
    expectTypeOf<Detail>().toEqualTypeOf<TestRunDetail>()
  })

  it('resolves app-test-stop detail to the canonical TestRunDetail', () => {
    type Detail = GlobalEventHandlersEventMap['app-test-stop']['detail']
    expectTypeOf<Detail>().not.toBeAny()
    expectTypeOf<Detail>().toEqualTypeOf<TestRunDetail>()
  })

  it('keeps the other declared event details checked', () => {
    expectTypeOf<
      GlobalEventHandlersEventMap['app-status-filter']['detail']
    >().not.toBeAny()
    expectTypeOf<
      GlobalEventHandlersEventMap['app-mutation-select']['detail']
    >().not.toBeAny()
    expectTypeOf<
      GlobalEventHandlersEventMap['show-command']['detail']['command']
    >().not.toBeAny()
  })
})

describe('console filtering is typed against shared ConsoleLog', () => {
  it('takes and returns the canonical shared type, not `any`', () => {
    expectTypeOf(filterConsoleLogs).parameter(0).not.toBeAny()
    expectTypeOf(filterConsoleLogs).parameter(0).toEqualTypeOf<ConsoleLog[]>()
    expectTypeOf(filterConsoleLogs).returns.toEqualTypeOf<ConsoleLog[]>()
  })

  it('derives the level filter from shared LogLevel', () => {
    expectTypeOf<ConsoleLevelFilter>().toEqualTypeOf<'all' | LogLevel>()
  })

  it('filters canonical ConsoleLog entries by level and search', () => {
    const logs: ConsoleLog[] = [
      { type: 'log', args: ['hello world'], timestamp: 1, source: 'browser' },
      { type: 'error', args: ['boom'], timestamp: 2, source: 'test' },
      { type: 'warn', args: ['deprecated'], timestamp: 3, source: 'terminal' }
    ]

    expect(filterConsoleLogs(logs, 'all', '')).toHaveLength(3)
    expect(filterConsoleLogs(logs, 'error', '')).toEqual([logs[1]])
    expect(filterConsoleLogs(logs, 'all', 'WORLD')).toEqual([logs[0]])
    expect(filterConsoleLogs(logs, 'warn', 'boom')).toEqual([])
  })

  it('preserves the source field the console badge reads', () => {
    const logs: ConsoleLog[] = [
      { type: 'log', args: ['a'], timestamp: 1, source: 'terminal' }
    ]
    expect(filterConsoleLogs(logs, 'all', '')[0]?.source).toBe('terminal')
  })
})
