import { createRequire } from 'node:module'
import { packageVersionOf } from './package-version.js'
import { rendersWithWdioSnapshot } from './snapshot-version.js'

export function installedWebdriverioVersion(): string | undefined {
  try {
    return packageVersionOf(
      createRequire(import.meta.url).resolve('webdriverio'),
      'webdriverio'
    )
  } catch {
    return undefined
  }
}

let usesSnapshot: boolean | undefined

export function usesWdioSnapshot(): boolean {
  usesSnapshot ??= rendersWithWdioSnapshot(installedWebdriverioVersion())
  return usesSnapshot
}
