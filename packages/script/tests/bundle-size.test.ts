import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { describe, it, expect } from 'vitest'

const BUNDLE = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  '..',
  'dist',
  'script.js'
)

/** This bundle is registered as a BiDi preload script, and headed Chrome 154
 *  degrades superlinearly with a preload's size: measured on a fresh session,
 *  1 KB navigated in 4.1s, 50 KB in 8.8s, and 100 KB never completed at all
 *  (#403). The ceiling is therefore a correctness guard rather than hygiene.
 *  It sits far under the first measured slowdown so a dependency added here
 *  fails on this assertion instead of on a user's stalled navigation. */
const CEILING_BYTES = 40 * 1024

describe('the injected collector bundle', () => {
  const built = fs.existsSync(BUNDLE)

  it.skipIf(!built)('stays small enough to preload without stalling', () => {
    const bytes = fs.statSync(BUNDLE).size

    expect(
      bytes,
      `dist/script.js is ${(bytes / 1024).toFixed(1)} KB, over the ${CEILING_BYTES / 1024} KB ceiling. ` +
        'A preload this size slows navigation in headed Chrome and can hang it outright. ' +
        'Check what was added to packages/script, not the ceiling.'
    ).toBeLessThan(CEILING_BYTES)
  })

  it.skipIf(!built)('carries no HTML parser or view library', () => {
    // The 148 KB parser was there to reparse `outerHTML` the collector could
    // read straight off the DOM, and the view library built vnodes the app
    // rebuilds itself. Both are the shapes this ceiling exists to keep out.
    const source = fs.readFileSync(BUNDLE, 'utf8')

    expect(source).not.toContain('parse5')
    expect(source).not.toContain('htm/preact')
  })
})
