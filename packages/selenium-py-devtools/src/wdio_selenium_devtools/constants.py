"""Module-level constants — the single home for connection defaults, env-var
names, the skip sets, and the pinned backend version. No internal imports."""

from __future__ import annotations

import os

# ── Connection defaults ──────────────────────────────────────────────────────
DEFAULT_HOST = "localhost"
DEFAULT_PORT = 3000
WORKER_PATH = "/worker"
CONNECT_TIMEOUT_S = 5.0

# ── Environment variables that configure the adapter ─────────────────────────
ENV_HOST = "DEVTOOLS_HOST"
ENV_PORT = "DEVTOOLS_PORT"
ENV_BACKEND_CMD = "DEVTOOLS_BACKEND_CMD"
ENV_OPT_IN = "WDIO_DEVTOOLS"
ENV_BIDI = "WDIO_DEVTOOLS_BIDI"  # "0"/"false"/"no"/"off" disables BiDi auto-enable
ENV_OPEN = "WDIO_DEVTOOLS_OPEN"  # "0"/"false"/"no"/"off" disables dashboard auto-open

# ── Backend launch ───────────────────────────────────────────────────────────
# Pinned backend version fetched via npx from a published install. There is no
# cross-ecosystem resolver, so this constant *is* the version link — bump it in
# the same change that regenerates _contract.py.
BACKEND_NPM_VERSION = "1.7.0"
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
