"""Install the pinned backend once, so running a test does not fetch anything.

``npx`` is a fine *fallback* and a poor default: it re-resolves the package
against a registry on every run, it fails mid-test rather than at install time
when a proxy refuses it, and the first run pays the whole download inside the
budget that is meant to catch a wedged server. This module is the deliberate
alternative — ``selenium-devtools install-backend`` puts the backend on disk,
and :mod:`backend` prefers what it finds there.

It is not automatic. A ``pip install`` cannot run it (wheels have no install
hook, and reaching npm from one would be a surprise), so the flow is two
commands and the second one says what it is doing.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from .constants import (
    BACKEND_INSTALL_DIRNAME,
    BACKEND_NPM_PACKAGE,
    BACKEND_NPM_VERSION,
    LOGGER_NAME,
)
from .node_runtime import require_node

_log = logging.getLogger(f"{LOGGER_NAME}.backend_install")

# `npm install` writes a whole node_modules tree, so this is a cache directory
# in the XDG sense — reproducible from the network, safe to delete.
def install_root(version: str = BACKEND_NPM_VERSION) -> Path:
    """Where the pinned backend is installed. Versioned per pin."""
    base = os.environ.get("XDG_CACHE_HOME") or os.path.join(
        os.path.expanduser("~"), ".cache"
    )
    return Path(base) / BACKEND_INSTALL_DIRNAME / f"backend-{version}"


def installed_server(version: str = BACKEND_NPM_VERSION) -> Optional[Path]:
    """The installed backend's entry script, or None if it is not there.

    Resolved through the package's own ``bin`` rather than a guessed path: the
    entry moved once already (``index.js`` was never a server), and a stale
    guess would spawn something that exits 0 without listening.
    """
    pkg = install_root(version) / "node_modules" / BACKEND_NPM_PACKAGE.replace(
        "/", os.sep
    )
    server = pkg / "dist" / "server.js"
    return server if server.is_file() else None


def install(version: str = BACKEND_NPM_VERSION, *, force: bool = False) -> Path:
    """Install the pinned backend into :func:`install_root`, return its server.

    Idempotent: an install that is already there is left alone unless ``force``.
    """
    existing = installed_server(version)
    if existing is not None and not force:
        _log.info("%s@%s is already installed at %s", BACKEND_NPM_PACKAGE, version,
                  install_root(version))
        return existing

    require_node()  # names the real problem before npm does, and checks the floor
    npm = shutil.which("npm")
    if npm is None:
        raise RuntimeError(
            "npm is needed to install the dashboard backend "
            f"({BACKEND_NPM_PACKAGE}@{version}) and is not on PATH. It ships "
            "with Node — install Node from https://nodejs.org."
        )

    root = install_root(version)
    root.mkdir(parents=True, exist_ok=True)
    # `--prefix` keeps the tree out of the user's project; the flags below only
    # remove noise npm prints for a dependency tree nobody is going to audit
    # here. Output is inherited rather than captured: this is an interactive
    # command and a five-minute silence reads as a hang.
    cmd = [
        npm,
        "install",
        "--prefix",
        str(root),
        "--no-audit",
        "--no-fund",
        "--loglevel",
        "error",
        f"{BACKEND_NPM_PACKAGE}@{version}",
    ]
    _log.info("installing %s@%s into %s", BACKEND_NPM_PACKAGE, version, root)
    result = subprocess.run(cmd)
    if result.returncode != 0:
        raise RuntimeError(
            f"npm install failed (exit {result.returncode}) for "
            f"{BACKEND_NPM_PACKAGE}@{version}. The output above is npm's. If it "
            "reports the version does not exist, the npm you are running "
            f'("{npm}") resolves against a registry that does not carry it.'
        )

    server = installed_server(version)
    if server is None:
        raise RuntimeError(
            f"npm install reported success but {BACKEND_NPM_PACKAGE}@{version} "
            f"has no dist/server.js under {root}."
        )
    return server


def uninstall(version: str = BACKEND_NPM_VERSION) -> bool:
    """Remove an installed backend. Returns whether there was one."""
    root = install_root(version)
    if not root.exists():
        return False
    shutil.rmtree(root)
    return True
