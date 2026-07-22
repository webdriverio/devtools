# @wdio/nightwatch-devtools

> Nightwatch adapter for [WebdriverIO DevTools](../../README.md) - brings the same visual debugging UI to your Nightwatch test suite with zero test code changes.

```bash
npm install @wdio/nightwatch-devtools
```

---

## Setup

### Standard Nightwatch (mocha-style)

```javascript
// nightwatch.conf.cjs
const nightwatchDevtools = require('@wdio/nightwatch-devtools').default

module.exports = {
  src_folders: ['tests'],

  test_settings: {
    default: {
      desiredCapabilities: {
        browserName: 'chrome',
        // Required for network request capture
        'goog:loggingPrefs': { performance: 'ALL' }
      },
      globals: nightwatchDevtools({ port: 3000 })
    }
  }
}
```

Run your tests as normal — the DevTools UI opens automatically in a new browser window:

```bash
nightwatch
```

> No changes to your test files are needed.

---

### Cucumber / BDD

Import `cucumberHooksPath` alongside the main export and pass it to the Cucumber `require` option. This registers `Before` / `After` scenario hooks that mirror the WebdriverIO service's `beforeScenario` / `afterScenario` behaviour.

```javascript
// nightwatch.conf.cjs
const nightwatchDevtools = require('@wdio/nightwatch-devtools').default
const { cucumberHooksPath } = require('@wdio/nightwatch-devtools')

module.exports = {
  src_folders: ['features/step_definitions'],

  test_runner: {
    type: 'cucumber',
    options: {
      feature_path: 'features',
      require: [cucumberHooksPath]  // <-- register DevTools Cucumber hooks
    }
  },

  test_settings: {
    default: {
      desiredCapabilities: {
        browserName: 'chrome',
        'goog:loggingPrefs': { performance: 'ALL' }
      },
      globals: nightwatchDevtools({ port: 3000 })
    }
  }
}
```

---

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `3000` | Port for the DevTools backend server. Auto-incremented if already in use. |
| `hostname` | `string` | `'localhost'` | Hostname the backend server binds to. |
| `screencast` | `ScreencastOptions` | `{ enabled: false }` | Session video recording — live mode only (see [Screencast](#screencast)). |
| `bidi` | `boolean` | `false` | Opt into WebDriver BiDi capture for browser console + JS exceptions + network. Requires `webSocketUrl: true` in your capabilities and a BiDi-capable chromedriver. When attached, the per-command Chrome perf-log network path is gated off so requests don't duplicate. |
| `mode` | `'live' \| 'trace'` | `'live'` | `'live'` opens the DevTools UI window; `'trace'` skips the UI and writes a `trace-<sessionId>.zip` next to your `nightwatch.conf.cjs` at run end. See [Trace mode](../../README.md#-trace-mode-tracezip). |
| `screenshot` | `'off' \| 'on' \| 'only-on-failure'` | `'off'` | Per-test screenshot. Trace mode + `traceGranularity: 'test'` only. **Produce-only** — the PNG is written to the trace output dir (and listed in the artifacts manifest when `emitArtifactsManifest: true`); it is NOT attached inline to Allure (see note below). |
| `video` | `'off' \| TraceRetentionPolicy` | `'off'` | Per-test video slice, retained per the given policy (e.g. `'retain-on-failure'`). Trace mode + `traceGranularity: 'test'` only. Setting a non-`off` policy starts the screencast recorder itself — you do **not** also need `filmstrip` or `screencast.enabled`; the recorder runs continuously for the session and each test's slice is cut from it by wall-clock window. **Produce-only** — the `.webm` is written to the trace output dir (and listed in the manifest when `emitArtifactsManifest: true`); NOT attached inline to Allure. |
| `emitArtifactsManifest` | `boolean` | `false` | Write the `devtools-artifacts-<sessionId>.json` manifest — the generic index reporters/CI consume to discover produced artifacts — next to the trace. **Opt-in for Nightwatch**: it has no live Allure signal to auto-detect against (`nightwatch-allure` is post-hoc), so unlike WDIO/Selenium it never auto-enables. Trace mode only. |

> **Inline Allure attachment is not supported for Nightwatch.** Its official `nightwatch-allure` reporter is post-hoc (no live attach API), and `allure-js-commons`' `attachment()` no-ops in a Nightwatch run. So `screenshot`/`video` artifacts are *produced* (files, plus the artifacts manifest when `emitArtifactsManifest: true`) in the trace output dir but not attached to an Allure test. Per-test slicing (and therefore these artifacts) is meaningful for the cucumber and exports-object interfaces; the BDD `describe/it` interface collapses to session granularity, so the gate no-ops there.

```javascript
globals: nightwatchDevtools({
  port: 3000,
  hostname: 'localhost',
  screencast: { enabled: true }
})
```

---

## Screencast

Record a continuous `.webm` video of the browser session. The recording starts on the first session the plugin sees and is finalized in Nightwatch's `after()` hook, writing `nightwatch-video-<sessionId>.webm` to the directory of the test file that just ran. Falls back to the directory containing `nightwatch.conf.*` if the test file path isn't known, and to `process.cwd()` as a last resort. Directories under `node_modules/` are skipped.

**Polling mode only.** Nightwatch doesn't expose a stable CDP escape hatch the way WebdriverIO (`browser.getPuppeteer()`) and Selenium (`driver.createCDPConnection`) do, so the screencast captures frames by calling `browser.takeScreenshot()` at a fixed interval. This works on every browser Nightwatch supports.

### Quick start

```javascript
globals: nightwatchDevtools({
  port: 3000,
  screencast: { enabled: true, pollIntervalMs: 200 }
})
```

### Options

| Option | Type | Default | Notes |
|--------|------|---------|-------|
| `enabled` | `boolean` | `false` | Master switch. |
| `pollIntervalMs` | `number` | `200` | Screenshot interval (ms). Lower = smoother video, more WebDriver round-trips. 200 ms ≈ 5 fps. |
| `captureFormat` | `'jpeg' \| 'png'` | `'jpeg'` | Frame format. WebDriver screenshots are always PNG, so this only affects the encoded output. |
| `maxWidth` / `maxHeight` / `quality` | — | — | CDP-only options, ignored in polling mode. Listed for shape compatibility with the WDIO/Selenium adapters. |

### Prerequisites

`fluent-ffmpeg` (already a runtime dep of this package) plus the `ffmpeg` binary on PATH. macOS: `brew install ffmpeg`. Linux: `apt install ffmpeg`. Without ffmpeg the recorder still runs but the encode step logs a warning and skips writing the file.

### Output

The encoded video is sent to the DevTools dashboard via the `screencast` WS scope and shown in the **Screencast** tab. The absolute path also appears in the Nightwatch log line `📹 Screencast video: <path>`.

---

## Examples

Working examples are included in this package:

| Directory | Runner | Command |
|-----------|--------|---------|
| [`example/`](./example) | Nightwatch mocha-style | `pnpm example` |

Build the package first:

```bash
# From repo root
pnpm build --filter @wdio/nightwatch-devtools
cd packages/nightwatch-devtools
pnpm example
```

---

## Limitations

Nightwatch does not provide the same depth of framework hooks as WebdriverIO, so there are a few differences from the WDIO DevTools service:

| Limitation | Detail |
|-----------|--------|
| No native command hooks | Nightwatch has no `beforeCommand` / `afterCommand` hook. Commands are intercepted via a browser proxy wrapper instead. |
| Limited test context | `browser.currentTest` provides less metadata than the WDIO runner context; test names and file paths require additional heuristics. |
| Flat suite nesting | Nightwatch does not natively support multiply-nested `describe` blocks; the plugin reports a maximum of two levels. |
| Delayed result availability | Test results are only finalised in `afterEach`, not available mid-test. |

Overall feature parity with the WebdriverIO DevTools service is approximately **80–90%**.

### Preserve & Rerun (Compare)

Available for Nightwatch — same dashboard UI as WebdriverIO. The "compare with rerun" flow snapshots the failing run, re-launches the test with `DEVTOOLS_RERUN_LABEL` set (the plugin filters down to just that test name on the rerun), and the dashboard shows the two runs side-by-side aligned by command.

### BiDi capture (opt-in)

Enable WebDriver BiDi capture for browser console messages, JS exceptions, and network requests. Equivalent to the path selenium-devtools uses — both adapters call the same `attachBidiHandlers` in `@wdio/devtools-core`.

```javascript
globals: nightwatchDevtools({
  port: 3000,
  bidi: true
})
```

You also need `webSocketUrl: true` in your capabilities so chromedriver actually exposes the BiDi channel:

```javascript
desiredCapabilities: {
  browserName: 'chrome',
  'webSocketUrl': true,                         // ← enables BiDi
  'goog:chromeOptions': { /* ... */ }
}
```

When attached, the per-command Chrome performance-log network capture path is gated off so requests don't appear twice in the dashboard. If `webSocketUrl` is missing or the chromedriver version doesn't expose BiDi, the attach silently fails and the perf-log fallback continues to work.

## :page_facing_up: License

[MIT](/LICENSE)
