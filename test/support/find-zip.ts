import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

// Match a single-`*` basename glob (e.g. "trace*.zip") without a RegExp — the
// matrix's globs always use one wildcard, so prefix/suffix matching suffices
// and avoids a dynamic-RegExp lint/CodeQL flag.
function basenameMatches(fileGlob: string, name: string): boolean {
  const star = fileGlob.indexOf('*')
  if (star === -1) {
    return name === fileGlob
  }
  const prefix = fileGlob.slice(0, star)
  const suffix = fileGlob.slice(star + 1)
  return (
    name.length >= prefix.length + suffix.length &&
    name.startsWith(prefix) &&
    name.endsWith(suffix)
  )
}

// Resolve recursive "dir/<...>/trace*.zip" globs against a base dir and return
// the newest matching file. No glob dependency — a small walk covers the fixed
// shapes the matrix uses.
function matchesFor(glob: string, repoRoot: string): string[] {
  const wildcardAt = glob.indexOf('**')
  const baseRel =
    wildcardAt === -1 ? path.dirname(glob) : glob.slice(0, wildcardAt)
  const baseAbs = path.resolve(repoRoot, baseRel)
  const fileGlob = path.basename(glob)
  if (!existsSync(baseAbs)) {
    return []
  }

  const out: string[] = []
  const walk = (dir: string): void => {
    for (const dirent of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, dirent.name)
      if (dirent.isDirectory()) {
        walk(full)
      } else if (basenameMatches(fileGlob, dirent.name)) {
        out.push(full)
      }
    }
  }
  walk(baseAbs)
  return out
}

/** Newest file matching any of the globs (repo-root-relative), or null. */
export function findNewestZip(
  globs: string[],
  repoRoot: string
): string | null {
  const matches = globs.flatMap((glob) => matchesFor(glob, repoRoot))
  if (matches.length === 0) {
    return null
  }
  return matches.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
}
