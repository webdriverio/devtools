---
paths:
  - "packages/core/src/{assert-patcher,read-value-locators}.ts"
  - "packages/service/src/{assert-capture,command-selectors,action-snapshot}.ts"
  - "packages/selenium-devtools/src/{assertPatcher,driverPatcher}.ts"
  - "packages/selenium-devtools/src/helpers/element-locators.ts"
  - "packages/nightwatch-devtools/src/helpers/{assertCapture,assertTarget,browserProxy}.ts"
  - "packages/selenium-devtools-py/src/selenium_devtools/read_value_locators.py"
  - "packages/trace/src/trace-action-events.ts"
---

# Assert capture

How an assertion row finds the element it names, and the error text it shows.

## Rules

- Wire `patchNodeAssert` in all three JS adapters, default-on behind each adapter's `captureAssertions` option; `captureAssertions: false` opts out. Service and Nightwatch skip the wiring when it is false; Selenium patches at import and gates at capture time.
- Record every non-element read as a null producer: service `command-selectors.ts` `isElementCommand` is false for `getTitle`/`getUrl`, and Nightwatch `assertTarget.ts` `commandTargetSelector` allows only element-read commands. Why: a title assertion borrowed the box of an `h1` reading the same text; Nightwatch node:assert rows with a locator went 0/7 to 4/7.
- Pass the raw args to `resolveAssertTargetFromArgs` through `patchNodeAssert`'s `resolveAssertTarget` hook. Why: sanitizing destroys the handle identity the lookup keys on.
- Derive the Nightwatch allowlist from its own per-command list, never from shared `ACTION_MAP`. Why: `ACTION_MAP` says how a command renders (WDIO handle commands carry no selector argument), not whether arg 0 names an element.
- Clear the value registry (`clearReadValues`) at each test or scenario start: service `resetStack`, Selenium `startTest`/`startScenario`, Nightwatch `resetTestTracking`, Python `pytest_runtest_logstart`. Why: a later `assert.ok(true)` boxed an element an earlier test read `true` from.
- On Nightwatch, also clear when the running `it` (`rowTestUid`) changes, via `scopeReadValuesToRowTest`. Why: the plugin hook fires once per module on the BDD interface, so a `beforeEach` read still carries the previous `it`'s scope.
- Let the first operand with a known producer decide, in core and in Python (`read_value_locators.py`); end the lookup at a subject owned by no element. Why: otherwise the expected value borrows the box of an element that read the same text.
- Name no locator for a node:assert row with no known producer; do not fall back to the last element a locator resolved. Why: that boxed `h2` for `assert.notEqual(await browser.getTitle(), …)`.
- Skip the service's own title probe with `isServiceProbe` (`action-snapshot.ts`, which runs the probe inside an AsyncLocalStorage context both hooks check). Why: the probe's title read sits under the spec frame, so it would log as the user's own `getTitle` row.
- Do not list `getTitle` in `INTERNAL_COMMANDS`, and do not count probes in flight, to hide the probe. Why: tried; both hid the user's own `getTitle` row, and a count hid it while a timed-out probe was still running.
- `describeAssertFailure` (`core/assert-patcher.ts`) rewrites only node's auto-generated AssertionError message, and its stack echo, to `Expected/Received`. Why: node's coloured per-character diff interleaves once any consumer strips ANSI; user messages and errors without actual/expected pass through.
- Do not extend `after.point` to assert rows. Why: `resolveActionPoint` (`trace/src/trace-action-events.ts`) gates on the Element class and `POINTABLE_METHODS`, so a point would draw a click marker an assertion never earned.
- Do not share one registry between WDIO's last-selector and Selenium's `WeakMap` (`helpers/element-locators.ts`). Why: WDIO's hook sees a serialized handle with an id string, while Selenium has the live object and no readable id.

## Accepted residuals (not regressions)

- **Unverified, no test:** service `command-selectors.ts` keeps one mutable last-selector, so `const a = await $('#a'); const b = await $('#b'); await a.click()` stamps `#b`, and the value registry gets that wrong selector too. Selenium's WeakMap has `selenium-devtools/tests/element-locators.test.ts`.
- Boolean reads are weakly discriminating: a value collision with no intervening producer can mis-attribute.
- Nightwatch's `element()`/`.find()` API and its ignored commands (`execute`, `executeAsync`, `perform`) are never wrapped, so their values neither claim nor clear.
- Jest/vitest-style `expect()` (Selenium) and chai produce no rows, since those libraries expose no assertion hook; Nightwatch's own `expect` API is not wrapped either.
