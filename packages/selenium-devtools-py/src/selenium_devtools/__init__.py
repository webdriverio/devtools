"""selenium-devtools-py — Python Selenium adapter for the DevTools dashboard.

Public API:

    import selenium_devtools as devtools
    devtools.enable()          # connect + instrument; reads DEVTOOLS_HOST/PORT
    ...  run selenium ...
    devtools.disable()

Under pytest, the bundled plugin calls these for you (gated on the
``DEVTOOLS_ENABLE`` / ``DEVTOOLS_PORT`` env vars). The transport has no
third-party dependency; the only requirement on top is selenium itself.
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
from typing import Optional

from . import backend, instrumentation, lifecycle, rerun, trace_export
from ._contract import CONTRACT_VERSION
from .capturer import SessionCapturer
from .output_dir import resolve_adapter_output_dir
from .run_id import reset_run_id, resolve_run_id
from .constants import (
    DEFAULT_HOST,
    DEFAULT_PORT,
    ENV_HOST,
    ENV_PORT,
    ENV_TRACE,
    LOGGER_NAME,
)
from .logcapture import LogCapturer
from .terminal import TerminalCapturer
from .transport import WSClient

__version__ = "0.1.0"
__all__ = [
    "enable", "disable", "get_capturer", "dashboard_url",
    "wait_for_dashboard_close", "CONTRACT_VERSION",
]

_log = logging.getLogger(f"{LOGGER_NAME}.enable")

def _install_excepthook() -> None:
    """Record an exception that reaches top level, so teardown can report the
    run as failed. Chained, never replacing: a user's own hook (pytest, an error
    reporter) still runs, and the original is restored on disable()."""
    if _active.get("excepthook") is not None:
        return
    previous = sys.excepthook

    def hook(exc_type, exc, tb):  # noqa: ANN001
        # SystemExit(0) is a clean exit, not a failure — `sys.exit()` at the end
        # of a passing script must not paint the run red.
        if not (exc_type is SystemExit and getattr(exc, "code", 0) in (0, None)):
            instrumentation.mark_run_failed()
        previous(exc_type, exc, tb)

    _active["excepthook"] = previous
    sys.excepthook = hook


def _restore_excepthook() -> None:
    previous = _active.get("excepthook")
    if previous is not None:
        sys.excepthook = previous
        _active["excepthook"] = None


_active: dict = {
    "capturer": None, "transport": None, "process": None, "url": None,
    "handle": None, "terminal": None, "logs": None, "excepthook": None,
    "trace": False, "traced": False,
}


def _trace_enabled(trace: Optional[bool]) -> bool:
    """Whether this run writes a trace archive. The argument wins over the
    environment so a script can opt out of an exported default."""
    if trace is not None:
        return trace
    return os.environ.get(ENV_TRACE, "").lower() in ("1", "true", "yes")


def export_trace() -> Optional[str]:
    """Write this run's trace archive now. No-op unless trace mode is on.

    Called when the RUN finishes rather than when the process tears down. An
    interactive run blocks on the dashboard window in between, and CI has no
    window at all; an artifact that depends on either is an artifact that is
    missing exactly when it is wanted.

    Only a SUCCESSFUL export closes the door on the teardown fallback. This is
    public, so a caller may run it early, get nothing, and still expect an
    archive at the end — latching on the attempt would spend that one chance on
    a transport that was not ready. The cost is that an unresponsive backend is
    waited on twice, once here and once at teardown; losing the artifact
    outright is the worse of the two, and by then the run is already broken.
    """
    if not _active["trace"] or _active["traced"]:
        return None
    path = _export_trace(
        _active["capturer"], instrumentation.resolved_output_dir()
    )
    if path is not None:
        _active["traced"] = True
    return path


def _export_trace(
    capturer: Optional[SessionCapturer], output_dir: Optional[str]
) -> Optional[str]:
    """Ask the backend for this run's archive. Never raises — a run that
    captured everything and failed to write a file still passed."""
    try:
        session_id = (
            getattr(capturer, "session_id", None) or resolve_run_id()
        )
        return trace_export.export(
            _active["transport"],
            output_dir=output_dir or resolve_adapter_output_dir(),
            session_id=session_id,
        )
    except Exception as exc:  # noqa: BLE001
        _log.warning("trace export skipped (%s)", exc)
    return None


def enable(
    host: Optional[str] = None,
    port: Optional[int] = None,
    *,
    webdriver_cls: Optional[type] = None,
    trace: Optional[bool] = None,
) -> Optional[SessionCapturer]:
    """Connect to the backend and instrument Selenium. Idempotent.

    With no host/port and no ``DEVTOOLS_PORT``, the backend is launched
    automatically (see :mod:`.backend`). Returns the SessionCapturer, or None if
    the dashboard can't be reached/launched — a missing dashboard must never
    break the user's test run.
    """
    if _active["capturer"] is not None:
        return _active["capturer"]

    # Decided before anything reads it: the screencast recorder, the dashboard
    # window and the teardown export all branch on this.
    trace_mode = _trace_enabled(trace)

    # Before the backend is launched: the directory a rerun spawns in travels
    # through the environment the backend process inherits. A framework plugin
    # has already published richer commands by now and this leaves those alone.
    rerun.configure_script()
    rerun.log_published()

    process = None
    try:
        if host is not None or port is not None:
            host = host or os.environ.get(ENV_HOST, DEFAULT_HOST)
            port = int(port or os.environ.get(ENV_PORT, DEFAULT_PORT))
        else:
            host, port, process = backend.launch_or_attach()
    except (OSError, RuntimeError, TimeoutError) as exc:
        # No dashboard exists to receive this, so it can only reach the user's
        # own logging config — or `logging.lastResort`, which still puts a
        # WARNING on stderr when nothing is configured.
        _log.warning("could not start dashboard (%s); continuing without capture", exc)
        return None

    transport = WSClient(host, port, on_control=lifecycle.on_control)
    try:
        transport.connect()
    except OSError as exc:
        _log.warning(
            "dashboard not reachable at %s:%s (%s); continuing without capture",
            host, port, exc,
        )
        if process is not None:
            process.terminate()
        return None

    capturer = SessionCapturer(transport)
    instrumentation.install(capturer, webdriver_cls, trace=trace_mode)
    # Plain scripts only: a framework plugin calls
    # `set_external_suites`, which turns this back off.
    instrumentation.start_assertion_tracing(capturer)
    _install_excepthook()
    # Surface the runner's output in the dashboard Console: Python logging
    # (selenium + the adapter's own events) and the test's stdout.
    logs = LogCapturer(capturer)
    logs.start()
    term = TerminalCapturer(capturer)
    term.start()
    url = f"http://{host}:{port}"
    _active.update(
        capturer=capturer, transport=transport, process=process, url=url,
        terminal=term, logs=logs, trace=trace_mode, traced=False,
    )

    # Open the dashboard window and wire exit/signal + control-frame teardown so
    # closing the window (clientDisconnected) or ending the process both tidy up.
    handle = (
        lifecycle.open_dashboard(url)
        if lifecycle.auto_open_enabled(trace=trace_mode)
        else None
    )
    _active["handle"] = handle
    lifecycle.register_exit_handlers(disable, handle)
    return capturer


def disable() -> None:
    # Close the dashboard window + unregister exit/signal handlers first, so a
    # re-enable() starts clean. Idempotent and defensive — never raises.
    lifecycle.unregister_exit_handlers()
    _restore_excepthook()
    capturer = _active["capturer"]
    if capturer is not None:
        # NOT guaranteed to run after the excepthook: a script calling disable()
        # from its own `finally` gets here while the exception is still
        # unwinding, and this tears the transport down, so nothing the hook
        # learns afterwards could still be sent. `finalize_run` therefore reads
        # the live exception itself. Must precede transport.close() either way.
        instrumentation.finalize_run(capturer)
    # Read before uninstall clears it: the trace belongs beside this run's
    # video, and the fallback is the cwd — the repo root, for a runner invoked
    # from one.
    output_dir = instrumentation.resolved_output_dir()
    instrumentation.uninstall()
    term = _active["terminal"]
    if term is not None:  # restore stdout/stderr before tearing the transport down
        term.stop()
    logs = _active["logs"]
    if logs is not None:  # detach the logging handler + restore logger levels
        logs.stop()
    # Fallback for a plain script that never called export_trace() itself.
    # Before the transport closes: the answer comes back on this same socket.
    if _active["trace"] and not _active["traced"]:
        # No latch needed: the reset below clears the run either way, and
        # nothing else runs after this.
        _export_trace(capturer, output_dir)
    transport = _active["transport"]
    if transport is not None:
        transport.close()
    # A new enable() in this process is a NEW run, so the id must not outlive
    # this one — the backend would otherwise keep the previous run's data.
    reset_run_id()
    # Same reasoning: a re-enable() re-derives its commands rather than
    # inheriting the ones this run published.
    rerun.reset()
    process = _active["process"]
    if process is not None:  # only set when we launched it ourselves
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()  # backend ignored SIGTERM — force it
    trace_export.reset()
    _active.update(
        capturer=None, transport=None, process=None, url=None, handle=None,
        terminal=None, logs=None, excepthook=None, trace=False, traced=False,
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
        # Last chance to see this run's exception on the thread that HAS it.
        # A script reaches here from its `finally` with the failure still
        # unwinding, then blocks; closing the window then runs the whole
        # teardown on the WS reader thread, where `sys.exc_info()` is empty and
        # the run would be finalized as passed.
        instrumentation.record_live_failure()
        # Deliberately NOT the logger: this tells the user why their terminal is
        # blocking, so it has to be on the terminal even when the dashboard is
        # taking the log stream, and `logging.lastResort` ignores INFO.
        print(f"[devtools] dashboard live at {dashboard_url()} — "
              "close the window to finish.", file=sys.stderr)
        lifecycle.wait_for_shutdown()
