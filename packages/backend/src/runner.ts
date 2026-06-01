import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import kill from 'tree-kill'
import { parse as shellParse, quote as shellQuote } from 'shell-quote'
import {
  REUSE_ENV,
  RUNNER_ENV,
  type RunnerRequestBody,
  type TestRunnerId
} from '@wdio/devtools-shared'
import { WDIO_CONFIG_FILENAMES, NIGHTWATCH_CONFIG_FILENAMES } from './types.js'
import { getFilterBuilder } from './framework-filters.js'
import { resolveNightwatchBin, resolveWdioBin } from './bin-resolver.js'

const wdioBin = resolveWdioBin()

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
      childEnv[REUSE_ENV.HOST] = payload.devtoolsHost
      childEnv[REUSE_ENV.PORT] = String(payload.devtoolsPort)
      childEnv[REUSE_ENV.REUSE] = '1'
    }

    let child: ChildProcess
    if (isGenericShell) {
      const command = this.#resolveGenericCommand(payload)
      this.#baseDir = process.env[RUNNER_ENV.RUNNER_CWD] || process.cwd()
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
        process.env[RUNNER_ENV.RUNNER_CWD] || path.dirname(configPath)
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
          childEnv[REUSE_ENV.RERUN_ENTRY_TYPE] = 'test'
          childEnv[REUSE_ENV.RERUN_LABEL] = payload.label
        } else {
          delete childEnv[REUSE_ENV.RERUN_ENTRY_TYPE]
          delete childEnv[REUSE_ENV.RERUN_LABEL]
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
  //
  // Exception: cucumber's `--name` matches scenario titles only, never feature
  // titles — a suite-level rerun on a feature would substitute the feature name
  // and match zero scenarios. When the payload looks like a cucumber feature
  // rerun (entryType='suite', spec file ends in `.feature`, template carries
  // `--name "{{testName}}"`), strip `--name` and pass the feature file as a
  // positional arg so cucumber-js runs every scenario in that file.
  #resolveGenericCommand(payload: RunnerRequestBody): string {
    const template = payload.rerunCommand
    const fallback = payload.launchCommand || ''
    const isTargetedRerun =
      !payload.runAll &&
      (payload.entryType === 'test' || payload.entryType === 'suite') &&
      Boolean(payload.label || payload.fullTitle)
    if (!template || !isTargetedRerun) {
      return fallback || template || ''
    }
    // Cucumber's `--name` matches scenario titles, never feature titles.
    // Feature-level reruns must drop `--name` and pass the .feature path as a
    // positional arg. The dashboard tags the root suite with
    // `suiteType: 'feature'`, which is what distinguishes a true feature-level
    // rerun from a scenario rerun (scenarios are also `entryType: 'suite'` but
    // `suiteType: 'suite'`).
    const featureSpec =
      payload.featureFile ||
      (payload.specFile?.endsWith('.feature') ? payload.specFile : undefined)
    const isCucumberFeatureRerun =
      payload.entryType === 'suite' &&
      payload.suiteType === 'feature' &&
      Boolean(featureSpec) &&
      /--name\s+"\{\{testName\}\}"/.test(template)
    if (isCucumberFeatureRerun && featureSpec) {
      const stripped = template.replace(/\s*--name\s+"\{\{testName\}\}"/, '')
      return `${stripped} ${shellQuote([featureSpec])}`
    }
    const name = payload.label || payload.fullTitle || ''
    return template.replace(/\{\{testName\}\}/g, name)
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

    // Cast: framework comes from an HTTP payload, so it's `string` at the
    // boundary. getFilterBuilder() falls back to the default spec-only
    // builder for unknown runners.
    const builder = getFilterBuilder(framework as TestRunnerId)
    const baseFilters = builder({ specArg, payload })

    // Scope "Run All" to the user's original --spec args. Nightwatch resolves specs via its own filter.
    if (payload.runAll && !framework.startsWith('nightwatch')) {
      const initialSpecs = process.env[RUNNER_ENV.WDIO_INITIAL_SPECS]
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
      process.env[RUNNER_ENV.WDIO_CONFIG],
      process.env[RUNNER_ENV.NIGHTWATCH_CONFIG],
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

export const testRunner = new TestRunner()
