import { captureLaunchCommand } from './helpers/utils.js'

// Per-runner CLI flag for filtering by test/scenario name.
const FILTER_FLAGS: Record<string, string> = {
  mocha: '--grep',
  jest: '--testNamePattern',
  vitest: '-t',
  cucumber: '--name'
}

// Aliases of FILTER_FLAGS we strip from the inherited argv. Without this, a
// rerun child's argv carries the previous filter and the next template gets
// `… --testNamePattern "old" --testNamePattern "new"` (matched as joined).
const FILTER_FLAG_ALIASES: Record<string, string[]> = {
  mocha: ['--grep', '-g'],
  jest: ['--testNamePattern', '-t'],
  vitest: ['-t', '--testNamePattern'],
  cucumber: ['--name']
}

export class RerunManager {
  #launchCommand: string
  #runner: string
  #rerunTemplate?: string

  constructor(runner: string) {
    this.#launchCommand = captureLaunchCommand()
    this.#runner = runner
  }

  configure(template: string | undefined) {
    this.#rerunTemplate = template
  }

  /** Replays argv + runner filter flag; backend swaps in {{testName}} at exec. */
  get rerunTemplate(): string | undefined {
    if (this.#rerunTemplate) {
      return this.#rerunTemplate
    }
    const flag = FILTER_FLAGS[this.#runner]
    if (!flag) {
      return undefined
    }
    const argv = this.#stripFilterFlags([
      process.argv0,
      ...process.argv.slice(1)
    ])
    const quoted = argv.map((a) => this.#shellQuote(a)).join(' ')
    return `${quoted} ${flag} "{{testName}}"`
  }

  #stripFilterFlags(argv: string[]): string[] {
    const aliases = FILTER_FLAG_ALIASES[this.#runner] ?? []
    if (aliases.length === 0) {
      return argv
    }
    const out: string[] = []
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i]
      if (aliases.includes(a)) {
        i++
        continue
      }
      if (aliases.some((alias) => a.startsWith(`${alias}=`))) {
        continue
      }
      out.push(a)
    }
    return out
  }

  get launchCommand() {
    return this.#launchCommand
  }

  /** Single-quote for `sh -c`; embedded single-quotes get the `'\''` dance. */
  #shellQuote(s: string): string {
    if (s === '') {
      return "''"
    }
    if (/^[a-zA-Z0-9_\-./=:@]+$/.test(s)) {
      return s
    }
    return `'${s.replace(/'/g, "'\\''")}'`
  }
}
