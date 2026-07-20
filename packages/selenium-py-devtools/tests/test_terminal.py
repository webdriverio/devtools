import io
import sys
import unittest

from wdio_selenium_devtools.terminal import TerminalCapturer, _TeeStream


class FakeCapturer:
    def __init__(self):
        self.logs = []

    def capture_console(self, level, args, source="browser"):
        self.logs.append((level, args, source))


class TestTee(unittest.TestCase):
    def test_writes_through_and_emits_complete_lines(self):
        buf = io.StringIO()
        emitted = []
        tee = _TeeStream(buf, emitted.append)
        tee.write("hello\nworld\n")
        self.assertEqual(buf.getvalue(), "hello\nworld\n")  # passthrough intact
        self.assertEqual(emitted, ["hello", "world"])

    def test_partial_line_is_buffered_until_newline(self):
        emitted = []
        tee = _TeeStream(io.StringIO(), emitted.append)
        tee.write("par")
        tee.write("tial\n")
        self.assertEqual(emitted, ["partial"])

    def test_skips_self_prefixed_and_blank_lines(self):
        emitted = []
        tee = _TeeStream(io.StringIO(), emitted.append)
        tee.write("[wdio-devtools] internal\n\n   \nreal line\n")
        self.assertEqual(emitted, ["real line"])

    def test_delegates_unknown_attrs(self):
        tee = _TeeStream(io.StringIO(), lambda _l: None)
        self.assertFalse(tee.isatty())  # delegated to StringIO


class TestTerminalCapturer(unittest.TestCase):
    def test_start_captures_then_stop_restores(self):
        cap = FakeCapturer()
        orig_out, orig_err = sys.stdout, sys.stderr
        tc = TerminalCapturer(cap)
        tc.start()
        try:
            self.assertIsNot(sys.stdout, orig_out)  # wrapped while active
            sys.stdout.write("captured line\n")
        finally:
            tc.stop()
        self.assertIs(sys.stdout, orig_out)  # restored
        self.assertIs(sys.stderr, orig_err)
        self.assertIn(("log", ["captured line"], "terminal"), cap.logs)


if __name__ == "__main__":
    unittest.main()
