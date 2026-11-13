#!/usr/bin/env node
import { readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api'
import { describe } from './artifact-sources.js'
import {
  CLI_USAGE,
  isBrowserFetchable,
  parseCliArgs,
  type PushArgs
} from './cli-args.js'
import { parseManifest } from './manifest.js'
import { createTelemetry } from './providers.js'
import { staleSpanWarning } from './stale-span.js'
import { planPush, type ManifestInput } from './to-telemetry.js'
import { pushSummary } from './push-summary.js'

function loadManifest(file: string): ManifestInput {
  const absolute = path.resolve(file)
  let text: string
  try {
    text = readFileSync(absolute, 'utf8')
  } catch (error) {
    throw new Error(`cannot read ${absolute}: ${describe(error)}`)
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new Error(`${absolute} is not valid JSON: ${describe(error)}`)
  }
  return {
    file: absolute,
    manifest: parseManifest(json, absolute),
    mtimeMs: statSync(absolute).mtimeMs
  }
}

function loadManifests(files: string[]): {
  loaded: ManifestInput[]
  problems: string[]
} {
  const loaded: ManifestInput[] = []
  const problems: string[] = []
  for (const file of files) {
    try {
      loaded.push(loadManifest(file))
    } catch (error) {
      problems.push(describe(error))
    }
  }
  return { loaded, problems }
}

function reportProblems(header: string, items: string[]): void {
  process.stderr.write(
    `wdio-otel: ${header}\n${items.map((item) => `  - ${item}\n`).join('')}`
  )
}

function reportUnreadable(zips: string[]): void {
  reportProblems(
    `${zips.length} trace zip(s) requested by --trace-zips could not be read, so their actions are missing:`,
    zips
  )
}

async function main(argv: string[]): Promise<number> {
  const args = parseCliArgs(argv)
  if (args.help) {
    process.stdout.write(CLI_USAGE)
    return 0
  }
  if (args.artifactBaseUrl && !isBrowserFetchable(args.artifactBaseUrl)) {
    process.stderr.write(
      `wdio-otel: --artifact-base-url ${args.artifactBaseUrl} is not http(s), so artifact links are recorded but a browser cannot open them for replay\n`
    )
  }
  const { loaded, problems } = loadManifests(args.manifests)
  if (problems.length > 0) {
    reportProblems(`nothing pushed, ${problems.length} problem(s):`, problems)
    return 1
  }
  return push(args, loaded)
}

async function push(args: PushArgs, loaded: ManifestInput[]): Promise<number> {
  if (args.consoleMessages && !args.traceZips) {
    process.stderr.write(
      'wdio-otel: --console-messages has no effect without --trace-zips\n'
    )
  }
  const plan = planPush({
    manifests: loaded,
    runId: args.runId,
    artifactBaseUrl: args.artifactBaseUrl,
    traceZips: args.traceZips,
    ignoreParentSampling: args.ignoreParentSampling,
    consoleMessages: args.consoleMessages,
    loadZip: (zipPath) => readFileSync(zipPath),
    realpath: (target) => realpathSync(target),
    warn: (message) => process.stderr.write(`wdio-otel: ${message}\n`)
  })
  const telemetry = createTelemetry({
    dryRun: args.dryRun,
    ignoreParentSampling: args.ignoreParentSampling,
    env: process.env
  })
  try {
    const tests = await plan.emit(telemetry)
    process.stdout.write(`wdio-otel: ${pushSummary(tests, plan)}\n`)
    const stale = staleSpanWarning(telemetry.oldestEndMs(), Date.now)
    if (stale) {
      process.stderr.write(`wdio-otel: ${stale}\n`)
    }
    const unreadable = plan.unreadable()
    if (unreadable.length > 0) {
      reportUnreadable(unreadable)
      return 1
    }
    return 0
  } finally {
    await telemetry.shutdown()
  }
}

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN)

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    process.stderr.write(`wdio-otel: ${describe(error)}\n`)
    process.exitCode = 1
  }
)
