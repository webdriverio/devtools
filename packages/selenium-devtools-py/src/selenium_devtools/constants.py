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

# ── Instrumentation ──────────────────────────────────────────────────────────
# Selenium commands that are bookkeeping/noise rather than user-meaningful.
# `screenshot`/`elementScreenshot` are skipped so the screencast recorder's
# per-command frame capture (get_screenshot_as_base64) doesn't flood the
# Actions timeline.
SKIP_COMMANDS = frozenset(
    {"newSession", "quit", "status", "getLog", "getAllSessions", "getSessions",
     "screenshot", "elementScreenshot"}
)

# Commands after which the page-side mutation buffer is NOT drained. Resolving a
# locator reads the DOM and cannot change it, so the drain it used to trigger was
# a round trip that could only ever return an empty buffer — measured at 4 of the
# 9 commands in a login flow. Deliberately a DENY-list: an unrecognized command
# still drains, so a command that does move the page is never silently skipped.
#
# Mirrors selenium-devtools' `warrantsLiveDrain`, which excludes the same class.
# Its other two exclusions don't apply here: this adapter has no separate
# navigation drain (so navigations must keep draining), and an assert row is
# recorded straight through `capture_command` and never reaches this path.
NO_DRAIN_COMMANDS = frozenset(
    {"findElement", "findElements", "findChildElement", "findChildElements",
     "findElementFromShadowRoot", "findElementsFromShadowRoot"}
)

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
# Seconds between polls while a BiDi command waits for its reply.
# `WebSocketConnection._wait_until` is a `sleep(interval)` loop, so selenium's
# 0.1 default costs up to 100 ms per BiDi command however fast the browser
# answers — the interval bounds the wait, it does not shorten the timeout, which
# is consumed in interval-sized steps either way. 10 ms trades at most 100
# wakeups/second, only while a command is actually in flight.
BIDI_RESPONSE_POLL_INTERVAL_S = 0.01
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
# Output filename stem; the session id + .webm suffix are appended.
SCREENCAST_FILENAME_PREFIX = "selenium-py-video"
# The `screencast` wire scope is generated into _contract.py (SCOPE_SCREENCAST).
