from __future__ import annotations

import threading
import time
import unittest
from types import SimpleNamespace
from unittest import mock

from selenium_devtools import bidi, bidi_preload, capture_calls


def _driver(session_id: str = "s1", version: str = "157.0.8000.22", **extra):
    caps = {"browserName": "chrome", "browserVersion": version, "webSocketUrl": "ws://x"}
    caps.update(extra)
    return SimpleNamespace(session_id=session_id, caps=caps)


class _Hang:
    def __init__(self, test: unittest.TestCase) -> None:
        self.release = threading.Event()
        test.addCleanup(self.release.set)

    def __call__(self, cancelled: threading.Event) -> str:
        self.release.wait(5)
        return "late"


class TestCallWithTimeout(unittest.TestCase):
    def setUp(self):
        capture_calls.reset()

    def test_a_hung_call_is_cut_off_and_cancelled_on_chrome_157(self):
        seen = {}

        def hang(cancelled: threading.Event) -> str:
            seen["cancelled"] = cancelled
            cancelled.wait(5)
            return "late"

        started = time.monotonic()
        result = capture_calls.call_with_timeout(_driver(), hang, 0.05, "fallback", "preload")
        self.assertEqual(result, "fallback")
        self.assertLess(time.monotonic() - started, 1.0)
        self.assertTrue(seen["cancelled"].wait(1))

    def test_an_unaffected_browser_gets_no_ceiling(self):
        for driver in (
            _driver(version="158.0.8106.0"),
            _driver(version="155.0.1"),
            _driver(version="157.0.1", platformName="Android"),
        ):
            with self.subTest(driver.caps):
                result = capture_calls.call_with_timeout(
                    driver, lambda _c: (time.sleep(0.1), "slow")[1], 0.01, "fallback", "x"
                )
                self.assertEqual(result, "slow")

    def test_an_error_in_time_passes_through(self):
        def boom(_cancelled):
            raise RuntimeError("gone")

        with self.assertRaisesRegex(RuntimeError, "gone"):
            capture_calls.call_with_timeout(_driver(), boom, 1.0, 0, "read")

    def test_warns_once_per_session_naming_the_bug_as_likely_cause(self):
        with self.assertLogs("selenium_devtools", level="INFO") as logs:
            capture_calls.call_with_timeout(_driver("s1"), _Hang(self), 0.01, None, "preload")
            capture_calls.call_with_timeout(_driver("s1"), _Hang(self), 0.01, None, "subscribe")
            capture_calls.call_with_timeout(_driver("s2"), _Hang(self), 0.01, None, "preload")
        self.assertEqual([r.levelname for r in logs.records], ["WARNING", "WARNING"])
        message = logs.records[0].getMessage()
        self.assertIn("timed out on Chrome 157, which hangs", message)
        self.assertIn("crbug 571161446", message)
        self.assertIn("158.0.8106.0", message)


class TestBidiSetupCeilings(unittest.TestCase):
    def setUp(self):
        capture_calls.reset()
        self.release = threading.Event()
        self.addCleanup(self.release.set)

    def test_a_late_preload_registration_is_unpinned(self):
        unpinned = threading.Event()
        driver = _driver()
        driver.script = SimpleNamespace(
            pin=lambda _source: self.release.wait(5) and "pin-1",
            unpin=lambda script_id: unpinned.set(),
        )
        with mock.patch.object(bidi_preload, "BIDI_SETUP_TIMEOUT_S", 0.05):
            self.assertFalse(bidi_preload.register_collector_preload(driver, "/* c */"))
        self.release.set()
        self.assertTrue(unpinned.wait(2))

    def test_a_late_subscription_registers_no_handler_and_writes_no_stats(self):
        handlers = []

        def add_handler(callback):
            self.release.wait(5)
            handlers.append(callback)

        driver = _driver()
        driver.script = SimpleNamespace(
            add_console_message_handler=add_handler,
            add_javascript_error_handler=handlers.append,
        )
        stats = {}
        capturer = mock.Mock()
        with mock.patch.object(bidi, "BIDI_SETUP_TIMEOUT_S", 0.05):
            started = time.monotonic()
            self.assertFalse(bidi.attach(driver, capturer, stats))
        self.assertLess(time.monotonic() - started, 1.0)
        self.release.set()
        time.sleep(0.2)
        self.assertEqual(len(handlers), 1, "only the call already in flight landed")
        handlers[0](SimpleNamespace(level="info", text="hi", args=[]))
        capturer.capture_console.assert_not_called()
        self.assertNotIn("attached", stats)


if __name__ == "__main__":
    unittest.main()
