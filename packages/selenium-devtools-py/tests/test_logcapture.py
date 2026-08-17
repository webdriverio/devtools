import logging
import unittest

from selenium_devtools.logcapture import (
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


class TestDegradationReachesTheDashboard(unittest.TestCase):
    """#280: a degradation warning has to arrive in the dashboard Console.

    `terminal.py` tees stdout by design and `_DashboardHandler` forwards logging
    records, so a raw `print(file=sys.stderr)` reached neither and losing BiDi
    left Console and Network silently empty. These drive the real modules, not a
    synthesized record, so a module reverting to stderr fails here.
    """

    def _captured(self, emit):
        cap = FakeCapturer()
        lc = LogCapturer(cap)
        lc.start()
        try:
            emit()
        finally:
            lc.stop()
        return [args[0] for level, args, _ in cap.logs if level == "warn"]

    def test_missing_bidi_capability_states_the_reason(self):
        from selenium_devtools import bidi

        class DriverWithoutBiDi:
            caps = {}

        warnings = self._captured(
            lambda: bidi.attach(DriverWithoutBiDi(), FakeCapturer())
        )

        self.assertTrue(
            any("web_socket_url" in w for w in warnings),
            f"the reason BiDi is unavailable never reached the capturer: {warnings}",
        )

    def test_every_degrading_module_routes_through_the_logger(self):
        from selenium_devtools import bidi, lifecycle, screencast, snapshot

        for module in (bidi, screencast, snapshot):
            with self.subTest(module=module.__name__):
                warnings = self._captured(lambda m=module: m._warn("degraded"))
                self.assertTrue(any("degraded" in w for w in warnings))

        warnings = self._captured(lambda: lifecycle._log.warning("degraded"))
        self.assertTrue(any("degraded" in w for w in warnings))

    def test_the_record_names_the_module_it_came_from(self):
        from selenium_devtools import snapshot

        cap = FakeCapturer()
        lc = LogCapturer(cap)
        lc.start()
        try:
            snapshot._warn("collector missing")
        finally:
            lc.stop()

        self.assertTrue(
            any("snapshot" in args[0] for _, args, _ in cap.logs),
            "the Console line should say which module degraded",
        )


if __name__ == "__main__":
    unittest.main()
