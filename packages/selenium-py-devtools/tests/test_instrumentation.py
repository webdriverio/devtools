import unittest

from wdio_selenium_devtools import instrumentation
from wdio_selenium_devtools.capturer import SessionCapturer


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
    def setUp(self):
        instrumentation.uninstall()
        self.tx = FakeTransport()
        self.cap = SessionCapturer(self.tx)
        instrumentation.install(self.cap, FakeDriverWithScript)
        self.driver = FakeDriverWithScript()

    def tearDown(self):
        instrumentation.uninstall()

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

    def _suites(self):
        return [d for s, d in self.tx.sent if s == "suites"]

    def test_script_run_gets_a_default_suite(self):
        self.driver.execute("newSession")
        self.driver.execute("get", {"url": "https://x/"})  # first real cmd → setup
        suites = self._suites()
        self.assertTrue(suites)  # a default suite was reported for the tree
        first = list(suites[0][0].values())[0]  # {uid: SuiteStats}[]
        self.assertEqual(first["tests"][0]["state"], "running")

    def test_default_suite_suppressed_when_framework_reports(self):
        instrumentation.set_external_suites(True)  # e.g. pytest plugin active
        self.driver.execute("newSession")
        self.driver.execute("get", {"url": "https://x/"})
        self.assertEqual(self._suites(), [])  # adapter didn't synthesize one


if __name__ == "__main__":
    unittest.main()
