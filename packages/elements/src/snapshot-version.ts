export const WDIO_SNAPSHOT_MIN = { major: 10, minor: 2 } as const

const VERSION_RE = /^(\d+)\.(\d+)\./

export function rendersWithWdioSnapshot(version: string | undefined): boolean {
  const match = VERSION_RE.exec(version ?? '')
  if (!match) {
    return false
  }
  const major = Number(match[1])
  const minor = Number(match[2])
  return (
    major > WDIO_SNAPSHOT_MIN.major ||
    (major === WDIO_SNAPSHOT_MIN.major && minor >= WDIO_SNAPSHOT_MIN.minor)
  )
}
