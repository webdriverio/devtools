const SUPPORTED_MAJOR = 10
const MIN_MINOR = 2

const VERSION_RE = /^(\d+)\.(\d+)\./

/** 10.x from 10.2, prereleases included (looser than semver's ^10.2.0, which rejects 10.2.0-beta). */
export function rendersWithWdioSnapshot(version: string | undefined): boolean {
  const match = VERSION_RE.exec(version ?? '')
  return (
    match !== null &&
    Number(match[1]) === SUPPORTED_MAJOR &&
    Number(match[2]) >= MIN_MINOR
  )
}
