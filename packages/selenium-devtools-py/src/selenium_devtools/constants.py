"""Module-level constants — the single home for connection defaults, env-var
names, the skip sets, and the pinned backend version. No internal imports."""

from __future__ import annotations

import os

# ── Runner identity ──────────────────────────────────────────────────────────
# The id itself is `RUNNER_ID` in the GENERATED `_contract.py`, derived from
# shared's TEST_RUNNER_IDS so a rename there fails generation rather than
# shipping a value the app narrows away.
#
# Every run control refused — what `rerun.py` publishes until it has built a
# command, and what it keeps for a run it cannot address. Sending this matters:
# absent an explicit bag the app falls back to `DEFAULT_CAPABILITIES` (all
# true), so the buttons render enabled and fail on click, and the backend's
# fallback for a rerun it was given no command for is the wdio binary.
RUN_CAPABILITIES_NONE = {
    "canRunSuites": False,
    "canRunTests": False,
    "canRunAll": False,
}

# ── Synthetic suite for a plain script ───────────────────────────────────────
# A script with no test framework still needs one entry in the tree, so the file
# becomes the suite and the whole run becomes a single implicit test under it.
# The test is named for what it is rather than for the file, which read as
# `login.py` nested inside `login.py`. Shared by the title and the uid so the
# two cannot drift.
DEFAULT_TEST_TITLE = "session"

# ── Collector delivery ───────────────────────────────────────────────────────
# A collector fetch that fails for a TRANSIENT reason is retried, because the
# collector is the only source of DOM replay for a published install and a
# blip during the first request would otherwise disable it for the whole run.
# Bounded on both axes: a cooldown so the per-command re-injection cannot turn
# retries into a request per command, and a cap so a backend that is simply
# never going to answer costs a known amount rather than the whole run.
# A refusal the server actually answered (a 404 — the route does not exist) is
# not transient and is never retried.
COLLECTOR_RETRY_LIMIT = 3
COLLECTOR_RETRY_COOLDOWN_S = 2.0

# ── Logging ──────────────────────────────────────────────────────────────────
# The adapter's logger name. Every operational message logs under this or a
# child of it, which is the only route to the dashboard Console: `LogCapturer`
# forwards logging records, `terminal.py` tees stdout by design, and a raw
# stderr print reaches neither. Modules use `LOGGER_NAME + ".<module>"` so the
# source shows up in the Console without a hand-written prefix.
LOGGER_NAME = "selenium_devtools"

# ── Connection defaults ──────────────────────────────────────────────────────
DEFAULT_HOST = "localhost"
DEFAULT_PORT = 3000
WORKER_PATH = "/worker"
CONNECT_TIMEOUT_S = 5.0

# ── Environment variables that configure the adapter ─────────────────────────
ENV_HOST = "DEVTOOLS_HOST"
ENV_PORT = "DEVTOOLS_PORT"
ENV_BACKEND_CMD = "DEVTOOLS_BACKEND_CMD"
ENV_OPT_IN = "DEVTOOLS_ENABLE"
ENV_BIDI = "DEVTOOLS_BIDI"  # "0"/"false"/"no"/"off" disables BiDi auto-enable
ENV_OPEN = "DEVTOOLS_OPEN"  # "0"/"false"/"no"/"off" disables dashboard auto-open

# ── Backend launch ───────────────────────────────────────────────────────────
# Pinned backend version fetched via npx from a published install. There is no
# cross-ecosystem resolver, so this constant *is* the version link — bump it in
# the same change that regenerates _contract.py. 1.10.0 is the first version
# carrying the `devtools-backend` bin; `npx` cannot start anything older.
BACKEND_NPM_VERSION = "1.10.0"
BACKEND_NPM_PACKAGE = "@wdio/devtools-backend"
BACKEND_SPAWN_TIMEOUT_S = 40.0

# The backend is a Node app, so Python users need a Node runtime. 18 is the
# floor its dependencies require; below it the process starts and then dies on
# syntax it cannot parse, which surfaces here only as "exited before reporting
# a port". Checked up front so the message names the real problem.
MIN_NODE_MAJOR = 18
NODE_VERSION_TIMEOUT_S = 5.0

# ── Trace mode ───────────────────────────────────────────────────────────────
# How long to wait for the backend to answer a trace export. The archive is
# assembled from a whole run's frames, so it is not instant; but a run that
# captured everything and then hung waiting for a file is worse than one that
# reports the wait timed out.
TRACE_EXPORT_TIMEOUT_S = 60.0

#: Opt in to writing a trace archive at the end of the run.
ENV_TRACE = "DEVTOOLS_TRACE"

#: Opt OUT of the dense filmstrip in trace mode (on by default, as in the JS
#: adapters). Falsy values disable it.
ENV_FILMSTRIP = "DEVTOOLS_FILMSTRIP"

#: Opt OUT of per-action element capture in trace mode (on by default).
ENV_A11Y = "DEVTOOLS_A11Y"

#: Which runs are worth an archive. Unset keeps every one.
ENV_TRACE_POLICY = "DEVTOOLS_TRACE_POLICY"

#: One archive per run, or one per test. Unset means per run.
ENV_TRACE_GRANULARITY = "DEVTOOLS_TRACE_GRANULARITY"

# `spec` is deliberately absent: this adapter's spec IS its test file, so it
# would have to behave as one of the other two, and a granularity that silently
# means something else is worse than one that is not offered.
TRACE_GRANULARITIES = frozenset({"session", "test"})

# Mirrors shared's `TraceRetentionPolicy`. Validated adapter-side so a typo is
# reported where it was made: `shouldRetainTrace` treats an unknown policy as
# "keep everything", which is the right runtime behaviour and the wrong thing
# to learn about from a missing file.
TRACE_RETENTION_POLICIES = frozenset(
    {
        "on",
        "retain-on-failure",
        "retain-on-first-failure",
        "on-first-retry",
        "on-all-retries",
        "retain-on-failure-and-retries",
    }
)

#: Filmstrip frames per websocket message. The buffer can hold
#: SCREENCAST_MAX_BUFFER_FRAMES JPEGs, which in one message would approach the
#: socket's payload limit; the transport also masks payloads in a per-byte
#: Python loop (~57 MB/s measured), so smaller messages keep the stall short.
SCREENCAST_FRAME_BATCH = 50

#: Action snapshots per message. Smaller than the frame batch: each carries a
#: screenshot AND an element tree, so a batch is heavier per item.
ACTION_SNAPSHOT_BATCH = 20

#: How long to wait for the backend to hand over page-side source. Short: it is
#: a loopback request to a process we launched, and a hang here stalls the run.
ELEMENT_SCRIPTS_FETCH_TIMEOUT_S = 5.0

# ── Instrumentation ──────────────────────────────────────────────────────────
# Selenium commands that are bookkeeping/noise rather than user-meaningful.
# `screenshot`/`elementScreenshot` are skipped so the screencast recorder's
# per-command frame capture (get_screenshot_as_base64) doesn't flood the
# Actions timeline.
SKIP_COMMANDS = frozenset(
    {"newSession", "quit", "status", "getLog", "getAllSessions", "getSessions",
     "screenshot", "elementScreenshot"}
)

# Commands that land on a new document, and are therefore worth asking the page
# for its navigation timings afterwards. `get` carries the url; the history ones
# do not, so their row reports the document's own url instead.
NAVIGATION_COMMANDS = frozenset({"get", "refresh", "goBack", "goForward"})

# Commands carrying a `{using, value}` locator — the only point at which the
# selector behind an element handle is visible. The child forms also carry the
# parent handle's id, which scopes the selector they produce.
FIND_CHILD_COMMANDS = frozenset({"findChildElement", "findChildElements"})
FIND_COMMANDS = frozenset({"findElement", "findElements"}) | FIND_CHILD_COMMANDS

# Element handles whose locator is remembered, before the oldest is evicted. A
# handle costs two short strings, and a page interacted with more than a few
# hundred elements deep has long since stopped resembling a readable trace.
ELEMENT_LOCATOR_CACHE_SIZE = 200

# Stack-frame path fragment to skip when resolving a command's call source —
# the adapter's own package. The selenium library dir is added at runtime by
# instrumentation (resolved from selenium.__file__), NOT matched by the
# substring "/selenium/" — that would wrongly skip a user's own test file living
# under a path like examples/selenium/... .
_PACKAGE_DIR = os.path.dirname(__file__)
SKIP_STACK_FRAMES = (_PACKAGE_DIR,)

# ── BiDi ──────────────────────────────────────────────────────────────────────
# The capability the driver must advertise for selenium's BiDi channel to open
# (set via ``options.web_socket_url = True`` at build time). Without it,
# accessing ``driver.script`` / ``driver.network`` raises — attach() degrades.
BIDI_CAPABILITY = "webSocketUrl"
# BiDi network event names we subscribe to WITHOUT interception — a plain
# session.subscribe, so requests are observed but never paused (interception
# would stall the user's page loads if a callback failed to continue them).
BIDI_NET_BEFORE_REQUEST = "network.beforeRequestSent"
BIDI_NET_RESPONSE_COMPLETED = "network.responseCompleted"
# The adapter targets the regenerated BiDi layer, which selenium 4.44 shipped —
# it is what ``Network.add_event_handler`` and ``EVENT_CONFIGS`` arrived in, and
# the pre-4.44 internals network capture used instead were removed in the same
# release. Declared in pyproject too; here so a wrong install is explained rather
# than raising an AttributeError, and so the surface guards know what they apply
# to. Also the reason ``requires-python`` is >=3.10: selenium 4.44 requires it.
SELENIUM_MINIMUM_VERSION = (4, 44)
# The interpreter that selenium version needs, which is why ``requires-python``
# is >=3.10. Held here so a runtime message can tell the two failures apart: an
# old selenium on a new python is an upgrade away, an old selenium on python 3.9
# is not — every release at or above the floor refuses to install there, so
# advising the upgrade would send the reader in a circle.
PYTHON_MINIMUM_VERSION = (3, 10)
# selenium's BiDi log entries already carry lowercase levels; this normalizes
# the stragglers to the shared LogLevel union. Unmapped levels fall back to log.
BIDI_LEVEL_MAP = {
    "debug": "debug",
    "info": "info",
    "warn": "warn",
    "warning": "warn",
    "error": "error",
    "severe": "error",
    "log": "log",
    "trace": "trace",
}

# ── Screencast ────────────────────────────────────────────────────────────────
# Frames are captured synchronously (one per command) on the main thread — see
# screencast.py for why a background poll thread is avoided. Screenshots via
# WebDriver are always PNG.
SCREENCAST_IMAGE_FORMAT = "png"
# Frames below which encoding is skipped. 1, mirroring core's
# `finalizeScreencast` default: one frame is still the page the run ended on,
# and is worth more than no artifact. It used to be 2, which was survivable only
# because `start()` padded every session with a seed frame — and that seed was a
# shot of about:blank taken before the first command, so a short run's "video"
# was black plus one real frame.
SCREENCAST_MIN_FRAMES = 1
# Buffered frames before the recorder halves what it holds. Per-command capture
# needs no cap — it takes one frame per command, so the test's own length bounds
# it — but CDP push mode streams from the browser and would grow without one.
# Mirrors core's `maxBufferFrames` default, decimating rather than truncating so
# both ends of the run survive.
SCREENCAST_MAX_BUFFER_FRAMES = 2000
# Output filename stem; the session id + .webm suffix are appended.
SCREENCAST_FILENAME_PREFIX = "selenium-py-video"
# The `screencast` wire scope is generated into _contract.py (SCOPE_SCREENCAST).
