/**
 * `src/types.ts` is a module, so a bare `declare namespace WebdriverIO` there
 * declares a module-local namespace and `browser.getSnapshot()` never reaches
 * the global `WebdriverIO.Browser`. The `expectTypeOf` checks are compile-time
 * only; the root `pnpm typecheck` enforces them.
 */

import { describe, expectTypeOf, it } from 'vitest'
import type { GetSnapshotOptions, GetSnapshotResult } from '@wdio/elements'
import type { ServiceOptions } from '../src/types.js'

describe('WebdriverIO.Browser augmentation', () => {
  it('exposes getSnapshot on the global Browser', () => {
    expectTypeOf<WebdriverIO.Browser['getSnapshot']>().toEqualTypeOf<
      (options?: GetSnapshotOptions) => Promise<GetSnapshotResult>
    >()
  })

  it('extends the global ServiceOption with the devtools options', () => {
    expectTypeOf<WebdriverIO.ServiceOption['mode']>().toEqualTypeOf<
      ServiceOptions['mode']
    >()
  })
})
