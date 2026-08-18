import os
import tempfile
import unittest
from unittest import mock

from selenium_devtools import snapshot
from selenium_devtools.snapshot import (
    SnapshotCapturer,
    load_injectable_script,
    normalize_mutations,
    resolve_script_path,
    start_snapshot_capture,
    wrap_injectable,
)


class FakeExec:
    """Records execute_script calls; returns queued values in order."""

    def __init__(self, *returns):
        self.calls = []
        self._returns = list(returns)

    def __call__(self, script, *args):
        self.calls.append((script, args))
        if self._returns:
            return self._returns.pop(0)
        return None


class TestScriptResolution(unittest.TestCase):
    # `packages/script/dist/script.js` is a gitignored build artifact, so a CI job
    # that only sets up Python has no copy. Mirrors the JS suite's
    # `it.skipIf(!scriptPackageAvailable)` guard on the same dependency.
    @unittest.skipUnless(
        resolve_script_path(), "packages/script/dist/script.js is not built"
    )
    def test_resolves_monorepo_script(self):
        path = resolve_script_path()
        self.assertIsNotNone(path)
        self.assertTrue(path.endswith(os.path.join("script", "dist", "script.js")))
        self.assertTrue(os.path.isfile(path))


class TestWrapAndLoad(unittest.TestCase):
    def test_wrap_produces_async_iife(self):
        wrapped = wrap_injectable("doThing();")
        self.assertEqual(wrapped, "(async function() { doThing(); })()")

    def test_load_reads_and_wraps(self):
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
            fh.write("BODY")
            temp = fh.name
        try:
            out = load_injectable_script(temp)
        finally:
            os.unlink(temp)
        self.assertEqual(out, "(async function() { BODY })()")

    def test_load_missing_file_returns_none(self):
        self.assertIsNone(load_injectable_script("/no/such/script.js"))


class TestNormalizeMutations(unittest.TestCase):
    def test_extracts_mutation_list(self):
        payload = {
            "mutations": [{"type": "childList", "target": "1"}],
            "consoleLogs": [],
            "metadata": {"url": "https://x/"},
        }
        self.assertEqual(normalize_mutations(payload), [{"type": "childList", "target": "1"}])

    def test_missing_key_returns_empty(self):
        self.assertEqual(normalize_mutations({"consoleLogs": []}), [])

    def test_non_list_mutations_returns_empty(self):
        self.assertEqual(normalize_mutations({"mutations": "oops"}), [])

    def test_none_payload_returns_empty(self):
        self.assertEqual(normalize_mutations(None), [])

    def test_non_dict_payload_returns_empty(self):
        self.assertEqual(normalize_mutations([1, 2, 3]), [])


class TestSnapshotCapturerInject(unittest.TestCase):
    def _tmp_script(self):
        fh = tempfile.NamedTemporaryFile("w", suffix=".js", delete=False)
        fh.write("COLLECTOR")
        fh.close()
        self.addCleanup(lambda: os.path.exists(fh.name) and os.unlink(fh.name))
        return fh.name

    def test_inject_appends_script_and_probes(self):
        # probe (absent) -> install -> probe (present)
        exec_fn = FakeExec(False, None, True)
        cap = SnapshotCapturer(exec_fn, script_path=self._tmp_script())
        self.assertTrue(cap.inject())
        self.assertTrue(cap.injected)
        install = [c for c in exec_fn.calls if "createElement('script')" in c[0]]
        self.assertEqual(len(install), 1)
        self.assertEqual(install[0][1], ("(async function() { COLLECTOR })()",))
        self.assertTrue(any("wdioTraceCollector" in c[0] for c in exec_fn.calls))

    def test_inject_skips_install_when_collector_present(self):
        # Self-healing: collector already on the page → probe True → no install.
        exec_fn = FakeExec(True)
        cap = SnapshotCapturer(exec_fn, script_path=self._tmp_script())
        self.assertTrue(cap.inject())
        self.assertEqual([c for c in exec_fn.calls if "createElement" in c[0]], [])

    def test_inject_reinjects_after_navigation(self):
        # Navigation wipes the collector: probe absent both times → 2 installs.
        exec_fn = FakeExec(False, None, True, False, None, True)
        cap = SnapshotCapturer(exec_fn, script_path=self._tmp_script())
        cap.inject()
        cap.inject()
        installs = [c for c in exec_fn.calls if "createElement" in c[0]]
        self.assertEqual(len(installs), 2)

    def test_inject_missing_script_is_noop(self):
        exec_fn = FakeExec()
        cap = SnapshotCapturer(exec_fn, script_path="/no/such.js")
        self.assertFalse(cap.inject())
        self.assertFalse(cap.injected)
        self.assertEqual(exec_fn.calls, [])  # script missing → no execute at all

    def test_inject_swallows_execute_errors(self):
        def boom(script, *args):
            raise RuntimeError("no such session")

        cap = SnapshotCapturer(boom, script_path=self._tmp_script())
        self.assertFalse(cap.inject())  # no raise
        self.assertFalse(cap.injected)


class TestSnapshotCapturerPull(unittest.TestCase):
    def test_pull_returns_normalized_mutations(self):
        trace = {"mutations": [{"type": "attributes", "target": "9"}]}
        exec_fn = FakeExec(trace)
        cap = SnapshotCapturer(exec_fn)
        self.assertEqual(cap.pull_mutations(), [{"type": "attributes", "target": "9"}])
        # The read uses the atomic getTraceData expression.
        self.assertIn("getTraceData", exec_fn.calls[0][0])

    def test_pull_null_trace_returns_empty(self):
        cap = SnapshotCapturer(FakeExec(None))
        self.assertEqual(cap.pull_mutations(), [])

    def test_pull_swallows_execute_errors(self):
        def boom(script, *args):
            raise RuntimeError("boom")

        cap = SnapshotCapturer(boom)
        self.assertEqual(cap.pull_mutations(), [])  # no raise


class TestStartSnapshotCapture(unittest.TestCase):
    def _tmp_script(self):
        fh = tempfile.NamedTemporaryFile("w", suffix=".js", delete=False)
        fh.write("C")
        fh.close()
        self.addCleanup(lambda: os.path.exists(fh.name) and os.unlink(fh.name))
        return fh.name

    def test_returns_capturer_when_driver_can_execute(self):
        class Driver:
            def __init__(self):
                self.calls = []

            def execute_script(self, script, *args):
                self.calls.append(script)
                return True  # ready probe

        driver = Driver()
        cap = start_snapshot_capture(driver, script_path=self._tmp_script())
        self.assertIsInstance(cap, SnapshotCapturer)
        self.assertTrue(cap.injected)

    def test_none_when_driver_has_no_execute_script(self):
        self.assertIsNone(start_snapshot_capture(object()))

    def test_the_capturer_survives_a_failed_first_injection(self):
        # Returning None here made the failure terminal: the caller stores None,
        # its post-command refresh skips a missing capturer, and inject() is
        # never called again — so a collector fetch that failed once could never
        # be retried, and a navigation could never re-install it either.
        class Driver:
            def execute_script(self, script, *args):
                return None

        capturer = start_snapshot_capture(Driver(), script_path="/no/such.js")

        self.assertIsNotNone(capturer)
        self.assertFalse(capturer.injected)

    def test_a_later_command_can_still_install_the_collector(self):
        # The retry path only exists if the capturer is still around to use it.
        calls = {"n": 0}

        class Driver:
            def execute_script(self, script, *args):
                calls["n"] += 1
                return True  # the page reports the collector present

        with mock.patch(
            "selenium_devtools.snapshot.load_injectable_script",
            side_effect=[None, "SOURCE"],  # first attempt has no source, then it does
        ):
            capturer = start_snapshot_capture(Driver(), script_path="/no/such.js")
            self.assertFalse(capturer.injected)

            self.assertTrue(capturer.inject())  # the next command retries

        self.assertTrue(capturer.injected)

    def test_none_only_when_the_driver_cannot_run_scripts(self):
        self.assertIsNone(start_snapshot_capture(object()))


if __name__ == "__main__":
    unittest.main()
