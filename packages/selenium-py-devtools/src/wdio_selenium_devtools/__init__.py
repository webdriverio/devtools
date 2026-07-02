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
import subprocess
import sys
from typing import Optional

from . import backend, instrumentation, lifecycle
from ._contract import CONTRACT_VERSION
from .capturer import SessionCapturer
from .constants import DEFAULT_HOST, DEFAULT_PORT, ENV_HOST, ENV_PORT
from .logcapture import LogCapturer
from .terminal import TerminalCapturer
from .transport import WSClient

__version__ = "0.1.0"
__all__ = [
    "enable", "disable", "get_capturer", "dashboard_url",
    "wait_for_dashboard_close", "CONTRACT_VERSION",
]

_active: dict = {
    "capturer": None, "transport": None, "process": None, "url": None,
    "handle": None, "terminal": None, "logs": None,
}


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

    transport = WSClient(host, port, on_control=lifecycle.on_control)
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
    # Surface the runner's output in the dashboard Console: Python logging
    # (selenium + the adapter's own events) and the test's stdout.
    logs = LogCapturer(capturer)
    logs.start()
    term = TerminalCapturer(capturer)
    term.start()
    url = f"http://{host}:{port}"
    _active.update(
        capturer=capturer, transport=transport, process=process, url=url,
        terminal=term, logs=logs,
    )

    # Open the dashboard window and wire exit/signal + control-frame teardown so
    # closing the window (clientDisconnected) or ending the process both tidy up.
    handle = lifecycle.open_dashboard(url) if lifecycle.auto_open_enabled() else None
    _active["handle"] = handle
    lifecycle.register_exit_handlers(disable, handle)
    return capturer


def disable() -> None:
    # Close the dashboard window + unregister exit/signal handlers first, so a
    # re-enable() starts clean. Idempotent and defensive — never raises.
    lifecycle.unregister_exit_handlers()
    instrumentation.uninstall()
    term = _active["terminal"]
    if term is not None:  # restore stdout/stderr before tearing the transport down
        term.stop()
    logs = _active["logs"]
    if logs is not None:  # detach the logging handler + restore logger levels
        logs.stop()
    transport = _active["transport"]
    if transport is not None:
        transport.close()
    process = _active["process"]
    if process is not None:  # only set when we launched it ourselves
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()  # backend ignored SIGTERM — force it
    _active.update(
        capturer=None, transport=None, process=None, url=None, handle=None,
        terminal=None, logs=None,
    )


def get_capturer() -> Optional[SessionCapturer]:
    return _active["capturer"]


def dashboard_url() -> Optional[str]:
    """URL of the connected dashboard, or None if capture isn't active."""
    return _active["url"]


def wait_for_dashboard_close() -> None:
    """Block until the user closes the dashboard window, so you can inspect the
    run after your test finishes. Returns immediately if no dashboard window is
    open (headless/CI) — safe to always call before ``disable()``."""
    if lifecycle.dashboard_window_open():
        print(f"[wdio-devtools] dashboard live at {dashboard_url()} — "
              "close the window to finish.", file=sys.stderr)
        lifecycle.wait_for_shutdown()
