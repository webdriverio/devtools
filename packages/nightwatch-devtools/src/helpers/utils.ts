// Track test occurrences to generate stable UIDs
const signatureCounters = new Map<string, number>()

/**
 * Generate stable UID for test/suite
 * Accepts either (item: SuiteStats | TestStats) or (file: string, name: string)
 */
export function generateStableUid(itemOrFile: any, name?: string): string {
  let file: string, testName: string
  if (typeof itemOrFile === 'object' && itemOrFile !== null && name === undefined) {
    file = itemOrFile.file || ''
    testName = String(itemOrFile.fullTitle || itemOrFile.title)
  } else {
    file = itemOrFile || ''
    testName = String(name || '')
  }
  const parts = [file, testName]
  const signature = parts.join('::')
  const count = signatureCounters.get(signature) || 0
  signatureCounters.set(signature, count + 1)
  if (count > 0) {
    parts.push(String(count))
  }
  // Generate hash for stable, short UIDs
  const hash = parts
    .join('::')
    .split('')
    .reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0)
  return `stable-${Math.abs(hash).toString(36)}`
}

/**
 * Reset counters at the start of each test run
 */
export function resetSignatureCounters() {
  signatureCounters.clear()
}
/**
 * Utility functions for test file discovery and metadata extraction
 * Based on WDIO DevTools approach
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { parse as parseStackTrace } from 'stacktrace-parser'

// File patterns for test file identification
const SPEC_FILE_PATTERN = /\/(test|spec|tests)\//i
const SPEC_FILE_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$/i

/**
 * Find test file from stack trace (WDIO DevTools approach)
 * Parses call stack to find the first frame that looks like a test file
 */
export function findTestFileFromStack(): string | undefined {
  const stack = new Error().stack
  if (!stack) {
    return undefined
  }
  const frames = parseStackTrace(stack)
  const testFrame = frames.find((frame: any) => {
    const file = frame.file
    return (
      file &&
      !file.includes('/node_modules/') &&
      !file.includes('<anonymous>') &&
      !file.includes('node:internal') &&
      !file.includes('/dist/') &&
      !file.includes('/index.js') &&
      (SPEC_FILE_PATTERN.test(file) || SPEC_FILE_RE.test(file))
    )
  })
  if (testFrame && testFrame.file) {
    let filePath: string = testFrame.file
    // Strip file:// protocol if present
    if (filePath.startsWith('file://')) {
      filePath = filePath.replace('file://', '')
    }
    // Remove line:col suffix
    filePath = filePath.split(':')[0]
    // Verify file exists
    if (fs.existsSync(filePath)) {
      return filePath
    }
  }
  return undefined
}

/**
 * Extract suite and test names from test file using simple regex (lightweight approach)
 * Falls back to simple regex matching instead of full AST parsing for performance
 */
export function extractTestMetadata(filePath: string): {
  suiteTitle: string | null
  testNames: string[]
} {
  const result: { suiteTitle: string | null; testNames: string[] } = {
    suiteTitle: null,
    testNames: []
  }
  if (!fs.existsSync(filePath)) {
    return result
  }
  try {
    const source = fs.readFileSync(filePath, 'utf-8')
    // Extract first describe() or suite() call
    const suiteMatch = source.match(
      /(?:describe|suite|context)\s*\(\s*['"']([^'"']+)['"']/
    )
    if (suiteMatch && suiteMatch[1]) {
      result.suiteTitle = suiteMatch[1]
    }
    // Extract all it() or test() calls
    const testRegex = /(?:it|test|specify)\s*\(\s*['"']([^'"']+)['"']/g
    let match: RegExpExecArray | null
    while ((match = testRegex.exec(source)) !== null) {
      result.testNames.push(match[1])
    }
  } catch (err) {
    console.log(
      `[DEBUG] Failed to parse test file ${filePath}: ${(err as Error).message}`
    )
  }
  return result
}

/**
 * Get call source info from stack trace (WDIO approach)
 * Returns filename:line format for display
 */
export function getCallSourceFromStack(): {
  filePath: string | undefined
  callSource: string
} {
  const stack = new Error().stack
  if (!stack) {
    return { filePath: undefined, callSource: 'unknown:0' }
  }
  const frames = parseStackTrace(stack)
  const userFrame = frames.find((frame: any) => {
    const file = frame.file
    return (
      file &&
      !file.includes('/node_modules/') &&
      !file.includes('<anonymous>') &&
      !file.includes('node:internal') &&
      !file.includes('/dist/') &&
      !file.includes('/index.js')
    )
  })
  if (userFrame && userFrame.file) {
    let filePath: string = userFrame.file
    // Strip file:// protocol
    if (filePath.startsWith('file://')) {
      filePath = filePath.replace('file://', '')
    }
    // Remove line:col from filePath
    const cleanFilePath: string = filePath.split(':')[0]
    // Use full path with line number for callSource so Source tab can match it
    const callSource: string = `${cleanFilePath}:${userFrame.lineNumber || 0}`
    return { filePath: cleanFilePath, callSource }
  }
  return { filePath: undefined, callSource: 'unknown:0' }
}

/**
 * Find test file by searching workspace for matching filename
 * Used when stack trace doesn't have the file yet (in beforeEach)
 */
export function findTestFileByName(
  filename: string,
  workspaceRoot?: string
): string | undefined {
  if (!filename || !workspaceRoot) {
    return undefined
  }
  // Clean up filename - remove extensions and normalize
  const baseFilename: string = filename.replace(/\.[cm]?[jt]sx?$/, '')
  // Recursively search directories
  function searchDir(dir: string, depth = 0): string | undefined {
    if (depth > 5) {
      return undefined
    } // Limit recursion depth
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          const found = searchDir(fullPath, depth + 1)
          if (found) {
            return found
          }
        } else {
          // Match test/spec files
          const nameMatch =
            entry.name === `${baseFilename}.test.js` ||
            entry.name === `${baseFilename}.spec.js` ||
            entry.name === `${baseFilename}.test.ts` ||
            entry.name === `${baseFilename}.spec.ts`
          if (nameMatch) {
            return fullPath
          }
        }
      }
    } catch {
      // Permission denied or other error, skip this directory
    }
    return undefined
  }
  return searchDir(workspaceRoot)
}
