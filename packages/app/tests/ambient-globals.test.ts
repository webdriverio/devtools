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
import type { ContextType } from '@lit/context'
// Aliased so the bare `NetworkRequest` below still resolves to the ambient
// global under test rather than to this import.
import type {
  ConsoleLog,
  LogLevel,
  LogSource,
  NetworkRequest as SharedNetworkRequest
} from '@wdio/devtools-shared'
import {
  filterConsoleLogs,
  type ConsoleLevelFilter
} from '../src/components/workbench/console-filter.js'
import type { TestRunDetail } from '../src/components/sidebar/types.js'
import type {
  consoleLogContext,
  networkRequestContext
} from '../src/controller/context.js'
// Type-only: `constants.ts` reads `window` at module scope, so importing its
// value would drag happy-dom in for an assertion that is compile-time anyway.
import type { CONSOLE_SOURCE_BADGE } from '../src/controller/constants.js'
import { getResourceType, contentType } from '../src/utils/network-helpers.js'

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

/**
 * The same silent-`any` failure mode as above, one file over: `script/types.d.ts`
 * aliased `ConsoleLogs` to a name `collectors/consoleLogs.ts` never exported and
 * declared `type NetworkRequest = NetworkRequest` (self-circular). Both degraded
 * to `any` for every app consumer, and `skipLibCheck` hid the two errors.
 */
describe('script/types.d.ts ambient globals', () => {
  it('resolves ConsoleLogs to shared ConsoleLog, not `any`', () => {
    expectTypeOf<ConsoleLogs>().not.toBeAny()
    expectTypeOf<ConsoleLogs>().toEqualTypeOf<ConsoleLog>()
  })

  it('resolves NetworkRequest to shared NetworkRequest, not `any`', () => {
    expectTypeOf<NetworkRequest>().not.toBeAny()
    expectTypeOf<NetworkRequest>().toEqualTypeOf<SharedNetworkRequest>()
  })
})

describe('network/console contexts carry the canonical shared types', () => {
  it('types consoleLogContext as ConsoleLog[]', () => {
    type Value = ContextType<typeof consoleLogContext>
    expectTypeOf<Value>().not.toBeAny()
    expectTypeOf<Value>().toEqualTypeOf<ConsoleLog[]>()
  })

  it('types networkRequestContext as NetworkRequest[]', () => {
    type Value = ContextType<typeof networkRequestContext>
    expectTypeOf<Value>().not.toBeAny()
    expectTypeOf<Value>().toEqualTypeOf<SharedNetworkRequest[]>()
  })

  it('keys the console source badge off shared LogSource', () => {
    expectTypeOf<typeof CONSOLE_SOURCE_BADGE>().not.toBeAny()
    expectTypeOf<keyof typeof CONSOLE_SOURCE_BADGE>().toEqualTypeOf<LogSource>()
  })
})

describe('network helpers accept the canonical NetworkRequest', () => {
  const request: SharedNetworkRequest = {
    id: 'r1',
    url: 'https://example.com/app.js',
    method: 'GET',
    type: 'script',
    timestamp: 1,
    startTime: 1,
    responseHeaders: { 'content-type': 'application/javascript; charset=utf-8' }
  }

  it('is typed against shared, not `any`', () => {
    expectTypeOf(getResourceType).parameter(0).not.toBeAny()
    expectTypeOf(getResourceType)
      .parameter(0)
      .toEqualTypeOf<SharedNetworkRequest>()
    expectTypeOf(contentType).parameter(0).toEqualTypeOf<SharedNetworkRequest>()
  })

  it('classifies a request built from shared-only fields', () => {
    expect(getResourceType(request)).toBe('JS')
    expect(contentType(request)).toBe('application/javascript')
  })

  it('accepts the superset fields the local duplicate lacked', () => {
    const withSupersetFields: SharedNetworkRequest = {
      ...request,
      headers: { accept: '*/*' },
      cookies: [],
      navigation: 'nav-1',
      redirectChain: [],
      children: [],
      response: {
        fromCache: false,
        headers: { 'content-type': 'application/javascript' },
        mimeType: 'application/javascript',
        status: 200
      }
    }
    expect(getResourceType(withSupersetFields)).toBe('JS')
  })
})
