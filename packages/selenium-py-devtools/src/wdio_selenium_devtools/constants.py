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

# ── Backend launch ───────────────────────────────────────────────────────────
# Pinned backend version fetched via npx from a published install. There is no
# cross-ecosystem resolver, so this constant *is* the version link — bump it in
# the same change that regenerates _contract.py.
BACKEND_NPM_VERSION = "1.7.0"
BACKEND_NPM_PACKAGE = "@wdio/devtools-backend"
BACKEND_SPAWN_TIMEOUT_S = 40.0

# ── Instrumentation ──────────────────────────────────────────────────────────
# Selenium commands that are bookkeeping/noise rather than user-meaningful.
SKIP_COMMANDS = frozenset(
    {"newSession", "quit", "status", "getLog", "getAllSessions", "getSessions"}
)

# Stack-frame path fragments to skip when resolving a command's call source —
# the adapter's own package and selenium internals.
_PACKAGE_DIR = os.path.dirname(__file__)
SKIP_STACK_FRAMES = (_PACKAGE_DIR, f"{os.sep}selenium{os.sep}")
