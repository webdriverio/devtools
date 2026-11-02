# selenium-devtools-py

Assembled at release from the fragments in `changes/` — see that directory's
README. Changesets generates the npm packages' changelogs from the pnpm
workspace, which this package is not a member of, so it has its own mechanism
of the same shape.

## 0.3.0 — 2026-10-30

- An assertion row now names the element its value was read from, so the dashboard boxes that element when the row is selected: `assert heading.text == "Secure Area"` carries the locator `heading` was found by. This works for values read with `.text`, `get_attribute`, `is_displayed` and the other element reads, in pytest runs and in plain scripts. A value read from the page itself, such as `driver.title` or `driver.current_url`, names no element, even when an element's text reads the same.

- An assertion row only names an element read in the same pytest test. An assertion in a later test no longer boxes an element an earlier test read the same value from.

- Behaviour now matches the JavaScript adapters in four places. An assertion comparing a read value with an equal number of the other numeric type, such as `assert count == 3.0` after an element read returned `3`, now names that element. Command row ids now start at the process's base id rather than one past it. Two waits started from one helper with different anonymous conditions, such as two `lambda`s, are now told apart when one outer wait's polls switch between them, so their polls no longer fold into one row. A navigation whose page reports no resources or document info leaves those fields absent instead of reporting an empty list, a count of 0 and an empty document.

  A navigation row's summary shows its load time in milliseconds to two decimals, such as `246.40 ms`, as the JavaScript adapters do.

- The generated wire types carry `CommandLog.parentId`, the id of the row whose execution issued a row, which the dashboard nests under that row.

- Node.js 22.23.4, 24.22.1, 26.12.1 or a later release of these lines is required on the PATH, where 22.19 was enough before. These are the first releases with the updated CA store for the eMudhra intermediate CA compromise, and the backend now requires them. With a Node release below the floor of its line, for example 22.22 or 24.21, which worked before, `enable()` now logs a warning (`could not start dashboard (...); continuing without capture`) that names the version it found and the versions it needs, then returns `None`, and the run continues without capture; `selenium-devtools install-backend` prints that error and exits with code 1 when it installs (no backend on disk yet, or `--force`); with the backend already on disk it does not check Node and still succeeds. The odd lines (23, 25) behave the same. Update Node on the PATH, or attach to a backend someone else runs via `DEVTOOLS_PORT`, which still needs no local Node.

- Pin the backend a `pip install` user runs to 2.1.0.

- The scripts that inject and drain the DOM collector and read a navigation's timings are now fetched from the backend once per run, so they are the same scripts the JS adapters run rather than copies kept in this package. A backend too old to serve them logs a warning and the run continues with DOM replay and navigation timings off.

- An explicit `devtools_trace = false` now outranks a trace policy or granularity
  that only implies trace mode at the same level or below, with the command line
  (flags and `-o`) above the ini file. `pytest -o devtools_trace=false` therefore
  gets a live dashboard from a project whose ini commits a policy, and the run
  logs one warning naming the setting it left with nothing to do. A policy or
  granularity left that way no longer opts the run in on its own.

- Every `WebDriverWait(...).until(...)` and `until_not(...)` is now one row in the Actions list, passing or not, and the commands its condition issued are nested under it, collapsed until you open the row (it opens on its own when the wait timed out). The row appears as soon as the wait starts and is updated when it ends, carrying what the wait returned as its result, or the `TimeoutException` when it timed out. A wait on `EC.presence_of_element_located(locator)` is named `waitForElementLocated` and one on `EC.visibility_of_element_located(locator)` `waitForElementVisible`, each on the same selector as the element rows its polls make, so the trace player shows them as the element waits they are; any other condition is a `wait` row named after the condition, `until_not` with a `not ` prefix. Before, a passing wait had no row of its own, and a timed-out one replaced the row of its last poll.

- A `WebDriverWait(...).until(...)` or `until_not(...)` that times out now shows as a failed `wait` row in the Actions list and the Errors tab, named after its condition (for example `presence_of_element_located(('css selector', '#missing'))`), at the line that called it and carrying the `TimeoutException`. Before, the test failed with nothing red in the dashboard and the timeout only in the console. The commands a wait repeats on every poll now fold into one row per call instead of listing a row per poll. Rows from different processes reporting into one dashboard (pytest-xdist workers, or a test rerun from the dashboard) no longer share ids, so a folded wait or a navigation's timings can no longer replace another process's row.

## 0.2.0 — 2026-10-22

- Fix network requests occasionally staying pending in the Network tab when BiDi is capturing them. Selenium delivers each BiDi event on a thread of its own, so a request's response could be sent to the dashboard before the request itself, and the request's pending row then replaced the completed one. A request's events are now sent in order, and a response that arrives before its request is held until the request has been listed. The teardown network summary also counts responses whose request was never seen, and separately counts responses dropped because too many were waiting for their request at once.

- A failed command's row now carries the browser's own error message, as the JavaScript adapters send it. It used to carry the exception's string form, so the dashboard's Errors tab showed `Message: ` before the text and the driver's stacktrace after it.

- Frames now leave out an optional field instead of sending it as null:
  `callSource` on commands and tests, `url` on session metadata, `status` and
  `endTime` on a network request still in flight, and `state` on an unfinished
  suite. A native session's viewport now carries `offsetLeft: 0`, `offsetTop: 0`
  and `scale: 1`, as the JavaScript adapters send it. The payload types in
  `selenium_devtools.types` are now generated from the dashboard's own schema;
  `ElementScripts` is renamed to `ElementScriptsResponse`.

- Capture a native app's network requests on Appium, through the [appium-interceptor](https://github.com/AppiumTestDistribution/appium-interceptor-plugin) plugin. A native app has no document and Appium serves no BiDi network events, so the Network tab of a native session was always empty. When Appium runs with `--use-plugins=appium-interceptor` and the session sets `appium:intercept: True`, the adapter starts a listener on the plugin's proxy and lists what it recorded after every command, when each test reports its outcome, and when the driver quits. Each request carries its method, URL, status, headers and bodies; the plugin records no timing, so a request is placed when it was first read. Without the plugin the adapter logs a warning and the session runs as usual. The plugin supports Android.

- Capture network requests on sessions without WebDriver BiDi: Safari, and every session Appium serves. Network capture subscribed through BiDi alone, so those sessions showed an empty Network tab. The page collector the adapter already injects for DOM replay now supplies the tab instead: its `fetch` / `XMLHttpRequest` patch, with headers, status and bodies for the calls the page makes, and the document's Resource Timing buffer, with every load the browser made and its timing and size. Resource Timing exposes no headers or bodies, and on Safari no status; the dashboard names that limit on each such request rather than showing it as failed. When BiDi is serving the session, the page's entries are withheld so each request is listed once. Serving means delivering: Appium's BiDi shim accepts the subscription and then sends no event, so the page's entries are withheld only once a BiDi request event has actually arrived.

  A request the browser gives up on (a blocked beacon, a refused connection) is closed as a failure with the browser's own reason, where it used to stay pending for the rest of the session.

  A session whose `webSocketUrl` capability is not a socket address (safaridriver echoes the requested `true` back) is no longer treated as BiDi-capable; previously selenium's own connection thread crashed on it.

- Node.js 22.19 or newer is required on the PATH, where 18 was enough before: the backend this package launches now needs it, and `enable()` checks the minor as well as the major so a Node 22.0 reports what to upgrade instead of failing later. Node 18 and 20 are past end of life. Attaching to a backend someone else runs, via `DEVTOOLS_PORT`, still needs no local Node.

- Pin the backend a `pip install` user runs to 1.11.2.

- Pin the backend a `pip install` user runs to 2.0.0.

- The generated wire types include the payload the dashboard now receives when a run ends: whether it was stopped, when, and why, for a run that exited before it reported anything.

## 0.1.0

First release.

Python Selenium adapter for the WebdriverIO DevTools dashboard, feeding the same
backend and UI as the JavaScript adapters over the language-neutral
`{scope, data}` WebSocket contract.

- **Live mode** — command capture and the test tree, browser console and network
  over BiDi, assertion rows, per-command screenshots and selectors, DOM replay,
  and a pushed CDP screencast.
- **Trace mode** — the same portable `trace.zip` the JavaScript adapters write,
  with action snapshots, sources and a transcript. Built by the backend on the
  adapter's behalf, since this package ships no Node.
- **Run controls** — Run, Rerun, Run-all and Preserve & Rerun, with reruns
  selected by pytest nodeid and spawned in pytest's own rootdir.
- **pytest plugin** — auto-discovered, opt-in per run (`--devtools`,
  `--devtools-trace`), per project (`[tool.pytest.ini_options]`) or per shell
  (`DEVTOOLS_ENABLE`). Installing it never changes how an existing suite behaves.
- **`selenium-devtools install-backend`** — puts the Node backend on disk once,
  so a run starts a server it already has. Without it a run still works: the
  backend is fetched with `npx` on first use, at a registry round trip per run.
  Where that fetch fails — a proxy withholding a newly published version, say —
  the adapter warns as the run starts and your tests then run *without capture*,
  passing but empty, which is a worse thing to discover than an install command
  that failed and said why.
- Ships `py.typed`, so the annotations already on the public API reach a
  consumer's type checker instead of resolving to `Any`.
- Requires Python 3.10+, `selenium>=4.44`, and Node.js 18+ on PATH for the
  backend.

Known gaps against the JavaScript adapters are listed under Roadmap in the
README.
