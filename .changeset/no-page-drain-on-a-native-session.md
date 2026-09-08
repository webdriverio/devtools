---
"@wdio/devtools-service": patch
---

Stop draining a page that does not exist, and stop treating a phone's browser as one. `SessionCapturer.captureTrace` reads the page-side collector through `browser.execute`, and a native Appium session has no document to run it in — but only two of its four call sites asked whether the session was native. The other two, the drain before a page-transition command and the final drain at teardown, went to the device anyway. Measured on a Pixel 7: five failed round trips per run, each printing `Failed to capture trace: WebDriverError: Method is not implemented` at ERROR in the user's output.

The check now lives inside `captureTrace`, where the assumption it protects lives, so a call site cannot forget it — and the live-command drain's own copy is gone, leaving that predicate to decide only which commands warrant a drain.

It also had to be a **narrower** check than the one the service had. The existing predicate is true for any Appium session, mobile browser included, because it ORs `isMobile` with `isAndroid` and `isIOS` — and only the first of those excludes a `chrome`/`safari`/`gecko`/`chromium` automationName, so the OR overrides WDIO's own mobile-web exclusion (measured on Appium Chrome capabilities: `isMobile` false, `isAndroid` true). An Appium session driving Chrome or Safari has a real page, so the two questions are split: `isAppiumSession` (the old predicate, renamed for what it actually answers) for anything needing WebDriver BiDi, which Appium does not serve, and `isNativeAppSession` for anything needing a document. The second keys on whether the capabilities name a browser at all, vendor bags included — WDIO reads `bstack:options.browserName` in the same function, so bags carrying it only there exist.

Four page-side call sites move to the narrower predicate, and three of them were wrong for a mobile browser session before this change rather than because of it:

- the drain itself, plus the drain-and-performance-read after a page-transition command. Its recovery injection is the only collector such a session ever gets, since the BiDi preload is skipped for every Appium session — so gating it on being mobile would have left it with no DOM capture at all.
- the `__wdioSnapMark` document tag and the post-action settle that reads it. These have to move together: split across the two predicates, a session tags a document nothing settles on, and its post-action screenshot comes from the page it navigated away from.
- the per-action snapshot strategy, which fed a chromedriver session's HTML through the page-source XML parser and produced a snapshot with no elements, no a11y tree, no url and no title.
- the viewport read. Documented as metadata-only, but the player sizes the DOM-replay iframe from it, so it is load-bearing wherever there is DOM to replay — and the driver window it was reading includes browser chrome and carries a hardcoded scale of 1.

Deliberately left on the broader predicate: the BiDi preload injection, which is the right question there, and the per-command and per-assertion screenshots, which a mobile browser session also does not get. Those cost no failed round trips and print no errors, so they are a separate gap rather than part of this one.

Residual: a hybrid app switched into a webview context does have a document, and no capability can say so — that is a runtime fact only `getContext()` knows.
