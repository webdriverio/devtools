import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureSecretRedaction, redactSecrets } from '@wdio/devtools-core'

import type { DirectProbes } from '../src/direct-probes.js'

const { directProbes } = vi.hoisted(() => ({
  directProbes: vi.fn<() => DirectProbes | undefined>(() => undefined)
}))
vi.mock('../src/direct-probes.js', () => ({ directProbes }))

import { TypedInputReads } from '../src/typed-input.js'

const SECRET = 'SuperSecretPassword!'

function browserWith(types: Record<string, string>, native = false) {
  return {
    capabilities: native
      ? { platformName: 'Android', 'appium:app': '/app.apk' }
      : { browserName: 'chrome' },
    getElementProperty: vi.fn(async (id: string) => types[id] ?? 'text')
  } as unknown as WebdriverIO.Browser & {
    getElementProperty: ReturnType<typeof vi.fn>
  }
}

describe('TypedInputReads', () => {
  afterEach(() => {
    configureSecretRedaction({ maskInputs: false })
    configureSecretRedaction()
  })

  it('issues the read inside beforeCommand without holding it, and has the password before the row is recorded', async () => {
    const browser = browserWith({ 'el-2': 'password' })
    const reads = new TypedInputReads()
    reads.read(browser, 'elementSendKeys', ['el-2', SECRET])
    expect(browser.getElementProperty).toHaveBeenCalledWith('el-2', 'type')
    await reads.settled()
    expect(redactSecrets({ command: 'setValue', args: [SECRET] })).toEqual({
      command: 'setValue',
      args: ['••••']
    })
    expect(reads.settled()).toBeUndefined()
  })

  it('reads through the direct probes on an Appium session, not from inside the hook', async () => {
    const getElementType = vi.fn(async () => 'password')
    directProbes.mockReturnValueOnce({
      getElementType
    } as unknown as DirectProbes)
    const browser = browserWith({})
    const reads = new TypedInputReads()
    reads.read(browser, 'elementSendKeys', ['el-9', SECRET])
    await reads.settled()
    expect(getElementType).toHaveBeenCalledWith('el-9')
    expect(browser.getElementProperty).not.toHaveBeenCalled()
    expect(redactSecrets(SECRET)).toBe('••••')
  })

  it('redacts what is typed when the direct probe gives no answer', async () => {
    directProbes.mockReturnValueOnce({
      getElementType: vi.fn(async () => undefined)
    } as unknown as DirectProbes)
    const reads = new TypedInputReads()
    reads.read(browserWith({}), 'elementSendKeys', ['el-9', SECRET])
    await reads.settled()
    expect(redactSecrets(SECRET)).toBe('••••')
  })

  it('keeps text typed into another field', async () => {
    const reads = new TypedInputReads()
    reads.read(browserWith({}), 'elementSendKeys', ['el-1', 'tomsmith'])
    await reads.settled()
    expect(redactSecrets('tomsmith')).toBe('tomsmith')
  })

  it('reads nothing for another command, a native app or with input masking off, and adds no tick then', () => {
    const browser = browserWith({ 'el-2': 'password' })
    const reads = new TypedInputReads()
    reads.read(browser, 'elementClick', ['el-2'])
    reads.read(browserWith({}, true), 'elementSendKeys', ['el-2', SECRET])
    configureSecretRedaction({ maskInputs: false })
    reads.read(browser, 'elementSendKeys', ['el-2', SECRET])
    expect(browser.getElementProperty).not.toHaveBeenCalled()
    expect(redactSecrets(SECRET)).toBe(SECRET)
  })
})
