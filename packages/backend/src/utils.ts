import url from 'node:url'
import path from 'node:path'
import { resolve } from 'import-meta-resolve'

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
