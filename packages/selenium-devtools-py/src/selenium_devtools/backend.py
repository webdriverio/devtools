"""Locate or launch the dashboard backend.

Python can't declare a dependency on the Node ``@wdio/devtools-backend`` the way
the JS adapters do (no cross-ecosystem resolution). So the backend is obtained
at runtime, and the resolution order encodes the local-vs-published split:

    0. reuse handshake set      → attach to the backend that spawned us (RERUN)
    1. DEVTOOLS_PORT set        → attach to an already-running backend (CI, manual)
    2. DEVTOOLS_BACKEND_CMD set → spawn that explicit command
    3. monorepo dist present    → node packages/backend/dist/server.js     (LOCAL dev)
    4. installed copy present   → node <cache>/…/dist/server.js            (INSTALLED)
    5. else                     → npx @wdio/devtools-backend@<pinned>       (PUBLISHED)

Steps 3, 4 and 5 spawn Node, so they are gated on
:func:`node_runtime.require_node` — steps 0 and 1 attach to a backend someone
else is running and need none.

Step 4 is what ``selenium-devtools install-backend`` puts there, and it is ahead
of npx because npx re-resolves against a registry on every single run: seconds
of every test run, and a mid-test failure when a proxy declines the package.

The pinned version below is bumped deliberately alongside a contract change —
there is no auto-resolution, so this constant *is* the version link.
"""

from __future__ import annotations

import logging
import os
import queue
import re
import shlex
import shutil
import subprocess
import threading
import time
from collections import deque
from pathlib import Path
from typing import Deque, List, Optional, Tuple

from . import backend_install
from ._contract import ENV_REUSE, ENV_REUSE_HOST, ENV_REUSE_PORT
from .node_runtime import require_node
from .constants import (
    BACKEND_FETCH_TIMEOUT_S,
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

# Enough of the child's output to carry an npm error, which is the failure a
# published install actually hits; more would bury the message in npm notices.
SPAWN_TAIL_LINES = 8


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


def _reader_thread(proc: subprocess.Popen) -> Tuple["queue.Queue", threading.Event]:
    """Stream the child's stdout into a queue, ending with ``None`` at EOF.

    One thread serves both jobs the spawn needs: handing lines to the caller
    while it waits for a port, and — once the returned event is set — reading on
    in silence so the backend's pipe never fills and blocks it. Queueing a live
    server's whole log instead would grow without bound.
    """
    lines: "queue.Queue" = queue.Queue()
    hush = threading.Event()

    def pump() -> None:
        assert proc.stdout is not None
        for line in proc.stdout:
            if not hush.is_set():
                lines.put(line)
        lines.put(None)

    threading.Thread(target=pump, daemon=True).start()
    return lines, hush


def _spawn_and_wait_for_port(
    cmd: List[str], timeout: float = BACKEND_SPAWN_TIMEOUT_S
) -> Tuple[subprocess.Popen, int]:
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1
    )
    assert proc.stdout is not None
    # The child's own words are the diagnosis — an npm registry refusing the
    # package, a port already bound — and without them the caller only learns
    # that something exited, which names neither the cause nor the fix.
    tail: Deque[str] = deque(maxlen=SPAWN_TAIL_LINES)
    # Read on a thread rather than calling readline() here: readline BLOCKS
    # until a line or EOF, so a backend that wedges silently — the one case this
    # budget exists for — never lets the loop reach its own deadline check.
    lines, hush = _reader_thread(proc)
    deadline = time.time() + timeout
    while True:
        remaining = deadline - time.time()
        if remaining <= 0:
            break
        try:
            line = lines.get(timeout=remaining)
        except queue.Empty:
            break
        if line is None:  # EOF: the pipe closed, so the child is done talking
            if proc.poll() is None:
                proc.terminate()
            raise RuntimeError(
                f"backend exited (code {proc.returncode}) before reporting a "
                f"port{_describe_tail(cmd, tail)}"
            )
        tail.append(line.rstrip())
        match = _PORT_RE.search(line)
        if match:
            hush.set()
            return proc, int(match.group(1))
    proc.terminate()
    raise TimeoutError(
        f"backend did not report a port within {timeout:.0f}s"
        f"{_describe_tail(cmd, tail)}"
    )


def _describe_tail(cmd: List[str], tail: "Deque[str]") -> str:
    """The command that was run plus its last output, for an error message."""
    said = "\n  ".join(line for line in tail if line.strip())
    spoken = f"\n  {said}" if said else " (it printed nothing)"
    return f"\n  command: {' '.join(cmd)}\n  last output:{spoken}"


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

    installed = backend_install.installed_server()
    if installed is not None:
        proc, port = _spawn_and_wait_for_port([node, str(installed)])
        return host, port, proc

    npx = shutil.which("npx")
    if npx is None:
        raise RuntimeError(
            f'Found Node at "{node}" but no npx alongside it, which is how the '
            f"dashboard backend ({BACKEND_NPM_PACKAGE}) is fetched. npx ships "
            "with npm — reinstall Node from https://nodejs.org, run "
            "`selenium-devtools install-backend` once, or set DEVTOOLS_PORT to "
            "an already-running dashboard."
        )
    # Said out loud because the first one downloads a dependency tree and there
    # is nothing else on the terminal to explain the pause.
    _log.info(
        "starting %s@%s with %s — the first run downloads it, which can take a "
        "minute; `selenium-devtools install-backend` does that once, ahead of time",
        BACKEND_NPM_PACKAGE, BACKEND_NPM_VERSION, npx,
    )
    proc, port = _spawn_and_wait_for_port(
        [npx, "-y", f"{BACKEND_NPM_PACKAGE}@{BACKEND_NPM_VERSION}"],
        timeout=BACKEND_FETCH_TIMEOUT_S,
    )
    return host, port, proc
