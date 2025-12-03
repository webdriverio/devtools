import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const wdioBin = resolveWdioBin()

const WDIO_CONFIG_FILENAMES = [
  'wdio.conf.ts',
  'wdio.conf.js',
  'wdio.conf.cjs',
  'wdio.conf.mjs'
]

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
  lineNumber?: number
}

const FRAMEWORK_FILTERS: Record<
  string,
  (ctx: { specArg?: string; payload: RunnerRequestBody }) => string[]
> = {
  cucumber: ({ specArg, payload }) => {
    const filters: string[] = []
    if (specArg) {
      filters.push('--spec', specArg)
    }
    const scenarioName = payload.fullTitle
      ? payload.fullTitle.replace(/^\s*\d+:\s*/, '').trim()
      : undefined
    if (payload.entryType === 'test' && scenarioName) {
      filters.push('--cucumberOpts.name', scenarioName)
    }
    return filters
  },
  mocha: ({ specArg, payload }) => {
    const filters: string[] = []
    if (specArg) {
      filters.push('--spec', specArg)
    }
    if (payload.entryType === 'test' && payload.fullTitle) {
      filters.push('--mochaOpts.grep', payload.fullTitle)
    }
    return filters
  },
  jasmine: ({ specArg, payload }) => {
    const filters: string[] = []
    if (specArg) {
      filters.push('--spec', specArg)
    }
    if (payload.entryType === 'test' && payload.fullTitle) {
      filters.push('--jasmineOpts.grep', payload.fullTitle)
    }
    return filters
  }
}

const DEFAULT_FILTERS = ({ specArg }: { specArg?: string }) =>
  specArg ? ['--spec', specArg] : []

class TestRunner {
  #child?: ChildProcess
  #lastPayload?: RunnerRequestBody
  #baseDir = process.cwd()

  async run(payload: RunnerRequestBody) {
    if (this.#child) {
      throw new Error('A test run is already in progress')
    }

    const configPath = this.#resolveConfigPath(payload)
    this.#baseDir = process.env.DEVTOOLS_RUNNER_CWD || path.dirname(configPath)

    const args = [
      wdioBin,
      'run',
      configPath,
      ...this.#buildFilters(payload)
    ].filter(Boolean)

    const child = spawn(process.execPath, args, {
      cwd: this.#baseDir,
      env: { ...process.env },
      stdio: 'inherit'
    })

    this.#child = child
    this.#lastPayload = payload

    child.once('close', () => {
      this.#child = undefined
      this.#lastPayload = undefined
      this.#baseDir = process.cwd()
    })

    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', (error) => {
        this.#child = undefined
        this.#lastPayload = undefined
        this.#baseDir = process.cwd()
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
    this.#baseDir = process.cwd()
  }

  #buildFilters(payload: RunnerRequestBody) {
    const framework = (payload.framework || '').toLowerCase()
    const specFile = payload.runAll
      ? undefined
      : this.#normaliseSpecFile(payload)
    const specArg = specFile
      ? this.#buildSpecArgument(specFile, payload)
      : undefined

    const builder = FRAMEWORK_FILTERS[framework] || DEFAULT_FILTERS
    return builder({ specArg, payload })
  }

  #buildSpecArgument(specFile: string, payload: RunnerRequestBody) {
    const line = this.#resolveLineNumber(payload)
    return line ? `${specFile}:${line}` : specFile
  }

  #resolveLineNumber(payload: RunnerRequestBody) {
    if (payload.lineNumber && payload.lineNumber > 0) {
      return payload.lineNumber
    }
    const source = payload.callSource?.trim() || this.#lastPayload?.callSource
    if (!source) {
      return this.#lastPayload?.lineNumber
    }
    const match = /:(\d+)(?::\d+)?$/.exec(source)
    return match ? Number(match[1]) : this.#lastPayload?.lineNumber
  }

  #normaliseSpecFile(payload: RunnerRequestBody) {
    const candidate = this.#getSpecCandidate(payload)
    return candidate ? this.#toFsPath(candidate) : undefined
  }

  #getSpecCandidate(payload?: RunnerRequestBody) {
    return (
      payload?.specFile ||
      this.#extractSpecFromCallSource(payload?.callSource) ||
      this.#lastPayload?.specFile
    )
  }

  #extractSpecFromCallSource(source?: string) {
    if (!source) {
      return undefined
    }
    const match = /^(.*?):\d+:\d+$/.exec(source.trim())
    return match?.[1] ?? source
  }

  #toFsPath(candidate: string) {
    const filePath = candidate.startsWith('file://')
      ? url.fileURLToPath(candidate)
      : candidate
    return path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.#baseDir, filePath)
  }

  #resolveConfigPath(payload?: RunnerRequestBody) {
    const specCandidate = this.#getSpecCandidate(payload)
    const specDir = specCandidate
      ? path.dirname(this.#toFsPath(specCandidate))
      : undefined

    const candidates = this.#dedupeCandidates([
      payload?.configFile,
      this.#lastPayload?.configFile,
      process.env.DEVTOOLS_WDIO_CONFIG,
      this.#findConfigFromSpec(specCandidate),
      ...this.#expandDefaultConfigsFor(this.#baseDir),
      ...this.#expandDefaultConfigsFor(path.resolve(this.#baseDir, 'example')),
      ...this.#expandDefaultConfigsFor(specDir)
    ])

    for (const candidate of candidates) {
      const resolved = this.#toFsPath(candidate)
      if (fs.existsSync(resolved)) {
        return resolved
      }
    }

    throw new Error(
      `Cannot locate WDIO config. Tried:\n${candidates
        .map((c) => ` • ${this.#toFsPath(c)}`)
        .join('\n')}`
    )
  }

  #findConfigFromSpec(specFile?: string) {
    if (!specFile) {
      return undefined
    }

    const fsSpec = this.#toFsPath(specFile)
    let dir = path.dirname(fsSpec)
    const root = path.parse(dir).root

    while (dir && dir !== root) {
      for (const file of WDIO_CONFIG_FILENAMES) {
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

  #expandDefaultConfigsFor(baseDir?: string) {
    if (!baseDir) {
      return []
    }
    return WDIO_CONFIG_FILENAMES.map((file) => path.resolve(baseDir, file))
  }

  #dedupeCandidates(values: Array<string | undefined>) {
    return Array.from(
      new Set(
        values.filter(
          (value): value is string =>
            typeof value === 'string' && value.length > 0
        )
      )
    )
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
