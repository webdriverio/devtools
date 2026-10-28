#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { CLI_USAGE, isBrowserFetchable, parseCliArgs } from './cli-args.js'
import { hasRetentionFilter, parseManifest } from './manifest.js'
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

function withoutRetentionFilter(loaded: ManifestInput[]): ManifestInput[] {
  return loaded.filter(({ file, manifest }) => {
    if (hasRetentionFilter(manifest)) {
      process.stderr.write(
        `devtools-otel: skipped ${file}: it has retained:false artifacts, so a retain-on-failure or retain-on-first-failure policy ran. Set tracePolicy:'on' so every test's trace is kept.\n`
      )
      return false
    }
    return true
  })
}

async function main(argv: string[]): Promise<number> {
  const args = parseCliArgs(argv)
  if (args.help) {
    process.stdout.write(CLI_USAGE)
    return 0
  }
  if (args.artifactBaseUrl && !isBrowserFetchable(args.artifactBaseUrl)) {
    process.stderr.write(
      `devtools-otel: --artifact-base-url ${args.artifactBaseUrl} is not http(s), so artifact links are recorded but a browser cannot open them for replay\n`
    )
  }
  const { loaded, problems } = loadManifests(args.manifests)
  const pushable = withoutRetentionFilter(loaded)
  const runId =
    args.runId ??
    pushable
      .map(({ manifest }) => manifest.sessionId)
      .sort()
      .join(RUN_ID_SEPARATOR)
  const plan = planPush({
    manifests: pushable,
    runId,
    nowMs: Date.now(),
    artifactBaseUrl: args.artifactBaseUrl,
    loadZip: (zipPath) => readFileSync(zipPath),
    warn: (message) => process.stderr.write(`devtools-otel: ${message}\n`)
  })
  const allProblems = [...problems, ...plan.problems]
  if (allProblems.length > 0) {
    process.stderr.write(
      `devtools-otel: nothing pushed, ${allProblems.length} problem(s):\n${allProblems.map((problem) => `  - ${problem}\n`).join('')}`
    )
    return 1
  }
  const telemetry = createTelemetry({ dryRun: args.dryRun })
  try {
    const tests = await plan.emit(telemetry)
    process.stdout.write(
      `devtools-otel: pushed ${tests} test(s) from ${pushable.length} manifest(s) as run ${runId}\n`
    )
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
      `devtools-otel: ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exitCode = 1
  }
)
