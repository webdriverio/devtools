import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import {
  findOwnPackagesDir,
  getCallSourceFromStack,
  isAssertFromUserCode,
  isPackageSource,
  isUserCodeFrame
} from '@wdio/devtools-core'

// Synthetic V8 stacks as captured INSIDE patchedAssert: frames[0] is the
// wrapper (any name — may be minified), frames[1] is whoever called the assert.
const stackWithCaller = (callerFile: string, wrapperName = 'patchedAssert') =>
  [
    'Error',
    `    at ${wrapperName} (/repo/packages/core/src/assert-patcher.ts:158:30)`,
    `    at Object.<anonymous> (${callerFile}:5:10)`,
    '    at Module._compile (node:internal/modules/cjs/loader:1234:14)'
  ].join('\n')

describe('isAssertFromUserCode', () => {
  it('keeps an assert whose immediate caller is user code', () => {
    expect(
      isAssertFromUserCode(stackWithCaller('/repo/tests/login.spec.ts'))
    ).toBe(true)
  })

  it('drops an assert fired by a dependency during a user operation', () => {
    expect(
      isAssertFromUserCode(
        stackWithCaller('/repo/node_modules/webdriverio/build/session.js')
      )
    ).toBe(false)
  })

  it('drops one whose immediate caller is bundled dist output', () => {
    expect(
      isAssertFromUserCode(stackWithCaller('/repo/packages/core/dist/x.js'))
    ).toBe(false)
  })

  it('works regardless of the wrapper frame name (minified bundle)', () => {
    // The wrapper is renamed by the bundler; the fixed frame offset still holds.
    expect(
      isAssertFromUserCode(stackWithCaller('/repo/tests/login.spec.ts', 'n2'))
    ).toBe(true)
    expect(
      isAssertFromUserCode(stackWithCaller('/repo/node_modules/x/i.js', 'n2'))
    ).toBe(false)
  })

  it('returns true when there is no stack', () => {
    expect(isAssertFromUserCode(undefined)).toBe(true)
  })
})

describe('getCallSourceFromStack', () => {
  const packagesDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
  )
  const stackOf = (...files: string[]) =>
    ['Error', ...files.map((f, i) => `    at f${i} (${f}:${i + 1}:1)`)].join(
      '\n'
    )

  it('skips the workspace packages own sources, as a source-mapped stack names them', () => {
    const spec = path.join(packagesDir, 'conformance/scenarios/selenium.ts')
    const stack = stackOf(
      path.join(packagesDir, 'core/src/stack.ts'),
      pathToFileURL(
        path.join(packagesDir, 'selenium-devtools/src/driverPatcher.ts')
      ).href,
      spec
    )
    expect(getCallSourceFromStack(stack)).toEqual({
      filePath: spec,
      callSource: `${spec}:3`
    })
  })

  it('keeps a src/ file of any other project, and the workspace tests', () => {
    expect(
      isUserCodeFrame({ file: '/elsewhere/packages/app/src/login.spec.ts' })
    ).toBe(true)
    expect(
      isUserCodeFrame({
        file: path.join(packagesDir, 'selenium-devtools/tests/x.test.ts')
      })
    ).toBe(true)
  })

  it('reports no call source, not a placeholder, when no frame is user code', () => {
    const stack = stackOf(
      path.join(packagesDir, 'core/src/stack.ts'),
      '/proj/node_modules/selenium-webdriver/lib/webdriver.js'
    )
    expect(getCallSourceFromStack(stack)).toEqual({
      filePath: undefined,
      callSource: undefined
    })
  })

  it('never throws on a frame whose file URL names a host', () => {
    expect(() =>
      isUserCodeFrame({ file: 'file://build-host/proj/spec.ts' })
    ).not.toThrow()
    expect(() =>
      getCallSourceFromStack(stackOf('file://build-host/proj/spec.ts'))
    ).not.toThrow()
  })
})

describe('findOwnPackagesDir', () => {
  let root: string
  const write = (file: string, content = '') => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), content)
  }
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'own-packages-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('finds the monorepo from a nested dist entry', () => {
    write('pnpm-workspace.yaml')
    write('package.json', JSON.stringify({ name: 'devtools-monorepo' }))
    const nested = path.join(root, 'packages/nightwatch-devtools/dist/helpers')
    mkdirSync(nested, { recursive: true })
    const packages = findOwnPackagesDir(nested)
    expect(packages).toBe(path.join(root, 'packages'))
    expect(
      isPackageSource(path.join(root, 'packages/core/src/stack.ts'), packages)
    ).toBe(true)
  })

  it('finds nothing for an adapter installed into a user workspace', () => {
    write('pnpm-workspace.yaml')
    write('package.json', JSON.stringify({ name: 'my-app' }))
    const installed = path.join(
      root,
      'node_modules/@wdio/selenium-devtools/dist'
    )
    mkdirSync(installed, { recursive: true })
    const packages = findOwnPackagesDir(installed)
    expect(packages).toBeUndefined()
    expect(
      isPackageSource(path.join(root, 'packages/app/src/spec.ts'), packages)
    ).toBe(false)
  })

  it('finds nothing for an adapter bundled into a user build', () => {
    write('package.json', JSON.stringify({ name: 'my-app' }))
    const bundled = path.join(root, 'build')
    mkdirSync(bundled, { recursive: true })
    expect(findOwnPackagesDir(bundled)).toBeUndefined()
  })
})
