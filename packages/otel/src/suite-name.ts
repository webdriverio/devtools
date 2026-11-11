// String logic, not path.relative: a manifest written on Windows may be pushed from Linux.
export function suiteNameOf(specFile: string, cwd: string | undefined): string {
  if (cwd === undefined) {
    return specFile
  }
  const root = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  const spec = specFile.replace(/\\/g, '/')
  return spec.startsWith(`${root}/`) ? spec.slice(root.length + 1) : specFile
}
