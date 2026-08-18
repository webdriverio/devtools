"""Driver instrumentation — the one genuinely per-language piece.

Every Selenium command (driver- *and* element-level, since element methods
delegate to ``self._parent.execute``) funnels through
``WebDriver.execute(driver_command, params)``. Wrapping that single chokepoint
captures the whole command stream from one place — cleaner than the JS
adapter's prototype patching.

The patch target is injected so the module imports and unit-tests without
selenium present; ``install`` defaults to the real selenium class.
"""

from __future__ import annotations

import logging
import os
import sys
import threading
import weakref
from typing import Any, Optional

from . import bidi, bidi_preload, frames
from .capturer import SessionCapturer
from .collector_source import reset_cache as reset_collector_cache
from .constants import (
    BIDI_CAPABILITY,
    DEFAULT_TEST_TITLE,
    ENV_BIDI,
    LOGGER_NAME,
    SKIP_COMMANDS,
    SKIP_STACK_FRAMES,
)
from .output_dir import resolve_adapter_output_dir
from .screencast import ScreencastRecorder
from .snapshot import (
    SnapshotCapturer,
    collector_source_text,
    start_snapshot_capture,
)
from .sources import read_source
from .utils import call_source, now_ms

# Operational logging — surfaced in the dashboard Console (the 'runner' stream).
_log = logging.getLogger(f"{LOGGER_NAME}.instrumentation")

# Marks the adapter's OWN execute_script calls (snapshot inject/readback) so
# patched_execute skips capturing them as user commands.
_internal = threading.local()

# User-file paths whose source we've already sent (once per file per run).
_sources_sent: set = set()


_skip_frames_cache: Optional[tuple] = None


def _skip_frames() -> tuple:
    """Call-source skip fragments: the adapter package + the REAL selenium
    library dir (resolved from selenium.__file__), cached. Resolving the actual
    package dir avoids skipping a user test file whose path merely contains
    'selenium' (e.g. examples/selenium/...)."""
    global _skip_frames_cache
    if _skip_frames_cache is None:
        try:
            import selenium

            extra = (os.path.dirname(os.path.abspath(selenium.__file__)) + os.sep,)
        except Exception:  # noqa: BLE001 — narrow fallback if selenium isn't importable
            extra = (f"{os.sep}selenium{os.sep}webdriver{os.sep}",)
        _skip_frames_cache = tuple(SKIP_STACK_FRAMES) + extra
    return _skip_frames_cache


def _internal_active() -> bool:
    return getattr(_internal, "active", False)


# When a test framework (the pytest plugin) reports the suite tree, the adapter
# must NOT also synthesize a default one. The plugin flips this in its configure.
_external_suites = False


def set_external_suites(value: bool = True) -> None:
    """Tell the adapter a test framework owns the suite tree (suppresses the
    default single-session suite used for plain scripts)."""
    global _external_suites
    _external_suites = value


def _send_default_suite(capturer: SessionCapturer, state: str) -> None:
    """Report the run as a single suite/test named after the entry script, so a
    plain-script run (no test framework) still shows in the TESTS tree. No-op if
    a framework is reporting suites."""
    if _external_suites:
        return
    entry = os.path.abspath(sys.argv[0]) if sys.argv and sys.argv[0] else ""
    suite_title = os.path.basename(entry) or "Selenium session"
    ds = _state.get("default_suite")
    start = ds["start"] if ds else now_ms()
    _state["default_suite"] = {"start": start}
    end = start if state == "running" else now_ms()
    # Named the way the pytest plugin names a real test: the file is the suite,
    # the test carries its own name, and fullTitle joins the two.
    test = frames.test_stats(
        uid=f"{entry or suite_title}::{DEFAULT_TEST_TITLE}",
        title=DEFAULT_TEST_TITLE,
        full_title=f"{suite_title} › {DEFAULT_TEST_TITLE}",
        parent=suite_title, state=state, file=entry, start_ms=start, end_ms=end,
    )
    suite = frames.suite_stats(
        uid=entry or suite_title, title=suite_title, file=entry, start_ms=start,
        tests=[test], state=state, end_ms=(None if state == "running" else end),
    )
    capturer.send_suites([suite])


def _guarded_execute_script(driver: Any) -> Any:
    """An ``execute_script`` that runs WITHOUT command capture — for the
    adapter's own snapshot injection/readback, which must never show up in the
    Actions timeline (the getTraceData/inject scripts are not user commands)."""

    try:
        ref: Any = weakref.ref(driver)
    except TypeError:  # not weak-referenceable; the closure holds it directly
        ref = lambda: driver  # noqa: E731

    def run(script: str, *args: Any) -> Any:
        live = ref()
        if live is None:  # driver gone; nothing left to read the page with
            return None
        _internal.active = True
        try:
            return live.execute_script(script, *args)
        finally:
            _internal.active = False

    return run


def _capture_source(capturer: SessionCapturer, call_src: Optional[str]) -> None:
    """Send the source of the file a command's ``callSource`` points at (once).

    Keyed by the exact ``callSource`` path so the Source tab always matches —
    and works for any runner (plain script or pytest), not just the plugin.
    Guarded: source capture must never break the user's test."""
    if not call_src:
        return
    path = call_src.rsplit(":", 1)[0]  # strip the trailing ":line"
    if not path:
        return
    # Screencast output lands next to the (first) test file, not the cwd.
    if _state.get("output_dir") is None:
        _state["output_dir"] = resolve_adapter_output_dir(test_file_path=path)
    if path in _sources_sent:
        return
    try:
        text = read_source(path)
    except Exception:  # noqa: BLE001
        return
    if text is None:
        return
    _sources_sent.add(path)
    capturer.send_sources({path: text})

# Selenium command names that change the document — after these we drain the
# page-side mutation buffer so the snapshot iframe stays current.
_state: dict = {
    "installed": False, "cls": None, "orig": None,
    # Capture state keyed by the DRIVER that owns it, weakly:
    #   {driver: {"session_id": sid, "screencast": rec, "snapshot": cap}}
    # The driver is the owner; the session id is a label on that state which can
    # be stale or absent, so keying on the id forced a guess about which session
    # a quit belonged to. Weak keys also let an abandoned driver be collected
    # instead of holding its recorder open for the rest of the run.
    "sessions": weakref.WeakKeyDictionary(),
    "output_dir": None,  # test-results dir beside the test file (see output_dir.py)
    "default_suite": None,  # synthesized suite for non-framework (script) runs
    # Set by enable()'s excepthook when an exception reaches top level. The
    # synthetic suite's final state reads this rather than assuming success.
    "run_failed": False,
}


def _take_screenshot(driver: Any) -> Optional[str]:
    """One base64 PNG of the current page on the MAIN thread — no background
    thread, so we never touch the Selenium session concurrently. Reused for both
    the command entry (per-command snapshot view) and the screencast frame.
    Best-effort: a transient failure (mid-navigation, dead session) returns
    None and never breaks the test. ``screenshot`` is in SKIP_COMMANDS, so this
    doesn't appear in the Actions timeline."""
    fn = getattr(driver, "get_screenshot_as_base64", None)
    if not callable(fn):
        return None
    try:
        shot = fn()
    except Exception:  # noqa: BLE001 — transient; skip this frame
        return None
    return shot if isinstance(shot, str) and shot else None


def _backend_origin(capturer: SessionCapturer) -> Optional[tuple]:
    """``(host, port)`` of the connected backend, which serves the collector.
    None when the transport does not expose one, so injection falls back to the
    monorepo path rather than failing."""
    tx = getattr(capturer, "_tx", None)
    host = getattr(tx, "host", None)
    port = getattr(tx, "port", None)
    return (host, port) if host and port else None


def _add_screencast_frame(entry: dict, shot: Optional[str]) -> None:
    """Buffer an already-captured screenshot as a frame of ITS OWN session."""
    recorder = entry.get("screencast")
    if recorder is None or not shot:
        return
    try:
        recorder.add_frame(shot)
    except Exception as exc:  # noqa: BLE001 — never break the test
        _log.warning("screencast add_frame threw: %s", exc)


def _refresh_snapshot(capturer: SessionCapturer, entry: dict) -> None:
    """After a command, keep the snapshot current: re-inject the collector if the
    page navigated (self-healing — a click can submit a form and wipe it), then
    drain the mutation buffer. Called after every command, not just explicit
    navigations, so the initial full-document snapshot is captured even if it
    wasn't ready the instant the navigation returned."""
    snapshot = entry.get("snapshot")
    if snapshot is None:
        return
    try:
        snapshot.inject()  # no-op if already present; re-installs after navigation
    except Exception as exc:  # noqa: BLE001 — never break the test
        _log.warning("snapshot re-inject threw: %s", exc)
    _flush_mutations(capturer, entry)


def _flush_mutations(capturer: SessionCapturer, entry: dict) -> None:
    """Drain the page-side mutation buffer and forward it — no-op if the
    collector was never injected. Defensive: never breaks the user's test."""
    snapshot: SnapshotCapturer | None = entry.get("snapshot")
    if snapshot is None:
        return
    try:
        mutations = snapshot.pull_mutations()
    except Exception as exc:  # noqa: BLE001 — capture must never break the test
        _log.warning("mutation flush threw: %s", exc)
        return
    if mutations:
        capturer.send_mutations(mutations)
        # Debug, not info: this fires after every command. It is the only signal
        # that DOM replay is actually receiving anything — the panel being empty
        # otherwise looks the same whether the collector never loaded or the
        # page simply did not change.
        _log.debug("captured %d DOM mutation(s)", len(mutations))


def _enable_bidi_capability(params: Any) -> None:
    """Request BiDi at session creation by injecting ``webSocketUrl`` into the
    newSession capabilities — the one point (before the session exists) where we
    can. This makes console/network capture work out-of-box, matching the JS
    adapters. Opt out with ``DEVTOOLS_BIDI=0``. Never blocks a session."""
    if os.environ.get(ENV_BIDI, "").strip().lower() in ("0", "false", "no", "off"):
        return
    try:
        caps = params.get("capabilities") if isinstance(params, dict) else None
        if not isinstance(caps, dict):
            return
        always = caps.get("alwaysMatch")
        if not isinstance(always, dict):
            always = {}
            caps["alwaysMatch"] = always
        always.setdefault(BIDI_CAPABILITY, True)
    except Exception:  # noqa: BLE001 — capability injection is best-effort
        pass


def _close_entry(capturer: SessionCapturer, entry: dict) -> None:
    """Drain and encode one driver's capture, attributed to the session it was
    recorded under."""
    _flush_mutations(capturer, entry)
    entry["snapshot"] = None
    _finalize_screencast(capturer, entry["session_id"], entry)


def _finalize_screencast(
    capturer: SessionCapturer, session_id: str, entry: dict
) -> None:
    """Encode and forward one session's recording, attributed to that session
    rather than to whichever session happens to be current."""
    recorder = entry.pop("screencast", None)
    if recorder is None:
        return
    try:
        info = recorder.finalize(session_id, output_dir=_state.get("output_dir"))
    except Exception as exc:  # noqa: BLE001
        _log.warning("screencast finalize threw: %s", exc)
        return
    if info is not None:
        capturer.send_screencast(**info, session_id=session_id)
        _log.info("screencast saved: %s", info.get("video_path"))


def _ensure_session_setup(driver: Any, capturer: SessionCapturer) -> Optional[dict]:
    """Bring capture up for this driver, once, and return its state.

    Keyed by the driver, so two live drivers are independent and interleaved
    commands re-arm nothing: re-attaching BiDi would duplicate console and
    network events, and restarting the recorder and collector would truncate
    both. A driver whose session id changes has genuinely started a new session,
    so its own previous one is closed out first.

    This CANNOT run in the newSession branch: selenium assigns ``session_id`` /
    ``caps`` only *after* the newSession execute() returns, so at that point the
    driver has no session yet (BiDi caps missing, screenshots fail). By the first
    real command the driver is fully initialized. Each step is independently
    defensive — a BiDi or screencast failure is a logged no-op.
    """
    session_id = getattr(driver, "session_id", None)
    if not session_id:
        return None  # driver not ready yet; retry on the next command
    sessions = _state["sessions"]
    try:
        entry = sessions.get(driver)
    except TypeError:  # unhashable driver: capture is skipped, never fatal
        _log.warning("driver is not hashable; capture disabled for it")
        return None
    if entry is not None:
        if entry["session_id"] == session_id:
            return entry
        _close_entry(capturer, entry)  # same driver, new session
    entry = {
        "session_id": session_id, "screencast": None, "snapshot": None,
        "preloaded": False,
    }
    try:
        sessions[driver] = entry
    except TypeError:  # not weak-referenceable
        _log.warning("driver cannot be tracked; capture disabled for it")
        return None
    capturer.ensure_metadata(session_id, getattr(driver, "caps", None), None)
    _log.info("session %s started", session_id)
    _send_default_suite(capturer, "running")  # tree entry for plain-script runs
    try:
        if bidi.attach(driver, capturer):
            _log.info("BiDi attached — capturing console + network")
    except Exception as exc:  # noqa: BLE001 — capture must never break the test
        _log.warning("BiDi attach threw: %s", exc)
    try:
        recorder = ScreencastRecorder()
        recorder.start(driver)
        entry["screencast"] = recorder
        _log.info("screencast recording started")
    except Exception as exc:  # noqa: BLE001
        _log.warning("screencast start threw: %s", exc)
    try:
        # Register the collector at document-start FIRST, while this runs before
        # the session's first command executes — a preload registered after a
        # navigation has already missed the document it needed to instrument.
        # Falls back to per-document `<script>` injection when BiDi is absent.
        origin = _backend_origin(capturer)
        source = collector_source_text(backend=origin)
        preloaded = bool(
            source and bidi_preload.register_collector_preload(driver, source)
        )
        entry["preloaded"] = preloaded
        # Inject the packages/script DOM observer so the snapshot iframe fills.
        # Use a capture-bypassing execute_script so injection/readback scripts
        # don't pollute the Actions timeline. With the preload registered the
        # capturer injects nothing and exists only to DRAIN the buffer.
        entry["snapshot"] = start_snapshot_capture(
            driver,
            execute_fn=_guarded_execute_script(driver),
            backend=origin,
            preloaded=preloaded,
        )
        snapshot_cap = entry["snapshot"]
        if preloaded:
            pass  # already reported by register_collector_preload
        elif snapshot_cap is not None and snapshot_cap.injected:
            _log.info("DOM snapshot collector injected")
        elif snapshot_cap is not None:
            # Kept rather than dropped, so a later command retries. Saying so
            # matters: the panel stays empty until one succeeds.
            _log.info("DOM snapshot collector not installed yet — will retry")
    except Exception as exc:  # noqa: BLE001
        _log.warning("snapshot start threw: %s", exc)
    return entry


def _on_quit(capturer: SessionCapturer, driver: Any) -> None:
    """On driver.quit(): close out THIS driver's capture.

    ``quit`` is in the skip set, so this is the last hook before the session is
    gone: drain and encode here, while it still exists. Other drivers are
    untouched, and the synthetic script suite completes only when the last driver
    goes, so a script driving two browsers is not marked done at the first quit.
    """
    sessions = _state["sessions"]
    try:
        entry = sessions.pop(driver, None)
    except TypeError:
        entry = None
    if entry is None:
        return  # this driver never armed capture; nothing of its own to close
    _close_entry(capturer, entry)
    if not len(sessions) and _state.get("default_suite") is not None:
        _send_default_suite(capturer, _live_run_state())  # the script run is done


def _live_run_state() -> str:
    """The run's outcome AT QUIT TIME, which is the last moment the dashboard
    can be updated before `wait_for_dashboard_close` blocks on it.

    A script quits its driver from a `finally`, and while an exception unwinds
    through that block `sys.exc_info()` still reports it — so this catches the
    case that matters, a test that raised, long before the exception reaches
    top level.

    Observing one makes the failure STICKY. Teardown can easily run before the
    excepthook fires: the user's own `finally` calls `disable()` while the
    exception is still unwinding, and closing the dashboard window runs the
    whole teardown on the WS reader thread, where this thread's `exc_info` is
    empty anyway. Any of those would otherwise finalize a failed run as passed.
    """
    record_live_failure()
    return "failed" if _state.get("run_failed") else "passed"


def record_live_failure() -> None:
    """Record an exception unwinding on THIS thread, if there is one.

    `sys.exc_info()` is thread-local, so it must be read on the thread that is
    actually unwinding. Teardown is not always that thread: closing the
    dashboard window runs the whole shutdown on the WS reader thread, where this
    reads empty however the script is doing. Callers on the main thread invoke
    this before handing control away, so the observation survives.
    """
    if sys.exc_info()[0] is not None:
        mark_run_failed()


def mark_run_failed() -> None:
    """Record that an exception reached top level (see `enable`'s excepthook)."""
    _state["run_failed"] = True


def finalize_run(capturer: SessionCapturer) -> None:
    """Send the run's final outcome at teardown.

    Only ever ESCALATES: a failure recorded at quit time survives, because
    teardown is not guaranteed to know better. It runs before the excepthook
    whenever the user calls `disable()` from their own `finally`, and on the WS
    reader thread when the dashboard window is closed — in both cases a failed
    run would otherwise be finalized as passed, which hides a real failure. The
    cost is that quitting from inside an unrelated `except` handler reports a
    run that went on to pass as failed; a false red prompts a look, a false
    green does not.

    No-op when no synthetic suite exists (a framework owns the tree, or no
    driver ever started).
    """
    if _state.get("default_suite") is None:
        return
    if threading.current_thread() is not threading.main_thread():
        # Off-thread teardown means the run was INTERRUPTED, by construction:
        # `lifecycle._trigger_shutdown` hands teardown to whoever is parked in
        # wait_for_shutdown and only runs it itself when nobody is, then hard
        # exits. So getting here on the WS reader thread says the script was
        # still mid-flight when the dashboard closed. Its outcome is unknowable
        # from here — `sys.exc_info` is thread-local — and it has no outcome
        # yet in any case, so the tree keeps showing `running`, which is true.
        return
    # Reads the live exception too, not just the recorded flag: a script that
    # calls disable() from its `finally` WITHOUT quitting the driver first never
    # reaches _on_quit, so nothing else would ever observe the failure — the
    # excepthook fires only after teardown has already torn the transport down.
    _send_default_suite(capturer, _live_run_state())


def install(capturer: SessionCapturer, webdriver_cls: Optional[type] = None) -> None:
    if _state["installed"]:
        return
    if webdriver_cls is None:
        from selenium.webdriver.remote.webdriver import WebDriver  # lazy

        webdriver_cls = WebDriver

    orig_execute = webdriver_cls.execute

    def patched_execute(self, driver_command: str, params: Any = None):  # noqa: ANN001
        # The adapter's own execute_script (snapshot inject/readback) runs
        # transparently — never captured as a user command.
        if _internal_active():
            return orig_execute(self, driver_command, params)
        # Skip capture for noise, but never alter behavior.
        if driver_command in SKIP_COMMANDS:
            # Finalize the screencast BEFORE quit tears the session down — after
            # orig_execute the driver's WebSocket/session is gone.
            if driver_command == "quit":
                _on_quit(capturer, self)
            elif driver_command == "newSession":
                _enable_bidi_capability(params)  # request BiDi before the session opens
            return orig_execute(self, driver_command, params)

        # First real command: the driver is now fully initialized — set up
        # metadata/BiDi/screencast once, before executing so BiDi sees this cmd.
        entry = _ensure_session_setup(self, capturer)
        start = now_ms()
        src = call_source(_skip_frames())
        _capture_source(capturer, src)  # Source tab: send the test file once
        try:
            result = orig_execute(self, driver_command, params)
        except BaseException as exc:  # capture then re-raise unchanged
            capturer.capture_command(
                command=driver_command,
                args=params,
                error=exc,
                start_time=start,
                call_source=src,
            )
            raise

        # WebDriver.execute returns the full response dict; the useful payload
        # is response["value"].
        value = result.get("value") if isinstance(result, dict) else result
        # One screenshot per command on this (main) thread — attached to the
        # command (so selecting it shows the page) AND reused as a screencast
        # frame, so we pay for only a single screenshot round-trip either way.
        shot = _take_screenshot(self)
        capturer.capture_command(
            command=driver_command,
            args=params,
            result=value,
            start_time=start,
            call_source=src,
            screenshot=shot,
        )
        _log.debug("command: %s", driver_command)
        # Keep the snapshot iframe current after every command (a click can
        # navigate too, not just get/back/…), re-injecting if the page changed.
        if entry is not None:
            _refresh_snapshot(capturer, entry)
            _add_screencast_frame(entry, shot)
        return result

    webdriver_cls.execute = patched_execute  # type: ignore[assignment]
    _sources_sent.clear()
    _state.update(
        installed=True, cls=webdriver_cls, orig=orig_execute,
        sessions=weakref.WeakKeyDictionary(), output_dir=None, default_suite=None,
    )


def uninstall() -> None:
    # The collector is cached per backend for the run's lifetime; a re-enable
    # may point at a different one, so the cache goes with the rest of the
    # per-run state.
    reset_collector_cache()
    # Never leave a recorder running past teardown, for any session still live.
    for entry in list(_state.get("sessions", {}).values()):
        recorder = entry.get("screencast")
        if recorder is not None:
            recorder.stop()
    if not _state["installed"]:
        _state.update(
            sessions=weakref.WeakKeyDictionary(),
            output_dir=None, default_suite=None, run_failed=False,
        )
        return
    _state["cls"].execute = _state["orig"]  # type: ignore[union-attr]
    _state.update(
        installed=False, cls=None, orig=None,
        sessions=weakref.WeakKeyDictionary(), output_dir=None, default_suite=None,
        run_failed=False,
    )
