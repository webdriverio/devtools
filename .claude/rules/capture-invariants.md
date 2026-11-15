---
paths:
  - "packages/{core,service,selenium-devtools,nightwatch-devtools,script,selenium-devtools-py}/src/**"
---

# Capture invariants

One-line imperatives from the history. Each names where the reasoning lives.

- Keep the `<script>` injection branches gated on `SessionCapturer.preloadRegistered`, not deleted: they are the only capture when BiDi is absent. — .claude/rules/doc-start-injection.md
- On Nightwatch's session rearm path (`session-init.ts` `armCaptureForSession`/`armReplacedSession`), register the collector preload with BiDi `script.addPreloadScript` before the BiDi attach, sequentially, never inside a `Promise.all` with it. Selenium deliberately registers it inside the `Promise.all` in `packages/selenium-devtools/src/session-lifecycle.ts` (~228-233); see .claude/rules/doc-start-injection.md. — .claude/rules/doc-start-injection.md
- Do not gate Nightwatch's DOM capture on its `bidi` option; `webSocketUrl: true` is the only requirement. — .claude/rules/doc-start-injection.md
- A drain must anchor the document it reads: pass `forceAnchor` (`collectorDrainExpression(true)`) from every Selenium and Nightwatch caller; only the WDIO pre-transition drain passes `false`. — packages/shared/CLAUDE.md
- Do not reintroduce an ungated settle poll or a document tag; wait on the document-replaced gate. — packages/service/CLAUDE.md
- Keep service command hooks non-`async`: WDIO's module-global `inCommandHook` flag drops concurrent commands' hooks. — packages/service/CLAUDE.md
- The per-action capture gate is `skipsCapture`; anything unlisted captures, and a test's first mapped command always captures. — packages/shared/CLAUDE.md
- Keep one `SessionCapturer` per Nightwatch run: a replaced session re-targets and re-arms, it never rebuilds the capturer. — packages/nightwatch-devtools/CLAUDE.md
- Nightwatch injection rides on the command's own thenable, never on a queued `perform()`. — packages/nightwatch-devtools/CLAUDE.md
- Nightwatch's page-side drain and probes go over `helpers/webdriverHttp.ts`, never `browser.execute` or a queued `browser.*`. — packages/nightwatch-devtools/CLAUDE.md
- A `browser.url()` call with no string argument is a read, not a navigation. — packages/nightwatch-devtools/CLAUDE.md
- A `waitUntil` condition is never taken for a result callback. — packages/nightwatch-devtools/CLAUDE.md
- A CLI is its own tsup leaf entry; an entry another entry imports cannot self-start. — packages/backend/CLAUDE.md
- Never list a workspace-internal package in a bundler's `external`; CJS-only dependencies go in `dependencies`. — .claude/rules/bundling.md
- Do not pin `browserVersion` as a fix for Chrome's password-leak input loss (use the `--host-resolver-rules` workaround); examples pin no browser driver package. — examples/CLAUDE.md
- `stop()` waits on an in-flight screencast handshake and never stops a session it did not arm; a start-generation mismatch is not a reason to stop. — .claude/rules/capture-cost.md
- Input and capture driver windows are never overridden by a polled screenshot. — .claude/rules/capture-cost.md
- Every per-action snapshot probe is timeout-guarded by `SNAPSHOT_DRIVER_PROBE_TIMEOUT_MS`. — packages/core/CLAUDE.md
- Anchors are only pulled earlier, never past the newest timestamp already in the stream. — packages/core/CLAUDE.md
- A retry never folds across a wait; a wait's polls fold per call inside it. — packages/selenium-devtools/CLAUDE.md
- `after.point` is deliberately not extended to assert rows. — .claude/rules/assert-capture.md
- `{{testId}}` is shell-quoted and never escaped; pytest matches nodeids literally. — packages/selenium-devtools-py/CLAUDE.md
- The Python screencast opens its own CDP websocket; `driver.start_devtools()` returns the shared BiDi socket. — packages/selenium-devtools-py/CLAUDE.md
- A stylesheet or font the collector reads back is not a network row. — packages/script/CLAUDE.md
- Do not read a low polling-mode filmstrip count as frame loss without a sha1 histogram of the emitted events. — packages/nightwatch-devtools/CLAUDE.md
