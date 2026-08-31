import os
import sys
import tempfile
import unittest
from unittest import mock

from selenium_devtools import instrumentation, snapshot
from selenium_devtools.capturer import SessionCapturer


class FakeTransport:
    connected = True

    def __init__(self):
        self.sent = []

    def send_json(self, scope, data):
        self.sent.append((scope, data))
        return True

    def close(self):
        pass


class FakeDriver:
    """Stand-in for selenium's WebDriver — same execute() chokepoint."""

    def __init__(self):
        self.session_id = None
        self.caps = {"browserName": "chrome"}

    def execute(self, command, params=None):
        if command == "newSession":
            self.session_id = "sess-9"
        if command == "boom":
            raise ValueError("kaboom")
        return {"value": f"ok:{command}"}


class ScreenshotDriver(FakeDriver):
    """Driver that can produce screenshots — exercises per-command capture."""

    def get_screenshot_as_base64(self):
        return "c2hvdA=="  # base64 for "shot"


class TestInstrumentation(unittest.TestCase):
    def setUp(self):
        instrumentation.uninstall()
        self.tx = FakeTransport()
        self.cap = SessionCapturer(self.tx)
        instrumentation.install(self.cap, FakeDriver)
        self.driver = FakeDriver()

    def tearDown(self):
        instrumentation.uninstall()

    def _commands(self):
        return [d[0] for s, d in self.tx.sent if s == "commands"]

    def test_captures_command_and_unwraps_value(self):
        out = self.driver.execute("get", {"url": "https://x/"})
        self.assertEqual(out, {"value": "ok:get"})  # behavior unchanged
        cmds = self._commands()
        self.assertEqual(len(cmds), 1)
        self.assertEqual(cmds[0]["command"], "get")
        self.assertEqual(cmds[0]["result"], "ok:get")  # unwrapped from .value
        self.assertEqual(cmds[0]["args"], [{"url": "https://x/"}])

    def test_skip_commands_not_captured(self):
        self.driver.execute("newSession")
        self.assertEqual(self._commands(), [])

    def test_metadata_sent_on_first_real_command_not_new_session(self):
        # session_id/caps only exist AFTER newSession returns, so setup (metadata,
        # BiDi, screencast) is deferred to the first real command — not newSession.
        self.driver.execute("newSession")
        self.assertEqual([d for s, d in self.tx.sent if s == "metadata"], [])
        self.driver.execute("get", {"url": "https://x/"})
        metas = [d for s, d in self.tx.sent if s == "metadata"]
        self.assertEqual(len(metas), 1)
        self.assertEqual(metas[0]["sessionId"], "sess-9")

    def test_error_is_captured_then_reraised(self):
        with self.assertRaises(ValueError):
            self.driver.execute("boom")
        cmds = self._commands()
        self.assertEqual(len(cmds), 1)
        self.assertEqual(cmds[0]["error"]["name"], "ValueError")

    def test_uninstall_restores_original(self):
        instrumentation.uninstall()
        self.tx.sent.clear()
        self.driver.execute("get")
        self.assertEqual(self._commands(), [])  # no capture after uninstall

    def test_snapshot_noop_when_driver_cannot_execute_script(self):
        # FakeDriver has no execute_script, so snapshot capture is skipped and
        # command capture must still work normally.
        self.driver.execute("get", {"url": "https://x/"})
        self.assertEqual(len(self._commands()), 1)

    def test_no_screenshot_when_driver_cannot_screenshot(self):
        # FakeDriver has no get_screenshot_as_base64 — the command frame simply
        # omits the screenshot field rather than sending a null.
        self.driver.execute("get", {"url": "https://x/"})
        self.assertNotIn("screenshot", self._commands()[0])

    def test_screenshot_attached_to_command_on_success(self):
        # With a screenshot-capable driver, each successful command carries the
        # base64 screenshot the UI shows when that command is selected.
        instrumentation.uninstall()
        instrumentation.install(self.cap, ScreenshotDriver)
        driver = ScreenshotDriver()
        driver.execute("get", {"url": "https://x/"})
        self.assertEqual(self._commands()[0]["screenshot"], "c2hvdA==")

    def test_no_screenshot_attached_on_error(self):
        instrumentation.uninstall()
        instrumentation.install(self.cap, ScreenshotDriver)
        driver = ScreenshotDriver()
        driver.execute("get", {"url": "https://x/"})  # sets up the session
        with self.assertRaises(ValueError):
            driver.execute("boom")
        boom = [c for c in self._commands() if c["command"] == "boom"][0]
        self.assertNotIn("screenshot", boom)
        self.assertEqual([d for s, d in self.tx.sent if s == "mutations"], [])


class FindingDriver(FakeDriver):
    """Returns element handles from finds, as selenium's `execute` does once
    `_unwrap_value` has turned the wire dict into a WebElement."""

    class Element:
        def __init__(self, element_id):
            self.id = element_id

    def execute(self, command, params=None):
        if command in ("findElement", "findChildElement"):
            return {"value": self.Element("e.1")}
        return super().execute(command, params)


class TestCommandSelector(unittest.TestCase):
    """A row's `selector` is what the player's element overlay resolves in the
    replayed document; without it a click row carries only an opaque handle."""

    def setUp(self):
        instrumentation.uninstall()
        self.tx = FakeTransport()
        instrumentation.install(SessionCapturer(self.tx), FindingDriver)
        self.driver = FindingDriver()
        self.addCleanup(instrumentation.uninstall)

    def _rows(self):
        return [d[0] for s, d in self.tx.sent if s == "commands"]

    def test_a_command_on_a_found_handle_carries_that_find_s_selector(self):
        self.driver.execute("findElement", {"using": "css selector", "value": '[id="go"]'})
        self.driver.execute("clickElement", {"id": "e.1"})
        click = [r for r in self._rows() if r["command"] == "clickElement"][0]
        self.assertEqual(click["selector"], "#go")

    def test_a_failing_command_carries_it_too(self):
        # The row a failure lands on is the one most worth boxing.
        self.driver.execute("findElement", {"using": "css selector", "value": "#go"})
        with self.assertRaises(ValueError):
            self.driver.execute("boom", {"id": "e.1"})
        boom = [r for r in self._rows() if r["command"] == "boom"][0]
        self.assertEqual(boom["selector"], "#go")

    def test_a_row_with_no_known_locator_omits_the_field(self):
        self.driver.execute("get", {"url": "https://x/"})
        self.assertNotIn("selector", self._rows()[0])


class FakeDriverWithScript(FakeDriver):
    """Driver whose execute_script drives the injected DOM collector."""

    def __init__(self):
        super().__init__()
        self.session_id = "sess-9"  # already-initialized session
        self._script_calls = []
        self._collector_installed = False

    def execute_script(self, script, *args):
        self._script_calls.append(script)
        if "createElement" in script:  # install
            self._collector_installed = True
            return True
        if "getTraceData" in script:  # read (drains buffer)
            return ({"mutations": [{"type": "childList", "target": "1"}]}
                    if self._collector_installed else None)
        if "wdioTraceCollector" in script:  # readiness probe
            return self._collector_installed
        return True


class TestSnapshotWiring(unittest.TestCase):
    """Covers the drain plumbing, not the collector's contents, so it stands in a
    stub for the bundle. `packages/script/dist/script.js` is a gitignored build
    artifact, and these tests would otherwise pass only on a machine that had
    built it and fail on CI, which is what happened."""

    def setUp(self):
        self._stub = tempfile.NamedTemporaryFile("w", suffix=".js", delete=False)
        self._stub.write("window.wdioTraceCollector = { getTraceData: () => null }\n")
        self._stub.close()
        self._script_patch = mock.patch.object(
            snapshot, "resolve_script_path", return_value=self._stub.name
        )
        self._script_patch.start()
        instrumentation.uninstall()
        self.tx = FakeTransport()
        self.cap = SessionCapturer(self.tx)
        instrumentation.install(self.cap, FakeDriverWithScript)
        self.driver = FakeDriverWithScript()

    def tearDown(self):
        instrumentation.uninstall()
        self._script_patch.stop()
        os.unlink(self._stub.name)

    def _mutations(self):
        return [d for s, d in self.tx.sent if s == "mutations"]

    def test_navigation_flushes_mutations(self):
        self.driver.execute("get", {"url": "https://x/"})
        muts = self._mutations()
        self.assertEqual(len(muts), 1)
        self.assertEqual(muts[0], [{"type": "childList", "target": "1"}])
        # The collector was injected exactly once during setup.
        installs = [s for s in self.driver._script_calls if "createElement" in s]
        self.assertEqual(len(installs), 1)

    def test_every_command_refreshes_snapshot(self):
        # Snapshot is drained after every command (a click can navigate too),
        # not only on get/back/…, so the iframe stays current.
        self.driver.execute("click", {"id": "btn"})
        self.assertEqual(len(self._mutations()), 1)


class TestSkipFrames(unittest.TestCase):
    def test_user_file_under_selenium_path_is_not_skipped(self):
        # A user's test file living under .../examples/selenium/... must NOT be
        # mistaken for the selenium library (the old "/selenium/" substring bug).
        frames = instrumentation._skip_frames()
        self.assertNotIn(f"{__import__('os').sep}selenium{__import__('os').sep}", frames)
        user_file = "/repo/examples/selenium/python-test/web_form.py"
        self.assertFalse(any(frag in user_file for frag in frames))


class TestDefaultSuite(unittest.TestCase):
    def setUp(self):
        instrumentation.uninstall()
        instrumentation.set_external_suites(False)
        self.tx = FakeTransport()
        self.cap = SessionCapturer(self.tx)
        instrumentation.install(self.cap, FakeDriver)
        self.driver = FakeDriver()

    def tearDown(self):
        instrumentation.uninstall()
        instrumentation.set_external_suites(False)
        instrumentation._state["run_failed"] = False
        instrumentation._state["default_suite"] = None

    def _suites(self):
        return [d for s, d in self.tx.sent if s == "suites"]

    def test_script_run_gets_a_default_suite(self):
        self.driver.execute("newSession")
        self.driver.execute("get", {"url": "https://x/"})  # first real cmd → setup
        suites = self._suites()
        self.assertTrue(suites)  # a default suite was reported for the tree
        first = list(suites[0][0].values())[0]  # {uid: SuiteStats}[]
        self.assertEqual(first["tests"][0]["state"], "running")

    def _run_as(self, script):
        """Drive one command with sys.argv[0] pinned, so the synthesized names
        come from a known entry script rather than from the test runner."""
        with mock.patch("selenium_devtools.instrumentation.sys.argv", [script]):
            self.driver.execute("newSession")
            self.driver.execute("get", {"url": "https://x/"})
        return list(self._suites()[0][0].values())[0]

    def test_the_synthetic_test_is_named_session_not_the_file(self):
        # The file is the suite; naming its single test after the file too made
        # the tree read `login.py` nested inside `login.py`.
        suite = self._run_as("/tmp/demo/login.py")
        test = suite["tests"][0]

        self.assertEqual(suite["title"], "login.py")
        self.assertEqual(test["title"], "session")
        # Mirrors the pytest plugin: parent is the suite, fullTitle joins them.
        self.assertEqual(test["parent"], "login.py")
        self.assertEqual(test["fullTitle"], "login.py \u203a session")
        self.assertEqual(test["uid"], "/tmp/demo/login.py::session")

    def test_the_suite_still_carries_the_entry_file(self):
        suite = self._run_as("/tmp/demo/login.py")

        self.assertEqual(suite["uid"], "/tmp/demo/login.py")
        self.assertEqual(suite["tests"][0]["file"], "/tmp/demo/login.py")

    def _final_state(self):
        """State of the synthetic test in the LAST suites frame sent."""
        return list(self._suites()[-1][0].values())[0]["tests"][0]["state"]

    def test_a_clean_run_reports_passed(self):
        self.driver.execute("newSession")
        self.driver.execute("get", {"url": "https://x/"})
        self.driver.execute("quit")

        self.assertEqual(self._final_state(), "passed")

    def test_quitting_while_an_exception_unwinds_reports_failed(self):
        # A script quits from a `finally`, so at quit time the exception is
        # still in flight — the only moment the dashboard can be told before
        # `wait_for_dashboard_close` blocks on it.
        self.driver.execute("newSession")
        self.driver.execute("get", {"url": "https://x/"})
        try:
            try:
                raise AssertionError("the test failed")
            finally:
                self.driver.execute("quit")
        except AssertionError:
            pass

        self.assertEqual(self._final_state(), "failed")

    def test_a_failure_seen_at_quit_survives_teardown(self):
        # THE regression: teardown routinely runs BEFORE the excepthook — the
        # user's own `finally` calls disable() while the exception is still
        # unwinding, and closing the dashboard runs teardown on the WS reader
        # thread, where this thread's exc_info is empty. Finalizing from
        # `run_failed` alone reported those runs as passed.
        self.driver.execute("newSession")
        self.driver.execute("get", {"url": "https://x/"})
        try:
            try:
                raise AssertionError("the test failed")
            finally:
                self.driver.execute("quit")
                instrumentation.finalize_run(self.cap)  # user's own disable()
        except AssertionError:
            pass

        self.assertEqual(self._final_state(), "failed")

    def test_a_failure_is_caught_even_when_the_driver_was_never_quit(self):
        # disable() from a `finally` without driver.quit() first: _on_quit never
        # runs, so nothing records the failure, and the excepthook fires only
        # after teardown has torn the transport down. finalize_run has to read
        # the live exception itself or the failed run is sent as passed.
        self.driver.execute("newSession")
        self.driver.execute("get", {"url": "https://x/"})
        try:
            try:
                raise AssertionError("the test failed")
            finally:
                instrumentation.finalize_run(self.cap)  # no quit()
        except AssertionError:
            pass

        self.assertEqual(self._final_state(), "failed")

    def test_a_failure_survives_a_teardown_run_on_another_thread(self):
        # Closing the dashboard runs the whole teardown on the WS reader thread,
        # where sys.exc_info() is empty however the script is doing. The main
        # thread records the failure before it blocks, so the later finalize —
        # simulated here by finalizing once the exception is no longer in flight
        # on this thread — still reports it.
        self.driver.execute("newSession")
        self.driver.execute("get", {"url": "https://x/"})
        try:
            try:
                raise AssertionError("the test failed")
            finally:
                instrumentation.record_live_failure()  # wait_for_dashboard_close
        except AssertionError:
            pass

        self.assertIsNone(sys.exc_info()[0])  # the WS thread's view: nothing
        instrumentation.finalize_run(self.cap)

        self.assertEqual(self._final_state(), "failed")

    def test_waiting_for_the_dashboard_records_the_live_failure(self):
        # Pins the CALL SITE, not just the helper: wait_for_dashboard_close is
        # the last code to run on the main thread before the process parks, so
        # if it does not observe the exception nothing else can.
        import selenium_devtools as devtools

        with mock.patch.object(
            devtools.lifecycle, "dashboard_window_open", return_value=True
        ), mock.patch.object(devtools.lifecycle, "wait_for_shutdown"):
            try:
                try:
                    raise AssertionError("the test failed")
                finally:
                    devtools.wait_for_dashboard_close()
            except AssertionError:
                pass

        self.assertTrue(instrumentation._state["run_failed"])

    def test_an_interrupted_run_is_not_finalized_from_the_reader_thread(self):
        # Closing the dashboard mid-flight runs teardown on the WS reader
        # thread, where the script's exception is invisible. lifecycle only
        # takes that path when nobody is parked in wait_for_shutdown — so the
        # script was still running, and publishing any terminal state would be a
        # guess. The tree keeps `running`, which is what actually happened.
        import threading

        self.driver.execute("newSession")
        self.driver.execute("get", {"url": "https://x/"})
        self.assertEqual(self._final_state(), "running")

        done = threading.Thread(
            target=lambda: instrumentation.finalize_run(self.cap)
        )
        done.start()
        done.join()

        self.assertEqual(self._final_state(), "running")

    def test_the_main_thread_still_finalizes_normally(self):
        self.driver.execute("newSession")
        self.driver.execute("get", {"url": "https://x/"})
        instrumentation.finalize_run(self.cap)

        self.assertEqual(self._final_state(), "passed")

    def test_record_live_failure_is_silent_on_a_clean_run(self):
        instrumentation.record_live_failure()

        self.assertFalse(instrumentation._state["run_failed"])

    def test_the_outcome_never_downgrades_to_passed(self):
        # Escalate-only: nothing at teardown can turn a recorded failure green.
        instrumentation.mark_run_failed()
        self.driver.execute("newSession")
        self.driver.execute("get", {"url": "https://x/"})
        self.driver.execute("quit")
        instrumentation.finalize_run(self.cap)

        self.assertEqual(self._final_state(), "failed")

    def test_finalize_reports_failed_once_the_excepthook_fired(self):
        self.driver.execute("newSession")
        self.driver.execute("get", {"url": "https://x/"})
        self.driver.execute("quit")
        self.assertEqual(self._final_state(), "passed")

        instrumentation.mark_run_failed()  # what the excepthook does
        instrumentation.finalize_run(self.cap)

        self.assertEqual(self._final_state(), "failed")

    def test_finalize_is_a_noop_without_a_synthetic_suite(self):
        # A framework owns the tree, or no driver ever started: nothing to say.
        instrumentation.finalize_run(self.cap)

        self.assertEqual(self._suites(), [])

    def test_a_failed_run_does_not_taint_the_next_one(self):
        # `run_failed` is module state. uninstall() resets the rest of the
        # per-run keys; leaving this one set reported a second, passing
        # enable/disable cycle in the same process as failed.
        instrumentation.mark_run_failed()
        instrumentation.uninstall()

        self.assertFalse(instrumentation._state["run_failed"])

    def test_default_suite_suppressed_when_framework_reports(self):
        instrumentation.set_external_suites(True)  # e.g. pytest plugin active
        self.driver.execute("newSession")
        self.driver.execute("get", {"url": "https://x/"})
        self.assertEqual(self._suites(), [])  # adapter didn't synthesize one


if __name__ == "__main__":
    unittest.main()


def live_session_ids():
    """Session ids currently being captured. The state is keyed by driver, so
    read the ids out of the entries rather than off the keys."""
    return {e["session_id"] for e in instrumentation._state["sessions"].values()}


class MultiSessionDriver(FakeDriver):
    """Driver whose session id is fixed at construction, so one process can hold
    two of them at once — what a function-scoped pytest fixture produces."""

    def __init__(self, session_id):
        super().__init__()
        self._sid = session_id
        self.session_id = session_id

    def execute(self, command, params=None):
        if command == "quit":
            return {"value": None}
        return {"value": f"ok:{command}"}

    # Deliberately no get_screenshot_as_base64: with one, arming starts a real
    # ScreencastRecorder, and finalize shells out to ffmpeg, which wrote a .webm
    # into the repo when these tests ran. Rotation is covered below with a stub.


class TestMultipleSessions(unittest.TestCase):
    """A second WebDriver in one process must be captured in full. Previously
    `setup_done` and `_metadata_sent` were booleans, so sessions after the first
    were attributed to session one and lost metadata, BiDi, DOM and video, and
    the first `quit()` tore down capture for whichever driver was still live."""

    def setUp(self):
        instrumentation.uninstall()
        self.tx = FakeTransport()
        self.cap = SessionCapturer(self.tx)
        self.attached = []
        self._bidi = mock.patch.object(
            instrumentation.bidi, "attach",
            # `stats` is the bag attach fills for the teardown summary; accepted
            # here so the stub keeps matching the real signature.
            side_effect=lambda d, c, stats=None: (
                self.attached.append(d.session_id) or True
            ),
        )
        self._bidi.start()
        instrumentation.install(self.cap, MultiSessionDriver)

    def tearDown(self):
        instrumentation.uninstall()
        self._bidi.stop()

    def _scopes(self, scope):
        return [d for s, d in self.tx.sent if s == scope]

    def _sessions_announced(self):
        return [m["sessionId"] for m in self._scopes("metadata")]

    def test_each_session_announces_its_own_metadata(self):
        MultiSessionDriver("sess-a").execute("get", {"url": "https://a/"})
        MultiSessionDriver("sess-b").execute("get", {"url": "https://b/"})
        self.assertEqual(self._sessions_announced(), ["sess-a", "sess-b"])

    def test_bidi_attaches_once_per_session(self):
        MultiSessionDriver("sess-a").execute("get", {"url": "https://a/"})
        MultiSessionDriver("sess-b").execute("get", {"url": "https://b/"})
        self.assertEqual(self.attached, ["sess-a", "sess-b"])

    def test_repeated_commands_on_one_session_arm_it_once(self):
        driver = MultiSessionDriver("sess-a")
        driver.execute("get", {"url": "https://a/"})
        driver.execute("click", {"id": "x"})
        self.assertEqual(self._sessions_announced(), ["sess-a"])
        self.assertEqual(self.attached, ["sess-a"])

    def test_two_live_drivers_are_tracked_independently(self):
        MultiSessionDriver("sess-a").execute("get", {"url": "https://a/"})
        MultiSessionDriver("sess-b").execute("get", {"url": "https://b/"})
        self.assertEqual(live_session_ids(), {"sess-a", "sess-b"})

    # The interleaved case: alternating commands must not re-arm anything.
    # Re-attaching BiDi per alternation duplicates console and network events,
    # and restarting the recorder and collector truncates both streams.
    def test_interleaved_commands_do_not_rearm(self):
        first = MultiSessionDriver("sess-a")
        second = MultiSessionDriver("sess-b")
        first.execute("get", {"url": "https://a/"})
        second.execute("get", {"url": "https://b/"})
        first.execute("click", {"id": "x"})
        second.execute("click", {"id": "y"})
        first.execute("getElementText", {"id": "x"})
        self.assertEqual(self.attached, ["sess-a", "sess-b"])
        self.assertEqual(self._sessions_announced(), ["sess-a", "sess-b"])

    def test_quitting_one_driver_leaves_the_other_capturing(self):
        first = MultiSessionDriver("sess-a")
        first.execute("get", {"url": "https://a/"})
        second = MultiSessionDriver("sess-b")
        second.execute("get", {"url": "https://b/"})
        first.execute("quit")
        self.assertEqual(live_session_ids(), {"sess-b"})
        second.execute("click", {"id": "x"})
        commands = [d[0]["command"] for s, d in self.tx.sent if s == "commands"]
        self.assertIn("click", commands)

    def test_a_driver_created_after_a_quit_is_armed_in_full(self):
        first = MultiSessionDriver("sess-a")
        first.execute("get", {"url": "https://a/"})
        first.execute("quit")
        self.assertEqual(live_session_ids(), set())
        MultiSessionDriver("sess-b").execute("get", {"url": "https://b/"})
        self.assertEqual(self._sessions_announced(), ["sess-a", "sess-b"])
        self.assertEqual(self.attached, ["sess-a", "sess-b"])


class StubRecorder:
    """Reports a finished encode without running ffmpeg or touching the disk."""

    def __init__(self):
        self.frames = []

    def start(self, driver):
        pass

    def add_frame(self, shot):
        self.frames.append(shot)

    def stop(self):
        pass

    def finalize(self, session_id, output_dir=None):
        return {
            "video_path": f"/tmp/{session_id}.webm",
            "video_file": f"{session_id}.webm",
            "frame_count": 1,
            "duration": 10,
            "start_time": 1000,
        }


class TestScreencastAttributionAcrossSessions(unittest.TestCase):
    """A rotated recording belongs to the session that produced it. send_screencast
    keyed on the capturer's latest session id, so replacing a session filed the
    previous session's video under the new one."""

    def setUp(self):
        instrumentation.uninstall()
        self.tx = FakeTransport()
        self.cap = SessionCapturer(self.tx)
        self._rec = mock.patch.object(
            instrumentation, "ScreencastRecorder", StubRecorder
        )
        self._rec.start()
        self._bidi = mock.patch.object(
            instrumentation.bidi, "attach", return_value=False
        )
        self._bidi.start()
        instrumentation.install(self.cap, MultiSessionDriver)

    def tearDown(self):
        instrumentation.uninstall()
        self._bidi.stop()
        self._rec.stop()

    def _videos(self):
        return [d for s, d in self.tx.sent if s == "screencast"]

    def test_a_live_session_is_not_finalized_when_another_starts(self):
        first = MultiSessionDriver("sess-a")
        first.execute("get", {"url": "https://a/"})
        MultiSessionDriver("sess-b").execute("get", {"url": "https://b/"})
        # sess-a is still live: encoding it here would truncate its video.
        self.assertEqual(self._videos(), [])

    def test_each_session_video_is_filed_under_that_session_on_its_own_quit(self):
        first = MultiSessionDriver("sess-a")
        second = MultiSessionDriver("sess-b")
        first.execute("get", {"url": "https://a/"})
        second.execute("get", {"url": "https://b/"})
        second.execute("quit")
        first.execute("quit")
        self.assertEqual([v["sessionId"] for v in self._videos()], ["sess-b", "sess-a"])
        self.assertEqual([v["videoFile"] for v in self._videos()],
                         ["sess-b.webm", "sess-a.webm"])


class SessionlessQuitDriver(MultiSessionDriver):
    """A driver that reaches quit with no session id: it never started one, or
    something cleared it first."""

    def execute(self, command, params=None):
        if command == "quit":
            self.session_id = None
        return super().execute(command, params)


class TestQuitTargetsItsOwnSession(unittest.TestCase):
    """`quit` must close the session belonging to the driver that quit. Picking
    'the only live session' when the quitting driver had none finalized a driver
    that was still running, losing its DOM and video from that point on."""

    def setUp(self):
        instrumentation.uninstall()
        self.tx = FakeTransport()
        self.cap = SessionCapturer(self.tx)
        self._rec = mock.patch.object(
            instrumentation, "ScreencastRecorder", StubRecorder
        )
        self._rec.start()
        self._bidi = mock.patch.object(
            instrumentation.bidi, "attach", return_value=False
        )
        self._bidi.start()
        instrumentation.install(self.cap, MultiSessionDriver)

    def tearDown(self):
        instrumentation.uninstall()
        self._bidi.stop()
        self._rec.stop()

    def test_a_sessionless_quit_does_not_close_someone_elses_session(self):
        live = MultiSessionDriver("sess-a")
        live.execute("get", {"url": "https://a/"})
        SessionlessQuitDriver("sess-never").execute("quit")  # never armed
        self.assertEqual(live_session_ids(), {"sess-a"})
        self.assertEqual([d for s, d in self.tx.sent if s == "screencast"], [])

    def test_a_driver_whose_id_was_cleared_still_closes_its_own_session(self):
        first = SessionlessQuitDriver("sess-a")
        first.execute("get", {"url": "https://a/"})
        second = MultiSessionDriver("sess-b")
        second.execute("get", {"url": "https://b/"})
        first.execute("quit")  # clears its own session_id before we see it
        self.assertEqual(live_session_ids(), {"sess-b"})
        videos = [d for s, d in self.tx.sent if s == "screencast"]
        self.assertEqual([v["sessionId"] for v in videos], ["sess-a"])


class TestOwnershipFollowsTheDriver(unittest.TestCase):
    """Consequences of keying capture on the driver rather than the session id."""

    def setUp(self):
        instrumentation.uninstall()
        self.tx = FakeTransport()
        self.cap = SessionCapturer(self.tx)
        self._rec = mock.patch.object(
            instrumentation, "ScreencastRecorder", StubRecorder
        )
        self._rec.start()
        # `new=` installs a plain function rather than a MagicMock. A MagicMock
        # records call_args, which would hold the driver and defeat the very
        # collection this class asserts.
        self._bidi = mock.patch.object(
            instrumentation.bidi, "attach", new=lambda driver, capturer: False
        )
        self._bidi.start()
        instrumentation.install(self.cap, MultiSessionDriver)

    def tearDown(self):
        instrumentation.uninstall()
        self._bidi.stop()
        self._rec.stop()

    def test_one_driver_starting_a_new_session_closes_its_previous_one(self):
        driver = MultiSessionDriver("sess-a")
        driver.execute("get", {"url": "https://a/"})
        driver.session_id = "sess-a2"  # the same driver, a replaced session
        driver.execute("get", {"url": "https://a2/"})
        self.assertEqual(live_session_ids(), {"sess-a2"})
        videos = [d for s, d in self.tx.sent if s == "screencast"]
        self.assertEqual([v["sessionId"] for v in videos], ["sess-a"])

    # A driver dropped without quit() must not hold its recorder open for the
    # rest of the run; weak keys let it go with the driver.
    def test_an_abandoned_driver_is_not_retained(self):
        import gc

        driver = MultiSessionDriver("sess-gone")
        driver.execute("get", {"url": "https://x/"})
        self.assertEqual(live_session_ids(), {"sess-gone"})
        del driver
        gc.collect()
        self.assertEqual(live_session_ids(), set())


class ScreenshotSessionDriver(MultiSessionDriver):
    """Fixed session id AND a screenshot method, so the REAL ScreencastRecorder
    arms against it."""

    def get_screenshot_as_base64(self):
        return "c2hvdA=="


class TestCaptureDoesNotOutliveItsDriver(unittest.TestCase):
    """The real recorder, not a stub. `start()` used to store
    `driver.get_screenshot_as_base64`, a bound method, which kept the driver
    alive for as long as the recorder did, so a driver dropped without quit()
    could never be collected and its recorder stayed open for the whole run."""

    def setUp(self):
        instrumentation.uninstall()
        self.tx = FakeTransport()
        self.cap = SessionCapturer(self.tx)
        self._bidi = mock.patch.object(
            instrumentation.bidi, "attach", new=lambda driver, capturer: False
        )
        self._bidi.start()
        instrumentation.install(self.cap, ScreenshotSessionDriver)

    def tearDown(self):
        instrumentation.uninstall()
        self._bidi.stop()

    def test_the_recorder_does_not_retain_its_driver(self):
        import gc
        import weakref

        driver = ScreenshotSessionDriver("sess-real")
        driver.execute("get", {"url": "https://x/"})
        entry = list(instrumentation._state["sessions"].values())[0]
        self.assertIsNotNone(entry["screencast"])  # a real recorder is armed
        ref = weakref.ref(driver)
        del driver
        gc.collect()
        self.assertIsNone(ref(), "the recorder is still holding the driver")
        self.assertEqual(live_session_ids(), set())


class TestPushScreencastWiring(unittest.TestCase):
    """Which source the video is made of, and that the stream is turned off.

    Both are decided in `instrumentation`, so a correct `cdp_screencast` proves
    nothing about them on its own.
    """

    class Recorder:
        def __init__(self):
            self.frames = []

        def add_frame(self, data):
            self.frames.append(data)
            return True

    class Push:
        def __init__(self, *, raises=False, raises_begin=False):
            self.stopped = 0
            self.frame_count = 3
            self._raises = raises
            self.began = 0
            self._raises_begin = raises_begin

        def begin_run(self, seed=None):
            if self._raises_begin:
                raise RuntimeError("socket already gone")
            self.began += 1
            self.seed = seed

        def stop(self):
            self.stopped += 1
            if self._raises:
                raise RuntimeError("session already gone")

    def test_per_command_shots_are_skipped_while_the_browser_streams(self):
        # The pushed frames already cover the timeline; a per-command shot would
        # duplicate one of them at a slightly different moment.
        rec = self.Recorder()
        entry = {"screencast": rec, "screencast_push": self.Push()}

        instrumentation._add_screencast_frame(entry, "shot")

        self.assertEqual(rec.frames, [])

    def test_the_stream_is_told_when_the_run_begins(self):
        push = self.Push()
        instrumentation._begin_screencast_run({"screencast_push": push})
        self.assertEqual(push.began, 1)

    def test_beginning_the_run_copes_with_no_stream_and_no_entry(self):
        # Polling mode, and the pre-session case where setup returned nothing.
        instrumentation._begin_screencast_run({"screencast_push": None})
        instrumentation._begin_screencast_run(None)

    def test_a_stream_that_raises_on_begin_does_not_break_the_command(self):
        push = self.Push(raises_begin=True)
        instrumentation._begin_screencast_run({"screencast_push": push})

    def test_per_command_shots_are_the_recording_without_a_stream(self):
        rec = self.Recorder()
        entry = {"screencast": rec, "screencast_push": None}

        instrumentation._add_screencast_frame(entry, "shot")

        self.assertEqual(rec.frames, ["shot"])

    def test_the_stream_is_stopped_once_and_forgotten(self):
        # Left running, the browser keeps sending frames into a buffer that has
        # already been read and encoded.
        push = self.Push()
        entry = {"screencast_push": push}

        instrumentation._stop_push_screencast(entry)
        instrumentation._stop_push_screencast(entry)

        self.assertEqual(push.stopped, 1)
        self.assertNotIn("screencast_push", entry)

    def test_a_stream_that_throws_on_stop_does_not_break_teardown(self):
        entry = {"screencast_push": self.Push(raises=True)}

        instrumentation._stop_push_screencast(entry)  # must not raise

    def test_no_stream_is_a_no_op(self):
        instrumentation._stop_push_screencast({})  # must not raise


class TestNavigationRowsGetTheirTimings(unittest.TestCase):
    """The dispatch, driven through the real command hook: a correct
    `performance` module proves nothing about which commands consult it."""

    PAYLOAD = {
        "navigation": {"url": "https://x/secure", "timing": {"loadTime": 700}},
        "resources": [],
        "cookies": "",
        "documentInfo": {"title": "Secure Area"},
    }

    class Driver:
        session_id = "sess-9"
        caps = {"browserName": "chrome"}

        def __init__(self, payload):
            self._payload = payload

        def execute(self, command, params=None):
            return {"value": f"ok:{command}"}

        def execute_script(self, script, *args):
            # Real selenium routes execute_script through the same `execute`
            # chokepoint the adapter patches, which is the whole reason the
            # adapter's own reads must go through the guarded executor.
            self.execute("executeScript", {"script": script, "args": list(args)})
            if "getEntriesByType" in script:
                return self._payload
            return None

        def get_screenshot_as_base64(self):
            return "shot"

    def setUp(self):
        self.cap = SessionCapturer(FakeTransport())
        instrumentation.uninstall()
        instrumentation.install(self.cap, self.Driver)
        self.addCleanup(instrumentation.uninstall)

    def _replacements(self):
        return [
            data
            for scope, data in self.cap._tx.sent
            if scope == "replaceCommand"
        ]

    def test_a_navigation_row_is_replaced_with_its_timings(self):
        driver = self.Driver(self.PAYLOAD)

        driver.execute("get", {"url": "https://x/secure"})

        (frame,) = self._replacements()
        self.assertEqual(frame["command"]["command"], "get")
        self.assertEqual(
            frame["command"]["performance"]["navigation"]["timing"]["loadTime"], 700
        )

    def test_the_timings_read_does_not_appear_in_the_actions_timeline(self):
        # The adapter's own read goes through the guarded executor. Unguarded it
        # would land in the same `execute` it was called from and show up as an
        # `executeScript` row beside every navigation.
        driver = self.Driver(self.PAYLOAD)

        driver.execute("get", {"url": "https://x/secure"})

        commands = [
            row["command"]
            for scope, rows in self.cap._tx.sent
            if scope == "commands"
            for row in rows
        ]
        self.assertEqual(commands, ["get"])

    def test_a_command_that_does_not_navigate_is_left_alone(self):
        driver = self.Driver(self.PAYLOAD)

        driver.execute("findElement", {"using": "css selector", "value": "#a"})

        self.assertEqual(self._replacements(), [])


class TestTheStreamIsOpenedByTheCommandHook(unittest.TestCase):
    """The gate is useless unless the hook actually opens it.

    This is the level the original regression happened at: the per-command
    recorder's "no frame from before the run" fix was guarded by a test on the
    recorder, so when a pushed stream became a SECOND frame producer the guard
    kept passing and 3-4s of blank came back. A unit test of the gate cannot
    catch a missing call site, so this drives the real command hook.
    """

    class Push:
        def __init__(self, order):
            self.began = 0
            self.seed = None
            self._order = order

        def begin_run(self, seed=None):
            self.began += 1
            self.seed = seed
            self._order.append("gate")

        def stop(self):
            pass

    def setUp(self):
        instrumentation.uninstall()
        self.order = []
        outer = self.order

        class OrderDriver(ScreenshotDriver):
            def execute(self, command, params=None):
                outer.append("command")
                return FakeDriver.execute(self, command, params)

        self.cap = SessionCapturer(FakeTransport())
        instrumentation.install(self.cap, OrderDriver)
        self.driver = OrderDriver()
        self.push = self.Push(self.order)
        # Pin the entry the hook works from: the real setup path needs a live
        # session, and what is under test is the hook, not session bring-up.
        self._patch = mock.patch.object(
            instrumentation,
            "_ensure_session_setup",
            return_value={"screencast_push": self.push, "screencast": None},
        )
        self._patch.start()

    def tearDown(self):
        self._patch.stop()
        instrumentation.uninstall()

    def test_running_a_command_opens_the_gate(self):
        self.driver.execute("get", {"url": "https://x/"})

        self.assertGreaterEqual(self.push.began, 1)

    def test_the_gate_is_seeded_with_that_commands_screenshot(self):
        # Chrome sends frames only on composite, so a page that has finished
        # painting may push nothing until the test next changes it.
        self.driver.execute("get", {"url": "https://x/"})

        self.assertEqual(self.push.seed, "c2hvdA==")

    def test_the_gate_opens_after_the_command_not_before(self):
        # Before the command, the page is still whatever preceded it — on a
        # fresh driver an unpainted about:blank that the browser keeps pushing
        # for the whole opening navigation. Opening early was measured to leave
        # the blank in place, just sourced from a frame ~0.8s later.
        self.driver.execute("get", {"url": "https://x/"})

        self.assertEqual(self.order[:2], ["command", "gate"])


class TestSessionSetupIssuesNoUserCommands(unittest.TestCase):
    """Arming the screencast must not appear in the Actions timeline.

    Resolving the CDP target reads `driver.current_window_handle`, which in
    selenium issues a real WebDriver command. Uncaptured, it re-entered the
    hook as a user command — and because session setup runs ON the first
    command, that read BECAME the first command. Its post-command screenshot is
    the page before the run: an unpainted surface, which then led the video for
    the whole opening navigation (measured: uniform frame, YMIN=YMAX=31, held
    3.8s of a 4.2s video).
    """

    def setUp(self):
        instrumentation.uninstall()
        self.tx = FakeTransport()
        self.cap = SessionCapturer(self.tx)

    def tearDown(self):
        instrumentation.uninstall()

    def test_reading_the_window_handle_while_arming_is_not_captured(self):
        seen = []

        class HandleReadingDriver(FakeDriver):
            """Its window-handle property goes through execute(), as selenium's
            does — a double that bypassed execute() could not catch this."""

            def __init__(self):
                FakeDriver.__init__(self)
                self.session_id = "sess-1"  # setup bails without one

            @property
            def current_window_handle(self):
                return self.execute("w3cGetCurrentWindowHandle")["value"]

            def execute(self, command, params=None):
                seen.append(command)
                return FakeDriver.execute(self, command, params)

        instrumentation.install(self.cap, HandleReadingDriver)
        driver = HandleReadingDriver()

        with mock.patch.object(
            instrumentation,
            "start_push_screencast",
            side_effect=lambda d, _sink: d.current_window_handle and None,
        ):
            driver.execute("get", {"url": "https://x/"})

        # The driver really was asked for its handle...
        self.assertIn("w3cGetCurrentWindowHandle", seen)
        # ...but only `get` reached the timeline.
        captured = [d[0]["command"] for s, d in self.tx.sent if s == "commands"]
        self.assertEqual(captured, ["get"])
