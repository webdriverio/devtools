# wdio-selenium-devtools (Python)

Python Selenium adapter for the WebdriverIO DevTools dashboard — the fourth
adapter alongside the JS WebdriverIO / Nightwatch / Selenium-JS ones. It feeds
the **same backend and UI**, unchanged, over the language-neutral
`{scope, data}` WebSocket contract.

**Status: Phase 1 + 2.** Live command capture + test tree; browser console &
network via BiDi; screencast video; and a dashboard window that auto-opens and
tears down with the run. Verified against real headless Chrome. See
[Roadmap](#roadmap) for what's deferred.

## Install (dev)

```bash
pip install -e packages/selenium-py-devtools   # or: pip install wdio-selenium-devtools (when published)
```

The transport is **dependency-free** (stdlib WebSocket client). The only thing
on top of your own `selenium` install is this package; `pytest` is optional.

## Use

**With pytest (recommended) — no code changes to your tests:**

```bash
WDIO_DEVTOOLS=1 pytest tests/       # DEVTOOLS_PORT=<n> also opts in (and attaches)
```

The bundled plugin auto-captures the run, opens the dashboard in a dedicated
window, and — after the run — **keeps it open so you can inspect it**; close the
window (or Ctrl-C) to finish. Nothing devtools-specific goes in your test files.

**Without pytest** (any script / unittest) — add two lines to a normal Selenium
script (`devtools.enable()` + `devtools.wait_for_dashboard_close()`):

```python
import wdio_selenium_devtools as devtools

devtools.enable()                     # open dashboard + capture every command
# ... your normal selenium code, ending with driver.quit() ...
devtools.wait_for_dashboard_close()   # keep the UI open to inspect (no-op if headless)
devtools.disable()
```

Runnable example: [`examples/selenium/python-test/web_form.py`](../../examples/selenium/python-test/web_form.py).
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
| Network requests | Selenium **BiDi** (low-level subscribe, no interception) | `networkRequests` | 2 |
| DOM snapshot (preview iframe) | inject `packages/script`, re-inject per navigation, drain mutations | `mutations` | 2 |
| Screencast video | screenshot polling → ffmpeg-encoded `.webm` | `screencast` | 2 |

Element actions (`click`, `send_keys`, `text`, …) are captured for free: they
delegate to `self._parent.execute`, so the one wrapper sees them as
`clickElement`, `getElementText`, etc.

**BiDi is auto-enabled** — the adapter injects the `webSocketUrl` capability
into the `newSession` request so console/network work out-of-box (opt out with
`WDIO_DEVTOOLS_BIDI=0`). **Screencast** needs `ffmpeg` on PATH to encode the
`.webm`; without it, recording is skipped (one warning, no error).

## Dashboard window lifecycle

Like the JS adapters, `enable()` opens the dashboard in a dedicated, closable
Chrome window; closing that window (backend `clientDisconnected`) shuts the run
down, and ending the process (exit / Ctrl-C) closes the window. Auto-open is on
when stdout is a TTY; force it with `WDIO_DEVTOOLS_OPEN=1` or disable with `=0`.

## Layout

```
src/wdio_selenium_devtools/
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
(examples live at repo root: examples/selenium/python-test/web_form.py)
```

## Backend & publishing

Two artifacts, two registries — pip can't resolve the Node backend, so each
coupling is handled explicitly rather than via a `workspace:^`-style resolver:

| | Local (monorepo) | Published |
|---|---|---|
| **Adapter** (this package) | `pip install -e` | PyPI: `pip install wdio-selenium-devtools` |
| **Backend + UI** (Node) | `node packages/backend/dist/index.js` | npm: `npx @wdio/devtools-backend@<pinned>` |
| **Wire contract** (`shared`) | regenerated into `_contract.py` | the generated `_contract.py` ships in the wheel |

`enable()` obtains the backend in this order (local vs published falls out of it):

1. `DEVTOOLS_PORT` set → attach to an already-running backend (CI, manual).
2. `DEVTOOLS_BACKEND_CMD` set → spawn that explicit command.
3. monorepo `packages/backend/dist/index.js` present → spawn it (**local dev**).
4. else → `npx @wdio/devtools-backend@<BACKEND_NPM_VERSION>` (**published**).

The pinned `BACKEND_NPM_VERSION` in `backend.py` is the version link — there is
no auto-resolution, so it's bumped deliberately alongside a contract change.

Regenerate the contract after any change to `packages/shared`:

```bash
python3 packages/selenium-py-devtools/scripts/gen_contract.py
```

It fails loudly if a scope the adapter needs disappeared from `shared` — a
build-time drift alarm.

## Test

```bash
# unit (no deps):
PYTHONPATH=src python3 -m unittest discover -s tests -v

# e2e (needs selenium + a running backend; Selenium Manager fetches the driver):
DEVTOOLS_PORT=3000 PYTHONPATH=src python3 e2e_check.py
DEVTOOLS_PORT=3000 PYTHONPATH=src pytest e2e/test_smoke.py -p wdio_selenium_devtools.pytest_plugin -q
```

## Release (approach A)

Two workflows, mirroring the JS split (`ci.yml` tests / `release.yml` publish):

- **`python.yml`** — runs on PRs + pushes touching this package or `shared`:
  unit tests on Python 3.9 + 3.12, and a contract-drift check (regenerate
  `_contract.py`, fail on any diff). Zero repo config needed.
- **`python-release.yml`** — **manual** (`workflow_dispatch`, like the JS
  "Manual NPM Publish"), target `pypi` or `testpypi`. Builds the sdist + wheel
  and publishes via **trusted publishing (OIDC)** — no token/secret.

The wheel does **not** bundle the backend — approach A fetches a pinned
`@wdio/devtools-backend` via `npx` at runtime (Node 18+ required). Bundling it
(approach B/C) is a GA-time change.

**One-time setup before the first publish** (this is what claims the PyPI name):

1. On PyPI, add a **pending trusted publisher** for project
   `wdio-selenium-devtools` → owner `webdriverio`, repo `devtools`, workflow
   `python-release.yml`, environment `pypi` (repeat on TestPyPI with env
   `testpypi` if you want a dry run first).
2. Create matching GitHub **Environments** `pypi` (and `testpypi`).
3. Run the workflow — the first successful publish creates and claims the name.

Each release: bump `version` in `pyproject.toml`, then run the workflow (PyPI
rejects re-uploading an existing version).

## Roadmap

- **Phase 2 (done)** — BiDi console/network + screenshot-polling screencast.
  Not yet: a CDP `Page.startScreencast` push-mode fast-path, per-command
  screenshots, and performance capture.
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
