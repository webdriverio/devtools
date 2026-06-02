import { describe, it, expect } from 'vitest'
import {
  arrayHeadersToObject,
  attachBidiHandlers,
  loadSeleniumSubmodule,
  type BidiHandlerSinks
} from '../src/bidi.js'

describe('arrayHeadersToObject', () => {
  it('flattens BiDi { name, value: string } headers to a lowercased dict', () => {
    expect(
      arrayHeadersToObject([
        { name: 'Content-Type', value: 'application/json' },
        { name: 'X-Foo', value: 'bar' }
      ])
    ).toEqual({ 'content-type': 'application/json', 'x-foo': 'bar' })
  })

  it('unwraps { value: { value: string } } shape (BiDi sometimes wraps)', () => {
    expect(
      arrayHeadersToObject([
        { name: 'Accept', value: { type: 'string', value: 'text/html' } }
      ])
    ).toEqual({ accept: 'text/html' })
  })

  it('falls back to JSON.stringify when value is neither string nor wrapped string', () => {
    expect(
      arrayHeadersToObject([
        { name: 'X-Weird', value: { type: 'object' } as unknown as string }
      ])
    ).toEqual({ 'x-weird': '{"type":"object"}' })
  })

  it('returns undefined for non-array input + skips entries with empty names', () => {
    expect(arrayHeadersToObject(undefined)).toBeUndefined()
    expect(arrayHeadersToObject('not-an-array')).toBeUndefined()
    expect(
      arrayHeadersToObject([
        { name: '', value: 'skipped' },
        { name: 'kept', value: 'v' }
      ])
    ).toEqual({ kept: 'v' })
  })
})

describe('loadSeleniumSubmodule', () => {
  it('returns null for a submodule that does not exist anywhere', () => {
    expect(
      loadSeleniumSubmodule('definitely/not/a/real/submodule-xyz123')
    ).toBeNull()
  })
})

describe('attachBidiHandlers — graceful degradation', () => {
  // Two real-world failure modes the function must handle without crashing:
  //   (a) submodules unresolvable → "not available" notice, returns false
  //   (b) submodules load but driver is fake / pre-BiDi → attach attempt
  //       throws inside the factory, caught + logged as "attach failed",
  //       returns false
  // selenium-webdriver IS installed in this workspace, so we exercise (b).
  it('returns false and never throws when the driver is not BiDi-capable', async () => {
    const sinks: BidiHandlerSinks = {
      pushConsoleLog: () => {},
      pushNetworkRequest: () => {},
      replaceNetworkRequest: () => {}
    }
    const logs: Array<[string, string]> = []
    const ok = await attachBidiHandlers({}, sinks, (lvl, msg) =>
      logs.push([lvl, msg])
    )
    expect(ok).toBe(false)
    // Either the submodule was missing OR the inspector attach threw —
    // both produce a notice via the onLog hook.
    const noticed = logs.some(
      ([, msg]) =>
        msg.includes('not available') || msg.includes('attach failed')
    )
    expect(noticed).toBe(true)
  })
})
