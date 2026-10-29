# Writing an adapter for a new language

This guide is for someone adding devtools support to a language or framework that cannot import the TypeScript packages in this repo: Java + JUnit, C# + NUnit, Ruby + RSpec, and so on. It assumes you know WebDriver and your target framework, and that you have read the package map in [ARCHITECTURE.md](../ARCHITECTURE.md).

The worked example throughout is the Python adapter, `packages/selenium-devtools-py`. It shares no code with the JavaScript adapters, only the wire format, so everything it does is something your adapter has to do too.

---

## 1. What an adapter is, and what it is not

An adapter is a process-local library that watches a test run and streams `{scope, data}` JSON frames over one WebSocket to the devtools backend. That is the whole interface. It does not render anything, store anything, or build trace archives itself.

What you reuse, and how you reach it from another language:

| You get | Provided by | How a non-JS adapter reaches it |
|---|---|---|
| The dashboard UI (Actions, Console, Network, DOM replay, Source, video) | `packages/app`, served by the backend | Nothing to do: it renders whatever frames you send. |
| WS gateway, broadcast to dashboard tabs, run accumulation, Preserve & Rerun | `packages/backend` | Connect to `/worker` and send frames. |
| The page-side DOM collector (`window.wdioTraceCollector`) | `packages/script`, served by the backend | `GET /api/collector` (`COLLECTOR_API.get` in `shared/src/collector.ts`). Raw JS source. |
| Element / accessibility-tree scripts for the trace's A11y tab | `shared/src/element-scripts.ts`, served by the backend | `GET /api/element-scripts?runner=<TestRunnerId>` (`ELEMENT_SCRIPTS_API`). JSON `{accessibilityTree, elements}`. |
| Collector readiness probe, `<script>` injection and forced-anchor drain, and the navigation timing read | `shared/src/page-scripts.ts`, served by the backend | `GET /api/page-scripts` (`PAGE_SCRIPTS_API`). JSON `{collectorReady, collectorInject, collectorDrain, capturePerformance}`, each a script body for an execute-script call. |
| Trace archive (`trace.zip`) building, retention policy, per-test slicing | `packages/trace`, run by the backend | Send a `traceExport` frame on the worker socket; the answer comes back as `traceExported` (`shared/src/trace-export.ts`). |
| Rerun / Run-all from the dashboard | backend `runner.ts` | Publish `launchCommand` / `rerunCommand` in your `metadata` frame and honour the reuse handshake (section 2d). |
| The backend itself | `@wdio/devtools-backend` on npm (`dist/server.js`, bin `devtools-backend`) | Spawn it with Node, or attach to one already running. |

Serving the collector, element scripts and page scripts over HTTP means their version always matches the backend you are talking to. Do not vendor a copy.

What an adapter must not do: re-implement the trace transforms, invent scope names, or branch on anything the backend did not tell you. If you need a new concept on the wire, it starts as a change to `packages/shared`.

## 2. The four responsibilities

### 2a. Driver command interception

**Contract.** Every user-visible WebDriver command produces one row in a `commands` frame (a `CommandLog`, see `wire-schema.json`):

- `startTime` is the wall clock (epoch ms) at **invocation**.
- `timestamp` is the wall clock at **completion**, after the driver has answered. `timestamp >= startTime`.
- `command` uses a name the trace vocabulary knows. `ACTION_MAP` in `shared/src/trace-actions.ts` already maps raw W3C protocol names (`get`, `clickElement`, `sendKeysToElement`, `clearElement`, `getElementText`, `goBack`, ...) because a protocol-level adapter reports those. An unmapped command still shows live but is dropped from a trace.
- A failed command still produces a row, with `error: {name, message}`, and the original exception is rethrown unchanged.
- Optional fields are omitted, never sent as `null` (the schema rejects `null` for an optional field).
- Your own scripts (collector injection, drains, screenshots) must not appear as rows.

A wait the test wrote (an element wait, or a wait on any other condition) is one row, named after what it waited for: `waitForElementLocated` (or the framework's own element wait name) with the locator as `selector`, mapped to `Element.waitForExist`, for a wait on an element locator, and `wait` (`Browser.waitForFunction`) for any other condition, with a numeric `id`. Send it when the wait starts, with `startTime` set and no result or error, and replace it by `id` when the wait ends, stamped at completion and carrying the timeout as `error`. Every command its condition issued, the polls of an element wait included, carries the wait's `id` as `parentId`, so the dashboard and the trace nest those rows under the wait, collapsed by default. `parentId` names whatever row's execution issued a row; a wait is the only parent today. The WebdriverIO service emits this shape (`packages/service/src/command-stack.ts` decides which commands are rows, `wait-rows.ts` sends them), and so does Nightwatch (`nightwatch-devtools/src/helpers/waitRows.ts`, which reads the issuing wait from an `AsyncLocalStorage` scope its condition runs in); Selenium and Python do not yet (#464), and the conformance rule `wait-row-parents-its-commands` and each one's known gap against it say what is missing.

To enrich a row after the fact (navigation timings, for example), send `replaceCommand` with `{oldTimestamp, command}`. Preserve the original row's `id`: the backend and app match a numeric `id` first, then fall back to the last row with `oldTimestamp`. If neither matches, they append the replacement as a new row.

**Pitfall already hit.** Two JS adapters stamped `timestamp` with the invocation clock while the page's mutation stream runs on real time, so a fill row replayed an empty field and a navigation row replayed the page it had just left (CLAUDE.md Known debt: "A command row is stamped at COMPLETION").

**Python.** `instrumentation.py` `install()` patches `WebDriver.execute`, the single chokepoint every driver and element command flows through (`patched_execute`). It records `start = now_ms()` before calling through, and `SessionCapturer.capture_command` in `capturer.py` stamps `timestamp=now_ms()` after the call returns. `frames.command_log` in `frames.py` builds the row and omits unset fields. Internal scripts run through `_guarded_execute_script`, which sets a flag that `patched_execute` checks so they bypass capture. `SKIP_COMMANDS` and `NAVIGATION_COMMANDS` live in `constants.py`; `_attach_performance` sends the enriched navigation row via `send_replace_command`.

Find the equivalent chokepoint in your binding (Java's `CommandExecutor`, .NET's `ICommandExecutor`, Ruby's bridge `execute`) rather than wrapping each public method.

### 2b. Collector injection and draining

**Contract.** The collector lives in the page and buffers DOM mutations. A **DOM anchor** is a `childList` mutation carrying `url`; the collector stamps it with the document's own `performance.timeOrigin`, i.e. the document's birth time. Your adapter must:

1. **Get the source** from `GET /api/collector`.
2. **Install it at document start when BiDi is available.** Request `webSocketUrl: true` in the new-session capabilities, then call BiDi `script.addPreloadScript` with **no browsing-context id** (global, so later contexts are covered) and the source wrapped as a function declaration: `async () => { <source> }`. Register it before the session's first navigation.
3. **Fall back to `<script>` injection** when BiDi is absent: run `collectorInject` from `GET /api/page-scripts` with the source wrapped as `(async function() { <source> })()` as its one argument. It appends a `<script>` to the current document and answers whether the collector came up (`collectorReady` probes again). Repeat whenever a drain finds no collector.
4. **Drain with a forced anchor.** Read the buffer with `collectorDrain` from `GET /api/page-scripts`, one atomic script that also anchors the current document:

```js
if (!(typeof window.wdioTraceCollector !== "undefined")) { return null; } window.wdioTraceCollector.captureCurrentDom(); return window.wdioTraceCollector.getTraceData();
```

This is `collectorDrainExpression(true)` in `shared/src/page-scripts.ts`; run the served string rather than a copy of the one above. Forcing is free after a document's first anchor (the collector guards it). A `null` result means "no collector in this document": inject once and drain again (`drainCollectorWithRecovery` in the same file). Forward the payload's `mutations` array as a `mutations` frame.

5. **Drain after any command that could have moved the page**, and once more before the session ends. Python drains after every captured command; the JS Selenium adapter uses a deny-list (`warrantsLiveDrain` in `selenium-devtools/src/helpers/commandPostActions.ts`). Either is acceptable; draining too rarely is not.

**Pitfalls already hit.**
- `<script>` injection only instruments the document that exists when it runs, so every navigation becomes a race; the preload removes the race class (Known debt: "Document-start injection is what removes the whole race class").
- A drain issued right after a navigation beats the collector's own asynchronous first anchor, and the destination's buffer dies with the page unless the drain forces the anchor (Known debt: "A drain must anchor the document it reads").
- A preload dies with its session; if your framework replaces sessions mid-run, re-register it for the new one (Known debt: "A preload dies with its session").

**Python.** `collector_source.py` `fetch_collector_source` (cached per backend), `bidi_preload.py` `register_collector_preload` and `as_function_declaration`, `page_scripts.py` `fetch` (the probe, injection and drain, cached per backend), `snapshot.py` (`wrap_injectable`, `SnapshotCapturer.inject`, `SnapshotCapturer.pull_trace` with one recovery), wired in `instrumentation.py` `_ensure_session_setup` (preload first, then `start_snapshot_capture`) and `_refresh_snapshot` / `_flush_mutations` after each command. `_enable_bidi_capability` adds `webSocketUrl` to the new-session request.

### 2c. Test-framework hooks

**Contract.** The suite tree is sent as a `suites` frame whose data is an **array of single-key records**, `[{"<uid>": SuiteStats}]`; a plain array of suites does not render. `SuiteStats.start`/`end` and `TestStats.start`/`end` are ISO-8601 strings. Required fields are listed in `wire-schema.json` (`uid`, `cid`, `title`, `fullTitle`, `type`, `file`, `start`, `tests`, `suites`, `hooks`, `_duration` for a suite; a test adds `parent`, `state`, `end`, `retries`). The frame is resent whole as states change; the app merges by uid.

- Publish the tree early (all tests `pending`), flip a test to `running` when it starts, then to its terminal state.
- Set `testUid` on every command row captured while a test runs. Without it the trace has no test boundaries.
- A setup or teardown failure is a test failure. A test whose setup failed never reports a "call" phase in most runners, so it must not be left `running`.
- Make uids stable and, if you can, directly addressable by your runner, so one rerun slot covers every row (see 2d).
- Without a framework (a plain script), synthesize one suite holding one test so the tree is not empty.

**Pitfall already hit.** A rerun process collects a subset of the tests, so anything derived from "this collection" (sibling order, the Run-all command) is wrong for the tree it merges into; Python orders siblings by source line for that reason (Known debt: "A rerun's process collects a SUBSET").

**Python.** `pytest_plugin.py`: `pytest_collection_finish` publishes every item as `pending`, `pytest_runtest_logstart` sets `capturer.test_uid` and marks `running`, `pytest_runtest_logreport` with `reported_state` maps setup/call/teardown outcomes, `pytest_sessionfinish` publishes the final tree and requests the trace export. `_SuiteRegistry` builds the tree; `frames.test_stats` / `frames.suite_stats` build the payloads; `capturer.send_suites` wraps each suite in its single-key record. The plain-script tree is `instrumentation.py` `_send_default_suite`.

### 2d. Transport, backend launch, and reruns

**Worker socket.** Open one WebSocket to `ws://<host>:<port>/worker?runId=<id>` (`WS_PATHS.worker`, `WORKER_WS_QUERY.runId` in `shared/src/routes.ts`). The query must be on the upgrade request line, because the backend decides then whether this connect continues the current run (keep accumulated state) or starts a new one (wipe it). Every worker of one run must send the same id: read `DEVTOOLS_RUN_ID` (`RUNNER_ENV.RUN_ID`) and adopt it if present, otherwise generate one and export it before forking workers. Send `reconnect=1` if you reopen the socket mid-run.

Frames you will receive from the backend on that socket:

| Scope | Meaning |
|---|---|
| `clientConnected` | A dashboard tab is open. |
| `clientDisconnected` | The last dashboard tab closed. Python treats this as "shut down". |
| `traceExported` | Answer to your `traceExport` request, matched on `requestId`. |

The backend handles `clearCommands`, `config` and `screencast` from you itself (a `screencast` frame registers `videoPath` so the UI can fetch the video from `/api/video/:sessionId`), handles `traceExport`, and forwards every other frame to the dashboard tabs while recording it for Preserve & Rerun.

**Backend launch or attach, in this order** (Python's `backend.py` `launch_or_attach`):

1. Reuse handshake set (`DEVTOOLS_APP_REUSE=1` plus `DEVTOOLS_APP_HOST` / `DEVTOOLS_APP_PORT`): attach to that backend. This wins over everything else.
2. An explicit port configured by the user: attach.
3. Otherwise spawn `node <backend>/dist/server.js` (or `npx @wdio/devtools-backend@<pinned>`) and read the bound port from its `listening at ...:<port>` log line. The preferred port may be busy, so do not assume it.

**Reuse handshake.** When the dashboard reruns something, the backend spawns your published command in a fresh process with these set (`REUSE_ENV` in `shared/src/runner.ts`):

```
DEVTOOLS_APP_REUSE=1
DEVTOOLS_APP_HOST=<backend host>
DEVTOOLS_APP_PORT=<backend port>
DEVTOOLS_RERUN_LAUNCH_COMMAND=<the parent's Run-all command, when it had one>
```

Attach to that backend, do not open a second dashboard window, and when `DEVTOOLS_APP_REUSE=1` republish `DEVTOOLS_RERUN_LAUNCH_COMMAND` as your `launchCommand` rather than deriving it from your own (narrowed) arguments.

**Run controls.** Put these in `metadata.options`:

```json
{
  "runCapabilities": {"canRunSuites": true, "canRunTests": true, "canRunAll": true},
  "launchCommand": "<runs everything>",
  "rerunCommand": "<runs one entry> {{testId}}"
}
```

`{{testId}}` (`RERUN_SLOT.testId`) is replaced with the entry's uid verbatim and shell-quoted; `{{testName}}` is replaced with its label, regex-escaped, for runners that filter by name pattern. Use one or the other. Only advertise a capability you built a command for. Set `DEVTOOLS_RUNNER_CWD` (`RUNNER_ENV.RUNNER_CWD`) to the directory reruns must start in **before** spawning the backend, since the backend reads it from its own environment.

**Pitfall already hit.** An adapter that ignored the reuse handshake launched a second backend and window for every rerun, so the window the user clicked Rerun in never changed (Known debt: "A spawned rerun must be pointed back at the backend that asked for it").

**Python.** `transport.py` `WSClient` (a dependency-free RFC 6455 client; `request_target` adds the run id), `run_id.py` `resolve_run_id` / `reset_run_id`, `backend.py` `reuse_target` and `launch_or_attach`, `rerun.py` (`configure_script`, `configure_pytest`, `_inherited_launch`, `_publish`, `_stamp_runner_cwd`), `lifecycle.py` `on_control`. `__init__.py` `enable()` shows the order: configure rerun commands, launch or attach, connect, install instrumentation.

**Trace mode.** If your adapter offers trace archives, send any `screencastFrames` and `actionSnapshots` first (in batches), then `traceExport` with `{requestId, outputDir, sessionId, tracePolicy?, traceGranularity?}`, and wait for `traceExported` on the reader side. Never let a failed export fail the run. Python: `trace_export.py` (`send_frames`, `send_action_snapshots`, `export`, `on_result`) driven by `__init__.py` `export_trace`.

## 3. The wire contract

### Frames you send

| Scope | `data` | When |
|---|---|---|
| `metadata` | `Metadata` (`type`, `sessionId`, `capabilities`, `runner`, `options`, `viewport?`, `url?`) | Once per WebDriver session, **before** its first `commands` frame. |
| `commands` | `CommandLog[]` | One per command, at completion; a wait also once at its start (2a). |
| `replaceCommand` | `{oldTimestamp, command}` | To update a row already sent. |
| `mutations` | `TraceMutation[]` | Each collector drain. |
| `suites` | `[{uid: SuiteStats}]` | Whenever the tree changes. |
| `consoleLogs` / `networkRequests` | `ConsoleLog[]` / `NetworkRequest[]` | From BiDi `log.entryAdded` / `network.*` events, if you capture them. |
| `sources` | `{absolutePath: fileText}` | Once per file a `callSource` (`path:line`) points at. |
| `config` | `{configFile}` | Optional, once: a config file the backend can rerun through its framework path (WDIO, Nightwatch), as an alternative to `metadata.options.configFile`. |
| `screencast` | `ScreencastInfo` (`sessionId`, `videoPath`, ...) | After you encode a session video. |
| `screencastFrames`, `actionSnapshots`, `traceExport` | see `trace-export.ts` | Trace mode only. |

`metadata.runner` must be a `TestRunnerId` (`TEST_RUNNER_IDS` in `shared/src/types.ts`). It selects the locator dialect for element scripts and how the backend treats the run. A protocol-level adapter currently reports `selenium-webdriver`; a new runner id is a `shared` change.

All times are epoch milliseconds except the suite/test `start`/`end` ISO strings. The shape of a row as Python's `frames.command_log` builds it (values illustrative):

```json
{"scope": "commands", "data": [{
  "command": "clickElement", "args": [{"id": "f.93A1"}], "result": null,
  "timestamp": 1760000000412, "startTime": 1760000000398, "id": 5,
  "callSource": "/abs/path/test_login.py:22",
  "selector": "button[type=\"submit\"]", "testUid": "test_login.py::test_valid"
}]}
```

### Generating your types

`packages/shared/wire-schema.json` is a JSON Schema (draft 2020-12) generated from shared's TypeScript types by `packages/shared/scripts/wire-schema.ts`: one entry per scope under `scopes`, shared shapes under `$defs`. A vitest test (`packages/shared/tests/wire-schema.test.ts`) fails when the committed copy is stale; regenerate with:

```sh
pnpm --filter @wdio/devtools-shared gen:wire-schema
```

Generate your language's types from that file and commit the output. `packages/selenium-devtools-py/scripts/gen_contract.py` is the model and does two things:

- `_TypedDictWriter` renders every `$defs` entry as a Python `TypedDict` into `_wire_types.py`.
- It reads the constants that are not types straight out of `shared/src` (scope names, `WORKER_WS_QUERY.runId`, `RUNNER_ENV.RUN_ID` and `RUNNER_CWD`, `REUSE_ENV`, `RERUN_SLOT.testId`, `COLLECTOR_API`, `ELEMENT_SCRIPTS_API`, `PAGE_SCRIPTS_API`, `TRACE_EXPORT_SCOPE`, `TEST_RUNNER_IDS`) into `_contract.py`, and **fails generation** if one the adapter depends on has disappeared. A renamed scope is otherwise silent: the frame is delivered and dropped.

CI runs the generator and then `git diff --exit-code` on both outputs (`.github/actions/python-package/action.yml`), so a `shared` change that alters the contract turns the adapter's job red. Do the same for your language. Note that Python's `/worker` path is still a hand-written constant (`constants.py` `WORKER_PATH`), not generated; generate yours.

### Validating what you send

Generated types document the contract but rarely enforce it at runtime. Python's `tests/wire_contract.py` validates every frame against `wire-schema.json` in unit tests: `RecordingTransport.send_json` checks each frame with `violations(scope, data)` (unknown fields, missing required fields, `null` where shared expects absence) and fails the owning test at cleanup. It collects rather than raises because the adapter's senders swallow exceptions, which would hide the violation exactly where it matters. Give your adapter a fake transport that does the same, and use it in every unit test that sends.

## 4. Proving it: the conformance suite

`packages/conformance` runs each adapter, as its own process, through one fixed scenario against a fake W3C WebDriver server, records every frame it sends, and judges the stream with behavioural rules. The same rules apply to every adapter.

### What the harness does

`src/harness.ts` `runScenario(command, args, {env, bidi, cwd?})`:

1. Starts `FakeWebDriver` (`src/fake-webdriver.ts`) and `RecordingBackend` (`src/recording-backend.ts`).
2. Spawns your scenario with the **reuse handshake** pointing at the recording backend (`DEVTOOLS_APP_REUSE=1`, `DEVTOOLS_APP_HOST`, `DEVTOOLS_APP_PORT`), so your adapter needs no test-only code path, plus the scenario variables (`SCENARIO_ENV` in `src/constants.ts`):

```
CONFORMANCE_WEBDRIVER=<fake WebDriver origin>
CONFORMANCE_LOGIN_URL=<origin>/login
CONFORMANCE_BROKEN_URL=<origin>/broken
```

3. Returns the recorded frames, the fake's ground truth (which documents were born and when, which navigations failed, which requests each document made, and what the fake served over BiDi), the exit code and the output. The scenario times out after 60 s.

The recording backend accepts only `/worker` upgrades, serves the real collector bundle at `/api/collector` and the real page scripts at `/api/page-scripts` as the real backend does, and stubs `/api/element-scripts`. The fake WebDriver models two pages (`PAGES`), answers `/url`, `/title` (each page's `PAGE_TITLES` entry, which reads the same as its `h2`), `/element(s)`, element `value`/`click`/`clear`/`text`, `/execute/*`, `/screenshot`, `/window`, `/window/handles`, `/window/rect`, and returns `null` for anything else. Each page loads its document plus the two `SUBRESOURCES`; the loads are the ground truth's `requests`, and a drain of the collector returns them once as Resource Timing rows (no status, no headers, `source: 'resource-timing'`), as `packages/script` reports them.

Every scenario runs in three BiDi modes (`BIDI_MODES` in `src/constants.ts`), each the shape of a real driver:

| Mode | The fake serves | The real driver it stands for |
|---|---|---|
| `live` | a `webSocketUrl`, every command answered, and `network.beforeRequestSent` / `network.responseCompleted` emitted for each load to the clients that subscribed | Chrome |
| `silent` | a `webSocketUrl` and every command answered, subscriptions accepted, no event ever emitted | Appium 3.7's BiDi shim on XCUITest |
| `off` | no `webSocketUrl` at all | Safari |

A `webSocketUrl` is returned only when the mode offers one **and** the new-session request asked for `webSocketUrl: true`; registering a preload (`script.addPreloadScript`) then gives every later document a collector anchored at birth (`src/fake-bidi.ts`). Over that socket the fake answers what a client routes through BiDi once it has it (`browsingContext.navigate`, `browsingContext.getTree`, `browsingContext.locateNodes`, `script.callFunction`), from the same two-page model, so WebdriverIO drives the same pages and the same user actions are stamped whichever protocol carried them; everything else is acknowledged.

The fake recognises the collector, not your adapter's way of using it, so inject and drain however your language makes natural:

| A script or its arguments | Fake treats it as |
|---|---|
| contain the collector's own source (it assigns `window.wdioTraceCollector`) | an injection, by any mechanism: the current document now has a collector |
| call `getTraceData()` | a drain; with `captureCurrentDom()` also called, a forced anchor |
| otherwise read `wdioTraceCollector` | the readiness probe |
| call `getEntriesByType('navigation')` | the page's Performance API read: the fake runs the script, as a WebDriver body or a BiDi function declaration or expression, against the page's navigation and resource timings, title and url, so it answers what the script returns and nothing if it returns nothing |

### The scenario

Every scenario runs through its framework's own test runner, the way a user's suite does: WebdriverIO's runner, the Nightwatch CLI, mocha with `--require @wdio/selenium-devtools`, and pytest with `--devtools` (see `scenarios/wdio/`, `scenarios/nightwatch/`, `scenarios/selenium/` and `scenarios/python/`). The adapter attaches through the reuse handshake and opens no UI. One session, created at `CONFORMANCE_WEBDRIVER` before the first test and quit after the last, runs six tests, in this order, with nothing else in between:

1. **Logs in and reads the greeting** (passes). Navigate to `CONFORMANCE_LOGIN_URL`; type `tom` into `#username` and `secret` into `#password` (CSS selectors); click `button[type="submit"]` (navigates to `/secure`); wait up to 2 s for `#flash`, which the page renders 150 ms after it loads, so the wait polls; read its text and assert it equals `You logged into a secure area!`.
2. **Waits on what the page shows** (passes). Read the text of `#flash`; wait until both `#flash` and the page's `h2` read non-empty text (a condition reading two elements, so each read must stay its own row); call a helper that waits until `#flash` reads that text again (a wait repeating the read the test just issued, whose poll must not fold into that row); click `#logout` (navigates back to `/login`).
3. **Asserts on the page title** (passes). Read the text of `h2` (`Login Page`), read the page title (`Login Page` too), and assert the title does not equal `Secure Area`, which test 2's condition wait read from the secure page's `h2`. Neither read owns the assertion's target: the title reads the same as the heading, and the expected value was an element's read.
4. **Fails on the wrong heading** (fails). Read the text of `h2` (`Login Page`) and assert it equals `Secure Area`.
5. **Times out waiting for a missing element** (fails). Wait up to 300 ms for `#missing`, which never renders.
6. **Survives a refused navigation** (passes). Navigate to `CONFORMANCE_BROKEN_URL`, which fails with HTTP 500; catch and ignore the error.

Use your framework's own idiom for each step (its element wait, its text read, its assertion), and plain equality where it has one (`node:assert`'s `equal` and `notEqual`, pytest's `==` and `!=`). Title each test as listed (`SCENARIO_TESTS` in `src/constants.ts`; pytest's `test_logs_in_and_reads_the_greeting` reads the same). Two tests fail by design, so the runner exits with its code for failed tests, which your `ADAPTERS` entry declares as `exitCode` (WebdriverIO 1, mocha its failure count 2, Nightwatch 5, pytest 1); any other code, a crash or a usage error, fails the run. The browser creates exactly three documents and makes nine requests: each document plus `/app.js` and `/app.css`.

### Adding your language

1. Add your id to `AdapterId` in `src/types.ts`.
2. Add `scenarios/<lang>/` holding a spec for the tests above, plus a config where your runner needs one (`scenarios/nightwatch/` and `scenarios/wdio/` are the models: the config reads the fake's origin from `CONFORMANCE_WEBDRIVER` and points the runner at it, with `start_process: false` for Nightwatch and `hostname`/`port` for WebdriverIO). Read the three variables by name (every spec repeats them, since none imports `SCENARIO_ENV`).
3. Add one entry to `ADAPTERS` in `src/adapters.ts`: `exitCode` (above), `ready()` (your toolchain and build are present, including any plugin registration your runner needs, such as pytest's entry point) and `prepare()` (the command, args and env that launch your scenario, its `scenarioFile` (the spec your call sites must name, which is the copy when you run from one), plus an optional `cleanup`, and a `cwd` for a CLI that resolves its runner and plugins from the working directory, as WebdriverIO does). `tests/conformance.test.ts` then runs your adapter in all three BiDi modes, holds it to every rule, and compares it with every other adapter. Expect the first run to be red: classify each line as a suite assumption to fix, a difference to declare with a reason, or an adapter bug to fix, and merge only when it is green. `ready()` may only skip a local run; in CI a missing prerequisite fails.
4. Make sure CI installs your toolchain before `pnpm test` in `.github/workflows/ci.yml` (Python's install step is there).

Run it locally with `pnpm test packages/conformance`. Vitest only collects `packages/**/tests/**/*.test.ts`.

### The rules

Defined in `src/checker.ts`, names in `RULES` (`src/constants.ts`):

| Rule | What it checks |
|---|---|
| `metadata-before-commands` | A `metadata` frame arrives before the first `commands` frame. |
| `row-stamped-at-completion` | No row has `startTime > timestamp`. |
| `anchor-carries-birth-time` | Every anchor's `url` and `timestamp` match a document the fake created, at its birth time. |
| `every-document-anchored` | Every document the fake created has an anchor. |
| `one-anchor-per-document` | No document has more than one anchor. |
| `row-replays-its-page` | For each navigate, click or fill row, the latest anchor at or before its `timestamp` is the document the browser was on when that action completed: a navigation row shows its destination, and a fill stamped after a later navigation is caught. |
| `navigation-row-names-its-destination` | A successful navigation row's url (bare, or W3C `{url}`) is the document the browser loaded when it completed. |
| `navigation-row-carries-timings` | Every successful navigation row carries `performance` once its replacements are applied (shared `replaceCommand`), as the page answered the Performance API read: the row goes out when the command completes, and again enriched. |
| `page-level-assertion-names-no-element` | The assertion in "Asserts on the page title" carries no `selector`, and the test shows at least one assertion row. A driver-level read records its value as owned by no element, and the first compared value with a known producer decides, so neither the heading that reads the same text nor the element that once read the expected value is boxed. |
| `failed-command-has-error-row` | Every navigation that failed in the browser has a row carrying `error`. |
| `replace-targets-a-sent-row` | Every `replaceCommand.oldTimestamp` names a row already sent, by a `commands` frame or as an earlier replacement's stamp. |
| `one-row-per-browser-action` | The number of `navigate`, `click` and `fill` rows equals what the fake browser received, after applying `replaceCommand` the way the dashboard does (shared `replaceCommand`: by `id`, then the last row with the old timestamp). |
| `tests-end-as-designed` | Every test in `SCENARIO_TESTS` is in the stream's suite tree (the latest report of each), ending in the state the scenario designs: a passing test reported failed or skipped, or a test missing, breaks it. |
| `every-test-has-rows` | Every scenario test the suite tree reports has at least one row. A row belongs to the test its `testUid` names, else to the last test started by then, where a `testUid` the tree never reports places all its rows by the first of them (`src/scenario-tests.ts`, the attribution the comparison uses). A test the tree never reports is left to `tests-end-as-designed`. |
| `wait-row-parents-its-commands` | Each scenario test shows exactly the waits it writes (`SCENARIO_WAITS` in `src/constants.ts`, as normalized steps); each wait row carries an `id` and a `startTime` and is first sent running, at its start; every row that ran inside a wait's span (`startTime` to `timestamp`) in the same test carries that wait's `id` as `parentId`; and every `parentId` names a row sent before it (`src/wait-nesting.ts`). |
| `failed-test-has-error-row` | Every scenario test reported failed, or designed to fail whatever it is reported, has a row that is a failed action by shared's `commandFailure`. An unmapped command's error does not count: a wait's polls error whether the wait passes or not, and the trace drops them. |
| `call-site-names-the-scenario` | Every row carrying a `callSource` names the spec the runner executed (`scenarioFile` on the adapter's launch, as launched or with symlinks resolved), at a line inside it: never DevTools' own code, another file, or the `unknown:0` placeholder. |
| `run-controls-are-served` | The dashboard offers every control the runner's defaults allow unless `metadata.options.runCapabilities` turns it off (shared `resolveRunCapabilities`, the dashboard's own rule), so a stream that advertises any control, by declaration or by silence, serves it: `launchCommand` or `rerunCommand` in the metadata (the backend's shell path, falling back from either to the other), `configFile` there, or a `config` frame (its framework path, which reruns a WDIO or Nightwatch config). With none, the backend falls back to the WebdriverIO binary, so the control runs the wrong tool. |
| `every-browser-request-listed` | For every url the browser loaded, the `networkRequests` rows (after folding re-sends under the same `id`, as the dashboard does) number at least the loads the browser made. Fewer means the page's Resource Timing was withheld although nothing else served the request. |
| `one-row-per-browser-request` | For every url the browser loaded, the rows number at most the loads the browser made. More means two sources listed one load, or a re-sent row carried a new id. The two rules are separate so a declared gap can cover the first without excusing the second. |
| `request-row-carries-what-the-browser-served` | With BiDi `live` (a socket handed to the session, not merely offered), every row carries a status and response headers. Otherwise every row either carries those, as the page's fetch/XHR patch supplies them, or is marked `source: 'resource-timing'`: a row with neither passes as a driver's and misleads the detail card. |

### Cross-adapter agreement

The rules check each adapter against what the fake browser did. A second check needs no rules: within each mode, every adapter's stream is reduced to what a dashboard user sees (`src/normalize.ts`: each step's shared action name, target, typed text, outcome and the page it replays, the pages snapshotted, the run controls offered, the requests listed; timestamps, ids, ports and raw command names dropped) and compared with the others (`src/agreement.ts`): the alphabetically first adapter in the mode is the reference every other is compared with. Steps are aligned within each scenario test (a row belongs to the test its `testUid` names, else to the last test started by then, from the suite tree, all rows of a `testUid` the tree never reports placed by the first of them) by their longest common sequence (`src/step-alignment.ts`), so a step one side misses is one difference, reported with the step before it, a step both sides show at different places is one move, and every step after either is still paired and compared for typed text, outcome and page. A row naming a `parentId` is a child step of its parent's step, as the dashboard nests it, and the children of two paired steps are aligned and compared the same way, as their own sequence under them. A moved step is compared the same way with its counterpart, so a gap scoped to a move excuses only where the step stands, never what it did there. Any difference fails as one of `adapters-agree-on-actions`, `-on-errors`, `-on-pages`, `-on-snapshots`, `-on-run-controls` or `-on-requests`, unless a declared gap explains it. A gap explains a difference only where its holder's own run shows the gap on that same step or document and the other adapter's run is clean there, so one adapter's limitation cannot hide a second bug in the other. Whether a row failed is shared's `commandFailure`, the rule the trace exporter uses (an `error`, a collapsed `passed: false`, or a wait that resolved `false`). An assertion or a wait that fails is compared as failed, not by its message, since each binding words those itself; a browser's own message is compared verbatim. This is what catches a difference no rule anticipated; the rules catch every adapter being wrong in the same way.

Navigation rows are recognised through `mapCommandToAction` (`method: 'navigate'`), with the url taken from a bare string arg or a W3C `{url}` arg, so name your navigation command accordingly.

### Reading a failure

A failing test prints the `unexplained` violations, each `{rule, message, subject?}`, for example `get(http://127.0.0.1:53211/login) at 1760000000412 replays no document; the browser was on http://127.0.0.1:53211/login` under `row-replays-its-page`. Each run also writes `packages/conformance/out/<adapter>-bidi-<mode>.json` (frames, ground truth, violations, output) and rebuilds `packages/conformance/out/index.html`, a report with each run's documents, anchors and rows on one timeline and the violations placed on the event they concern (`src/report.ts`, `src/report-html.ts`, `src/timeline.ts`). The report opens with "Do the adapters agree?": per mode, a column per adapter and a row per step, differing rows highlighted. A failing run opens with a "Where to look" block: for each unexplained rule, what it means, its usual cause, and which of the responsibilities in section 2 it tests, linked to that section (`src/rule-guide.ts`). It names no adapter's files: the section says what the responsibility requires, and your adapter's own structure says where it lives. The directory is gitignored; CI uploads it as the `conformance-report` artifact when the job fails. A failing `exitCode` assertion includes the scenario's full output.

### Allowlist entries

`src/allowlist.ts` `KNOWN_GAPS` lists differences an adapter is allowed to show: `{adapter, bidi, rules, reason, timingDependent?, only?, lacksSteps?, lacksTargets?}`, where `bidi` names one mode. An entry is legitimate only for a documented limitation (for example, the `<script>` fallback without BiDi racing a short-lived document) or a known adapter bug with an open issue, scoped with `only` to the differences it explains (one hunk, one move, or one test's reported state), and `reason` is required: state the limitation and point at its Known debt entry (`KNOWN_DEBT` in `src/constants.ts`; a test checks every entry it names exists). `only` narrows an entry to the violations or differences whose message it matches, so a second bug under the same rule still fails; a difference names each side in its own clause, so a pattern can name its holder's side whichever adapter is the reference. `lacksSteps` (steps, as `Class.method` or `Class.method target`, the adapter never emits, such as a wait its binding runs client-side) and `lacksTargets` (steps it emits without a target) are not excuses: a lacked step on the other side is passed over only where the adapter shows nothing in its place, every other step is still compared, and the entry goes stale once the adapter shows the step, shows any other step where it stood (a rename surfaces as a difference naming both), or is compared only with adapters that never show the step either, since then nothing checks it. `against` names the adapter an entry is matched against; when that adapter did not run, the entry is not judged stale. An entry that stops matching is reported as `stale` and fails the run (the report shows a run's stale gaps in its own section and a comparison's in the agreement section), so a fixed gap forces its own removal; `timingDependent: true` exempts a race that a run can happen to win, so such an entry is never reported stale and has to be removed by hand once its bug is fixed. Do not allowlist a rule your adapter breaks because it is unfinished.

## 5. Checklist

- [ ] Commands intercepted at the binding's single chokepoint; `startTime` at invocation, `timestamp` at completion; failures produce an `error` row and rethrow.
- [ ] Command names map through `ACTION_MAP`; optional fields omitted, never `null`.
- [ ] Internal scripts and screenshots bypass capture.
- [ ] `metadata` sent once per session before its first command, with `runner` and `options`.
- [ ] Collector fetched from `/api/collector` and the probe, injection, drain and timing read from `/api/page-scripts`; BiDi `webSocketUrl: true` requested; global preload registered before the first navigation and re-registered per new session.
- [ ] `<script>` fallback when BiDi is absent; drains force the anchor and recover once on `null`; drain after page-moving commands and at session end.
- [ ] Suite tree sent as single-key records, published early, states updated from setup, call and teardown; `testUid` on every row.
- [ ] Worker socket at `/worker?runId=...`; run id adopted from or exported to `DEVTOOLS_RUN_ID`.
- [ ] Reuse handshake attaches first and suppresses a second window; inherited `DEVTOOLS_RERUN_LAUNCH_COMMAND` republished; `DEVTOOLS_RUNNER_CWD` set before spawning the backend.
- [ ] `launchCommand` / `rerunCommand` published only when serviceable, with `{{testId}}` or `{{testName}}`.
- [ ] Types and constants generated from `wire-schema.json` and `shared/src`, with a CI drift check.
- [ ] Unit tests validate every sent frame against the schema.
- [ ] Conformance scenario and test added, passing with and without BiDi, any allowlist entry carrying a reason.
