# selenium-devtools-py (Python)

Python Selenium adapter for the WebdriverIO DevTools dashboard — the fourth
adapter alongside the JS WebdriverIO / Nightwatch / Selenium-JS ones. It feeds
the **same backend and UI**, unchanged, over the language-neutral
`{scope, data}` WebSocket contract.

**Status: Phase 1 + 2.** Live command capture + test tree; browser console &
network via BiDi; assertion rows; screencast video; and a dashboard window that
auto-opens and tears down with the run. Verified against real headless Chrome.
See [Roadmap](#roadmap) for what's deferred.

## Install (dev)

```bash
pip install -e packages/selenium-devtools-py   # or: pip install selenium-devtools-py (when published)
```

The transport is **dependency-free** (stdlib WebSocket client). `selenium>=4.44`
is installed with the package; `pytest` is optional.

**Requires Python 3.10+ and selenium 4.44+.** Network capture subscribes through
the public BiDi event API that selenium regenerated in 4.44 — before that the
only way to observe requests without pausing them was a private connection,
which the same release removed. 4.44 requires Python 3.10, which sets the
Python floor too.

Both floors are declared in `pyproject.toml` (`requires-python` and
`dependencies`), so pip enforces them at install time rather than leaving you to
discover an empty Network tab at runtime. If pip resolves an older selenium
anyway — a pin elsewhere in your project, or an existing environment — the
adapter says so on the first command instead of degrading quietly.

## Use

**With pytest (recommended) — no code changes to your tests:**

```bash
DEVTOOLS_ENABLE=1 pytest tests/       # DEVTOOLS_PORT=<n> also opts in (and attaches)
```

The bundled plugin auto-captures the run, opens the dashboard in a dedicated
window, and — after the run — **keeps it open so you can inspect it**; close the
window (or Ctrl-C) to finish. Nothing devtools-specific goes in your test files.

**Without pytest** (any script / unittest) — add two lines to a normal Selenium
script (`devtools.enable()` + `devtools.wait_for_dashboard_close()`):

```python
import selenium_devtools as devtools

devtools.enable()                     # open dashboard + capture every command
# ... your normal selenium code, ending with driver.quit() ...
devtools.wait_for_dashboard_close()   # keep the UI open to inspect (no-op if headless)
devtools.disable()
```

Runnable example: [`web_form.py`](../../examples/selenium/python-test/web_form.py),
the three-line version above. From the repo root, after `pip install -e` above and
a `pnpm build` so the backend exists:

```bash
pnpm demo:python
```

Unlike `demo:wdio` and friends, this needs the Python package installed and uses
whatever `python3` resolves to on your PATH.
If the backend can't be launched or reached, `enable()` warns and returns
`None` — capture is skipped, your tests still run.

**ChromeDriver:** you need one matching your Chrome (a mismatch breaks all
Selenium, not just this). Selenium 4.6+ auto-manages it when no `chromedriver`
is on `PATH`; otherwise keep it current (`brew upgrade chromedriver`).

## What it captures

| Data | How | Scope | Phase |
|---|---|---|---|
| Commands (driver + element) | wrap `WebDriver.execute()` — the single chokepoint all commands flow through | `commands` | 1 |
| Session metadata | read `session_id` + `caps` on the first ready command | `metadata` | 1 |
| Test / suite tree | pytest plugin (`pytest_runtest_logreport` / `sessionfinish`) | `suites` | 1 |
| Browser console + JS errors | Selenium **BiDi** (`driver.script` handlers) | `consoleLogs` | 2 |
| Network requests | Selenium **BiDi** (`Network.add_event_handler`, observe-only — never an intercept, which would pause every request) | `networkRequests` | 2 |
| Assertions | pytest hooks under pytest; line tracing for a plain script | `commands` | 2 |
| DOM snapshot (preview iframe) | `packages/script` registered at document-start (**BiDi** preload), pushing mutations back over a BiDi channel; without BiDi, injected per navigation and drained after each command | `mutations` | 2 |
| Screencast video | screenshot polling → ffmpeg-encoded `.webm` | `screencast` | 2 |

Element actions (`click`, `send_keys`, `text`, …) are captured for free: they
delegate to `self._parent.execute`, so the one wrapper sees them as
`clickElement`, `getElementText`, etc.

**BiDi is auto-enabled** — the adapter injects the `webSocketUrl` capability
into the `newSession` request so console/network work out-of-box (opt out with
`DEVTOOLS_BIDI=0`). It also buys the higher-fidelity DOM path: with BiDi the
page pushes its own mutations, so no command pays for a drain round trip;
without it every command that could have moved the page pays for one. **Screencast**
needs `ffmpeg` on PATH to encode the `.webm`; without it, recording is skipped
(one warning, no error).

### Assertions

Passing and failing `assert` statements appear as rows carrying **expected** and
**actual**, and failures reach the Errors tab. Python's `assert` is a statement
rather than a call, so unlike the JS adapters' `node:assert` patching there is
nothing to wrap — the outcome comes from the runner, and how much is available
differs by runner.

**Under pytest**, from its assertion rewriter, so every row carries real values.
Passing assertions need pytest's `enable_assertion_pass_hook`, which the plugin
switches on for itself. One caveat: pytest decides per module, while *rewriting*
it, whether to emit that hook — so a module whose rewritten bytecode was cached
before the plugin was installed keeps reporting failures only. The adapter says
so once at collection and names the cache to delete, which is **not** always the
`__pycache__` beside your tests: with `sys.pycache_prefix` set (macOS's system
python sets it by default) every rewritten module goes to one central tree
instead.

**In a plain script** (`python login.py`) there is no rewriter — by the time
`enable()` runs the module is already compiled — so outcomes come from the
interpreter's line events, and values are read from the frame that is about to
run the assert. Only reads that cannot execute your code are resolved: a literal
or a local resolves, an attribute or a call does not, because evaluating
`driver.current_url` again would issue another WebDriver command. Those rows
carry the condition and the error without values.

## Dashboard window lifecycle

Like the JS adapters, `enable()` opens the dashboard in a dedicated, closable
Chrome window; closing that window (backend `clientDisconnected`) shuts the run
down, and ending the process (exit / Ctrl-C) closes the window. Auto-open is on
when stdout is a TTY; force it with `DEVTOOLS_OPEN=1` or disable with `=0`.

## Layout

```
src/selenium_devtools/
  __init__.py         public API — enable() / disable() / get_capturer()
  constants.py        defaults, env-var names, skip sets, pinned backend version
  types.py            TypedDicts for the wire payloads (mirror packages/shared)
  _contract.py        GENERATED from packages/shared — scope names + CONTRACT_VERSION
  utils.py            framework-agnostic helpers (now_ms, iso, to_jsonable, call_source)
  frames.py           pure builders for each {scope,data} payload
  transport.py        stdlib WebSocket client (handshake, masked frames, ping/pong, control reader)
  capturer.py         SessionCapturer: command IDs, normalize→send, metadata-once
  instrumentation.py  execute() wrap + BiDi auto-enable + session-setup hook
  bidi.py             BiDi console/JS-error + network capture (pure mapping + wiring)
  screencast.py       screenshot-polling recorder + ffmpeg webm encode
  backend.py          launch-or-attach the Node backend + port discovery
  lifecycle.py        dashboard window open/close + shutdown-on-disconnect
  pytest_plugin.py    suite/test tree feeder (opt-in)
scripts/gen_contract.py   regenerate _contract.py from shared (dev-time; also a drift-guard)
tests/                stdlib-unittest unit tests (no selenium/pytest needed)
e2e_check.py          real-Chrome smoke (plain script)
e2e/test_smoke.py     real-Chrome smoke (pytest + plugin)
(example lives at repo root: examples/selenium/python-test/web_form.py)
```

## Backend & publishing

Two artifacts, two registries — pip can't resolve the Node backend, so each
coupling is handled explicitly rather than via a `workspace:^`-style resolver:

| | Local (monorepo) | Published |
|---|---|---|
| **Adapter** (this package) | `pip install -e` | PyPI: `pip install selenium-devtools-py` |
| **Backend + UI** (Node) | `node packages/backend/dist/server.js` | npm: `npx @wdio/devtools-backend@<pinned>` |
| **Wire contract** (`shared`) | regenerated into `_contract.py` | the generated `_contract.py` ships in the wheel |

`enable()` obtains the backend in this order (local vs published falls out of it):

1. `DEVTOOLS_PORT` set → attach to an already-running backend (CI, manual).
2. `DEVTOOLS_BACKEND_CMD` set → spawn that explicit command.
3. monorepo `packages/backend/dist/server.js` present → spawn it (**local dev**).
4. else → `npx @wdio/devtools-backend@<BACKEND_NPM_VERSION>` (**published**).

The pinned `BACKEND_NPM_VERSION` in `backend.py` is the version link — there is
no auto-resolution, so it's bumped deliberately alongside a contract change.

Regenerate the contract after any change to `packages/shared`:

```bash
python3 packages/selenium-devtools-py/scripts/gen_contract.py
```

It fails loudly if a scope the adapter needs disappeared from `shared` — a
build-time drift alarm.

## Test

```bash
# unit (no deps):
PYTHONPATH=src python3 -m unittest discover -s tests -v

# e2e (needs selenium + a running backend; Selenium Manager fetches the driver):
DEVTOOLS_PORT=3000 PYTHONPATH=src python3 e2e_check.py
DEVTOOLS_PORT=3000 PYTHONPATH=src pytest e2e/test_smoke.py -p selenium_devtools.pytest_plugin -q
```

## Release (approach A)

Two workflows, mirroring the JS split (`ci.yml` tests / `release.yml` publish):

- **`python.yml`** — runs on PRs + pushes touching this package or `shared`:
  unit tests on Python 3.10 + 3.13, and a contract-drift check (regenerate
  `_contract.py`, fail on any diff). Zero repo config needed.
- **`python-release.yml`** — **manual** (`workflow_dispatch`, like the JS
  "Manual NPM Publish"), target `pypi` or `testpypi`. Builds the sdist + wheel
  and publishes via **trusted publishing (OIDC)** — no token/secret.

The wheel does **not** bundle the backend — approach A fetches a pinned
`@wdio/devtools-backend` via `npx` at runtime (Node 18+ required). Bundling it
(approach B/C) is a GA-time change.

**One-time setup before the first publish** (this is what claims the PyPI name):

1. On PyPI, add a **pending trusted publisher** for project
   `selenium-devtools-py` → owner `webdriverio`, repo `devtools`, workflow
   `python-release.yml`, environment `pypi` (repeat on TestPyPI with env
   `testpypi` if you want a dry run first).
2. Create matching GitHub **Environments** `pypi` (and `testpypi`).
3. Run the workflow — the first successful publish creates and claims the name.

Each release: bump `version` in `pyproject.toml`, then run the workflow (PyPI
rejects re-uploading an existing version).

## Roadmap

- **Phase 2 (done)** — BiDi console/network, assertion rows, and
  screenshot-polling screencast. Not yet: a CDP `Page.startScreencast` push-mode
  fast-path, per-command screenshots, and performance capture.
- **Phase 3** — trace export, preserve-and-rerun, action snapshots. Per the
  architecture, the heavy post-processing is a candidate to live server-side in
  the backend (written once) rather than re-implemented here.

## Design notes

- **Backend/UI unchanged.** This adapter only produces the wire frames; the
  server routes and renders them exactly as for the JS adapters.
- **Capture never breaks tests.** Commands are recorded around the real call;
  errors are captured *and re-raised* unchanged; a missing dashboard is a no-op.
- **Contract drift** is the main long-term risk (see the integration artifact).
  Mitigated two ways: `_contract.py` is generated from `packages/shared` (scope
  names + `CONTRACT_VERSION`), and the generator fails if a required scope
  vanishes. Full field-level type generation is a future step.
