import path from 'node:path'

// A forked worker's argv lacks the config arg, so only the launcher can read it here.
export function configPathFromArgv(): string | undefined {
  const argv = process.argv
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === '--config' || argv[i] === '-c') {
      const next = argv[i + 1]
      if (next && /\.(conf|config)\.(ts|js|cjs|mjs)$/i.test(next)) {
        return path.isAbsolute(next) ? next : path.resolve(process.cwd(), next)
      }
    }
  }
  const positional = argv.find((a) => /\.conf\.(ts|js|cjs|mjs)$/i.test(a))
  if (!positional) {
    return undefined
  }
  return path.isAbsolute(positional)
    ? positional
    : path.resolve(process.cwd(), positional)
}

export function detectInvocationSpecs(): string[] {
  const argv = process.argv
  const out: string[] = []
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === '--spec' || argv[i] === '-s') {
      const raw = argv[i + 1]
      if (!raw) {
        continue
      }
      for (const part of raw.split(',')) {
        const trimmed = part.trim()
        if (!trimmed) {
          continue
        }
        out.push(
          path.isAbsolute(trimmed)
            ? trimmed
            : path.resolve(process.cwd(), trimmed)
        )
      }
    }
  }
  return out
}
