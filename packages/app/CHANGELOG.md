# @wdio/devtools-app

## 1.11.2

### Patch Changes

- a4847ee: Build the dashboard with preact 11, which renders the DOM replay. Raise the `ws` floor to 8.22.0 for every adapter and the backend, and the service's `@babel/traverse` and `@babel/types` floors to 7.29.8. Babel stays on 7: Babel 8 requires Node 22.18 or newer, and the service runs inside WebdriverIO 9 projects that support Node 18.20 and up.

## 1.11.1

### Patch Changes

- 3a36ff0: Replay a boolean attribute the page itself set. The DOM anchor captures markup, so a page's own `<input type="checkbox" checked>` arrives as `checked=""` — and Preact assigns these as properties, where `''` is falsy, so the box replayed unchecked while the screencast showed it ticked. Every boolean attribute was affected the same way: a control the page disabled replayed as usable, a selected option as unselected.

  Captured markup now replays on presence alone, which is what HTML means: `checked="false"` in a page's own markup is a ticked box. That is deliberately NOT the mutation path's rule, where "false" is the collector reporting a cleared field — a signal that only ever arrives as a mutation record, never as markup.

- f2305b4: Declare the build-time libraries as devDependencies, so installing the dashboard no longer installs the toolchain that built it. Both packages ship a bundle with everything already inlined — lit, preact, codemirror and the iconify set for the app; htm, parse5 and preact for the page script — yet listed them as runtime dependencies, and the script additionally listed a vite plugin, which pulled vite, rolldown and lightningcss onto every machine that installed the backend. The app also declared the WebdriverIO adapter it never imports.

  Measured against the registry: installing `@wdio/devtools-backend` went from 338 packages and 264 MB to roughly 85 and 27 MB. That cost fell on every adapter, and hardest on the Python one, which fetches the backend at runtime.

## 1.11.0

### Minor Changes

- ae1fd6a: Frame a capture that came off a device as the device, not as a desktop browser window. A mobile trace rendered inside the desktop chrome — traffic lights, and an address bar reading `unknown`, since a native app has no url — with the phone left as a narrow strip in the middle of a landscape frame. Measured on a 1170x2532 capture: the image used 162 px of a 388 px frame and the remaining ~60% was backdrop.

  The frame is now shaped from the capture's own decoded pixels, and its header states the device instead of drawing window furniture that describes nothing. The capture's pixels are the only workable source: the metadata viewport disagrees with the screenshot on both platforms, since Android reports the window without the navigation bar and iOS reports points, so an older binary on an iPhone 17 reports a 390x844 window for a 402x874 screen. The frame's own header and padding are taken off before fitting and added back after, or the capture area comes out short by them and the image letterboxes inside a frame that was supposed to be its shape.

  Only the screenshot branch is reframed. A mobile _browser_ session — Appium driving Chrome on Android — reports a device and also carries a DOM, and that replay is an iframe laid out at its own captured viewport; shaping the frame to a screenshot as well would fight that sizing for the same box, and such a session is a real browser with a real url, so the browser chrome stays honest there. A desktop capture is untouched.

  Reads the `device` field added in #345, and the decoded-size helper added in #344.

- f8f6ffd: Carry a native mobile session's viewport, capabilities and device into the trace. A native Appium session produced a zip claiming `viewport: 1280x720` and `browserName: chromium` — both the exporter's own fallbacks rather than anything measured. Three separate causes had to be fixed together, because none of them is useful alone.

  The values were never read: the WDIO service skipped its metadata send entirely for a native session, because it resolves the viewport from `window.visualViewport` and a native app has no DOM. It now reads the window off the driver instead (`getWindowSize`, measured at 1080x2219 on a Pixel 7 — the window minus the navigation bar), and degrades to no viewport rather than failing the session if that read is refused.

  Reading them would not have been enough: the capturer's `metadata` — the copy the exporter serializes — was only ever written by the page-side collector's payload, while `sendUpstream` merely transmits. A value resolved on the driver therefore reached a live dashboard and was dropped before the zip. `SessionCapturer.mergeMetadata` now stores as well as publishes, and merges rather than replaces so a later push naming only a url cannot wipe the device.

  And there was nowhere in the zip to put the device: `browserName` is normalized to `chromium` for android/iOS, `platform` names the HOST OS, and the reader rebuilt capabilities as `{ browserName }` alone, so the device survived only as prose inside `title` and every consumer re-derived "was this a phone?" from a heuristic. A `DeviceInfo` type and a single `deviceFromCapabilities` reader now live in shared, the zip states it as a `device` extension field on `context-options` (the same pattern the existing `runner` field uses), and the trace reader narrows it back in and puts the platform back onto the rebuilt capabilities. The naming order is what real hardware requires: `appium:deviceName` then `deviceModel` then `deviceName`, rejecting any candidate that merely repeats the udid — a device cloud reports an Android serial as both `deviceName` and `udid` and the friendly name only in `deviceModel`, while iOS reports a friendly `deviceName` with `udid` separate.

  Because the field is derived in the exporter from capabilities every adapter already sends, Selenium, Nightwatch and the Python adapter gain it with no adapter-side change. The viewport read is per-adapter and remains done only in the WDIO service; Selenium and Nightwatch set no viewport at all today, desktop or native, so their zips still take the exporter's fallback.

  The Metadata tab shows it as a `Device` row (`iPhone 17 (ios 18.1)`), which is all that reads it for now; #347 is the consumer this unblocks, and is what will shape and label the player's frame.

  Note on units, for anything tempted to size a captured image by this viewport: don't. It disagrees with the screenshot on both platforms — Android reports the window without the navigation bar (1080x2219 against a 1080x2400 shot) and iOS reports points rather than pixels (390x844 against 1170x2532). Fit by the image's own decoded dimensions.

### Patch Changes

- 79f9263: Adapt the player pane to the window it is actually in. The pane's height came from a pixel number resolved once, at construction, from whatever window happened to be open then, and nothing recomputed it: measured at 124px in a 1280x720 window and still 124px at 2560x1440, so a trace rendered into a 13px-wide box on a 2560px screen. Not mobile-specific — wrong for every trace, just least visible on a desktop one.

  Three separate things froze it, and all three had to go. `MIN_WORKBENCH_HEIGHT` was `Math.min(300, window.innerHeight * 0.3)` evaluated at module import, so it took the window open at page load and — being the pane's own `minPosition` — pinned the pane there for the life of the page; loaded in a 413px-tall window it is exactly the 124px measured. `DragController.initialPosition` took a number rather than the getter its bounds already accepted, so a window-derived default could never follow the window. And each controller registered its resize handling by assigning `window.onresize`, which is a single slot: with five controllers on the page only the last one constructed ever adjusted, and it clobbered anything else on that slot.

  A height the user dragged still wins. It is stored, and a resize only re-clamps it — so it survives a window that still has room for it and is pulled back inside one that no longer does, rather than leaving the drag handle off-screen.

  The player component also re-fitted only on `resize` and `window-drag`, which meant it depended on whoever changed the layout remembering to announce it — and the dock divider, the sidebar collapsing and browser zoom announce nothing. It now watches its own box with a `ResizeObserver`, which covers all of them.

- a56c36e: Capture a hybrid app's webview half as a page, and frame a mobile capture as a device in the trace player as well as live.

  **Following the context.** Document availability was answered from the startup capabilities and never revisited, so a session that switched into a webview was still treated as native: the collector injection, the DOM drain and the `__wdioSnapMark` tag (since removed — trace mode now takes one capture per action) stayed skipped, and its per-action snapshot read a real HTML document through the page-source XML reader. `sessionHasDocument(capabilities, context)` in shared is now the question a capture guard asks; `isNativeAppSession` remains the capability-level answer for what genuinely cannot change. Anything that is not Appium's `NATIVE_APP` counts as a webview, because the `WEBVIEW_` prefix is a convention and a driver naming its webview otherwise would have its capture skipped. Following it costs no round trip: `switchContext` carries the context it moves to in its own arguments, and a switch that failed is ignored.

  Verified on a real hybrid app (Appium's ApiDemos on an Android emulator): the webview action is exported with a page snapshot — `[Page: I am a page title — file:///android_asset/html/index.html]`, a heading, a link and a working locator — where the native actions on either side stay `[android] hierarchy FrameLayout…`.

  **Per-action snapshots are skipped where Appium has a document to probe, and nowhere else.** They are issued from inside the command hook, and Appium serialises a probe behind the command it is observing: a hybrid trace run measured the DIRECT transport timing out exactly as `browser.execute` had, so the serialisation is Appium's own and going round the client cannot escape it. That run spent 2m6s hitting timeouts where the same spec takes 34s untouched.

  The IN-PAGE probes are what hang, though, so the gate asks whether a document is in play rather than whether the driver is Appium. A native session passes no `runScript` at all — page source and a screenshot only — and completes fine: measured on an Android emulator, 13.6s against 5.5s with the capture skipped, no timeout. Gating on the driver instead left every native trace with **one** snapshot for the whole run, the one taken at its end, so all eleven actions of a sample spec replayed the final frame; it now carries ten, one per action. Because the context answers the question, a hybrid app is judged by the half it is currently in: its webview actions are still skipped, and those are the ones that carry no per-action element data, accessibility tree or settle screenshot. Command rows and their screenshots, console, network and the archive itself are unaffected, as is every desktop session.

  **The device column now applies in both modes.** It was live-only, on the reasoning that the player's own layout worked — but the player had never actually rendered one: `#deviceCapture` requires a measurable image, and both of its sources read `command.screenshot`, which a trace's commands never carry. So a native trace was framed as a desktop browser. The player now falls back to the recorded viewport when there is no screenshot to measure — second, not first, because a native screenshot's pixels and its window size genuinely differ. In that layout the capture takes a full-height column with the action list and the dock stacked beside it, and the playback controls ride above the capture.

- 70f73a8: Make a live native mobile run visible on the dashboard. Three separate gaps left one looking empty, and each hid the next.

  **Early messages were discarded in silence.** A session's metadata and its first suites are published while the driver is still being created — against Appium that is ~11 s before the worker socket opens — and `sendUpstream` dropped anything sent before the socket was open. `metadata.type` gates the test-suite pane and `metadata.device` gates the mobile layout, so a live run showed neither the test tree nor the device frame and simply looked like nothing had been captured. Messages published while the socket is CONNECTING are now buffered and flushed in publication order on open; a socket that dies before ever opening reports and releases what it held rather than retaining a run's worth of payloads. The buffer is bounded.

  Drop reporting is re-entrancy guarded, because the fix uncovered a second trap: `patchConsole` forwards console output upstream, so an adapter's drop handler that logs re-enters `sendUpstream`, drops again and recurses until the stack blows — surfacing as `Maximum call stack size exceeded` raised inside the user's own spec, pointing nowhere near the capturer.

  **A native command carried no image.** The per-command screenshot was skipped for every Appium session. A native session has no DOM to replay and no per-action snapshot outside trace mode, so the player had nothing to show for any command and the device pane fell back to desktop browser chrome. Native sessions now take one in **live mode only** — trace mode already screenshots the same command through its pre-action capture, and two Appium round trips at ~1.2 s each is the cost #351 exists to remove. A mobile _browser_ session is unchanged: it replays from its mutation stream.

  **The capture had nowhere sensible to sit.** The trace player puts the dock beside the capture, which works when the whole window is the trace. A live dashboard has already spent its left edge on the suite tree, so a third column squeezed the dock into an unreadable strip and the tab row overflowed under the capture. Live mode now stacks the action list and the dock in one column beside a full-height capture, with both drag handles working and the collapse reversible.

- 01a068c: Let every adapter tell a native session from a browser one. Until now only the WDIO service could: the predicate read `browser.isMobile`/`isAndroid`/`isIOS`, which are WDIO runtime flags that Selenium's `WebDriver`, Nightwatch's `browser` and the Python driver do not have. So Selenium and Nightwatch ran their DOM drain, their collector injection and their page-script probes against a native app anyway — the same wasted round trips and `Method is not implemented` errors the service stopped emitting — and the Python adapter read `window.innerWidth` on a session with no window.

  The fact now has one reader, `isNativeAppSession` in shared, which asks the capabilities every adapter already publishes rather than a driver flag. It keys on whether the session named a browser, because a device alone does not answer the question — an Appium session driving Chrome or Safari runs on a phone and has a real page — and it reads both `platformName` and `browserName` one level into vendor options, since a device cloud commonly states them only inside its own bag.

  `SessionCapturerBase` exposes it as `isNativeAppSession`, resolved from the metadata the adapter has already set. That indirection is not decoration: Selenium's own `getCapabilities()` is async, and a guard cannot await it at the point it has to decide. Guards live inside the guarded method rather than at its call sites, which is what the service's own fix established — Selenium's drain has three call sites and Nightwatch's has four.

  Gated per adapter: Selenium's `captureTrace`, `injectScript`, `reinjectIfNavigated` and its performance read (whose 500 ms settle was being spent to reach a document that does not exist); Nightwatch's `captureTrace`, `injectScript`, `anchorAfterNavigation` — which polls the page for its own document identity — and its own performance read; Python's collector, its performance read and its viewport, which now measures the device window rather than asking a page that isn't there for `window.innerWidth`.

  The densest of these is the per-action snapshot, and all three adapters were paying it: two injected scripts plus `url` and `title`, on **every** action. Those four now drop out on a native session while the screenshot — the one probe a native app does serve — is still taken, so the trace keeps its per-action frames. Screenshots and `manage().logs()` are deliberately left alone too: Appium serves both, and logcat arrives through the second, so gating them would lose data rather than save a failed call.

  Two pre-existing bugs fell out of the work, both from the same root: Selenium published its capabilities as selenium-webdriver's `Capabilities` **instance**. That class keeps its data in a private Map and exposes `serialize` only under a Symbol, so the string-keyed `serialize?.()` the adapter called returned `undefined` and the instance reached the dashboard as `{"map_":{}}`. Every Selenium trace therefore carried no `device` and a guessed browser name, and the dashboard's capabilities pane was empty. It is now flattened through the class's own `keys()`/`get()` — which is also what makes the new guards work at all, since they read that bag. The test stub that hid this had a string-keyed `serialize()` no real driver has ever had.

  Reading the device out of vendor options fixes the same field for a cloud session, which previously read as desktop and reached the player framed as a browser window rather than a phone.

  The player's whole mobile layout was also still WDIO-only, in live mode. It gates on `metadata.device`, and only the WDIO service derives one before sending — Selenium, Nightwatch and Python send capabilities alone. So a phone run on those adapters arrived as a desktop session and got the desktop layout, even though the same run's _trace_ was framed correctly, because the exporter derives the device on the way into the zip. The app now derives it from the capabilities when the adapter sent none: one place rather than four — the single ingestion point every live message passes through. A device the adapter did send wins. Live mode only: a trace's device is already derived by the exporter on the way into the zip.

  Not included: a native session still gets no accessibility tree, because deriving one from page source is a capture _feature_ the WDIO service has and the other three do not. Selenium and Nightwatch also still publish no viewport at all, so their traces — desktop ones included — are framed at the reader's 1280x720 fallback. Both are tracked separately.

- 70d5260: Fit a capture with no DOM by both axes. The player's screenshot branch — reached by every trace that carries no mutation stream, so by every native mobile one — was bounded on the width alone inside a wrapper that hides its overflow, and the filmstrip drew each frame in a fixed 16:9 box with `object-cover`. A portrait capture was therefore scaled up to the pane width, overflowed its height, and had the remainder cut off, while its thumbnails were cropped to a horizontal band through the middle of the screen. Measured on a 1206x2622 iPhone 17 capture in a 1240x457 pane: the main pane showed 17% of the device screen at 5.9x magnification, and because that band is empty page on a phone app screen, the whole filmstrip rendered as blank white rectangles. The captured bytes were always correct — dragging the image out of the player showed the whole screen.

  This is not mobile-specific, it was only unmissable there: the same width-only fit cut the bottom 15% off a 1280x800 desktop capture in a 400px-tall pane. Both places now fit by the capture's own pixels, read from its PNG or JPEG header — the metadata viewport cannot serve, because it disagrees with the screenshot on both mobile platforms (Android reports the window without the navigation bar, iOS reports points rather than pixels) and a DOM-less trace carries no viewport at all. The main pane fills the pane and contains inside it, matching the screencast branch; a filmstrip thumbnail takes the capture's own aspect ratio and contains rather than covers, keeping the 16:9 box only for bytes that name no size.

- Updated dependencies [04c7441]
- Updated dependencies [9ad41c3]
- Updated dependencies [34199c8]
- Updated dependencies [a56c36e]
- Updated dependencies [70f73a8]
- Updated dependencies [f8f6ffd]
- Updated dependencies [01a068c]
- Updated dependencies [b7b75e4]
- Updated dependencies [afc07ca]
- Updated dependencies [70f73a8]
- Updated dependencies [92af76f]
- Updated dependencies [afc07ca]
  - @wdio/devtools-service@10.10.0

## 1.10.1

### Patch Changes

- c8cf114: Pick up the merged `@wdio/protocols` update, 9.28.0 to 9.30.1. It is a runtime dependency, so the published range only changes when the package is released.
- Updated dependencies [c8cf114]
  - @wdio/devtools-service@10.9.1

## 1.10.0

### Minor Changes

- aeb3804: A trace records the same thing whichever runner produced it, and the player reads it back in that runner's own terms.

  **Locators you can paste into your own test.** The accessibility tree and element overlay used to hand back `a*=Logout` to everyone — WebdriverIO syntax, which Selenium's `By.css` and Nightwatch's `'css selector'` both reject. Each trace now carries its runner, and a captured locator is written in that runner's dialect: WebdriverIO keeps its text form, Selenium gets XPath, and Nightwatch prefers a native CSS locator (`button[type="submit"]`) because it is the one runner that reads a bare selector string under a default strategy. Where an XPath locator is genuinely the best available, the A11y panel names the call that resolves it. The player also resolves XPath now, so those rows draw their overlay boxes, and traces recorded before this still resolve their old locators.

  **Rows name the element they acted on.** Selenium consumes a locator at `findElement` and hands back an opaque handle, so its element rows reached the player with nothing to box or mark — no click points at all. Both Selenium and Nightwatch now carry the element's locator onto the row, including for assertions, which name no element of their own: a `node:assert` resolves its target from the value it was given, and a Nightwatch native assert reads it from the call. A page-level read records that its value belongs to no element, so a title assertion cannot inherit the box of an element that happens to read the same text. WebdriverIO stamps the element a command actually acted on rather than the last one resolved, which was wrong whenever two handles were resolved before either was used.

  **Every document instruments itself.** Selenium now registers its page collector at document start over BiDi, as the WebdriverIO and Nightwatch adapters already did, instead of appending a script after each navigation. On a fast two-page form that recovers input events that were being dropped while the collector came up, and anchors destination pages that previously lived and died unrecorded. Nightwatch re-establishes the same instrumentation when it replaces a session mid-run, which also restores network capture that was silently absent for every session after the first.

  **The action tree matches the run.** Nightwatch's `describe/it` interface showed one group for a whole module; each `it` is now its own group. A Cucumber scenario is named instead of showing a generated id, and nests under its feature. A group no longer repeats its parent's name. `traceGranularity: 'session'` covers a whole Nightwatch run rather than only its last browser session, and `'test'` remains the recommendation for Cucumber.

  **Live mode replays the right page.** The player bounded a row's DOM by the next row in arrival order, which is not the next row in time — a Nightwatch native assert, held back until its outcome is known, could bound a row that ran seconds later. Selenium additionally drained the page only at navigation in live mode, leaving nothing to replay between them. Both are fixed; trace-mode replay is unchanged.

  **Fewer swallowed failures.** A screenshot poll landing inside a click could make the click report success while doing nothing; the recorder now stands aside while an input command is in flight. A driver error is no longer mistaken for a probe result, which could put an error object into a screencast frame and lose the run's entire trace at export. A Nightwatch wait that times out produces a row, so the failure appears in the timeline and the Errors tab rather than only in console text, and Cucumber assertions carry a real pass/fail instead of rendering neutral.

### Patch Changes

- 87a2bad: Rows in the test tree and the trace player's action list are a single line of uniform height, clipped to their panel instead of sizing it.

  - A long test, suite, step or action name no longer makes its row taller than its neighbours, so a tree reads as one list rather than a stack of unrelated blocks.
  - The test-tree panel keeps the width its drag handle is set to. A name too long for that width is clipped at the panel edge instead of widening the panel past the handle it is supposed to follow.
  - Clicking a row reflows its full name over as many lines as it needs, and exactly one row is expanded at a time — clicking another folds the previous one.
  - Nothing expands a row on its own: the action at the playhead, a failed step that auto-opened, and the running test the tree auto-selects all stay on one line.

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
  - @wdio/devtools-service@10.9.0

## 1.9.0

### Minor Changes

- b28de26: Trace mode: a portable `trace.zip` artifact and first-party `show-trace` player, at parity across WebdriverIO, Selenium, and Nightwatch.

  - **Trace mode** (`mode: 'trace'`) writes a portable artifact under `test-results/` with no dashboard window — `traceFormat` (`zip` | `ndjson-directory`), `traceGranularity` (`session` | `spec` | `test`), and retry-aware `tracePolicy` retention.
  - **Trace player** (`show-trace`): DOM time-travel replayed from the mutation stream, an A11y tab and pick-locator element overlay, a Transcript tab with Copy-for-LLM, Errors/Console/Network/Source panels, and a scrubbable filmstrip timeline.
  - **Per-test artifacts**: `screenshot` and `video` at `traceGranularity: 'test'`, a dense `filmstrip` into the trace, an `emitArtifactsManifest` index for CI, and inline Allure attachment (WebdriverIO + Selenium).
  - **Assertion capture** (`captureAssertions`, on by default): `node:assert` and framework matchers render as trace action rows.

  The trace format and player are identical across all three adapters; capture completeness varies per adapter (see the cross-framework support docs).

### Patch Changes

- Updated dependencies [b28de26]
  - @wdio/devtools-service@10.8.0

## 1.8.1

### Patch Changes

- Updated dependencies [64d54a9]
  - @wdio/devtools-service@10.7.1

## 1.8.0

### Minor Changes

- 66309cf: Add the trace player. `show-trace <trace.zip>` reconstructs a recorded trace and plays it back in the dashboard with a timeline dock, filmstrip, interactive network panel, and keyboard navigation. In trace mode the adapters export a `trace.zip`; the backend reconstructs it and serves it to the player.

### Patch Changes

- Updated dependencies [e1e859b]
- Updated dependencies [66309cf]
  - @wdio/devtools-service@10.7.0

## 1.7.0

### Minor Changes

- 93d3851: ### 🚀 Features

  - **Dashboard UI redesign**: port the entire dashboard to the new design mockup — sidebar, header, tabs, and workbench layout align with the updated visual system; theme-adaptive light mode with a segmented toggle.
  - **Timeline & action rail**: new timeline chips, connector rail, and active-row highlighting; action durations color-coded by per-step heat with consistent timing; rail extends across all actions.
  - **Sidebar filtering**: status chips in the sidebar now act as the single-select test filter.
  - **Screencast scrubber**: a scrubber with action markers synced to screencast playback; clicking an action seeks the screencast to that moment.
  - **Network panel redesign**: new layout for the Network tab; added a waterfall view for request timing.
  - **Metadata tab redesign**: collapsible cards replace the flat metadata layout.
  - **Console & Log redesign**: updated layout for the Console and Log tabs; console level filters consolidated into the filter module.
  - **Source panel redesign**: file switcher with call-site context replaces the flat source view.
  - **Compare tab redesign**: updated to match the new design mockup with aligned status markers.
  - **iframe URL mapping**: page URLs now resolve correctly for iframe-hosted pages, and the browser preview frame stays stable across Snapshot/Screencast tabs.

  ### 🐛 Fixes
  - **Baseline command attribution**: assertion commands issued by the framework are now kept with the test that ran them, and preserved baseline commands are attributed by source location.
  - **Automation infobar**: the "Chrome is being controlled by automated test software" infobar is hidden on the dashboard window (service and nightwatch adapters).
  - **Layout polish**: resize-divider line now aligns with the pane boundary; sidebar test-row content and selected-row highlight are evenly spaced.

  ### ⚡ Improvements
  - **Nightwatch PerfLog parsing**: waterfall timing data is now extracted from CDP performance logs for the Network waterfall view.
  - **Console filter consolidation**: console level filters moved to the shared filter module; dead code removed.

### Patch Changes

- Updated dependencies [93d3851]
- Updated dependencies [cf011cb]
  - @wdio/devtools-service@10.6.1
