import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { createRequire } from 'node:module'
import kill from 'tree-kill'
import type { RunnerRequestBody } from './types.js'
import { WDIO_CONFIG_FILENAMES } from './types.js'

const require = createRequire(import.meta.url)
const wdioBin = resolveWdioBin()

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const FRAMEWORK_FILTERS: Record<
  string,
  (ctx: { specArg?: string; payload: RunnerRequestBody }) => string[]
> = {
  cucumber: ({ specArg, payload }) => {
    const filters: string[] = []

    // For feature-level suites, run the entire feature file
    if (payload.suiteType === 'feature' && specArg) {
      // Remove any line number from specArg for feature-level execution
      const featureFile = specArg.split(':')[0]
      filters.push('--spec', featureFile)
      return filters
    }

    // Priority 1: Use feature file with line number for exact scenario targeting (works for examples)
    // Note: Cucumber scenarios are type 'suite', not 'test'
    if (payload.featureFile && payload.featureLine) {
      filters.push('--spec', `${payload.featureFile}:${payload.featureLine}`)
      return filters
    }

    // Priority 2: For specific test reruns with example row number, use exact regex match
    if (payload.entryType === 'test' && payload.fullTitle) {
      // Cucumber fullTitle format: "1: Scenario name" or "2: Scenario name"
      // Extract the row number and scenario name
      // Avoid ReDoS by removing ambiguous \s* before .* - use string operations instead
      const colonIndex = payload.fullTitle.indexOf(':')
      if (colonIndex > 0) {
        const rowNumber = payload.fullTitle.substring(0, colonIndex)
        const scenarioName = payload.fullTitle.substring(colonIndex + 1).trim()
        // Validate row number is digits only
        if (/^\d+$/.test(rowNumber)) {
          // Use spec file filter
          if (specArg) {
            filters.push('--spec', specArg)
          }
          // Use regex to match the exact "rowNumber: scenarioName" pattern
          // This ensures we only run that specific example row
          filters.push(
            '--cucumberOpts.name',
            `^${rowNumber}:\\s*${escapeRegex(scenarioName)}$`
          )
          return filters
        }
      }
      // No row number - use plain name filter
      if (specArg) {
        filters.push('--spec', specArg)
      }
      filters.push('--cucumberOpts.name', payload.fullTitle.trim())
      return filters
    }

    // Suite-level rerun
    if (specArg) {
      filters.push('--spec', specArg)
    }
    return filters
  },
  mocha: ({ specArg, payload }) => {
    const filters: string[] = []
    if (specArg) {
      filters.push('--spec', specArg)
    }
    // For both tests and suites, use grep to filter
    if (payload.fullTitle) {
      filters.push('--mochaOpts.grep', payload.fullTitle)
    }
    return filters
  },
  jasmine: ({ specArg, payload }) => {
    const filters: string[] = []
    if (specArg) {
      filters.push('--spec', specArg)
    }
    // For both tests and suites, use grep to filter
    if (payload.fullTitle) {
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

    const childEnv = { ...process.env }
    if (payload.devtoolsHost && payload.devtoolsPort) {
      childEnv.DEVTOOLS_APP_HOST = payload.devtoolsHost
      childEnv.DEVTOOLS_APP_PORT = String(payload.devtoolsPort)
      childEnv.DEVTOOLS_APP_REUSE = '1'
    }

    const child = spawn(process.execPath, args, {
      cwd: this.#baseDir,
      env: childEnv,
      stdio: 'inherit',
      detached: false
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
    if (!this.#child || !this.#child.pid) {
      return
    }

    const pid = this.#child.pid

    // Kill the entire process tree
    kill(pid, 'SIGTERM', (err) => {
      if (err) {
        console.error('Error stopping test run:', err)
        // Try force kill if graceful termination fails
        kill(pid, 'SIGKILL')
      }
    })

    // Clean up immediately
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

    const builderCandidate = FRAMEWORK_FILTERS[framework]
    const builder =
      typeof builderCandidate === 'function'
        ? builderCandidate
        : DEFAULT_FILTERS
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
