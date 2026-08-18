"""Document-start registration of the collector.

A `<script>`-append can only instrument the document that exists when it runs,
and dies with it — so every navigation yields a document we learn about after the
fact. A preload runs in EVERY document before that document's own script, which
removes the whole class of "when do we re-inject / who owns this DOM" races.
"""

import unittest
from unittest import mock

from selenium_devtools import bidi_preload
from selenium_devtools.snapshot import SnapshotCapturer


class FakeScript:
    def __init__(self, raises=None):
        self.pinned = []
        self._raises = raises

    def pin(self, script):
        if self._raises:
            raise self._raises
        self.pinned.append(script)
        return "preload-id"


class FakeDriver:
    def __init__(self, caps=None, script=None):
        self.caps = caps if caps is not None else {"webSocketUrl": "ws://x"}
        self._script = script or FakeScript()

    @property
    def script(self):
        return self._script


class TestRegistering(unittest.TestCase):
    def test_registers_the_collector_as_a_function_declaration(self):
        # A preload script IS a function, so the bundle's top-level await works
        # in its body — unlike the `<script>` path, which needs the async IIFE.
        driver = FakeDriver()

        self.assertTrue(
            bidi_preload.register_collector_preload(driver, "COLLECTOR")
        )
        self.assertEqual(driver.script.pinned, ["async () => { COLLECTOR }"])

    def test_a_session_without_the_bidi_capability_falls_back(self):
        # No webSocketUrl means driver.script cannot open. The `<script>` path
        # still captures DOM, just with the races the preload removes.
        driver = FakeDriver(caps={})

        self.assertFalse(
            bidi_preload.register_collector_preload(driver, "COLLECTOR")
        )

    def test_a_selenium_failure_falls_back_with_a_reason(self):
        driver = FakeDriver(script=FakeScript(raises=RuntimeError("no bidi")))

        with self.assertLogs("selenium_devtools.preload", level="WARNING") as logs:
            self.assertFalse(
                bidi_preload.register_collector_preload(driver, "COLLECTOR")
            )

        self.assertIn("falling back to per-document injection", "\n".join(logs.output))


class TestTheScriptPathIsGatedNotDeleted(unittest.TestCase):
    """The `<script>` path is the only capture without BiDi, so it stays — it is
    simply not used when a preload already installed the collector everywhere."""

    def test_a_preloaded_capturer_injects_nothing(self):
        calls = {"n": 0}

        def execute(*_args):
            calls["n"] += 1
            return True

        capturer = SnapshotCapturer(execute, preloaded=True)

        self.assertTrue(capturer.injected)  # present from document-start
        self.assertTrue(capturer.inject())
        self.assertEqual(calls["n"], 0)  # no probe, no injection

    def test_without_a_preload_the_script_path_still_runs(self):
        calls = {"n": 0}

        def execute(*_args):
            calls["n"] += 1
            return True

        capturer = SnapshotCapturer(execute, script_path=None, preloaded=False)
        with mock.patch(
            "selenium_devtools.snapshot.load_injectable_script", return_value="SRC"
        ):
            self.assertTrue(capturer.inject())

        self.assertGreater(calls["n"], 0)


class TestTheSeleniumSurfaceWeDependOn(unittest.TestCase):
    """`pin()` is public, but its docstring says "current browsing context" while
    we depend on it registering GLOBALLY so documents created later are covered.
    That reliance is undocumented, so it is pinned here: if selenium ever scopes
    `pin` to one context, this fails instead of the preload silently covering
    only the first document."""

    def test_pin_registers_without_a_browsing_context(self):
        from selenium.webdriver.common.bidi.script import Script

        seen = {}

        def fake_add(self, function_declaration, *args, **kwargs):
            seen["args"] = args
            seen["kwargs"] = kwargs
            return "id"

        # A bare instance: constructing a real Script needs a live driver, and
        # only the dispatch from pin() to _add_preload_script is under test.
        script = Script.__new__(Script)
        with mock.patch.object(Script, "_add_preload_script", fake_add):
            script.pin("async () => {}")

        self.assertEqual(seen["args"], ())
        self.assertIsNone(seen["kwargs"].get("contexts"))


if __name__ == "__main__":
    unittest.main()
