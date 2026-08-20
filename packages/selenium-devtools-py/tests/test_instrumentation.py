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

    def test_page_moving_command_refreshes_snapshot(self):
        # Drained after any command that could have moved the page, not only
        # get/back/… — a click can navigate too, so the iframe stays current.
        self.driver.execute("click", {"id": "btn"})
        self.assertEqual(len(self._mutations()), 1)

    def test_locator_command_skips_the_drain(self):
        # Resolving a locator reads the DOM and cannot change it, so the drain
        # it used to trigger could only ever return an empty buffer.
        self.driver.execute(
            "findElement", {"using": "css selector", "value": "#a"}
        )
        self.assertEqual(self._mutations(), [])
        reads = [s for s in self.driver._script_calls if "getTraceData" in s]
        self.assertEqual(reads, [])  # no round trip at all, not just no payload

    def test_locator_command_is_still_captured(self):
        # Only the drain is skipped — the row itself is still what the user
        # wrote, and still appears in the Actions timeline.
        self.driver.execute(
            "findElement", {"using": "css selector", "value": "#a"}
        )
        cmds = [d[0] for s, d in self.tx.sent if s == "commands"]
        self.assertEqual(len(cmds), 1)
        self.assertEqual(cmds[0]["command"], "findElement")

    def test_unrecognized_command_still_drains(self):
        # Deny-list, not allow-list: a command this adapter has never heard of
        # must keep draining, or a future selenium command that moves the page
        # would silently stop being captured.
        self.driver.execute("someFutureCommand", {})
        self.assertEqual(len(self._mutations()), 1)


class TestWarrantsDrain(unittest.TestCase):
    """The predicate alone — no driver, no capture plumbing."""

    def test_locators_are_denied(self):
        for command in (
            "findElement", "findElements", "findChildElement",
            "findChildElements", "findElementFromShadowRoot",
            "findElementsFromShadowRoot",
        ):
            self.assertFalse(instrumentation.warrants_drain(command), command)

    def test_page_moving_and_unknown_commands_are_allowed(self):
        for command in ("get", "click", "sendKeys", "back", "someFutureCommand"):
            self.assertTrue(instrumentation.warrants_drain(command), command)


class FakeClientConfig:
    def __init__(self, interval=0.1):
        self.websocket_interval = interval


class FakeExecutor:
    def __init__(self, config):
        self.client_config = config


class TestBidiPollInterval(unittest.TestCase):
    """`_tune_bidi_poll_interval` — the reply-poll interval, lowered before the
    socket that reads it is built."""

    def setUp(self):
        instrumentation.uninstall()
        self.tx = FakeTransport()
        self.cap = SessionCapturer(self.tx)

    def tearDown(self):
        instrumentation.uninstall()

    def _driver(self, config):
        driver = FakeDriver()
        driver.command_executor = FakeExecutor(config)
        return driver

    def test_default_interval_is_lowered(self):
        config = FakeClientConfig(0.1)
        instrumentation._tune_bidi_poll_interval(self._driver(config))
        self.assertEqual(
            config.websocket_interval,
            instrumentation.BIDI_RESPONSE_POLL_INTERVAL_S,
        )

    def test_a_smaller_user_interval_is_left_alone(self):
        # Only ever lowers: someone who chose finer polling keeps it.
        config = FakeClientConfig(0.001)
        instrumentation._tune_bidi_poll_interval(self._driver(config))
        self.assertEqual(config.websocket_interval, 0.001)

    def test_executor_without_client_config_is_a_noop(self):
        # Not every command_executor is a RemoteConnection.
        driver = FakeDriver()
        driver.command_executor = object()
        instrumentation._tune_bidi_poll_interval(driver)  # must not raise

    def test_driver_without_executor_is_a_noop(self):
        instrumentation._tune_bidi_poll_interval(FakeDriver())  # must not raise

    def test_tuning_runs_before_bidi_attach(self):
        # The socket is built on the first `driver.script` touch, which is
        # attach — so tuning after it would never reach the connection.
        order = []

        def record_tune(_driver):
            order.append("tune")

        def record_attach(*_args, **_kwargs):
            order.append("attach")
            return False

        driver = self._driver(FakeClientConfig(0.1))
        driver.session_id = "sess-1"
        with mock.patch.object(
            instrumentation, "_tune_bidi_poll_interval", record_tune
        ), mock.patch.object(instrumentation.bidi, "attach", record_attach):
            instrumentation._ensure_session_setup(driver, self.cap)
        self.assertEqual(order, ["tune", "attach"])

    def test_config_without_the_setting_is_a_noop(self):
        # Nothing to tune when selenium does not expose the interval — writing
        # an attribute it never reads would only look like it worked.
        class BareConfig:
            pass

        config = BareConfig()
        instrumentation._tune_bidi_poll_interval(self._driver(config))
        self.assertFalse(hasattr(config, "websocket_interval"))


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
            instrumentation.bidi, "attach", new=lambda driver, capturer, stats=None: False
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
            instrumentation.bidi, "attach", new=lambda driver, capturer, stats=None: False
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
