// Re-exports + small helpers used across the service. The heavy lifting
// (AST parsing, source mapping, cucumber step-def lookup) lives in
// utils/source-mapping.ts and utils/step-defs.ts.

export {
  setCurrentSpecFile,
  findTestLocations,
  getCurrentTestLocation,
  mapTestToSource,
  mapSuiteToSource
} from './utils/source-mapping.js'
export { findStepDefinitionLocation } from './utils/step-defs.js'

/** A spec file owned by the user — excludes node-builtins and node_modules,
 *  but keeps WDIO's expect helpers (callers may want to step into those). */
export function isUserSpecFile(file?: string | null): boolean {
  if (!file) {
    return false
  }
  if (file.startsWith('node:')) {
    return false
  }
  const normalized = file.replace(/\\/g, '/')
  if (normalized.includes('/@wdio/expect-webdriverio/')) {
    return true
  }
  return !normalized.includes('/node_modules/')
}

/** Walk up an element chain to its root browser. */
export function getBrowserObject(
  elem: WebdriverIO.Element | WebdriverIO.Browser
): WebdriverIO.Browser {
  const elemObject = elem as WebdriverIO.Element
  return (elemObject as WebdriverIO.Element).parent
    ? getBrowserObject(elemObject.parent)
    : (elem as WebdriverIO.Browser)
}
