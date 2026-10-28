/**
 * Argv parsing for the `devtools-otel` bin. Split from `cli.ts` because that
 * file runs as its module body, so a unit test cannot import it.
 */

export const CLI_USAGE = `
  Usage: devtools-otel push <manifest...> [options]

  Pushes the tests in devtools-artifacts-<sessionId>.json manifests to the
  OpenTelemetry collector named by the standard OTEL_EXPORTER_OTLP_* env.

  Options:
    --artifact-base-url <url>  Base URL the retained trace zips are served from
    --run-id <id>              Run identity (default: sorted sessionIds joined by "+")
    --dry-run                  Print spans and log records to stdout instead of exporting
    -h, --help                 Show this message
`

export interface PushArgs {
  help: boolean
  manifests: string[]
  artifactBaseUrl?: string
  runId?: string
  dryRun: boolean
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
    return { help: true, manifests: [], dryRun: false }
  }
  if (command !== 'push') {
    throw new Error(`unknown command "${command}"; expected "push"`)
  }
  const args: PushArgs = { help: false, manifests: [], dryRun: false }
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === '--dry-run') {
      args.dryRun = true
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
