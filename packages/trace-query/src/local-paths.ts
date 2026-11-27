import fs from 'node:fs/promises'
import path from 'node:path'

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative.split(path.sep)[0] !== '..')
  )
}

async function realRootOf(root: string): Promise<string> {
  try {
    return await fs.realpath(path.resolve(root))
  } catch (error) {
    throw new Error(
      `The allowed root ${root} cannot be resolved: ${(error as Error).message}`
    )
  }
}

function outside(target: string, allowedRoots: readonly string[]): Error {
  return new Error(
    `Cannot open ${target}: it is outside the allowed roots (${allowedRoots.join(', ')})`
  )
}

/** The real path of `target`, refused unless it resolves inside an allowed root once symlinks and `..` are followed. A path outside every root is refused before it is looked up, so the refusal says nothing about what exists there. */
export async function guardedRealPath(
  target: string,
  allowedRoots: readonly string[]
): Promise<string> {
  if (allowedRoots.length === 0) {
    throw new Error(
      `Cannot open ${target}: no allowed root is configured, so local traces are refused`
    )
  }
  const roots = await Promise.all(allowedRoots.map(realRootOf))
  const resolved = path.resolve(target)
  const lexicalRoots = allowedRoots.map((root) => path.resolve(root))
  if (![...roots, ...lexicalRoots].some((root) => isWithin(root, resolved))) {
    throw outside(target, allowedRoots)
  }
  const real = await fs.realpath(resolved).catch((error: unknown) => {
    const code = (error as NodeJS.ErrnoException).code ?? 'unreadable'
    throw new Error(`Cannot open ${target}: ${code}`)
  })
  if (!roots.some((root) => isWithin(root, real))) {
    throw outside(target, allowedRoots)
  }
  return real
}
