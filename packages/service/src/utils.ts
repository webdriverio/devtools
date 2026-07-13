// Re-exports + small helpers used across the service. The heavy lifting
// (AST parsing, source mapping, cucumber step-def lookup) lives in
// utils/source-mapping.ts and utils/step-defs.ts.

import path from 'node:path'
import { fileURLToPath } from 'node:url'

export {
  setCurrentSpecFile,
  findTestLocations,
  getCurrentTestLocation,
  mapTestToSource,
  mapSuiteToSource
} from './utils/source-mapping.js'
export { findStepDefinitionLocation } from './utils/step-defs.js'

/** The service's own bundle directory. Stack frames from here are the service's
 *  instrumentation, not user code — a normal install has the service under
 *  node_modules (already excluded below), but a monorepo/linked setup puts the
 *  built service outside node_modules, so exclude it explicitly. */
const SELF_DIR = path
  .dirname(fileURLToPath(import.meta.url))
  .replace(/\\/g, '/')

/** A spec file owned by the user — excludes node-builtins, node_modules, and
 *  the service's own bundle, but keeps WDIO's expect helpers (callers may want
 *  to step into those). */
export function isUserSpecFile(file?: string | null): boolean {
  if (!file) {
    return false
  }
  if (file.startsWith('node:')) {
    return false
  }
  // ESM stack frames report a file:// URL; SELF_DIR is a plain path, so decode
  // to a plain path first or the self-bundle exclusion below silently no-ops.
  // Use fileURLToPath (not `new URL().pathname`) so the Windows drive-letter is
  // normalized the same way SELF_DIR is — otherwise `/C:/…` vs `C:/…` mismatch.
  let normalized = file
  if (normalized.startsWith('file://')) {
    try {
      normalized = fileURLToPath(normalized)
    } catch {
      /* keep the raw value */
    }
  }
  normalized = normalized.replace(/\\/g, '/')
  if (normalized.includes('/@wdio/expect-webdriverio/')) {
    return true
  }
  if (normalized.startsWith(SELF_DIR)) {
    return false
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
