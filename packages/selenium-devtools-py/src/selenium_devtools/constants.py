"""Module-level constants — the single home for connection defaults, env-var
names, the skip sets, and the pinned backend version. No internal imports."""

from __future__ import annotations

import os

# ── Synthetic suite for a plain script ───────────────────────────────────────
# A script with no test framework still needs one entry in the tree, so the file
# becomes the suite and the whole run becomes a single implicit test under it.
# The test is named for what it is rather than for the file, which read as
# `login.py` nested inside `login.py`. Shared by the title and the uid so the
# two cannot drift.
DEFAULT_TEST_TITLE = "session"

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
# Skip encoding below this many frames — a single still isn't a video.
SCREENCAST_MIN_FRAMES = 2
# Output filename stem; the session id + .webm suffix are appended.
SCREENCAST_FILENAME_PREFIX = "selenium-py-video"
# The `screencast` wire scope is generated into _contract.py (SCOPE_SCREENCAST).
