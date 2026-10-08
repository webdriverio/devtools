# @wdio/devtools-service

## 10.11.0

### Minor Changes

- 9ef8a33: Accept WebdriverIO 10 as a peer. The service required `webdriverio` `^9.19.1` and `@wdio/protocols` at exactly `9.30.1`, and `@wdio/elements` required `webdriverio` `^9.0.0`, so adding either to a v10 project conflicted with the project's own `webdriverio` and `@wdio/protocols`. Both majors are now accepted. The service uses none of the APIs v10 removed: its `addCommand` call already passes no third argument, and assertion folding keys on the matcher's value-read command, not on the matcher name that v10 now reports as the alias.

### Patch Changes

- bd0d9e9: Open the dashboard window over WebDriver and stop requiring the `devtools` package. The launcher opened it with `automationProtocol: 'devtools'`, which loads the `devtools` package. The service listed `devtools` `^8.42.0` as a peer, so npm installed it and an old Puppeteer into every project, and on WebdriverIO 10 the dashboard window failed to open when it was absent (`Couldn't find automation protocol "devtools"`). The window now opens through chromedriver, the same way the test sessions do, still without the "controlled by automated test software" bar, and `devtools` is no longer a peer.
- a4847ee: Build the dashboard with preact 11, which renders the DOM replay. Raise the `ws` floor to 8.22.0 for every adapter and the backend, and the service's `@babel/traverse` and `@babel/types` floors to 7.29.8. Babel stays on 7: Babel 8 requires Node 22.18 or newer, and the service runs inside WebdriverIO 9 projects that support Node 18.20 and up.
- a8ca108: Use the project's own `@wdio/types`, `@wdio/logger` and `@wdio/reporter` instead of pinned copies. The service pinned them at exact 9.x versions in `dependencies`, so a WebdriverIO 10 project installed a second set beside its own. On v10 that made the service class fail to type-check when passed directly in `services` (`[DevToolsHookService, options]`), because its types came from the 9.x copy. They are now peers accepting 9 and 10: `webdriverio` already brings the first two, and npm and pnpm install a missing `@wdio/reporter` automatically.
- Updated dependencies [9ef8a33]
- Updated dependencies [a4847ee]
- Updated dependencies [f49e9f4]
- Updated dependencies [dc2ae05]
- Updated dependencies [954faec]
  - @wdio/elements@1.2.0
  - @wdio/devtools-backend@1.11.2
  - @wdio/devtools-script@1.7.5

## 10.10.0

### Minor Changes

- f8f6ffd: Carry a native mobile session's viewport, capabilities and device into the trace. A native Appium session produced a zip claiming `viewport: 1280x720` and `browserName: chromium` — both the exporter's own fallbacks rather than anything measured. Three separate causes had to be fixed together, because none of them is useful alone.

  The values were never read: the WDIO service skipped its metadata send entirely for a native session, because it resolves the viewport from `window.visualViewport` and a native app has no DOM. It now reads the window off the driver instead (`getWindowSize`, measured at 1080x2219 on a Pixel 7 — the window minus the navigation bar), and degrades to no viewport rather than failing the session if that read is refused.

  Reading them would not have been enough: the capturer's `metadata` — the copy the exporter serializes — was only ever written by the page-side collector's payload, while `sendUpstream` merely transmits. A value resolved on the driver therefore reached a live dashboard and was dropped before the zip. `SessionCapturer.mergeMetadata` now stores as well as publishes, and merges rather than replaces so a later push naming only a url cannot wipe the device.

  And there was nowhere in the zip to put the device: `browserName` is normalized to `chromium` for android/iOS, `platform` names the HOST OS, and the reader rebuilt capabilities as `{ browserName }` alone, so the device survived only as prose inside `title` and every consumer re-derived "was this a phone?" from a heuristic. A `DeviceInfo` type and a single `deviceFromCapabilities` reader now live in shared, the zip states it as a `device` extension field on `context-options` (the same pattern the existing `runner` field uses), and the trace reader narrows it back in and puts the platform back onto the rebuilt capabilities. The naming order is what real hardware requires: `appium:deviceName` then `deviceModel` then `deviceName`, rejecting any candidate that merely repeats the udid — a device cloud reports an Android serial as both `deviceName` and `udid` and the friendly name only in `deviceModel`, while iOS reports a friendly `deviceName` with `udid` separate.

  Because the field is derived in the exporter from capabilities every adapter already sends, Selenium, Nightwatch and the Python adapter gain it with no adapter-side change. The viewport read is per-adapter and remains done only in the WDIO service; Selenium and Nightwatch set no viewport at all today, desktop or native, so their zips still take the exporter's fallback.

  The Metadata tab shows it as a `Device` row (`iPhone 17 (ios 18.1)`), which is all that reads it for now; #347 is the consumer this unblocks, and is what will shape and label the player's frame.

  Note on units, for anything tempted to size a captured image by this viewport: don't. It disagrees with the screenshot on both platforms — Android reports the window without the navigation bar (1080x2219 against a 1080x2400 shot) and iOS reports points rather than pixels (390x844 against 1170x2532). Fit by the image's own decoded dimensions.

### Patch Changes

- 04c7441: Give a direct `addValue` its own action row. It was excluded from the trace action vocabulary on the grounds that WDIO fires it inside `setValue`, where mapping it would double-count — but that assumed it only ever appears nested. A direct `addValue`, which is idiomatic on Appium, produced no action at all: the typing step was simply missing from the trace, and a spec doing click → `addValue` → `getText` exported two rows instead of three.

  The double-count the exclusion guarded against cannot happen. The service logs a command only when it matches the top of its own command stack, and that stack is pushed for top-level user commands alone — so the nested `addValue` never reaches the command log to be mapped. Neither the Selenium nor the Nightwatch adapter emits a command by that name at all; `addValue` is WDIO's, and Selenium's equivalent `sendKeys` appends too and has always mapped to a fill. It renders the same way.

  `clearValue` stays excluded: it has the same nesting story but no direct use that currently goes unrecorded.

- 9ad41c3: Stop the WDIO service deadlocking a mobile-web Appium session. `beforeCommand` issues its probes — the collector drain and the per-action snapshot's two scripts plus `url`/`title` — from inside the hook wrapping the command it is observing. Desktop chromedriver tolerates that re-entrancy; Appium serialises per session, so each probe enqueued behind the command it was meant to observe and neither resolved. Measured on an emulator: a two-command mobile-web spec passes in 1.6 s without the service and took 6 m 13 s of timeouts with it, every command at the WDIO timeout, with Chrome still on its new-tab page.

  The probes now go straight to the driver's HTTP endpoint for a session whose driver serialises, which is the only escape that does not change the ordering guarantee the pre-action snapshot depends on — the alternative, not awaiting in the hook, trades "state BEFORE this action executes" for every adapter and platform.

  The transport moved to `core` rather than being copied: Nightwatch has needed exactly this since its own command queue posed the same problem, and its `helpers/webdriverHttp.ts` now delegates to it, keeping only the part that is genuinely framework-specific — walking Nightwatch's internal config for the driver's host and port. Two things the Nightwatch version could not do are in the core one because the service needs them: https, and basic auth from the connection's `user`/`key`, since a cloud grid answers 401 without it and a probe that silently 401s reads as a capture gap rather than an error.

  Gated on `isAppiumSession`, not on being native. A native session skips these probes entirely, so the one that needed this is the mobile **web** session — it has a document and is driven through Appium. Desktop keeps `browser.*`, which carries WDIO's own retries and interceptors, because the re-entrancy is only fatal where the driver serialises. A session whose address is not knowable from the connection options also keeps the normal path: guessing localhost would aim a probe at whatever else is listening there.

- 34199c8: Find the collector bundle whether the package resolved to its build or its source. `loadCollectorSource` resolved `@wdio/devtools-script` and then read `script.js` from **that entry's directory**, which only holds when the entry is the built one. The repo tsconfig maps the package to `packages/script/src/index.ts`, and every resolver honouring those paths lands there instead — `tsx` and `ts-node` among them, which is how `wdio run <conf>.ts` loads a config. The read then ENOENTs on `packages/script/src/script.js`.

  Nothing failed loudly, which is why this survived: every caller treats an injection failure as a warning, so the run continued and lost its DOM capture. Surfaced as `Collector re-injection failed: ENOENT … packages/script/src/script.js` on a mobile-web Appium run, and reproduced in three lines against a plain `tsx` entry point, so it was never mobile-specific — any TS-config-driven run was affected.

  The bundle is now looked for beside the entry _and_ at `../dist/script.js`, and a genuine miss reports every path it tried instead of only the last.

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

- b7b75e4: Stop draining a page that does not exist, and stop treating a phone's browser as one. `SessionCapturer.captureTrace` reads the page-side collector through `browser.execute`, and a native Appium session has no document to run it in — but only two of its four call sites asked whether the session was native. The other two, the drain before a page-transition command and the final drain at teardown, went to the device anyway. Measured on a Pixel 7: five failed round trips per run, each printing `Failed to capture trace: WebDriverError: Method is not implemented` at ERROR in the user's output.

  The check now lives inside `captureTrace`, where the assumption it protects lives, so a call site cannot forget it — and the live-command drain's own copy is gone, leaving that predicate to decide only which commands warrant a drain.

  It also had to be a **narrower** check than the one the service had. The existing predicate is true for any Appium session, mobile browser included, because it ORs `isMobile` with `isAndroid` and `isIOS` — and only the first of those excludes a `chrome`/`safari`/`gecko`/`chromium` automationName, so the OR overrides WDIO's own mobile-web exclusion (measured on Appium Chrome capabilities: `isMobile` false, `isAndroid` true). An Appium session driving Chrome or Safari has a real page, so the two questions are split: `isAppiumSession` (the old predicate, renamed for what it actually answers) for anything needing WebDriver BiDi, which Appium does not serve, and `isNativeAppSession` for anything needing a document. The second keys on whether the capabilities name a browser at all, vendor bags included — WDIO reads `bstack:options.browserName` in the same function, so bags carrying it only there exist.

  Four page-side call sites move to the narrower predicate, and three of them were wrong for a mobile browser session before this change rather than because of it:

  - the drain itself, plus the drain-and-performance-read after a page-transition command. Its recovery injection is the only collector such a session ever gets, since the BiDi preload is skipped for every Appium session — so gating it on being mobile would have left it with no DOM capture at all.
  - the `__wdioSnapMark` document tag and the post-action settle that read it (both since removed — trace mode now takes one capture per action and settles only after the last one, via `settleAfterLastAction`). They had to move together at the time: split across the two predicates, a session tagged a document nothing settled on, and its post-action screenshot came from the page it navigated away from.
  - the per-action snapshot strategy, which fed a chromedriver session's HTML through the page-source XML parser and produced a snapshot with no elements, no a11y tree, no url and no title.
  - the viewport read. Documented as metadata-only, but the player sizes the DOM-replay iframe from it, so it is load-bearing wherever there is DOM to replay — and the driver window it was reading includes browser chrome and carries a hardcoded scale of 1.

  Deliberately left on the broader predicate: the BiDi preload injection, which is the right question there, and the per-command and per-assertion screenshots, which a mobile browser session also does not get. Those cost no failed round trips and print no errors, so they are a separate gap rather than part of this one.

  Residual: a hybrid app switched into a webview context does have a document, and no capability can say so — that is a runtime fact only `getContext()` knows.

- afc07ca: Take one DOM capture per action again. Trace mode had grown a second, eager post-action capture beside the pre-action one, with a `readyState` poll and a 250 ms pause on top to hide the fact that the eager one lands while the screen is still moving — so every action paid two captures, and on a native Appium session each capture is two serial round trips. Measured on the native example spec: 15 screenshots and 15 page-source reads against 8 and 8, and a 14.0–14.7 s test against 11.4 s, with the captured frames equivalent.

  The pre-action capture is the one that was right: taken before the command is issued, it is the moment the driver is guaranteed idle, so an action's result is the next action's "before". Only the last action has no successor to hand its result to, so a settle survives in exactly that one place, and it is gated rather than timed — no navigation, no wait. The eager capture, the poll that patched it and the document tag it was built on are deleted. Two related fixes ride along: a row with no capture of its own now replays the latest state at or before it rather than the nearest in absolute distance, which could hand it its successor's; and the screencast poll keeps at most one screenshot outstanding, so it cannot queue ahead of the test's own commands on a serialised driver.

- 70f73a8: Record a passing `.not.*` assertion as passed. Every negated matcher that succeeded was rendered as a failed action row and collected into the Errors tab, inside a test the runner itself reported green — so a clean run showed a red row and an error it had not produced.

  expect-webdriverio hands `afterAssertion` the **raw** matcher result: jest's convention is that `pass` answers the _positive_ assertion and the framework inverts it for `.not`, so a passing `.not.toBeDisplayed()` arrives as `pass: false`. Nothing in the hook's parameters carries `isNot` — it lives on the matcher's own `this` — which leaves the formatted message as the only carrier that reaches an adapter.

  Both signals are read off the generated **diff block**, never the prose. The first line is `Expect ${subject} ${not}to …` and a subject is user-controlled, so scanning it let a selector or an expected value containing "not to" reverse a positive assertion's outcome. A matcher that takes a value labels the diff `Expected [not]` when negated; the `.be` family renders no such label (`enhanceErrorBe` passes `useNotInLabel: false`) and encodes the negation in the generated expected value instead, which is trusted only when the user supplied none — `toHaveText('not foo')` prints the same shape.

  A caller that already knows the outcome, such as the synthesized row for a matcher that hard-threw, skips the inversion entirely rather than having a decided failure re-read from its message.

  Not mobile-specific: this affected every `.not.*` matcher on every run.

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

## 10.9.1

### Patch Changes

- c8cf114: Pick up the merged dependency updates. `yazl` moves 2 to 3 (and `@types/yazl` with it), which is the library the trace zip is written with; `@wdio/reporter` and `@wdio/types` move 9.28.0 to 9.30.1 and `@wdio/logger` 9.18.0 to 9.29.1. These are runtime dependencies, so the published range only changes when the package is released.
- Updated dependencies [7fdbe55]
- Updated dependencies [f158645]
- Updated dependencies [c8cf114]
- Updated dependencies [4993f4a]
  - @wdio/devtools-backend@1.10.0
  - @wdio/devtools-script@1.7.2

## 10.9.0

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
  - @wdio/elements@1.1.2

## 10.8.0

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

## 10.7.1

### Patch Changes

- 64d54a9: - Bump @wdio/devtools-core to 1.0.1
- Updated dependencies [64d54a9]
  - @wdio/elements@1.1.1

## 10.7.0

### Minor Changes

- e1e859b: ### 🚀 Features

  - **`getSnapshot()`** — single call for web and mobile that returns an AI-readable text tree with embedded `e1`, `e2`, … virtual element IDs plus an elements map for direct selector resolution. No post-processing required.
  - **`browser.getSnapshot()`** — WDIO runtime accessor registered by `@wdio/devtools-service` in the `before` hook, calling `getSnapshot()` directly with zero trace-mode overhead (no screenshot round-trip, no page-settling).

  ### 🛠 Core additions (`@wdio/devtools-core` — private)
  - `buildSnapshot()` — platform-agnostic formatter converting flat `SnapshotNode[]` into text + elements map.
  - `accessibilityNodesToSnapshotNodes()` — web adapter from `AccessibilityNode[]`.
  - `jsonElementToSnapshotNodes()` — mobile adapter from `JSONElement` tree.
  - `isStatictextEchoedByParent()` — shared statictext echo-suppression helper.
  - New types: `SnapshotNode`, `SnapshotElement` (with `qualifiedSelector` for `.instance(N)` disambiguation), `SnapshotResult`.
  - `tagName` field on internal `MobileFlatNode`.

- 66309cf: Add the trace player. `show-trace <trace.zip>` reconstructs a recorded trace and plays it back in the dashboard with a timeline dock, filmstrip, interactive network panel, and keyboard navigation. In trace mode the adapters export a `trace.zip`; the backend reconstructs it and serves it to the player.

### Patch Changes

- Updated dependencies [e1e859b]
- Updated dependencies [66309cf]
  - @wdio/elements@1.1.0
  - @wdio/devtools-backend@1.8.0

## 10.6.1

### Patch Changes

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

- cf011cb: ### ⚡ Improvements
  - Add spec-level trace granularity (`TraceGranularity: 'session' | 'spec'`) to all adapters
    - `spec` mode writes one trace per spec file, keyed on filename
    - Actions within each test are wrapped in `Tracing.tracingGroup` spans for proper nesting in trace viewers
    - Fix `lastSelector` bleed-through between consecutive tests
    - Annotate tracing spans with `it()` test names
- Updated dependencies [93d3851]
  - @wdio/devtools-backend@1.7.0
