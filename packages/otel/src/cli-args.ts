/**
 * Argv parsing for the `wdio-otel` bin. Split from `cli.ts` because that
 * file runs as its module body, so a unit test cannot import it.
 */

export const CLI_USAGE = `
  Usage: wdio-otel push <manifest...> [options]

  Pushes the tests in devtools-artifacts-<sessionId>.json manifests to the
  OpenTelemetry collector named by the standard OTEL_EXPORTER_OTLP_* env.
  Each attempt becomes a root span with the ids the manifest records.

  Options:
    --artifact-base-url <url>  Base URL the trace zips are served from
    --run-id <id>              Run identity (default: the manifests' runId when they agree, else sorted sessionIds joined by "+")
    --trace-zips               Read each test's trace zip and push its actions as child spans (a missing zip warns and skips them)
    --dry-run                  Print spans to stdout instead of exporting
    -h, --help                 Show this message
`

interface PushArgs {
  help: boolean
  manifests: string[]
  artifactBaseUrl?: string
  runId?: string
  dryRun: boolean
  traceZips: boolean
}

const BROWSER_FETCHABLE_PROTOCOLS = ['http:', 'https:']

export function isBrowserFetchable(url: string): boolean {
  try {
    return BROWSER_FETCHABLE_PROTOCOLS.includes(new URL(url).protocol)
  } catch {
    return false
  }
}

const VALUE_FLAGS = ['--artifact-base-url', '--run-id'] as const
type ValueFlag = (typeof VALUE_FLAGS)[number]

export function parseCliArgs(argv: readonly string[]): PushArgs {
  const [command, ...rest] = argv
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    return {
      help: true,
      manifests: [],
      dryRun: false,
      traceZips: false
    }
  }
  if (command !== 'push') {
    throw new Error(`unknown command "${command}"; expected "push"`)
  }
  const args: PushArgs = {
    help: false,
    manifests: [],
    dryRun: false,
    traceZips: false
  }
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === '--dry-run') {
      args.dryRun = true
      continue
    }
    if (arg === '--trace-zips') {
      args.traceZips = true
      continue
    }
    const flag = VALUE_FLAGS.find(
      (name) => arg === name || arg.startsWith(`${name}=`)
    )
    if (flag) {
      const value = arg === flag ? rest[++i] : arg.slice(flag.length + 1)
      if (!value || value.startsWith('--')) {
        throw new Error(`${flag} needs a value`)
      }
      assignValue(args, flag, value)
      continue
    }
    if (arg.startsWith('-')) {
      throw new Error(`unknown option "${arg}"`)
    }
    args.manifests.push(arg)
  }
  if (args.manifests.length === 0) {
    throw new Error('push needs at least one manifest path')
  }
  return args
}

function assignValue(args: PushArgs, flag: ValueFlag, value: string): void {
  if (flag === '--artifact-base-url') {
    args.artifactBaseUrl = value
  } else {
    args.runId = value
  }
}
