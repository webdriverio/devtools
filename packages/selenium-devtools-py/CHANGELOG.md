# selenium-devtools-py

Assembled at release from the fragments in `changes/` — see that directory's
README. Changesets generates the npm packages' changelogs from the pnpm
workspace, which this package is not a member of, so it has its own mechanism
of the same shape.

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
