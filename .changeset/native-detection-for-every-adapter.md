---
"@wdio/devtools-service": patch
"@wdio/selenium-devtools": patch
"@wdio/nightwatch-devtools": patch
"@wdio/devtools-app": patch
---

Let every adapter tell a native session from a browser one. Until now only the WDIO service could: the predicate read `browser.isMobile`/`isAndroid`/`isIOS`, which are WDIO runtime flags that Selenium's `WebDriver`, Nightwatch's `browser` and the Python driver do not have. So Selenium and Nightwatch ran their DOM drain, their collector injection and their page-script probes against a native app anyway — the same wasted round trips and `Method is not implemented` errors the service stopped emitting — and the Python adapter read `window.innerWidth` on a session with no window.

The fact now has one reader, `isNativeAppSession` in shared, which asks the capabilities every adapter already publishes rather than a driver flag. It keys on whether the session named a browser, because a device alone does not answer the question — an Appium session driving Chrome or Safari runs on a phone and has a real page — and it reads both `platformName` and `browserName` one level into vendor options, since a device cloud commonly states them only inside its own bag.

`SessionCapturerBase` exposes it as `isNativeAppSession`, resolved from the metadata the adapter has already set. That indirection is not decoration: Selenium's own `getCapabilities()` is async, and a guard cannot await it at the point it has to decide. Guards live inside the guarded method rather than at its call sites, which is what the service's own fix established — Selenium's drain has three call sites and Nightwatch's has four.

Gated per adapter: Selenium's `captureTrace`, `injectScript`, `reinjectIfNavigated` and its performance read (whose 500 ms settle was being spent to reach a document that does not exist); Nightwatch's `captureTrace`, `injectScript`, `anchorAfterNavigation` — which polls the page for its own document identity — and its own performance read; Python's collector, its performance read and its viewport, which now measures the device window rather than asking a page that isn't there for `window.innerWidth`.

The densest of these is the per-action snapshot, and all three adapters were paying it: two injected scripts plus `url` and `title`, on **every** action. Those four now drop out on a native session while the screenshot — the one probe a native app does serve — is still taken, so the trace keeps its per-action frames. Screenshots and `manage().logs()` are deliberately left alone too: Appium serves both, and logcat arrives through the second, so gating them would lose data rather than save a failed call.

Two pre-existing bugs fell out of the work, both from the same root: Selenium published its capabilities as selenium-webdriver's `Capabilities` **instance**. That class keeps its data in a private Map and exposes `serialize` only under a Symbol, so the string-keyed `serialize?.()` the adapter called returned `undefined` and the instance reached the dashboard as `{"map_":{}}`. Every Selenium trace therefore carried no `device` and a guessed browser name, and the dashboard's capabilities pane was empty. It is now flattened through the class's own `keys()`/`get()` — which is also what makes the new guards work at all, since they read that bag. The test stub that hid this had a string-keyed `serialize()` no real driver has ever had.

Reading the device out of vendor options fixes the same field for a cloud session, which previously read as desktop and reached the player framed as a browser window rather than a phone.

The player's whole mobile layout was also still WDIO-only, in live mode. It gates on `metadata.device`, and only the WDIO service derives one before sending — Selenium, Nightwatch and Python send capabilities alone. So a phone run on those adapters arrived as a desktop session and got the desktop layout, even though the same run's *trace* was framed correctly, because the exporter derives the device on the way into the zip. The app now derives it from the capabilities when the adapter sent none: one place rather than four — the single ingestion point every live message passes through. A device the adapter did send wins. Live mode only: a trace's device is already derived by the exporter on the way into the zip.

Not included: a native session still gets no accessibility tree, because deriving one from page source is a capture *feature* the WDIO service has and the other three do not. Selenium and Nightwatch also still publish no viewport at all, so their traces — desktop ones included — are framed at the reader's 1280x720 fallback. Both are tracked separately.
