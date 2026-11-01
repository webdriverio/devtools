import fs from 'node:fs/promises'
import url from 'node:url'
import path from 'node:path'
import { resolve } from 'import-meta-resolve'

/**
 * Source of the page-side collector every adapter injects, read from the
 * `@wdio/devtools-script` package this backend depends on.
 *
 * Serving it is what lets an adapter installed outside a checkout capture DOM
 * mutations: locating it on disk only ever worked in the monorepo. Throws
 * rather than degrading, matching `getDevtoolsApp` — a backend that cannot
 * hand out the collector is broken, and a silent failure here reappears as a
 * mysteriously empty preview panel in whichever adapter connected.
 */
export async function getCollectorSource(): Promise<string> {
  let entry: string
  try {
    entry = url.fileURLToPath(
      await resolve('@wdio/devtools-script', import.meta.url)
    )
  } catch {
    throw new Error(
      "Couldn't find @wdio/devtools-script package, do you have it installed?"
    )
  }
  try {
    return await fs.readFile(entry, 'utf-8')
  } catch (err) {
    throw new Error(
      `Found @wdio/devtools-script at ${entry} but could not read it: ` +
        `${(err as Error).message}. Has the package been built?`
    )
  }
}

export async function getDevtoolsApp() {
  try {
    const appPkg = await resolve('@wdio/devtools-app', import.meta.url)
    return path.resolve(url.fileURLToPath(appPkg), '..', '..', 'dist')
  } catch {
    throw new Error(
      "Couldn't find @wdio/devtools-app package, do you have it installed?"
    )
  }
}
