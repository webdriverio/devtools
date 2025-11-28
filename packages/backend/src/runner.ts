import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const wdioBin = resolveWdioBin()

export interface RunnerRequestBody {
  uid: string
  entryType: 'suite' | 'test'
  specFile?: string
  fullTitle?: string
  label?: string
  callSource?: string
  runAll?: boolean
  framework?: string
  configFile?: string
}

class TestRunner {
  #child?: ChildProcess
  #lastPayload?: RunnerRequestBody

  async run(payload: RunnerRequestBody) {
    console.log('run', payload)
    if (this.#child) {
      throw new Error('A test run is already in progress')
    }

    const configPath = this.#resolveConfigPath(payload)
    const args = [
      wdioBin,
      'run',
      configPath,
      ...this.#buildFilters(payload)
    ].filter(Boolean) as string[]

    const cwd = process.env.DEVTOOLS_RUNNER_CWD || process.cwd()
    const child = spawn(process.execPath, args, {
      cwd,
      env: {
        ...process.env,
        WDIO_DEVTOOLS_TARGET_UID: payload.uid,
        WDIO_DEVTOOLS_TARGET_LABEL: payload.label || ''
      },
      stdio: 'inherit'
    })

    this.#child = child
    this.#lastPayload = payload

    child.once('close', () => {
      this.#child = undefined
      this.#lastPayload = undefined
    })

    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', (error) => {
        this.#child = undefined
        this.#lastPayload = undefined
        reject(error)
      })
    })
  }

  stop() {
    if (!this.#child) {
      return
    }
    this.#child.kill('SIGINT')
    this.#child = undefined
    this.#lastPayload = undefined
  }

  #buildFilters(payload: RunnerRequestBody) {
    const filters: string[] = []
    const framework = (payload.framework || '').toLowerCase()
    const isCucumber = framework === 'cucumber'

    if (!payload.runAll && !isCucumber) {
      const specFile = this.#normaliseSpecFile(payload)
      if (!specFile) {
        throw new Error('Unable to determine spec file for run')
      }
      filters.push('--spec', specFile)
    }

    if (payload.entryType === 'test' && payload.fullTitle) {
      if (framework === 'mocha') {
        filters.push('--mochaOpts.grep', payload.fullTitle)
      } else if (framework === 'jasmine') {
        filters.push('--jasmineOpts.grep', payload.fullTitle)
      } else if (framework === 'cucumber') {
        filters.push('--cucumberOpts.name', payload.fullTitle)
      }
    }

    return filters
  }

  #normaliseSpecFile(payload: RunnerRequestBody) {
    if (payload.specFile) {
      return this.#toFsPath(payload.specFile)
    }
    if (payload.callSource) {
      const match = payload.callSource.match(/^(.*?):\d+:\d+$/)
      if (match?.[1]) {
        return this.#toFsPath(match[1])
      }
      return this.#toFsPath(payload.callSource)
    }
    if (this.#lastPayload?.specFile) {
      return this.#toFsPath(this.#lastPayload.specFile)
    }
    return undefined
  }

  #toFsPath(candidate: string) {
    let filePath = candidate
    if (filePath.startsWith('file://')) {
      filePath = url.fileURLToPath(filePath)
    }
    if (!path.isAbsolute(filePath)) {
      filePath = path.resolve(process.cwd(), filePath)
    }
    if (!fs.existsSync(filePath)) {
      throw new Error(`Spec file "${filePath}" does not exist`)
    }
    return filePath
  }

  #resolveConfigPath(payload?: RunnerRequestBody) {
    const provided =
      payload?.configFile ||
      process.env.DEVTOOLS_WDIO_CONFIG ||
      this.#findConfigFromSpec(payload?.specFile) ||
      path.resolve(process.cwd(), 'wdio.conf.ts')
    if (fs.existsSync(provided)) {
      return provided
    }
    const exampleConfig = path.resolve(process.cwd(), 'example', 'wdio.conf.ts')
    if (fs.existsSync(exampleConfig)) {
      return exampleConfig
    }
    throw new Error(
      'Unable to resolve WDIO config. Set DEVTOOLS_WDIO_CONFIG environment variable.'
    )
  }

  #findConfigFromSpec(specFile?: string) {
    if (!specFile) {
      return undefined
    }

    const candidates = [
      'wdio.conf.ts',
      'wdio.conf.js',
      'wdio.conf.cjs',
      'wdio.conf.mjs'
    ]

    let dir = path.dirname(specFile)
    const root = path.parse(dir).root

    while (dir && dir !== root) {
      for (const file of candidates) {
        const candidate = path.join(dir, file)
        if (fs.existsSync(candidate)) {
          return candidate
        }
      }
      const parent = path.dirname(dir)
      if (parent === dir) {
        break
      }
      dir = parent
    }

    return undefined
  }
}

function resolveWdioBin() {
  const envOverride = process.env.DEVTOOLS_WDIO_BIN
  if (envOverride) {
    const overriddenPath = path.isAbsolute(envOverride)
      ? envOverride
      : path.resolve(process.cwd(), envOverride)
    if (!fs.existsSync(overriddenPath)) {
      throw new Error(
        `DEVTOOLS_WDIO_BIN "${overriddenPath}" does not exist or is not accessible`
      )
    }
    return overriddenPath
  }

  try {
    const cliEntry = require.resolve('@wdio/cli')
    const candidate = path.resolve(path.dirname(cliEntry), '../bin/wdio.js')
    if (!fs.existsSync(candidate)) {
      throw new Error(`Derived WDIO bin "${candidate}" does not exist`)
    }
    return candidate
  } catch (error) {
    throw new Error(
      `Failed to resolve WDIO binary. Provide DEVTOOLS_WDIO_BIN env var. ${(error as Error).message}`
    )
  }
}

export const testRunner = new TestRunner()
