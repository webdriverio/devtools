
# @wdio/devtools-service

A WebdriverIO service that provides a developer tools UI for running, debugging, and inspecting browser automation tests. Features include DOM mutation replay, per-command screenshots, network request inspection, console log capture, and session screencast recording.

## Installation

```sh
npm install @wdio/devtools-service --save-dev
# or
pnpm add -D @wdio/devtools-service
```

## Usage

### Test Runner

```ts
// wdio.conf.ts
export const config = {
  services: ['devtools'],
}
```

### Standalone

```ts
import { remote } from 'webdriverio'
import { setupForDevtools } from '@wdio/devtools-service'

const browser = await remote(setupForDevtools({
  capabilities: { browserName: 'chrome' }
}))
await browser.url('https://example.com')
await browser.deleteSession()
```

## Service Options

```ts
services: [['devtools', options]]
```

| Option | Type | Default | Description |
|---|---|---|---|
| `port` | `number` | random | Port the DevTools UI server listens on |
| `hostname` | `string` | `'localhost'` | Hostname the DevTools UI server binds to |
| `devtoolsCapabilities` | `Capabilities` | Chrome 1600×1200 | Capabilities used to open the DevTools UI window |
| `screencast` | `ScreencastOptions` | — | Session video recording (live mode only — see below; for trace mode use `video`) |
| `mode` | `'live' \| 'trace'` | `'live'` | `'live'` opens the DevTools UI window; `'trace'` skips the UI and writes a `trace-<sessionId>.zip` at session end. See [Trace mode](../../README.md#-trace-mode-tracezip) |
| `traceFormat` | `'zip' \| 'ndjson-directory'` | `'zip'` | Trace mode only. Output layout — `'zip'` writes a single archive; `'ndjson-directory'` unpacks the same files into `trace-<id>/` (one less unzip step for scripted/agentic consumers). Both open in `show-trace` and other compatible viewers. |
| `traceGranularity` | `'session' \| 'spec' \| 'test'` | `'session'` | Trace mode only. How traces are partitioned — one per worker session / spec file / test. `'test'` is required for per-test Allure attachments (trace, screenshot, video). |
| `tracePolicy` | `TraceRetentionPolicy` | `'on'` | Trace mode only. Which traces to keep: `'on'` \| `'retain-on-failure'` \| `'retain-on-first-failure'` \| `'on-first-retry'` \| `'on-all-retries'` \| `'retain-on-failure-and-retries'`. The retry-aware policies pair best with `traceGranularity: 'test'`. |
| `screenshot` | `'off' \| 'on' \| 'only-on-failure'` | `'off'` | Trace mode + `traceGranularity: 'test'`. Per-test screenshot, attached inline to Allure (`image/png`). WDIO-service-specific. |
| `video` | `'off' \| TraceRetentionPolicy` | `'off'` | Trace mode + `traceGranularity: 'test'`. Per-test screencast video, retained per the given policy, attached inline to Allure (`video/webm`). WDIO-service-specific. |
| `filmstrip` | `boolean` | `true` | Trace mode only. Records a dense, continuous screencast filmstrip *into* the trace so the player scrubs smooth playback — dense frames are added alongside the per-action frames (not one frame per action). Frames are thinned (≥100 ms apart, ~600 max) and content-addressed (identical frames — a static wait — collapse to one resource); windowed per slice at any `traceGranularity`. Runs the screencast recorder (CDP push on Chrome, polling elsewhere). |
| `emitArtifactsManifest` | `boolean` | `false` | Trace mode only. Writes `devtools-artifacts-<sessionId>.json` next to the trace — a generic index of every produced artifact (trace/screenshot/video) plus each test's state, for reporters/CI to consume. Off by default; **auto-enabled when `@wdio/allure-reporter` is in the config**. |
| `captureAssertions` | `boolean` | `true` | Capture assertions as command/action rows — `node:assert` plus passing *and* failing expect-webdriverio matchers, folded into single `expect.<matcher>` rows (e.g. `toHaveText`, `toExist`). Set `false` to opt out. |

## Viewing traces — `show-trace`

In trace mode the adapter writes a portable `trace.zip` (or, with
`traceFormat: 'ndjson-directory'`, an unpacked directory). Open it in the
first-party player:

```sh
pnpm show-trace path/to/trace.zip     # from this repo
npx show-trace path/to/trace.zip      # in a project that installs an adapter
```

The `show-trace` bin ships with this service (and with the Selenium/Nightwatch
adapters), so it's available wherever one is installed — no extra dependency. It
boots the DevTools UI in a dedicated **player** mode:

- **DOM time-travel** — the page pane rebuilds the real DOM as of the selected
  action from the captured mutation stream (not just a screenshot), replaying
  form-field state (typed values, checked/selected) so each step shows the page
  exactly as it was at that moment.
- **A11y tab** — the accessibility tree (roles + accessible names) captured for
  the selected action; the semantic view a screen reader sees, distinct from the
  raw DOM in the snapshot pane.
- **Element overlay ("pick locator")** — every locator the test interacted with
  is outlined on the replayed page. Hover a box to highlight the matching A11y
  row; click to copy a resilient locator to the clipboard. Hovering an A11y row
  highlights the element back — the two views are linked bidirectionally.
- **Transcript tab + Copy-for-LLM** — the run's `transcript.md` rendered
  in-panel, with a one-click **Copy prompt** that bundles the transcript and any
  failing-command errors into paste-ready LLM context.
- **Timeline** — categorized action markers (navigation / input / assertion /
  query / …), a dense filmstrip when `filmstrip` is enabled, Network and Console
  tracks, a draggable playhead, and playback controls (play/pause, step, speed).
  Cucumber runs nest as Feature → Scenario → Step.
- **Errors, Console, Network, and Source tabs** — the same workbench tabs as
  live mode.

The same `trace.zip` also opens in other compatible standalone trace viewers,
and its on-disk format is what an Allure report's embedded trace viewer reads
(Allure ≥ 2.35).

## Allure integration

When `@wdio/allure-reporter` is installed, trace-mode artifacts are attached to
the Allure report automatically (and `emitArtifactsManifest` is auto-enabled, so
the run also writes the `devtools-artifacts-<sessionId>.json` index):

- **`traceGranularity: 'test'`** — each test's trace (`application/zip`, a
  download that opens in `pnpm show-trace`), screenshot (`image/png`, inline)
  and video (`video/webm`, inline) attach to that test's card. This is the mode
  to use for a per-test Allure report.
- **`traceGranularity: 'session'` / `'spec'`** — a session/spec-spanning
  `trace.zip` is written to disk and enumerated in
  `devtools-artifacts-<sessionId>.json` (the artifacts manifest, listing every
  artifact + each test's state), but it is **not** attached to individual test
  cards.

### Why session/spec traces aren't attached per test

The reporter's `addAttachment` targets the **currently-running test**. A
session/spec trace is only finalized **after** all its tests have run — by which
point their Allure cards are already closed — so there is no open test to attach
it to. Per-test attachment therefore requires `traceGranularity: 'test'`, where
each slice is written during its own test hook while the card is still open.

To surface a session/spec trace in Allure anyway, post-process the manifest in
your **own** `onComplete` hook (copying the `trace.zip` into `allure-results/`
and appending it to the result files). This is deliberately left to userland —
baking it into the adapter would couple it to Allure's on-disk result format.

### Report noise

In trace mode the service captures a per-action snapshot (a `takeScreenshot`
WebDriver command) to build the trace timeline; `@wdio/allure-reporter` logs
every WebDriver command as a step and attaches a screenshot per `takeScreenshot`.
Silence that flood with the reporter's own options — the `trace.zip` /
screenshot / video attachments are unaffected:

```ts
reporters: [
  ['allure', {
    outputDir: 'allure-results',
    disableWebdriverStepsReporting: true,
    disableWebdriverScreenshotsReporting: true
  }]
]
```

## Screencast Recording

Records browser sessions as `.webm` videos. Videos are displayed in the DevTools UI alongside the snapshot and DOM mutation views.

Available across all three adapters — WebdriverIO uses CDP push for Chrome (and polling fallback otherwise); see the [Nightwatch](../nightwatch-devtools/README.md#screencast) and [Selenium](../selenium-devtools/README.md) READMEs for their adapter-specific modes.

### Setup

Screencast encoding requires **ffmpeg** on `PATH` and the `fluent-ffmpeg` package:

```sh
# Install ffmpeg — https://ffmpeg.org/download.html
brew install ffmpeg        # macOS
sudo apt install ffmpeg    # Ubuntu/Debian

# Install fluent-ffmpeg
npm install fluent-ffmpeg
```

### Configuration

```ts
services: [
  [
    'devtools',
    {
      screencast: {
        enabled: true,
        captureFormat: 'jpeg',
        quality: 70,
        maxWidth: 1280,
        maxHeight: 720,
      }
    }
  ]
]
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `false` | Enable session recording |
| `captureFormat` | `'jpeg' \| 'png'` | `'jpeg'` | Frame image format. **Chrome/Chromium only** — controls the format Chrome sends over CDP. Ignored in polling mode (Firefox, Safari) where screenshots are always PNG. Does not affect the output video container, which is always `.webm` |
| `quality` | `number` | `70` | JPEG compression quality 0–100. Only applies in Chrome/Chromium CDP mode with `captureFormat: 'jpeg'` |
| `maxWidth` | `number` | `1280` | Maximum frame width in pixels. **Chrome/Chromium only** — Chrome scales frames before sending over CDP. Ignored in polling mode |
| `maxHeight` | `number` | `720` | Maximum frame height in pixels. **Chrome/Chromium only** — same as above |
| `pollIntervalMs` | `number` | `200` | Screenshot interval in milliseconds for non-Chrome browsers (polling mode). Lower = smoother video but more WebDriver round-trips during test execution |

### Browser support

Recording works across all major browsers using automatic mode selection:

| Browser | Mode | Notes |
|---|---|---|
| Chrome / Chromium / Edge | **CDP push** | Chrome pushes frames over the DevTools Protocol. Efficient — no impact on test command timing |
| Firefox / Safari / others | **BiDi polling** | Falls back to calling `browser.takeScreenshot()` at `pollIntervalMs` intervals. Works wherever WebDriver screenshots are supported; adds a small overhead proportional to the interval |

No configuration change is needed to switch modes — the service detects browser capabilities automatically and logs which mode is active.

### Behaviour

- Recording starts when the browser session opens and stops when it closes.
- Leading blank frames (captured before the first URL navigation) are automatically trimmed so videos begin at the first meaningful page action.
- If `browser.reloadSession()` is called mid-run, the service finalises the current recording and starts a fresh one for the new session. Each session produces its own `.webm` file.
- When multiple recordings exist, the DevTools UI shows a **Recording N** dropdown to switch between them.
- Output files are written to the directory containing `wdio.conf.ts` (WDIO's `rootDir`) or `outputDir` if explicitly configured.

### Output files

| File | Description |
|---|---|
| `wdio-trace-{sessionId}.json` | Full trace: DOM mutations, commands, screenshots, console logs, network requests |
| `wdio-video-{sessionId}.webm` | Screencast video (only produced when `screencast.enabled: true`) |

## Performance API capture

After every navigation command (`url`, `navigateTo`, etc.), the service runs the shared `CAPTURE_PERFORMANCE_SCRIPT` from `@wdio/devtools-core` to read `window.performance.getEntriesByType('navigation' | 'resource')`, cookies, and document info. The result is attached to the command entry in the Actions tab so you see `loadTime` / `domReady` / `responseTime` / resource counts per navigation. Same script and `applyPerformanceData` post-processing used by selenium-devtools and nightwatch-devtools — uniform dashboard fields across all three adapters.

## Shared library notes

Most of this service's capture + reporting logic now lives in `@wdio/devtools-core` and is consumed by all three adapters: `SessionCapturerBase`, `ScreencastRecorderBase`, `TestReporterBase`, `loadInjectableScript`/`pollUntilReady`, `processTracePayload`, `captureSource`, `sendCommand`/`sendReplaceCommand`, `errorMessage`/`toError`/`serializeError`, `RetryTracker`, `mapChromeBrowserLogs`, `attachBidiHandlers`, `finalizeScreencast`, `encodeToVideo`, `suite-helpers`, `test-discovery`. This service contains only WDIO-specific glue (BiDi event listeners via WDIO's native `browser.on`, the WDIO reporter integration, `beforeCommand`/`afterCommand` hook wiring, Cucumber UID branching).
