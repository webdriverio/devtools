import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { createRequire } from 'node:module'
import kill from 'tree-kill'
import { parse as shellParse } from 'shell-quote'
import type { RunnerRequestBody } from './types.js'
import { WDIO_CONFIG_FILENAMES, NIGHTWATCH_CONFIG_FILENAMES } from './types.js'

const require = createRequire(import.meta.url)
const wdioBin = resolveWdioBin()

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

type FilterBuilder = (ctx: {
  specArg?: string
  payload: RunnerRequestBody
}) => string[]

// Map (not object) keeps payload-supplied `framework` from reaching
// prototype methods at dispatch time — CodeQL: unvalidated-dynamic-method-call.
const FRAMEWORK_FILTERS = new Map<string, FilterBuilder>()

FRAMEWORK_FILTERS.set('cucumber', ({ specArg, payload }) => {
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
})

FRAMEWORK_FILTERS.set('mocha', ({ specArg, payload }) => {
  const filters: string[] = []
  if (specArg) {
    filters.push('--spec', specArg)
  }
  // For both tests and suites, use grep to filter
  if (payload.fullTitle) {
    filters.push('--mochaOpts.grep', payload.fullTitle)
  }
  return filters
})

FRAMEWORK_FILTERS.set('jasmine', ({ specArg, payload }) => {
  const filters: string[] = []
  if (specArg) {
    filters.push('--spec', specArg)
  }
  // For both tests and suites, use grep to filter
  if (payload.fullTitle) {
    filters.push('--jasmineOpts.grep', payload.fullTitle)
  }
  return filters
})

const DEFAULT_FILTERS: FilterBuilder = ({ specArg }) =>
  specArg ? ['--spec', specArg] : []

// Nightwatch CLI: positional spec file + optional --testcase filter
FRAMEWORK_FILTERS.set('nightwatch', ({ specArg, payload }) => {
  const filters: string[] = []
  if (specArg) {
    // Nightwatch doesn't support file:line — strip any trailing line number
    filters.push(specArg.split(':')[0])
  }
  if (payload.entryType === 'test' && payload.label) {
    filters.push('--testcase', payload.label)
  }
  return filters
})

// Nightwatch + Cucumber: feature files are resolved via the config's feature_path.
// Never pass .feature files as positional args — Nightwatch rejects them.
// Nightwatch forwards --name and --tags to the underlying Cucumber runner.
FRAMEWORK_FILTERS.set('nightwatch-cucumber', ({ payload }) => {
  const filters: string[] = []

  // Only pass --name for scenario-level reruns. Feature/file-level suites
  // (suiteType === 'feature') run all their scenarios, so no --name filter.
  const isFeatureLevel = payload.suiteType === 'feature' || payload.runAll
  if (!isFeatureLevel && payload.fullTitle) {
    // Wrap as an anchored exact regex so "Scenario A" never also matches
    // "Scenario A-1" (Cucumber treats --name as a regex).
    const escaped = payload.fullTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    filters.push('--name', `^${escaped}$`)
  }
  return filters
})

class TestRunner {
  #child?: ChildProcess
  #lastPayload?: RunnerRequestBody
  #registeredConfigFile?: string
  #baseDir = process.cwd()
  // Set on rerun spawn; consumed once by the next worker handshake so the
  // accumulated suite tree is preserved instead of wiped.
  #expectingRerunChild = false
  consumeRerunChildFlag(): boolean {
    const v = this.#expectingRerunChild
    this.#expectingRerunChild = false
    return v
  }

  registerConfigFile(configFile: string) {
    if (configFile && fs.existsSync(configFile)) {
      this.#registeredConfigFile = configFile
    }
  }

  async run(payload: RunnerRequestBody) {
    if (this.#child) {
      this.stop()
      await new Promise<void>((resolve) => setTimeout(resolve, 500))
    }
    // devtoolsHost/Port in the payload = REUSE handshake (rerun child).
    this.#expectingRerunChild = Boolean(
      payload.devtoolsHost && payload.devtoolsPort
    )

    const isNightwatch = (payload.framework || '')
      .toLowerCase()
      .startsWith('nightwatch')
    // Used when a plugin supplies its own rerun template (e.g. selenium —
    // runs under mocha/jest/vitest/cucumber, none of which use wdioBin).
    const isGenericShell =
      !isNightwatch && Boolean(payload.rerunCommand || payload.launchCommand)

    const childEnv = { ...process.env }
    if (payload.devtoolsHost && payload.devtoolsPort) {
      childEnv.DEVTOOLS_APP_HOST = payload.devtoolsHost
      childEnv.DEVTOOLS_APP_PORT = String(payload.devtoolsPort)
      childEnv.DEVTOOLS_APP_REUSE = '1'
    }

    let child: ChildProcess
    if (isGenericShell) {
      const command = this.#resolveGenericCommand(payload)
      this.#baseDir = process.env.DEVTOOLS_RUNNER_CWD || process.cwd()
      const { file, args } = this.#parseGenericCommand(command)
      child = spawn(file, args, {
        cwd: this.#baseDir,
        env: childEnv,
        stdio: 'inherit',
        detached: false
      })
    } else {
      const configPath = this.#resolveConfigPath(payload)
      this.#baseDir =
        process.env.DEVTOOLS_RUNNER_CWD || path.dirname(configPath)
      let args: string[]
      if (isNightwatch) {
        const nightwatchBin = resolveNightwatchBin(this.#baseDir)
        args = [
          nightwatchBin,
          '--config',
          configPath,
          ...this.#buildFilters(payload)
        ].filter(Boolean)
      } else {
        args = [
          wdioBin,
          'run',
          configPath,
          ...this.#buildFilters(payload)
        ].filter(Boolean)
      }
      if (isNightwatch) {
        if (payload.entryType === 'test' && payload.label) {
          childEnv.DEVTOOLS_RERUN_ENTRY_TYPE = 'test'
          childEnv.DEVTOOLS_RERUN_LABEL = payload.label
        } else {
          delete childEnv.DEVTOOLS_RERUN_ENTRY_TYPE
          delete childEnv.DEVTOOLS_RERUN_LABEL
        }
      }
      child = spawn(process.execPath, args, {
        cwd: this.#baseDir,
        env: childEnv,
        stdio: 'inherit',
        detached: false
      })
    }

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
        this.#expectingRerunChild = false
        reject(error)
      })
    })
  }

  // Targeted reruns substitute {{testName}} into rerunCommand; suite filtering
  // works because mocha/jest/cucumber filter flags match by name (describe/it/scenario alike).
  #resolveGenericCommand(payload: RunnerRequestBody): string {
    const template = payload.rerunCommand
    const fallback = payload.launchCommand || ''
    const isTargetedRerun =
      !payload.runAll &&
      (payload.entryType === 'test' || payload.entryType === 'suite') &&
      Boolean(payload.label || payload.fullTitle)
    if (template && isTargetedRerun) {
      const name = payload.label || payload.fullTitle || ''
      return template.replace(/\{\{testName\}\}/g, name)
    }
    return fallback || template || ''
  }

  #parseGenericCommand(command: string): { file: string; args: string[] } {
    const tokens = (shellParse(command) as unknown[]).filter(
      (token): token is string => typeof token === 'string'
    )
    if (tokens.length === 0) {
      throw new Error('Invalid generic command: empty command')
    }
    const [file, ...args] = tokens
    return { file, args }
  }

  stop() {
    if (!this.#child || !this.#child.pid) {
      return
    }

    const pid = this.#child.pid
    const child = this.#child

    // SIGTERM, then SIGKILL after 1s — Jest swallows SIGTERM and keeps
    // running until the current test resolves.
    kill(pid, 'SIGTERM', (err) => {
      if (err) {
        kill(pid, 'SIGKILL')
      }
    })
    const sigkillTimer = setTimeout(() => {
      kill(pid, 'SIGKILL')
    }, 1000)
    // Cancel SIGKILL on clean exit — the PID slot may have been recycled.
    child.once('close', () => clearTimeout(sigkillTimer))

    // Clear immediately so a follow-up /api/tests/run isn't blocked by the
    // stale #child guard before SIGKILL lands.
    this.#child = undefined
    this.#lastPayload = undefined
    this.#expectingRerunChild = false
    this.#baseDir = process.cwd()
  }

  #buildFilters(payload: RunnerRequestBody) {
    const framework = (payload.framework || '').toLowerCase()
    const specFile = payload.runAll
      ? undefined
      : this.#normaliseSpecFile(payload)
    const line = specFile ? this.#resolveLineNumber(payload) : undefined
    const specArg = specFile
      ? line
        ? `${specFile}:${line}`
        : specFile
      : undefined

    const candidateBuilder = FRAMEWORK_FILTERS.get(framework)
    const builder =
      typeof candidateBuilder === 'function'
        ? candidateBuilder
        : DEFAULT_FILTERS
    const baseFilters = builder({ specArg, payload })

    // Scope "Run All" to the user's original --spec args. Nightwatch resolves specs via its own filter.
    if (payload.runAll && !framework.startsWith('nightwatch')) {
      const initialSpecs = process.env.DEVTOOLS_WDIO_INITIAL_SPECS
      if (initialSpecs) {
        const specs = initialSpecs.split(path.delimiter).filter(Boolean)
        for (const spec of specs) {
          baseFilters.push('--spec', spec)
        }
      }
    }

    return baseFilters
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

    const isNightwatch = (payload?.framework || '')
      .toLowerCase()
      .startsWith('nightwatch')
    const candidates = this.#dedupeCandidates([
      payload?.configFile,
      this.#lastPayload?.configFile,
      this.#registeredConfigFile,
      process.env.DEVTOOLS_WDIO_CONFIG,
      process.env.DEVTOOLS_NIGHTWATCH_CONFIG,
      this.#findConfigFromSpec(specCandidate, isNightwatch),
      ...this.#expandDefaultConfigsFor(this.#baseDir, isNightwatch),
      ...this.#expandDefaultConfigsFor(
        path.resolve(this.#baseDir, 'example'),
        isNightwatch
      ),
      ...this.#expandDefaultConfigsFor(specDir, isNightwatch)
    ])

    for (const candidate of candidates) {
      const resolved = this.#toFsPath(candidate)
      if (fs.existsSync(resolved)) {
        return resolved
      }
    }

    const runner = isNightwatch ? 'Nightwatch' : 'WDIO'
    throw new Error(
      `Cannot locate ${runner} config. Tried:\n${candidates
        .map((c) => ` • ${this.#toFsPath(c)}`)
        .join('\n')}`
    )
  }

  #findConfigFromSpec(specFile?: string, nightwatch = false) {
    if (!specFile) {
      return undefined
    }

    const filenames = nightwatch
      ? [...NIGHTWATCH_CONFIG_FILENAMES, ...WDIO_CONFIG_FILENAMES]
      : WDIO_CONFIG_FILENAMES
    const fsSpec = this.#toFsPath(specFile)
    let dir = path.dirname(fsSpec)
    const root = path.parse(dir).root

    while (dir && dir !== root) {
      for (const file of filenames) {
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

  #expandDefaultConfigsFor(baseDir?: string, nightwatch = false) {
    if (!baseDir) {
      return []
    }
    const filenames = nightwatch
      ? [...NIGHTWATCH_CONFIG_FILENAMES, ...WDIO_CONFIG_FILENAMES]
      : WDIO_CONFIG_FILENAMES
    return filenames.map((file) => path.resolve(baseDir, file))
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

function resolveNightwatchBin(baseDir: string): string {
  const envOverride = process.env.DEVTOOLS_NIGHTWATCH_BIN
  if (envOverride) {
    const resolved = path.isAbsolute(envOverride)
      ? envOverride
      : path.resolve(process.cwd(), envOverride)
    if (fs.existsSync(resolved)) {
      return resolved
    }
  }

  // Walk up from baseDir looking for node_modules/nightwatch/package.json
  // and resolve the actual JS entry (avoids running the shell-script wrapper
  // at node_modules/.bin/nightwatch directly via node).
  let dir = baseDir
  const root = path.parse(dir).root
  while (dir !== root) {
    const nightwatchPkgPath = path.join(
      dir,
      'node_modules',
      'nightwatch',
      'package.json'
    )
    if (fs.existsSync(nightwatchPkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(nightwatchPkgPath, 'utf8'))
        const nightwatchDir = path.join(dir, 'node_modules', 'nightwatch')
        const binEntry =
          typeof pkg.bin === 'string'
            ? pkg.bin
            : (pkg.bin?.nightwatch ?? pkg.bin?.nw)
        if (binEntry) {
          const jsPath = path.resolve(nightwatchDir, binEntry)
          if (fs.existsSync(jsPath)) {
            return jsPath
          }
        }
      } catch {
        // malformed package.json — continue walking
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }

  throw new Error(
    'Cannot find nightwatch binary. Install nightwatch locally or set DEVTOOLS_NIGHTWATCH_BIN env var.'
  )
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
