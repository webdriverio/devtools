"""Locate or launch the dashboard backend.

Python can't declare a dependency on the Node ``@wdio/devtools-backend`` the way
the JS adapters do (no cross-ecosystem resolution). So the backend is obtained
at runtime, and the resolution order encodes the local-vs-published split:

    0. reuse handshake set      → attach to the backend that spawned us (RERUN)
    1. DEVTOOLS_PORT set        → attach to an already-running backend (CI, manual)
    2. DEVTOOLS_BACKEND_CMD set → spawn that explicit command
    3. monorepo dist present    → node packages/backend/dist/server.js     (LOCAL dev)
    4. else                     → npx @wdio/devtools-backend@<pinned>       (PUBLISHED)

Steps 3 and 4 spawn Node, so they are gated on :func:`node_runtime.require_node`
— steps 0 and 1 attach to a backend someone else is running and need none.

The pinned version below is bumped deliberately alongside a contract change —
there is no auto-resolution, so this constant *is* the version link.
"""

from __future__ import annotations

import logging
import os
import re
import shlex
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import List, Optional, Tuple

from ._contract import ENV_REUSE, ENV_REUSE_HOST, ENV_REUSE_PORT
from .node_runtime import require_node
from .constants import (
    BACKEND_NPM_PACKAGE,
    BACKEND_NPM_VERSION,
    BACKEND_SPAWN_TIMEOUT_S,
    DEFAULT_HOST,
    ENV_BACKEND_CMD,
    ENV_HOST,
    ENV_PORT,
    LOGGER_NAME,
)

_log = logging.getLogger(f"{LOGGER_NAME}.backend")

# Match the ACTUAL bound port from Fastify's "Server listening at http://…:PORT"
# line — NOT the earlier "Starting … on port 3000" line, which is only the
# *preferred* port. When 3000 is busy the backend negotiates a different port,
# so keying off the preferred port connects to the wrong (or a dead) socket.
# Greedy `.*` so the IPv6 form (http://[::1]:PORT) resolves to the final :PORT.
_PORT_RE = re.compile(r"listening at .*:(\d+)")


def _find_monorepo_backend(start: Optional[Path] = None) -> Optional[Path]:
    """Walk up from ``start`` (default: this module) for a built backend. Present
    only in a monorepo checkout; None from an installed wheel.

    Targets ``server.js``, the backend's CLI entry, NOT ``index.js``: that one is
    the library entry the JS adapters import, and running it starts nothing."""
    base = start or Path(__file__).resolve()
    for parent in base.parents:
        candidate = parent / "packages" / "backend" / "dist" / "server.js"
        if candidate.exists():
            return candidate
    return None


def _drain(proc: subprocess.Popen) -> None:
    """Keep reading the backend's stdout so its pipe never fills and blocks it."""

    def pump() -> None:
        assert proc.stdout is not None
        for _ in proc.stdout:
            pass

    threading.Thread(target=pump, daemon=True).start()


def _spawn_and_wait_for_port(
    cmd: List[str], timeout: float = BACKEND_SPAWN_TIMEOUT_S
) -> Tuple[subprocess.Popen, int]:
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1
    )
    assert proc.stdout is not None
    deadline = time.time() + timeout
    while time.time() < deadline:
        line = proc.stdout.readline()
        if not line:
            if proc.poll() is not None:
                raise RuntimeError(
                    f"backend exited (code {proc.returncode}) before reporting a port"
                )
            continue
        match = _PORT_RE.search(line)
        if match:
            _drain(proc)
            return proc, int(match.group(1))
    proc.terminate()
    raise TimeoutError("backend did not report a port within the timeout")


def reuse_target() -> Optional[Tuple[str, int]]:
    """The backend that spawned us, when this process is a rerun child.

    The dashboard's Rerun spawns a fresh process and points it back at itself
    through these three variables. Without honouring them the child launches a
    SECOND backend and opens a SECOND dashboard window, reporting its run
    there — so the window the user pressed Rerun in never updates, which looks
    like a rerun that captured nothing.
    """
    if os.environ.get(ENV_REUSE) != "1":
        return None
    host = os.environ.get(ENV_REUSE_HOST)
    port = os.environ.get(ENV_REUSE_PORT)
    if not host or not port:
        return None
    try:
        return host, int(port)
    except ValueError:
        _log.warning("ignoring reuse handshake: %s is not a port (%r)",
                     ENV_REUSE_PORT, port)
        return None


def launch_or_attach() -> Tuple[str, int, Optional[subprocess.Popen]]:
    """Return ``(host, port, process)``. ``process`` is None when we attached to
    a backend we don't own (caller must not terminate it)."""
    host = os.environ.get(ENV_HOST, DEFAULT_HOST)

    # Ahead of DEVTOOLS_PORT: this is the backend that asked for this run, so it
    # wins over an ambient preference the parent happened to be started with.
    reuse = reuse_target()
    if reuse is not None:
        _log.info("reusing the dashboard that requested this run at %s:%s", *reuse)
        return reuse[0], reuse[1], None

    if os.environ.get(ENV_PORT):
        return host, int(os.environ[ENV_PORT]), None

    explicit = os.environ.get(ENV_BACKEND_CMD)
    if explicit:
        proc, port = _spawn_and_wait_for_port(shlex.split(explicit))
        return host, port, proc

    # Only the spawning paths need a local Node. Attaching to a backend someone
    # else is already running (the two branches above) needs none.
    node = require_node()

    local = _find_monorepo_backend()
    if local is not None:
        proc, port = _spawn_and_wait_for_port([node, str(local)])
        return host, port, proc

    npx = shutil.which("npx")
    if npx is None:
        raise RuntimeError(
            f'Found Node at "{node}" but no npx alongside it, which is how the '
            f"dashboard backend ({BACKEND_NPM_PACKAGE}) is fetched. npx ships "
            "with npm — reinstall Node from https://nodejs.org, or set "
            "DEVTOOLS_PORT to an already-running dashboard."
        )
    proc, port = _spawn_and_wait_for_port(
        [npx, "-y", f"{BACKEND_NPM_PACKAGE}@{BACKEND_NPM_VERSION}"]
    )
    return host, port, proc
