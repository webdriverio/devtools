"""wdio-selenium-devtools — Python Selenium adapter for the DevTools dashboard.

Public API:

    import wdio_selenium_devtools as devtools
    devtools.enable()          # connect + instrument; reads DEVTOOLS_HOST/PORT
    ...  run selenium ...
    devtools.disable()

Under pytest, the bundled plugin calls these for you (gated on the
``WDIO_DEVTOOLS`` / ``DEVTOOLS_PORT`` env vars). The transport has no
third-party dependency; the only requirement on top is selenium itself.
"""

from __future__ import annotations

import os
import sys
from typing import Optional

from . import backend, instrumentation
from ._contract import CONTRACT_VERSION
from .capturer import SessionCapturer
from .constants import DEFAULT_HOST, DEFAULT_PORT, ENV_HOST, ENV_PORT
from .transport import WSClient

__version__ = "0.1.0"
__all__ = ["enable", "disable", "get_capturer", "CONTRACT_VERSION"]

_active: dict = {"capturer": None, "transport": None, "process": None}


def enable(
    host: Optional[str] = None,
    port: Optional[int] = None,
    *,
    webdriver_cls: Optional[type] = None,
) -> Optional[SessionCapturer]:
    """Connect to the backend and instrument Selenium. Idempotent.

    With no host/port and no ``DEVTOOLS_PORT``, the backend is launched
    automatically (see :mod:`.backend`). Returns the SessionCapturer, or None if
    the dashboard can't be reached/launched — a missing dashboard must never
    break the user's test run.
    """
    if _active["capturer"] is not None:
        return _active["capturer"]

    process = None
    try:
        if host is not None or port is not None:
            host = host or os.environ.get(ENV_HOST, DEFAULT_HOST)
            port = int(port or os.environ.get(ENV_PORT, DEFAULT_PORT))
        else:
            host, port, process = backend.launch_or_attach()
    except (OSError, RuntimeError, TimeoutError) as exc:
        print(f"[wdio-devtools] could not start dashboard ({exc}); "
              f"continuing without capture", file=sys.stderr)
        return None

    transport = WSClient(host, port)
    try:
        transport.connect()
    except OSError as exc:
        print(
            f"[wdio-devtools] dashboard not reachable at {host}:{port} "
            f"({exc}); continuing without capture",
            file=sys.stderr,
        )
        if process is not None:
            process.terminate()
        return None

    capturer = SessionCapturer(transport)
    instrumentation.install(capturer, webdriver_cls)
    _active.update(capturer=capturer, transport=transport, process=process)
    return capturer


def disable() -> None:
    instrumentation.uninstall()
    transport = _active["transport"]
    if transport is not None:
        transport.close()
    process = _active["process"]
    if process is not None:  # only set when we launched it ourselves
        process.terminate()
    _active.update(capturer=None, transport=None, process=None)


def get_capturer() -> Optional[SessionCapturer]:
    return _active["capturer"]
