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
from typing import Any, Optional

from . import bidi, frames
from .capturer import SessionCapturer
from .constants import BIDI_CAPABILITY, ENV_BIDI, SKIP_COMMANDS, SKIP_STACK_FRAMES
from .screencast import ScreencastRecorder
from .snapshot import SnapshotCapturer, start_snapshot_capture
from .sources import read_source
from .utils import call_source, now_ms

# Operational logging — surfaced in the dashboard Console (the 'runner' stream).
_log = logging.getLogger("wdio_selenium_devtools")

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
    title = os.path.basename(entry) or "Selenium session"
    ds = _state.get("default_suite")
    start = ds["start"] if ds else now_ms()
    _state["default_suite"] = {"start": start}
    end = start if state == "running" else now_ms()
    test = frames.test_stats(
        uid=f"{entry or title}::session", title=title, full_title=title,
        parent=title, state=state, file=entry, start_ms=start, end_ms=end,
    )
    suite = frames.suite_stats(
        uid=entry or title, title=title, file=entry, start_ms=start,
        tests=[test], state=state, end_ms=(None if state == "running" else end),
    )
    capturer.send_suites([suite])


def _guarded_execute_script(driver: Any) -> Any:
    """An ``execute_script`` that runs WITHOUT command capture — for the
    adapter's own snapshot injection/readback, which must never show up in the
    Actions timeline (the getTraceData/inject scripts are not user commands)."""

    def run(script: str, *args: Any) -> Any:
        _internal.active = True
        try:
            return driver.execute_script(script, *args)
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
        _state["output_dir"] = os.path.dirname(path)
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
    "screencast": None, "snapshot": None, "setup_done": False,
    "output_dir": None,  # dir of the test file — where the screencast .webm lands
    "default_suite": None,  # synthesized suite for non-framework (script) runs
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


def _add_screencast_frame(shot: Optional[str]) -> None:
    """Buffer an already-captured screenshot as a screencast frame."""
    recorder = _state.get("screencast")
    if recorder is None or not shot:
        return
    try:
        recorder.add_frame(shot)
    except Exception as exc:  # noqa: BLE001 — never break the test
        _log.warning("screencast add_frame threw: %s", exc)


def _refresh_snapshot(capturer: SessionCapturer) -> None:
    """After a command, keep the snapshot current: re-inject the collector if the
    page navigated (self-healing — a click can submit a form and wipe it), then
    drain the mutation buffer. Called after every command, not just explicit
    navigations, so the initial full-document snapshot is captured even if it
    wasn't ready the instant the navigation returned."""
    snapshot = _state.get("snapshot")
    if snapshot is None:
        return
    try:
        snapshot.inject()  # no-op if already present; re-installs after navigation
    except Exception as exc:  # noqa: BLE001 — never break the test
        _log.warning("snapshot re-inject threw: %s", exc)
    _flush_mutations(capturer)


def _flush_mutations(capturer: SessionCapturer) -> None:
    """Drain the page-side mutation buffer and forward it — no-op if the
    collector was never injected. Defensive: never breaks the user's test."""
    snapshot: SnapshotCapturer | None = _state.get("snapshot")
    if snapshot is None:
        return
    try:
        mutations = snapshot.pull_mutations()
    except Exception as exc:  # noqa: BLE001 — capture must never break the test
        _log.warning("mutation flush threw: %s", exc)
        return
    if mutations:
        capturer.send_mutations(mutations)


def _enable_bidi_capability(params: Any) -> None:
    """Request BiDi at session creation by injecting ``webSocketUrl`` into the
    newSession capabilities — the one point (before the session exists) where we
    can. This makes console/network capture work out-of-box, matching the JS
    adapters. Opt out with ``WDIO_DEVTOOLS_BIDI=0``. Never blocks a session."""
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


def _ensure_session_setup(driver: Any, capturer: SessionCapturer) -> None:
    """Once per session — on the first real command — send metadata, attach
    BiDi, and start the screencast.

    This CANNOT run in the newSession branch: selenium assigns ``session_id`` /
    ``caps`` only *after* the newSession execute() returns, so at that point the
    driver has no session yet (BiDi caps missing, screenshots fail). By the first
    real command the driver is fully initialized. Each step is independently
    defensive — a BiDi or screencast failure is a logged no-op.
    """
    if _state.get("setup_done"):
        return
    session_id = getattr(driver, "session_id", None)
    if not session_id:
        return  # driver not ready yet; retry on the next command
    _state["setup_done"] = True
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
        _state["screencast"] = recorder
        _log.info("screencast recording started")
    except Exception as exc:  # noqa: BLE001
        _log.warning("screencast start threw: %s", exc)
    try:
        # Inject the packages/script DOM observer so the snapshot iframe fills.
        # Use a capture-bypassing execute_script so injection/readback scripts
        # don't pollute the Actions timeline.
        snapshot = start_snapshot_capture(
            driver, execute_fn=_guarded_execute_script(driver)
        )
        _state["snapshot"] = snapshot
        if snapshot is not None:
            _log.info("DOM snapshot collector injected")
    except Exception as exc:  # noqa: BLE001
        _log.warning("snapshot start threw: %s", exc)


def _on_quit(capturer: SessionCapturer) -> None:
    """On driver.quit(): finalize the screencast and forward its metadata.

    ``quit`` is in the skip set, so this is the last hook before the session is
    gone — encode here while a session id is still known."""
    # Drain any final mutations while the session (and page) still exist.
    _flush_mutations(capturer)
    _state["snapshot"] = None
    if _state.get("default_suite") is not None:
        _send_default_suite(capturer, "passed")  # mark the script run complete
    recorder = _state.get("screencast")
    if recorder is None:
        return
    _state["screencast"] = None
    try:
        info = recorder.finalize(
            capturer.session_id or "session", output_dir=_state.get("output_dir")
        )
    except Exception as exc:  # noqa: BLE001
        _log.warning("screencast finalize threw: %s", exc)
        return
    if info is not None:
        capturer.send_screencast(**info)
        _log.info("screencast saved: %s", info.get("video_path"))


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
                _on_quit(capturer)
            elif driver_command == "newSession":
                _enable_bidi_capability(params)  # request BiDi before the session opens
            return orig_execute(self, driver_command, params)

        # First real command: the driver is now fully initialized — set up
        # metadata/BiDi/screencast once, before executing so BiDi sees this cmd.
        _ensure_session_setup(self, capturer)
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
        _refresh_snapshot(capturer)
        _add_screencast_frame(shot)
        return result

    webdriver_cls.execute = patched_execute  # type: ignore[assignment]
    _sources_sent.clear()
    _state.update(
        installed=True, cls=webdriver_cls, orig=orig_execute,
        setup_done=False, output_dir=None, default_suite=None,
    )


def uninstall() -> None:
    recorder = _state.get("screencast")
    if recorder is not None:
        recorder.stop()  # never leave a poll thread running past teardown
    if not _state["installed"]:
        _state.update(
            screencast=None, snapshot=None, setup_done=False,
            output_dir=None, default_suite=None,
        )
        return
    _state["cls"].execute = _state["orig"]  # type: ignore[union-attr]
    _state.update(
        installed=False, cls=None, orig=None, screencast=None, snapshot=None,
        setup_done=False, output_dir=None, default_suite=None,
    )
