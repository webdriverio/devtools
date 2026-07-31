// Component tests for the Lit elements in packages/app/src — mount one with
// explicit inputs, assert its shadow DOM in a real browser.
//
// The browser runner serves the specs through Vite, so it is handed the app's
// own vite.config.ts rather than a second copy of it: the components import
// `~icons/*` (unplugin-icons), Tailwind through postcss, and the `@` / `@core`
// / `@components` aliases — none of which the runner's default Vite config
// resolves, so without it every spec fails at import.
//
// The `reference types` directive is load-bearing: it is what populates
// `WebdriverIO.BrowserRunnerOptions` with the `viteConfig` / `preset` /
// `headless` options used below.
//
// Headless by default so runs are quiet and reproducible; HEADED=1 shows the
// browser and the in-page mocha reporter.

/// <reference types="@wdio/browser-runner" />

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import appViteConfig from './vite.config.js'

const appDir = path.dirname(fileURLToPath(import.meta.url))
const headed = process.env.HEADED === '1' || process.env.HEADED === 'true'
// INSPECT=1 makes the browser attachable from an editor: a fixed CDP port, one
// worker so nothing contends for it, and headed so the paused page is visible.
const inspect = process.env.INSPECT === '1' || process.env.INSPECT === 'true'
const INSPECT_PORT = 9222
const requireFromApp = createRequire(import.meta.url)

// The runner asks Vite to pre-bundle these CJS packages so the browser can
// import them as ESM. Under pnpm none of them are reachable from this package,
// so Vite silently skips them and the first one the import graph touches throws
// `does not provide an export named 'default'` — every spec fails at load. They
// are reachable from `webdriverio`, which depends on them, so each is mapped to
// its real path. Keep in step with the runner's own `optimizeDeps.include`.
const RUNNER_CJS_DEPS = [
  'expect',
  'minimatch',
  'css-shorthand-properties',
  'lodash.merge',
  'lodash.zip',
  'ws',
  'lodash.clonedeep',
  'lodash.pickby',
  'lodash.flattendeep',
  'aria-query',
  'grapheme-splitter',
  'css-value',
  'rgb2hex',
  'p-iteration',
  'deepmerge-ts',
  'jest-util',
  'jest-matcher-utils',
  'split2'
]

function tryResolve(require_: NodeJS.Require, id: string): string | undefined {
  try {
    return require_.resolve(id)
  } catch {
    // Not reachable from this base — the caller falls through to the next one.
    return undefined
  }
}

/** Real path per CJS dep, resolved from this package first and then from the
 *  packages that depend on them. A dep that resolves nowhere is left out: it is
 *  unreachable, so nothing can import it either. */
function cjsDepAliases(): Record<string, string> {
  const bases = ['webdriverio', 'expect']
    .map((id) => tryResolve(requireFromApp, id))
    .filter((entry): entry is string => Boolean(entry))
    .map((entry) => createRequire(entry))
  const aliases: Record<string, string> = {}
  for (const dep of RUNNER_CJS_DEPS) {
    for (const require_ of [requireFromApp, ...bases]) {
      const resolved = tryResolve(require_, dep)
      if (resolved) {
        aliases[dep] = resolved
        break
      }
    }
  }
  return aliases
}

// The app's config declares `alias` as an object literal, so it is spread rather
// than concatenated as the array form would need.
const appAlias = appViteConfig.resolve?.alias as Record<string, string>

const viteConfig = {
  ...appViteConfig,
  resolve: {
    ...appViteConfig.resolve,
    alias: { ...appAlias, ...cjsDepAliases() }
  }
}

export const config: WebdriverIO.Config = {
  runner: [
    'browser',
    {
      preset: 'lit',
      rootDir: appDir,
      headless: !(headed || inspect),
      viteConfig
    }
  ],
  specs: ['./test-ui/**/*.test.ts'],
  capabilities: [
    {
      browserName: 'chrome',
      ...(inspect
        ? {
            'goog:chromeOptions': {
              args: [`--remote-debugging-port=${INSPECT_PORT}`]
            }
          }
        : {})
    }
  ],
  // 2, not the default 100 (a browser per spec file all at once): every worker
  // carries its own Vite server plus a Chrome, and past 2 that contention alone
  // pushes the heaviest specs over the 30s timeout — at 4 three spec files fail
  // there and the suite is also slower overall than at 2. One when inspecting,
  // since a fixed debugging port can only serve a single browser.
  maxInstances: inspect ? 1 : 2,
  logLevel: 'warn',
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 30000
  }
}
