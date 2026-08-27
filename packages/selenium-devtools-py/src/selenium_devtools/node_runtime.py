"""Check for a usable Node runtime before trying to spawn the backend.

The dashboard backend is a Node app and Python cannot declare a dependency on
it, so Node is a genuine prerequisite for a published install — and not only
for the dashboard: the page collector is fetched from the backend over HTTP and
the whole event stream goes through its websocket, so no Node means no capture
at all.

Without this check the three ways it goes wrong all surface as something else:

* no ``node`` on PATH, with the monorepo dist present — a raw
  ``FileNotFoundError: [Errno 2] ... 'node'`` out of ``subprocess.Popen``
* Node present but too old — the backend spawns, dies on syntax it cannot
  parse, and the caller reports ``backend exited (code 1) before reporting a
  port``
* neither, on the npx path — the failure arrives 40 s later as a spawn timeout

None of those names Node. This module answers up front, once, with the version
it found and what is needed.
"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
from typing import Optional, Tuple

from .constants import LOGGER_NAME, MIN_NODE_MAJOR, NODE_VERSION_TIMEOUT_S

_log = logging.getLogger(f"{LOGGER_NAME}.backend")

# Matched against the WHOLE line: `node --version` prints exactly `vX.Y.Z`, and
# searching for a version anywhere in the output accepts a wrapper that merely
# mentions one — `my-wrapper v20.11.1 (shim)` read as Node 20, which passes the
# floor and then fails to run the backend with the cryptic error this module
# exists to replace.
#
# The optional suffix is what a prerelease or nightly reports —
# `v20.0.0-rc.1`, `v22.0.0-nightly2024010112345abcde`. Those are usable Node
# builds, and rejecting them refused capture outright on a runtime that would
# have worked. It stays inside the anchor, so prose still fails to match: a
# wrapper's ` (shim)` carries spaces and parentheses that no suffix can.
_VERSION_RE = re.compile(r"v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?")

#: Appended to every failure, so the message always carries a way forward that
#: does not involve installing anything.
_ESCAPE_HATCH = (
    "Set DEVTOOLS_PORT to attach to an already-running dashboard instead, or "
    "DEVTOOLS_BACKEND_CMD to launch it your own way."
)


def node_version(executable: str) -> Optional[Tuple[int, int, int]]:
    """``(major, minor, patch)`` reported by ``<executable> --version``.

    None when it cannot be run or does not answer in the expected shape — a
    shim on PATH that is not really Node, a broken install, a hang. The caller
    treats that as unusable rather than guessing.
    """
    try:
        result = subprocess.run(
            [executable, "--version"],
            capture_output=True,
            text=True,
            timeout=NODE_VERSION_TIMEOUT_S,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        _log.debug("could not run %s --version: %s", executable, exc)
        return None
    if result.returncode != 0:
        return None
    match = _VERSION_RE.fullmatch((result.stdout or "").strip())
    if match is None:
        return None
    return (int(match.group(1)), int(match.group(2)), int(match.group(3)))


def require_node() -> str:
    """Absolute path to a Node new enough to run the backend.

    Raises :class:`RuntimeError` naming what was found and what is needed. It
    is called only on the paths that actually spawn Node — attaching to a
    backend someone else is running needs no local Node at all.
    """
    executable = shutil.which("node")
    if executable is None:
        raise RuntimeError(
            f"Node.js not found on PATH. The devtools dashboard backend is a "
            f"Node app, so Node {MIN_NODE_MAJOR}+ is required — install it "
            f"from https://nodejs.org. {_ESCAPE_HATCH}"
        )
    version = node_version(executable)
    if version is None:
        raise RuntimeError(
            f'"{executable}" did not report a usable version, so it cannot be '
            f"used to run the devtools dashboard backend (Node "
            f"{MIN_NODE_MAJOR}+ required). {_ESCAPE_HATCH}"
        )
    if version[0] < MIN_NODE_MAJOR:
        found = ".".join(str(part) for part in version)
        raise RuntimeError(
            f"Node {found} at \"{executable}\" is too old to run the devtools "
            f"dashboard backend, which needs Node {MIN_NODE_MAJOR}+. Upgrade "
            f"from https://nodejs.org. {_ESCAPE_HATCH}"
        )
    return executable
