import logging
import unittest

from wdio_selenium_devtools.logcapture import (
    LOGGER_NAME,
    LogCapturer,
    _DashboardHandler,
)


class FakeCapturer:
    def __init__(self):
        self.logs = []

    def capture_console(self, level, args, source="browser"):
        self.logs.append((level, args, source))


def _record(name, levelno, msg, args=()):
    return logging.LogRecord(name, levelno, __file__, 1, msg, args, None)


class TestHandler(unittest.TestCase):
    def test_forwards_with_logger_name_and_terminal_source(self):
        cap = FakeCapturer()
        _DashboardHandler(cap).emit(_record("selenium", logging.INFO, "hi %s", ("x",)))
        self.assertEqual(cap.logs, [("info", ["selenium: hi x"], "terminal")])

    def test_level_mapping(self):
        cap = FakeCapturer()
        h = _DashboardHandler(cap)
        for lvl in (logging.DEBUG, logging.WARNING, logging.ERROR):
            h.emit(_record("n", lvl, "m"))
        self.assertEqual([lvl for lvl, _, _ in cap.logs], ["debug", "warn", "error"])


class TestLogCapturer(unittest.TestCase):
    def test_captures_adapter_logs_then_restores_on_stop(self):
        cap = FakeCapturer()
        adapter_logger = logging.getLogger(LOGGER_NAME)
        prev_level = adapter_logger.level
        lc = LogCapturer(cap)
        lc.start()
        try:
            self.assertIn(lc._handler, logging.getLogger().handlers)
            logging.getLogger(LOGGER_NAME).info("hello from adapter")
            self.assertTrue(
                any("hello from adapter" in a[0] for _, a, _ in cap.logs)
            )
        finally:
            lc.stop()
        self.assertNotIn(lc._handler, logging.getLogger().handlers)  # detached
        self.assertEqual(adapter_logger.level, prev_level)  # level restored


if __name__ == "__main__":
    unittest.main()
