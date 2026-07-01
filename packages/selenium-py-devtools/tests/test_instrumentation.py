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

    def test_skip_commands_not_captured_but_metadata_sent(self):
        self.driver.execute("newSession")
        self.assertEqual(self._commands(), [])
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


if __name__ == "__main__":
    unittest.main()
