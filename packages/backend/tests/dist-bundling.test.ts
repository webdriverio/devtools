/**
 * The backend ships `dist/server.js` and `dist/show-trace.js` as executables,
 * so a bundling mistake here is a crash on the user's machine rather than a
 * failing build.
 *
 * The failure this guards against: importing a value from a CJS-only package
 * (yazl) pulls it into tsup's ESM output, where esbuild replaces `require` with
 * a shim that throws `Dynamic require of "fs" is not supported` the moment the
 * module is loaded. It cost `pnpm show-trace` entirely, and neither `pnpm
 * build`, `pnpm test` nor the workspace-internal leak grep in CLAUDE.md §2.6
 * noticed — every one of them passes on a dist that dies on first import.
 *
 * The fix is always the same: declare the CJS package in `dependencies` so it
 * is externalized and Node loads it natively, which is what the three adapters
 * already do for yazl.
 *
 * Gated on the build having run — CI test jobs may execute before it.
 */

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { describe, it, expect } from 'vitest'

const distDir = path.resolve(
  url.fileURLToPath(new URL('.', import.meta.url)),
  '..',
  'dist'
)

const bundles = fs.existsSync(distDir)
  ? fs.readdirSync(distDir).filter((f) => f.endsWith('.js'))
  : []

describe('backend dist bundling', () => {
  it.skipIf(bundles.length === 0)(
    'bundles no CJS dependency that would need a require shim at runtime',
    () => {
      const offenders = bundles.filter((file) =>
        fs
          .readFileSync(path.join(distDir, file), 'utf8')
          .includes('Dynamic require of')
      )
      expect(offenders).toEqual([])
    }
  )

  // Named explicitly because it is the one the trace writer pulls in, and the
  // shim check above only fails once esbuild happens to emit a shim.
  it.skipIf(bundles.length === 0)(
    'reaches yazl by import rather than inlining it — it is CJS',
    () => {
      const inlining = bundles.filter((file) =>
        fs
          .readFileSync(path.join(distDir, file), 'utf8')
          .includes('node_modules/yazl/index.js')
      )
      expect(inlining).toEqual([])
    }
  )
})
