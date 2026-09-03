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
import threading
from typing import Optional

from . import (
    backend,
    element_scripts,
    instrumentation,
    lifecycle,
    rerun,
    trace_export,
)
from ._contract import CONTRACT_VERSION
from .capturer import SessionCapturer
from .output_dir import resolve_adapter_output_dir
from .run_id import reset_run_id, resolve_run_id
from .constants import (
    TRACE_RETENTION_POLICIES,
    TRACE_GRANULARITIES,
    DEFAULT_HOST,
    DEFAULT_PORT,
    ENV_HOST,
    ENV_A11Y,
    ENV_FILMSTRIP,
    ENV_PORT,
    ENV_TRACE,
    ENV_TRACE_POLICY,
    ENV_TRACE_GRANULARITY,
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
    "trace": False, "traced": False, "filmstrip_mark": None,
    "trace_policy": None, "trace_granularity": None,
}


def _filmstrip_enabled(filmstrip: Optional[bool]) -> bool:
    """Whether trace mode records a dense filmstrip. Default ON, as in the JS
    adapters (`BaseDevToolsOptions.filmstrip`), opt-out only — the argument
    wins, then the environment."""
    if filmstrip is not None:
        return filmstrip
    value = os.environ.get(ENV_FILMSTRIP)
    if value is None:
        return True
    return value.lower() not in ("0", "false", "no", "off", "")


def _resolve_trace_settings(
    trace: Optional[bool],
    filmstrip: Optional[bool],
    a11y: Optional[bool],
    trace_policy: Optional[str],
    trace_granularity: Optional[str],
) -> tuple:
    """Every trace decision in one place: ``(mode, filmstrip, a11y, policy,
    granularity)``.

    Extracted from `enable()` so the wiring is testable on its own. The rules it
    encodes — that an explicit policy or granularity implies the mode, that an
    exported one does not, and that nothing is dropped silently — were each
    reachable only through a live `enable()` before, so a mutation to any of
    them left every test green.
    """
    mode = _trace_enabled(trace, implied_by=(trace_policy, trace_granularity))
    if not mode:
        _warn_if_ignored()
        return False, False, False, None, None
    return (
        True,
        _filmstrip_enabled(filmstrip),
        _a11y_enabled(a11y),
        _trace_policy(trace_policy),
        _trace_granularity(trace_granularity),
    )


def _warn_if_ignored() -> None:
    """Say so when a trace setting was exported but this run is not tracing.

    An ARGUMENT naming a policy turns trace mode on; an exported variable does
    not, because it is ambient — it may have been set for a different script in
    the same shell, and flipping a live run to trace mode on that basis would
    take away the dashboard nobody asked to lose. But it must not be silent:
    the symptom is otherwise an archive that never appears.
    """
    for name in (ENV_TRACE_POLICY, ENV_TRACE_GRANULARITY):
        if os.environ.get(name):
            _log.warning(
                "%s is set but this run is not in trace mode, so it does "
                "nothing. Add %s=1, or pass trace=True to enable().",
                name,
                ENV_TRACE,
            )


def _trace_granularity(granularity: Optional[str]) -> Optional[str]:
    """One archive per run (`session`, the default) or one per test (`test`).

    Validated here for the same reason the policy is: the backend falls back to
    session granularity for anything it does not recognise, which is the right
    runtime behaviour and an invisible way to lose per-test archives.
    """
    value = granularity if granularity is not None else os.environ.get(
        ENV_TRACE_GRANULARITY
    )
    if not value:
        return None
    if value not in TRACE_GRANULARITIES:
        _log.warning(
            "unknown trace granularity %r; writing one archive for the run. "
            "Expected one of: %s",
            value,
            ", ".join(sorted(TRACE_GRANULARITIES)),
        )
        return None
    return value


def _trace_policy(policy: Optional[str]) -> Optional[str]:
    """Which runs are worth an archive. Default: keep every one.

    Validated here rather than at the backend, so a typo says so on the machine
    that made it instead of silently keeping everything — `shouldRetainTrace`
    treats an unknown policy as `on`, which is the right runtime behaviour and
    the wrong thing to discover from a missing artifact.
    """
    value = policy if policy is not None else os.environ.get(ENV_TRACE_POLICY)
    if not value:
        return None
    if value not in TRACE_RETENTION_POLICIES:
        _log.warning(
            "unknown trace policy %r; keeping every run's archive. Expected one of: %s",
            value,
            ", ".join(sorted(TRACE_RETENTION_POLICIES)),
        )
        return None
    return value


def _a11y_enabled(a11y: Optional[bool]) -> bool:
    """Whether trace mode captures the per-action element tree. Default ON —
    the A11y tab is empty without it — opt out with DEVTOOLS_A11Y=0. Two extra
    round trips per command is the cost, which live mode never pays."""
    if a11y is not None:
        return a11y
    value = os.environ.get(ENV_A11Y)
    if value is None:
        return True
    return value.lower() not in ("0", "false", "no", "off", "")


def _trace_enabled(
    trace: Optional[bool], *, implied_by: tuple = ()
) -> bool:
    """Whether this run writes a trace archive. The argument wins over the
    environment so a script can opt out of an exported default."""
    if trace is not None:
        return trace
    # An explicit policy or granularity ARGUMENT is a request for trace mode:
    # neither means anything in live mode, so honouring one without it would
    # silently drop what the caller asked for. Same rule as the CLI flags, and
    # deliberately not extended to the environment — see `_warn_if_ignored`.
    if any(implied_by):
        return True
    return os.environ.get(ENV_TRACE, "").lower() in ("1", "true", "yes")


#: Serializes exports. Teardown can run on the WS reader thread while a caller
#: is mid-export on the main one, and `trace_export` holds ONE pending slot: a
#: second request replaces it, so the first caller's reply is dropped and it
#: waits out the full timeout while the backend writes the same archive twice.
#: Holding it across the wait is also what stops a MAIN-THREAD teardown closing
#: the transport out from under an export still listening on it. Off-thread
#: callers must not wait on it at all — see export_trace.
_export_lock = threading.Lock()


def export_trace(output_dir: Optional[str] = None) -> Optional[str]:
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
    # Off the main thread this never waits. Teardown can arrive on the WS
    # reader thread — `_trigger_shutdown` runs it there when nobody is parked
    # in wait_for_shutdown — and that thread is the ONLY one that can deliver
    # the reply an in-flight export is blocked on. Waiting for that export from
    # here deadlocks both until the timeout, and the shutdown's `os._exit`
    # timer may kill the process first. An interrupted run losing its archive
    # is the better failure; by construction it was interrupted.
    on_main = threading.current_thread() is threading.main_thread()
    if not _export_lock.acquire(blocking=on_main):
        _log.debug("a trace export is already in flight; not starting another")
        return None
    try:
        if not _active["trace"] or _active["traced"]:
            return None
        path = _export_trace(
            _active["capturer"],
            output_dir
            if output_dir is not None
            else instrumentation.resolved_output_dir(),
        )
        if path is not None:
            _active["traced"] = True
        return path
    finally:
        _export_lock.release()


def _export_trace(
    capturer: Optional[SessionCapturer], output_dir: Optional[str]
) -> Optional[str]:
    """Ask the backend for this run's archive. Never raises — a run that
    captured everything and failed to write a file still passed."""
    try:
        session_id = (
            getattr(capturer, "session_id", None) or resolve_run_id()
        )
        # Before the request, not with it: the buffer holds up to a couple of
        # thousand JPEGs, and the backend accumulates them like any other
        # stream.
        #
        # Only what has not gone out already. A failed export is retried at
        # teardown, and the backend APPENDS these — it has no key to replace or
        # dedupe on — so resending the buffer would put every frame in the trace
        # twice.
        #
        # Keyed on the newest timestamp sent, NOT on how many were sent. A live
        # recorder decimates its bounded buffer in place
        # (`screencast._decimate` halves it, keeping the ends), so between two
        # attempts the list can SHRINK and every index shift — an offset would
        # then skip frames it never sent. Decimation drops frames but never
        # renumbers the survivors, and timestamps are monotonic per recorder, so
        # the watermark stays meaningful however the buffer is rewritten.
        # None, not 0: "nothing sent yet" is not a timestamp, and a frame
        # stamped 0 would be filtered out by one.
        #
        # The boundary is INCLUSIVE, so a retry may resend the frame the last
        # attempt ended on. Timestamps are milliseconds and two frames can share
        # one, and an exclusive boundary would drop the unsent twin — a gap in
        # the filmstrip. A resend costs nothing much instead: the exporter
        # content-addresses frame bytes, so the duplicate shares one resource.
        # Losing a frame beats duplicating one only if you never look at it.
        mark = _active["filmstrip_mark"]
        pending = [
            f
            for f in instrumentation.screencast_frames()
            if mark is None or f.get("timestamp", 0) >= mark
        ]
        sent = trace_export.send_frames(_active["transport"], pending)
        # Same pass: both are streams the backend has no other way to get, and
        # both have to land before the request that reads them.
        trace_export.send_action_snapshots(
            _active["transport"], instrumentation.action_snapshots()
        )
        if sent:
            _active["filmstrip_mark"] = pending[sent - 1].get("timestamp", mark)
        return trace_export.export(
            _active["transport"],
            output_dir=output_dir or resolve_adapter_output_dir(),
            session_id=session_id,
            trace_policy=_active["trace_policy"],
            trace_granularity=_active["trace_granularity"],
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
    filmstrip: Optional[bool] = None,
    a11y: Optional[bool] = None,
    trace_policy: Optional[str] = None,
    trace_granularity: Optional[str] = None,
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
    trace_mode, filmstrip_mode, a11y_mode, policy, granularity = (
        _resolve_trace_settings(
            trace, filmstrip, a11y, trace_policy, trace_granularity
        )
    )

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
    instrumentation.install(
        capturer,
        webdriver_cls,
        trace=trace_mode,
        filmstrip=filmstrip_mode,
        a11y=a11y_mode,
    )
    if a11y_mode:
        # Fetched here, not per action: the scripts are the same all run, and
        # a backend too old to serve them should cost one request, not one per
        # command. None leaves the capture a no-op.
        instrumentation.set_element_scripts(element_scripts.fetch(host, port))
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
        terminal=term, logs=logs, trace=trace_mode, traced=False, filmstrip_mark=None,
        trace_policy=policy, trace_granularity=granularity,
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
    # Through export_trace, not around it: one lock and one latch, so a public
    # call still in flight is waited for rather than raced.
    export_trace(output_dir)
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
        terminal=None, logs=None, excepthook=None, trace=False, traced=False, filmstrip_mark=None,
        trace_policy=None, trace_granularity=None,
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
