/**
 * Argv parsing for the `wdio-otel` bin. Split from `cli.ts` because that
 * file runs as its module body, so a unit test cannot import it.
 */

export const CLI_USAGE = `
  Usage: wdio-otel push <manifest...> [options]

  Pushes the tests in devtools-artifacts-<sessionId>.json manifests to the
  OpenTelemetry collector named by the standard OTEL_EXPORTER_OTLP_* env.
  Each attempt becomes a span with the ids the manifest records; without a
  TRACEPARENT, the attempts of a test share one trace.

  Options:
    --artifact-base-url <url>  Base URL the trace zips are served from
    --run-id <id>              Run identity for every manifest (default: each manifest's runId, else its sessionId)
    --trace-zips               Read each test's trace zip and push its actions as child spans (a missing zip warns and skips them)
    --console-messages         Push console warnings and errors as span events, with their text (needs --trace-zips; may contain personal data)
    --ignore-parent-sampling   Push manifests recorded under an unsampled TRACEPARENT anyway
    --dry-run                  Print spans to stdout instead of exporting
    -h, --help                 Show this message
`

export interface PushArgs {
  help: boolean
  manifests: string[]
  artifactBaseUrl?: string
  runId?: string
  dryRun: boolean
  traceZips: boolean
  consoleMessages: boolean
  ignoreParentSampling: boolean
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
type BooleanFlag =
  'dryRun' | 'traceZips' | 'consoleMessages' | 'ignoreParentSampling'
const BOOLEAN_FLAGS: ReadonlyMap<string, BooleanFlag> = new Map([
  ['--dry-run', 'dryRun'],
  ['--trace-zips', 'traceZips'],
  ['--console-messages', 'consoleMessages'],
  ['--ignore-parent-sampling', 'ignoreParentSampling']
])
const UNSET_FLAGS: Record<BooleanFlag, false> = {
  dryRun: false,
  traceZips: false,
  consoleMessages: false,
  ignoreParentSampling: false
}
type ValueFlag = (typeof VALUE_FLAGS)[number]

export function parseCliArgs(argv: readonly string[]): PushArgs {
  const [command, ...rest] = argv
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    return { help: true, manifests: [], ...UNSET_FLAGS }
  }
  if (command !== 'push') {
    throw new Error(`unknown command "${command}"; expected "push"`)
  }
  const args: PushArgs = { help: false, manifests: [], ...UNSET_FLAGS }
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    const flag = BOOLEAN_FLAGS.get(arg)
    if (flag) {
      args[flag] = true
      continue
    }
    const valueFlag = VALUE_FLAGS.find(
      (name) => arg === name || arg.startsWith(`${name}=`)
    )
    if (valueFlag) {
      const value =
        arg === valueFlag ? rest[++i] : arg.slice(valueFlag.length + 1)
      if (!value || value.startsWith('--')) {
        throw new Error(`${valueFlag} needs a value`)
      }
      assignValue(args, valueFlag, value)
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
