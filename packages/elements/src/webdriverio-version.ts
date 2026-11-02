import { createRequire } from 'node:module'
import { isModuleNotFound, packageVersionOf } from './package-version.js'
import { rendersWithWdioSnapshot } from './snapshot-version.js'

export function installedWebdriverioVersion(): string | undefined {
  try {
    return packageVersionOf(
      createRequire(import.meta.url).resolve('webdriverio'),
      'webdriverio'
    )
  } catch (err) {
    if (!isModuleNotFound(err)) {
      console.warn(
        `@wdio/elements: could not resolve webdriverio: ${(err as Error).message}`
      )
    }
    return undefined
  }
}

let usesSnapshot: boolean | undefined

export function usesWdioSnapshot(): boolean {
  usesSnapshot ??= rendersWithWdioSnapshot(installedWebdriverioVersion())
  return usesSnapshot
}
