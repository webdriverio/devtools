# wdio-selenium-devtools (Python)

Python Selenium adapter for the WebdriverIO DevTools dashboard — the fourth
adapter alongside the JS WebdriverIO / Nightwatch / Selenium-JS ones. It feeds
the **same backend and UI**, unchanged, over the language-neutral
`{scope, data}` WebSocket contract proven in `examples/python-spike`.

**Status: Phase 1 (MVP).** Live command capture + test tree, verified against
real headless Chrome. See [Roadmap](#roadmap) for what's deferred.

## Install (dev)

```bash
pip install -e packages/selenium-py-devtools   # or: pip install wdio-selenium-devtools (when published)
```

The transport is **dependency-free** (stdlib WebSocket client). The only thing
on top of your own `selenium` install is this package; `pytest` is optional.

## Use

`enable()` launches the dashboard backend for you (see
[Backend & publishing](#backend--publishing)) — no separate step needed.

**With pytest** (auto-wired; opt in per run so it never hijacks other runs):

```bash
WDIO_DEVTOOLS=1 pytest tests/           # DEVTOOLS_PORT=<n> also opts in (and attaches)
```

**Without pytest** (any script / unittest):

```python
import wdio_selenium_devtools as devtools

devtools.enable()        # launch-or-attach backend + instrument selenium
# ... your normal selenium code ...
devtools.disable()       # terminates the backend if we launched it
```

If the backend can't be launched or reached, `enable()` warns and returns
`None` — capture is skipped, your tests still run.

## What Phase 1 captures

| Data | How | Scope sent |
|---|---|---|
| Commands (driver + element) | wrap `WebDriver.execute()` — the single chokepoint all commands flow through | `commands` |
| Session metadata | read `session_id` + `caps` after `newSession` | `metadata` |
| Test / suite tree | pytest plugin (`pytest_runtest_logreport` / `sessionfinish`) | `suites` |

Element actions (`click`, `send_keys`, `text`, …) are captured for free: they
delegate to `self._parent.execute`, so the one wrapper sees them as
`clickElement`, `getElementText`, etc.

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
  instrumentation.py  execute() wrap (patch target injectable for tests)
  backend.py          launch-or-attach the Node backend + port discovery
  pytest_plugin.py    suite/test tree feeder (opt-in)
scripts/gen_contract.py   regenerate _contract.py from shared (dev-time; also a drift-guard)
tests/                stdlib-unittest unit tests (no selenium/pytest needed)
e2e_check.py          real-Chrome smoke (plain script)
e2e/test_smoke.py     real-Chrome smoke (pytest + plugin)
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

Pair either with `examples/python-spike/verify-client.mjs` to watch the frames
fan out to a dashboard-role client.

## Release (approach A)

CI (`.github/workflows/python.yml`) runs the unit tests on Python 3.9 + 3.12 and
fails if the generated contract has drifted from `shared`. Tagging
`python-vX.Y.Z` builds the sdist + wheel and publishes to PyPI via trusted
publishing (one-time setup: a PyPI trusted-publisher entry + a `pypi` GitHub
environment). The wheel does **not** bundle the backend — approach A fetches a
pinned `@wdio/devtools-backend` via `npx` at runtime (Node 18+ required).
Bundling it (approach B/C) is a GA-time change.

## Roadmap

- **Phase 2** — screencast (CDP `Page.startScreencast` via `execute_cdp_cmd` +
  screenshot-poll fallback), per-command screenshots, performance capture.
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
