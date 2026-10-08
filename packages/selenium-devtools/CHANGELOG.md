# @wdio/selenium-devtools

## 1.6.2

### Patch Changes

- a4847ee: Build the dashboard with preact 11, which renders the DOM replay. Raise the `ws` floor to 8.22.0 for every adapter and the backend, and the service's `@babel/traverse` and `@babel/types` floors to 7.29.8. Babel stays on 7: Babel 8 requires Node 22.18 or newer, and the service runs inside WebdriverIO 9 projects that support Node 18.20 and up.
- 3fa708b: Stop pinning `chromedriver` as a dev dependency. A pinned driver rots against whatever Chrome a developer has installed, and pnpm puts the package's `node_modules/.bin` on `PATH`, where Selenium Manager finds it, prefers it over resolving one itself, and on a version mismatch only warns before returning it anyway. The adapters' examples then failed to start a session at all, against any Chrome whose major had moved on from the pin.

  With no driver on `PATH`, Selenium Manager resolves one matching the installed browser. Nightwatch needs no package either: its Chrome service builder reports `requiresDriverBinary: false` and passes an unset `server_path` through to that same resolver, and it declares `chromedriver` an optional peer. This is a development-only dependency, so nothing changes for consumers of either package.

- Updated dependencies [a4847ee]
- Updated dependencies [f49e9f4]
- Updated dependencies [dc2ae05]
- Updated dependencies [954faec]
  - @wdio/devtools-backend@1.11.2
  - @wdio/devtools-script@1.7.5

## 1.6.1

### Patch Changes

- 1b43bac: Add a mobile example per adapter — `pnpm demo:wdio:mobile`, `demo:selenium:mobile`, `demo:nightwatch:mobile`, `demo:python:mobile` — each honouring the same `DEVTOOLS_MODE=live|trace` switch the desktop demos already read.

  All four build the same capability bag — spelled per language, which is a duplication worth collapsing — so a difference in the dashboard between two adapters is a difference in the adapter rather than in the test. `examples/MOBILE.md` is the one place the prerequisites and switches are stated.

  The default target is the device's **own Clock app** (`com.google.android.deskclock`), which is what makes this landable at all: a native example previously needed an uploaded app and credentials in the environment, and that is the reason #354 closed without one. Nothing here needs an `.apk`. `APPIUM_APP` points it at a real app, and `DEVTOOLS_MOBILE=web` drives Chrome on the same device instead — worth running too, because a mobile browser session has a document and must keep every page-side call a native one skips.

  All four drive the same flow on the timer SETUP screen — clear the entry, key a duration on the keypad, read it back, correct it with backspace — and none of them starts a timer. A running timer survives the session and replaces that screen with its card, so a spec that starts one is re-runnable only if it also finishes. They avoid the preset chips for the same class of reason: those are recently-used-duration suggestions, absent on a freshly reset Clock, so a preset-based flow fails on any device without timer history. Verified on an Android 16 emulator with Clock 9.1, from a reset app; the Clock app updates independently of the Android version, so the resource-ids are re-read rather than assumed.

  Each one checks the toolchain before opening a session, through a shared `examples/mobile-preflight.cjs`, because none of the four frameworks reports a missing Appium in a way that names the cause: WDIO says "make sure browser driver is running", Nightwatch says it could not reach GeckoDriver, selenium-webdriver gives `ECONNREFUSED` and a stack trace. The check also distinguishes a missing Appium from a missing SDK from an emulator that is simply not started.

  Two framework details are worth recording, since both fail in ways that do not point at them. selenium-webdriver's `Builder.build()` throws unless `browserName` is a **string**, before it ever contacts the server, so a native session needs `browserName: ''` — which is the W3C signal for "no browser" anyway. And Nightwatch needs `selenium.use_appium`, not merely a `webdriver` block pointed at port 4723; without it it infers GeckoDriver, and even once connected it fills in `browserName: "firefox"` plus `moz:firefoxOptions` unless the capability is explicitly `null` — measured on the wire, and it made the adapters treat an app session as having a document.

  No adapter code changed: the dashboard already starts itself from `ensureBackendStarted()` and Python's `enable()`, so unlike the throwaway harnesses these replace, none of these examples needs a backend started by hand.

- Updated dependencies [bde7358]
- Updated dependencies [f2305b4]
  - @wdio/devtools-backend@1.11.1
  - @wdio/devtools-script@1.7.4

## 1.6.0

### Minor Changes

- f8f6ffd: Carry a native mobile session's viewport, capabilities and device into the trace. A native Appium session produced a zip claiming `viewport: 1280x720` and `browserName: chromium` — both the exporter's own fallbacks rather than anything measured. Three separate causes had to be fixed together, because none of them is useful alone.

  The values were never read: the WDIO service skipped its metadata send entirely for a native session, because it resolves the viewport from `window.visualViewport` and a native app has no DOM. It now reads the window off the driver instead (`getWindowSize`, measured at 1080x2219 on a Pixel 7 — the window minus the navigation bar), and degrades to no viewport rather than failing the session if that read is refused.

  Reading them would not have been enough: the capturer's `metadata` — the copy the exporter serializes — was only ever written by the page-side collector's payload, while `sendUpstream` merely transmits. A value resolved on the driver therefore reached a live dashboard and was dropped before the zip. `SessionCapturer.mergeMetadata` now stores as well as publishes, and merges rather than replaces so a later push naming only a url cannot wipe the device.

  And there was nowhere in the zip to put the device: `browserName` is normalized to `chromium` for android/iOS, `platform` names the HOST OS, and the reader rebuilt capabilities as `{ browserName }` alone, so the device survived only as prose inside `title` and every consumer re-derived "was this a phone?" from a heuristic. A `DeviceInfo` type and a single `deviceFromCapabilities` reader now live in shared, the zip states it as a `device` extension field on `context-options` (the same pattern the existing `runner` field uses), and the trace reader narrows it back in and puts the platform back onto the rebuilt capabilities. The naming order is what real hardware requires: `appium:deviceName` then `deviceModel` then `deviceName`, rejecting any candidate that merely repeats the udid — a device cloud reports an Android serial as both `deviceName` and `udid` and the friendly name only in `deviceModel`, while iOS reports a friendly `deviceName` with `udid` separate.

  Because the field is derived in the exporter from capabilities every adapter already sends, Selenium, Nightwatch and the Python adapter gain it with no adapter-side change. The viewport read is per-adapter and remains done only in the WDIO service; Selenium and Nightwatch set no viewport at all today, desktop or native, so their zips still take the exporter's fallback.

  The Metadata tab shows it as a `Device` row (`iPhone 17 (ios 18.1)`), which is all that reads it for now; #347 is the consumer this unblocks, and is what will shape and label the player's frame.

  Note on units, for anything tempted to size a captured image by this viewport: don't. It disagrees with the screenshot on both platforms — Android reports the window without the navigation bar (1080x2219 against a 1080x2400 shot) and iOS reports points rather than pixels (390x844 against 1170x2532). Fit by the image's own decoded dimensions.

### Patch Changes

- 34199c8: Find the collector bundle whether the package resolved to its build or its source. `loadCollectorSource` resolved `@wdio/devtools-script` and then read `script.js` from **that entry's directory**, which only holds when the entry is the built one. The repo tsconfig maps the package to `packages/script/src/index.ts`, and every resolver honouring those paths lands there instead — `tsx` and `ts-node` among them, which is how `wdio run <conf>.ts` loads a config. The read then ENOENTs on `packages/script/src/script.js`.

  Nothing failed loudly, which is why this survived: every caller treats an injection failure as a warning, so the run continued and lost its DOM capture. Surfaced as `Collector re-injection failed: ENOENT … packages/script/src/script.js` on a mobile-web Appium run, and reproduced in three lines against a plain `tsx` entry point, so it was never mobile-specific — any TS-config-driven run was affected.

  The bundle is now looked for beside the entry _and_ at `../dist/script.js`, and a genuine miss reports every path it tried instead of only the last.

- 01a068c: Let every adapter tell a native session from a browser one. Until now only the WDIO service could: the predicate read `browser.isMobile`/`isAndroid`/`isIOS`, which are WDIO runtime flags that Selenium's `WebDriver`, Nightwatch's `browser` and the Python driver do not have. So Selenium and Nightwatch ran their DOM drain, their collector injection and their page-script probes against a native app anyway — the same wasted round trips and `Method is not implemented` errors the service stopped emitting — and the Python adapter read `window.innerWidth` on a session with no window.

  The fact now has one reader, `isNativeAppSession` in shared, which asks the capabilities every adapter already publishes rather than a driver flag. It keys on whether the session named a browser, because a device alone does not answer the question — an Appium session driving Chrome or Safari runs on a phone and has a real page — and it reads both `platformName` and `browserName` one level into vendor options, since a device cloud commonly states them only inside its own bag.

  `SessionCapturerBase` exposes it as `isNativeAppSession`, resolved from the metadata the adapter has already set. That indirection is not decoration: Selenium's own `getCapabilities()` is async, and a guard cannot await it at the point it has to decide. Guards live inside the guarded method rather than at its call sites, which is what the service's own fix established — Selenium's drain has three call sites and Nightwatch's has four.

  Gated per adapter: Selenium's `captureTrace`, `injectScript`, `reinjectIfNavigated` and its performance read (whose 500 ms settle was being spent to reach a document that does not exist); Nightwatch's `captureTrace`, `injectScript`, `anchorAfterNavigation` — which polls the page for its own document identity — and its own performance read; Python's collector, its performance read and its viewport, which now measures the device window rather than asking a page that isn't there for `window.innerWidth`.

  The densest of these is the per-action snapshot, and all three adapters were paying it: two injected scripts plus `url` and `title`, on **every** action. Those four now drop out on a native session while the screenshot — the one probe a native app does serve — is still taken, so the trace keeps its per-action frames. Screenshots and `manage().logs()` are deliberately left alone too: Appium serves both, and logcat arrives through the second, so gating them would lose data rather than save a failed call.

  Two pre-existing bugs fell out of the work, both from the same root: Selenium published its capabilities as selenium-webdriver's `Capabilities` **instance**. That class keeps its data in a private Map and exposes `serialize` only under a Symbol, so the string-keyed `serialize?.()` the adapter called returned `undefined` and the instance reached the dashboard as `{"map_":{}}`. Every Selenium trace therefore carried no `device` and a guessed browser name, and the dashboard's capabilities pane was empty. It is now flattened through the class's own `keys()`/`get()` — which is also what makes the new guards work at all, since they read that bag. The test stub that hid this had a string-keyed `serialize()` no real driver has ever had.

  Reading the device out of vendor options fixes the same field for a cloud session, which previously read as desktop and reached the player framed as a browser window rather than a phone.

  The player's whole mobile layout was also still WDIO-only, in live mode. It gates on `metadata.device`, and only the WDIO service derives one before sending — Selenium, Nightwatch and Python send capabilities alone. So a phone run on those adapters arrived as a desktop session and got the desktop layout, even though the same run's _trace_ was framed correctly, because the exporter derives the device on the way into the zip. The app now derives it from the capabilities when the adapter sent none: one place rather than four — the single ingestion point every live message passes through. A device the adapter did send wins. Live mode only: a trace's device is already derived by the exporter on the way into the zip.

  Not included: a native session still gets no accessibility tree, because deriving one from page source is a capture _feature_ the WDIO service has and the other three do not. Selenium and Nightwatch also still publish no viewport at all, so their traces — desktop ones included — are framed at the reader's 1280x720 fallback. Both are tracked separately.

- 92af76f: Publish the viewport from every adapter. Selenium and Nightwatch published none at all, so `trace.metadata.viewport` was absent for every trace either produced and the exporter fell back to a hard-coded 1280x720 in three places. That fallback is what the player lays the DOM-replay iframe out at, so **every** Selenium and Nightwatch trace was replayed at 1280x720 regardless of the window the run actually used. Not a mobile problem: a desktop run at 2560x1440 was framed just as wrongly, which is presumably why it went unnoticed — the proportions are plausible.

  The read has one home now, `resolveViewport` in `core`, because all three JS adapters need it. Two probes, only one of which exists at a time: a page measures itself through `visualViewport` — the only read carrying the real scale and offsets — and a native app has no page to ask, so the device's own window is the only answer. `isNativeAppSession` settles which, so the branch was already decided.

  Each adapter supplies its own probes, and the care is in how: Selenium reads through the **unpatched** `getDriverOriginals()` and Nightwatch over its raw WebDriver transport, because both implement these as ordinary commands — through the patched path every run would open with an `executeScript` or `getWindowRect` row of our own making, and Nightwatch's would additionally sit behind the command in flight on its own queue.

  The script reads the `visualViewport` fields one by one rather than returning the object: it is a host object, and a driver that serializes it structurally hands back `{}`, which would read as a successful empty measurement rather than a failed one. A read that answers nothing usable omits the viewport rather than publishing a zero-sized one, and a failure degrades to no viewport rather than failing the session.

  The Python adapter already published one, but only `width`/`height` from `innerWidth`/`innerHeight`, so it lost the scale and offsets the shared `Viewport` declares; it now takes the same `visualViewport` read as the others.

  Also corrects the claim, in the comment that survived, that this field is metadata only. It is load-bearing geometry wherever there is a DOM to replay.

- afc07ca: Stop a screencast session outliving the recording it was armed for. A `stop()` arriving while the CDP handshake was still in flight returned early — the recording flag it checks is only set once the handshake finishes — so the session, its frame listener and the browser-side screencast stream stayed live after teardown (the late frames themselves were moot: every adapter builds a fresh recorder per session). `start()` and `stop()` are now serialised, so a stop always runs against a start that has finished arming and tears down what that start armed.

  The visible consequence of the fix: `stop()` now waits for an in-flight handshake rather than returning immediately — so every driver primitive that handshake awaits is ceilinged. An unbounded one (the service's `getPuppeteer()`/`pages()`/`createCDPSession()`/`Page.startScreencast` and the `session.detach()` its timeout path takes, the polling path's first screenshot, Selenium's `createCDPConnection`) would have parked teardown behind a driver that never answers, turning a leaked session into a hung test run. On the ceiling the handshake gives up and the recorder falls back to polling, or reports the screencast unavailable when polling was what wedged.

  Nothing is claimed until the handshake has answered, which is what keeps the ceiling safe: a `Page.startScreencast` that times out leaves no session, no frame listener and no stream behind for teardown to find — and a CDP session or connection that completes after the ceiling is detached (or, for Selenium, has its socket closed) when it lands, so no orphan outlives the recording. Selenium's stop closes the socket its recording opened on the success path too: each `createCDPConnection` overwrites the driver's single connection slot and `quit()` closes only the current one, so every recording rotation on one driver would otherwise leak one live websocket for the session's life. The same ceiling covers the stop-side `Page.stopScreencast` send, so a wedged stop cannot block the next recording either.

- Updated dependencies [1e4a434]
- Updated dependencies [f8f6ffd]
- Updated dependencies [993cb61]
- Updated dependencies [afc07ca]
  - @wdio/devtools-backend@1.11.0
  - @wdio/devtools-script@1.7.3

## 1.5.1

### Patch Changes

- c8cf114: Pick up the merged `yazl` 2 to 3 update, the library the trace zip is written with. It is a runtime dependency, so the published range only changes when the package is released.
- Updated dependencies [7fdbe55]
- Updated dependencies [f158645]
- Updated dependencies [c8cf114]
- Updated dependencies [4993f4a]
  - @wdio/devtools-backend@1.10.0
  - @wdio/devtools-script@1.7.2

## 1.5.0

### Minor Changes

- aeb3804: A trace records the same thing whichever runner produced it, and the player reads it back in that runner's own terms.

  **Locators you can paste into your own test.** The accessibility tree and element overlay used to hand back `a*=Logout` to everyone — WebdriverIO syntax, which Selenium's `By.css` and Nightwatch's `'css selector'` both reject. Each trace now carries its runner, and a captured locator is written in that runner's dialect: WebdriverIO keeps its text form, Selenium gets XPath, and Nightwatch prefers a native CSS locator (`button[type="submit"]`) because it is the one runner that reads a bare selector string under a default strategy. Where an XPath locator is genuinely the best available, the A11y panel names the call that resolves it. The player also resolves XPath now, so those rows draw their overlay boxes, and traces recorded before this still resolve their old locators.

  **Rows name the element they acted on.** Selenium consumes a locator at `findElement` and hands back an opaque handle, so its element rows reached the player with nothing to box or mark — no click points at all. Both Selenium and Nightwatch now carry the element's locator onto the row, including for assertions, which name no element of their own: a `node:assert` resolves its target from the value it was given, and a Nightwatch native assert reads it from the call. A page-level read records that its value belongs to no element, so a title assertion cannot inherit the box of an element that happens to read the same text. WebdriverIO stamps the element a command actually acted on rather than the last one resolved, which was wrong whenever two handles were resolved before either was used.

  **Every document instruments itself.** Selenium now registers its page collector at document start over BiDi, as the WebdriverIO and Nightwatch adapters already did, instead of appending a script after each navigation. On a fast two-page form that recovers input events that were being dropped while the collector came up, and anchors destination pages that previously lived and died unrecorded. Nightwatch re-establishes the same instrumentation when it replaces a session mid-run, which also restores network capture that was silently absent for every session after the first.

  **The action tree matches the run.** Nightwatch's `describe/it` interface showed one group for a whole module; each `it` is now its own group. A Cucumber scenario is named instead of showing a generated id, and nests under its feature. A group no longer repeats its parent's name. `traceGranularity: 'session'` covers a whole Nightwatch run rather than only its last browser session, and `'test'` remains the recommendation for Cucumber.

  **Live mode replays the right page.** The player bounded a row's DOM by the next row in arrival order, which is not the next row in time — a Nightwatch native assert, held back until its outcome is known, could bound a row that ran seconds later. Selenium additionally drained the page only at navigation in live mode, leaving nothing to replay between them. Both are fixed; trace-mode replay is unchanged.

  **Fewer swallowed failures.** A screenshot poll landing inside a click could make the click report success while doing nothing; the recorder now stands aside while an input command is in flight. A driver error is no longer mistaken for a probe result, which could put an error object into a screencast frame and lose the run's entire trace at export. A Nightwatch wait that times out produces a row, so the failure appears in the timeline and the Errors tab rather than only in console text, and Cucumber assertions carry a real pass/fail instead of rendering neutral.

### Patch Changes

- acc22dc: Correctness pass over the dashboard and trace player, driven by a new component-test suite that ran the UI in a real browser for the first time.

  - **DOM replay** now reproduces what the page actually did: a boolean attribute is replayed by presence rather than by value (`checked="false"` no longer replays as checked, and a `disabled="false"` the page set stays disabled), an attribute the page removed replays as removed instead of being recreated empty, a removed `value` empties a field that was never typed into while keeping text that was, and a text-only DOM change is captured and replayed at all.
  - **Trace slices keep their step names**: a per-test slice dropped the metadata its step titles lived under, so every Gherkin step rendered as `stable-…:step:1` instead of its own text.
  - **Network panel**: resource-type dots are coloured for a reconstructed trace, whose HAR reports no MIME type; a request that failed at the transport level reads `ERR` in both the list and the detail card rather than the dash that means "still in flight"; capture, wire and UI now share one request-type vocabulary.
  - **Errors panel** no longer mangles assertion failures — each row is headed by what failed, a multi-line failure stays inside its own bullet, and one failure site is resolved per step.
  - **Compare tab** appears only for the selected test, is windowed to that test's own uid, and keeps its toolbar on one line.
  - **Run state survives a run's worker sockets**, so Preserve & Rerun no longer 409s on every spec but the last, and a dashboard opened mid-run replays the whole run instead of the current spec. Rerun filters also match the runner's own full-title form, so a rerun no longer reports the test as skipped.
  - **Sidebar**: a running test can be stopped, a suite carries no verdict until one of its children settles, a Run All refusal is judged against `canRunAll` and says why, and the selection feeds the selected-test context.
  - **Player**: listeners are torn down on disconnect, the viewport is shown, and the theme is honoured per instance.
  - **Capture**: DOM capture recovers on a document that missed script injection, and Nightwatch cucumber runs now produce traces with native assertions captured.
  - **Empty panels** explain why they are empty instead of drawing a loading skeleton forever.

- Updated dependencies [aeb3804]
- Updated dependencies [acc22dc]
  - @wdio/devtools-backend@1.9.1
  - @wdio/devtools-script@1.7.1

## 1.4.0

### Minor Changes

- b28de26: Trace mode: a portable `trace.zip` artifact and first-party `show-trace` player, at parity across WebdriverIO, Selenium, and Nightwatch.

  - **Trace mode** (`mode: 'trace'`) writes a portable artifact under `test-results/` with no dashboard window — `traceFormat` (`zip` | `ndjson-directory`), `traceGranularity` (`session` | `spec` | `test`), and retry-aware `tracePolicy` retention.
  - **Trace player** (`show-trace`): DOM time-travel replayed from the mutation stream, an A11y tab and pick-locator element overlay, a Transcript tab with Copy-for-LLM, Errors/Console/Network/Source panels, and a scrubbable filmstrip timeline.
  - **Per-test artifacts**: `screenshot` and `video` at `traceGranularity: 'test'`, a dense `filmstrip` into the trace, an `emitArtifactsManifest` index for CI, and inline Allure attachment (WebdriverIO + Selenium).
  - **Assertion capture** (`captureAssertions`, on by default): `node:assert` and framework matchers render as trace action rows.

  The trace format and player are identical across all three adapters; capture completeness varies per adapter (see the cross-framework support docs).

### Patch Changes

- Updated dependencies [b28de26]
  - @wdio/devtools-backend@1.9.0
  - @wdio/devtools-script@1.7.0

## 1.3.1

### Patch Changes

- 64d54a9: - Bump @wdio/devtools-core to 1.0.1

## 1.3.0

### Minor Changes

- 66309cf: Add the trace player. `show-trace <trace.zip>` reconstructs a recorded trace and plays it back in the dashboard with a timeline dock, filmstrip, interactive network panel, and keyboard navigation. In trace mode the adapters export a `trace.zip`; the backend reconstructs it and serves it to the player.

### Patch Changes

- Updated dependencies [66309cf]
  - @wdio/devtools-backend@1.8.0

## 1.2.1

### Patch Changes

- cf011cb: ### ⚡ Improvements
  - Add spec-level trace granularity (`TraceGranularity: 'session' | 'spec'`) to all adapters
    - `spec` mode writes one trace per spec file, keyed on filename
    - Actions within each test are wrapped in `Tracing.tracingGroup` spans for proper nesting in trace viewers
    - Fix `lastSelector` bleed-through between consecutive tests
    - Annotate tracing spans with `it()` test names
- Updated dependencies [93d3851]
  - @wdio/devtools-backend@1.7.0
