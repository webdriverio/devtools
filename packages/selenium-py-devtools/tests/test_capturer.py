import unittest

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


class TestSessionCapturer(unittest.TestCase):
    def setUp(self):
        self.tx = FakeTransport()
        self.cap = SessionCapturer(self.tx)

    def test_metadata_sent_once(self):
        self.cap.ensure_metadata("sess-1", {"browserName": "chrome"}, None)
        self.cap.ensure_metadata("sess-1", {"browserName": "chrome"}, None)
        meta_frames = [d for s, d in self.tx.sent if s == "metadata"]
        self.assertEqual(len(meta_frames), 1)
        self.assertEqual(meta_frames[0]["sessionId"], "sess-1")

    def test_capture_command_increments_id_and_wraps_in_array(self):
        self.cap.capture_command(command="get", args={"url": "x"},
                                 result={"v": 1}, start_time=1, call_source=None)
        self.cap.capture_command(command="click", args=None,
                                 result=None, start_time=2, call_source=None)
        cmds = [d for s, d in self.tx.sent if s == "commands"]
        self.assertEqual(len(cmds), 2)
        self.assertEqual(cmds[0][0]["id"], 1)
        self.assertEqual(cmds[1][0]["id"], 2)
        # non-list args are normalized to a list
        self.assertEqual(cmds[0][0]["args"], [{"url": "x"}])
        self.assertEqual(cmds[1][0]["args"], [])

    def test_capture_command_records_error(self):
        self.cap.capture_command(command="boom", args=[],
                                 error=RuntimeError("x"), start_time=1,
                                 call_source=None)
        cmd = [d for s, d in self.tx.sent if s == "commands"][0][0]
        self.assertEqual(cmd["error"]["name"], "RuntimeError")

    def test_suites_sent_as_uid_keyed_records(self):
        # UI expects Record<uid, SuiteStats>[], not a plain array of suites.
        suite = {"uid": "suite-1", "title": "S", "tests": []}
        self.cap.send_suites([suite])
        self.assertIn(("suites", [{"suite-1": suite}]), self.tx.sent)

    def test_suites_empty_payload_not_sent(self):
        self.cap.send_suites([{"title": "no uid"}])
        self.assertEqual([s for s, _ in self.tx.sent if s == "suites"], [])


if __name__ == "__main__":
    unittest.main()
