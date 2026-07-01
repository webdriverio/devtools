"""Locate or launch the dashboard backend.

Python can't declare a dependency on the Node ``@wdio/devtools-backend`` the way
the JS adapters do (no cross-ecosystem resolution). So the backend is obtained
at runtime, and the resolution order encodes the local-vs-published split:

    1. DEVTOOLS_PORT set        → attach to an already-running backend (CI, manual)
    2. DEVTOOLS_BACKEND_CMD set → spawn that explicit command
    3. monorepo dist present    → node packages/backend/dist/index.js      (LOCAL dev)
    4. else                     → npx @wdio/devtools-backend@<pinned>       (PUBLISHED)

The pinned version below is bumped deliberately alongside a contract change —
there is no auto-resolution, so this constant *is* the version link.
"""

from __future__ import annotations

import os
import re
import shlex
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import List, Optional, Tuple

from .constants import (
    BACKEND_NPM_PACKAGE,
    BACKEND_NPM_VERSION,
    BACKEND_SPAWN_TIMEOUT_S,
    DEFAULT_HOST,
    ENV_BACKEND_CMD,
    ENV_HOST,
    ENV_PORT,
)

_PORT_RE = re.compile(r"on port (\d+)")


def _find_monorepo_backend(start: Optional[Path] = None) -> Optional[Path]:
    """Walk up from ``start`` (default: this module) for a built backend. Present
    only in a monorepo checkout; None from an installed wheel."""
    base = start or Path(__file__).resolve()
    for parent in base.parents:
        candidate = parent / "packages" / "backend" / "dist" / "index.js"
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


def launch_or_attach() -> Tuple[str, int, Optional[subprocess.Popen]]:
    """Return ``(host, port, process)``. ``process`` is None when we attached to
    a backend we don't own (caller must not terminate it)."""
    host = os.environ.get(ENV_HOST, DEFAULT_HOST)

    if os.environ.get(ENV_PORT):
        return host, int(os.environ[ENV_PORT]), None

    explicit = os.environ.get(ENV_BACKEND_CMD)
    if explicit:
        proc, port = _spawn_and_wait_for_port(shlex.split(explicit))
        return host, port, proc

    local = _find_monorepo_backend()
    if local is not None:
        proc, port = _spawn_and_wait_for_port(["node", str(local)])
        return host, port, proc

    npx = shutil.which("npx")
    if npx is None:
        raise RuntimeError(
            "Node.js not found — install Node 18+ (the dashboard backend is a Node "
            "app), or set DEVTOOLS_PORT to an already-running dashboard."
        )
    proc, port = _spawn_and_wait_for_port(
        [npx, "-y", f"{BACKEND_NPM_PACKAGE}@{BACKEND_NPM_VERSION}"]
    )
    return host, port, proc
