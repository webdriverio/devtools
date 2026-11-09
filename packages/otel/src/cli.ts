#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { CLI_USAGE, isBrowserFetchable, parseCliArgs } from './cli-args.js'
import { parseManifest } from './manifest.js'
import { createTelemetry } from './providers.js'
import { planPush, type ManifestInput } from './to-telemetry.js'

const RUN_ID_SEPARATOR = '+'

function loadManifest(file: string): ManifestInput {
  const absolute = path.resolve(file)
  let json: unknown
  try {
    json = JSON.parse(readFileSync(absolute, 'utf8'))
  } catch (error) {
    throw new Error(
      `${absolute} is not JSON: ${error instanceof Error ? error.message : String(error)}`
    )
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
      problems.push(error instanceof Error ? error.message : String(error))
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
  const runIds = new Set(loaded.map(({ manifest }) => manifest.runId))
  const manifestRunId = runIds.size === 1 ? [...runIds][0] : undefined
  const runId =
    args.runId ??
    manifestRunId ??
    loaded
      .map(({ manifest }) => manifest.sessionId)
      .sort()
      .join(RUN_ID_SEPARATOR)
  const plan = planPush({
    manifests: loaded,
    runId,
    artifactBaseUrl: args.artifactBaseUrl,
    traceZips: args.traceZips,
    loadZip: (zipPath) => readFileSync(zipPath),
    warn: (message) => process.stderr.write(`wdio-otel: ${message}\n`)
  })
  const telemetry = createTelemetry({ dryRun: args.dryRun })
  try {
    const tests = await plan.emit(telemetry)
    process.stdout.write(
      `wdio-otel: pushed ${tests} test(s) from ${loaded.length} manifest(s) as run ${runId}\n`
    )
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

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    process.stderr.write(
      `wdio-otel: ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exitCode = 1
  }
)
