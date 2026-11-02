import fs from 'node:fs/promises'
import path from 'node:path'

/** A zip `show-trace` serves in a run: where it is, and how to name it. */
export interface TraceRunFile {
  /** Absolute path the bytes are read from. */
  file: string
  /** What the player lists it as. */
  path: string
}

const isZipName = (name: string): boolean => name.toLowerCase().endsWith('.zip')

async function zipsUnder(dir: string): Promise<string[]> {
  const found: string[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...(await zipsUnder(full)))
    } else if (entry.isFile() && isZipName(entry.name)) {
      found.push(full)
    }
  }
  return found
}

/** The zips the arguments name: a file as given (the reader refuses a non-zip), a folder as every zip under it, sorted. */
export async function collectTraceZips(
  args: readonly string[],
  cwd: string
): Promise<string[]> {
  const files = new Set<string>()
  for (const arg of args) {
    const resolved = path.resolve(cwd, arg)
    const stat = await fs.stat(resolved)
    const found = stat.isDirectory()
      ? (await zipsUnder(resolved)).sort()
      : [resolved]
    found.forEach((file) => files.add(file))
  }
  return [...files]
}

/** Relative to `cwd`, so per-test folder names read as written; absolute when outside it. */
export function traceRunFiles(
  files: readonly string[],
  cwd: string
): TraceRunFile[] {
  return files.map((file) => {
    const relative = path.relative(cwd, file)
    const outside = relative.startsWith('..') || path.isAbsolute(relative)
    return {
      file,
      path: (outside ? file : relative).split(path.sep).join('/')
    }
  })
}
