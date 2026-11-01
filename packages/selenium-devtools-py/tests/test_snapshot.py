import os
import tempfile
import unittest
from unittest import mock

from page_scripts_fixture import PAGE_SCRIPTS
from selenium_devtools.snapshot import (
    SnapshotCapturer,
    TracePayload,
    load_injectable_script,
    normalize_mutations,
    normalize_network_requests,
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
        cap = SnapshotCapturer(exec_fn, PAGE_SCRIPTS, script_path=self._tmp_script())
        self.assertTrue(cap.inject())
        self.assertTrue(cap.injected)
        install = [c for c in exec_fn.calls if "createElement('script')" in c[0]]
        self.assertEqual(len(install), 1)
        self.assertEqual(install[0][1], ("(async function() { COLLECTOR })()",))
        self.assertTrue(any("wdioTraceCollector" in c[0] for c in exec_fn.calls))

    def test_inject_skips_install_when_collector_present(self):
        # Self-healing: collector already on the page → probe True → no install.
        exec_fn = FakeExec(True)
        cap = SnapshotCapturer(exec_fn, PAGE_SCRIPTS, script_path=self._tmp_script())
        self.assertTrue(cap.inject())
        self.assertEqual([c for c in exec_fn.calls if "createElement" in c[0]], [])

    def test_inject_reinjects_after_navigation(self):
        # Navigation wipes the collector: probe absent both times → 2 installs.
        exec_fn = FakeExec(False, None, True, False, None, True)
        cap = SnapshotCapturer(exec_fn, PAGE_SCRIPTS, script_path=self._tmp_script())
        cap.inject()
        cap.inject()
        installs = [c for c in exec_fn.calls if "createElement" in c[0]]
        self.assertEqual(len(installs), 2)

    def test_inject_without_a_source_installs_nothing(self):
        # The readiness probe comes first now, so an already-instrumented page
        # costs no source load at all. With no source AND no collector present,
        # nothing is installed and the capturer stays uninjected.
        exec_fn = FakeExec()
        cap = SnapshotCapturer(exec_fn, PAGE_SCRIPTS, script_path="/no/such.js")

        self.assertFalse(cap.inject())
        self.assertFalse(cap.injected)
        self.assertEqual([c for c in exec_fn.calls if "createElement" in c[0]], [])

    def test_inject_swallows_execute_errors(self):
        def boom(script, *args):
            raise RuntimeError("no such session")

        cap = SnapshotCapturer(boom, PAGE_SCRIPTS, script_path=self._tmp_script())
        self.assertFalse(cap.inject())  # no raise
        self.assertFalse(cap.injected)


class TestNormalizeNetworkRequests(unittest.TestCase):
    def test_extracts_the_dict_rows(self):
        row = {"id": "rt-1-0", "url": "https://x/", "method": "", "type": "document"}
        self.assertEqual(normalize_network_requests({"networkRequests": [row]}), [row])

    def test_drops_a_row_that_is_not_a_dict(self):
        payload = {"networkRequests": [{"id": "a"}, "junk", None]}
        self.assertEqual(normalize_network_requests(payload), [{"id": "a"}])

    def test_anything_else_is_empty(self):
        self.assertEqual(normalize_network_requests(None), [])
        self.assertEqual(normalize_network_requests({"mutations": []}), [])
        self.assertEqual(normalize_network_requests({"networkRequests": "no"}), [])


class TestSnapshotCapturerPull(unittest.TestCase):
    def test_pull_returns_normalized_mutations(self):
        trace = {"mutations": [{"type": "attributes", "target": "9"}]}
        exec_fn = FakeExec(trace)
        cap = SnapshotCapturer(exec_fn, PAGE_SCRIPTS)
        self.assertEqual(cap.pull_trace().mutations, [{"type": "attributes", "target": "9"}])
        # The read uses the atomic getTraceData expression.
        self.assertIn("getTraceData", exec_fn.calls[0][0])

    def test_pull_trace_carries_both_halves_of_one_drain(self):
        # One read serves both consumers: `getTraceData()` resets the page-side
        # buffer, so a second read for the network entries would find nothing.
        row = {"id": "rt-1-0", "url": "https://x/a.js", "method": "GET", "type": "script"}
        trace = {"mutations": [{"type": "attributes", "target": "9"}], "networkRequests": [row]}
        exec_fn = FakeExec(trace)
        cap = SnapshotCapturer(exec_fn, PAGE_SCRIPTS)
        self.assertEqual(
            cap.pull_trace(),
            TracePayload([{"type": "attributes", "target": "9"}], [row]),
        )
        self.assertEqual(len(exec_fn.calls), 1)

    def test_pull_trace_is_empty_on_an_unreadable_collector(self):
        def boom(script, *args):
            raise RuntimeError("boom")

        self.assertEqual(SnapshotCapturer(boom, PAGE_SCRIPTS).pull_trace(), TracePayload([], []))

    def test_pull_null_trace_returns_empty(self):
        cap = SnapshotCapturer(FakeExec(None), PAGE_SCRIPTS)
        self.assertEqual(cap.pull_trace().mutations, [])

    def test_pull_swallows_execute_errors(self):
        def boom(script, *args):
            raise RuntimeError("boom")

        cap = SnapshotCapturer(boom, PAGE_SCRIPTS)
        self.assertEqual(cap.pull_trace().mutations, [])  # no raise


class FakeCollector:
    """A page-side collector modelled closely enough to tell an anchored drain
    from an unanchored one.

    The real collector schedules its first full-DOM anchor asynchronously (after
    `waitForBody`), so a drain arriving before that has run finds an empty
    buffer unless it anchors the document itself. `captureCurrentDom` is guarded
    by an `#anchored` flag that survives the buffer reset, which is what makes
    forcing it on every drain free rather than a full DOM per command.
    """

    def __init__(self, present: bool = True, url: str = "https://x/secure"):
        self.present = present
        self.url = url
        self.anchored = False
        self.anchor_calls = 0
        self.drains = 0
        self._buffer: list = []

    def __call__(self, script, *args):
        if "captureCurrentDom" not in script and "getTraceData" not in script:
            return None  # an injection or readiness probe, not our concern
        if not self.present:
            return None  # the collector is not in this document
        if "captureCurrentDom" in script:
            self.anchor_calls += 1
            if not self.anchored:
                self.anchored = True
                self._buffer.append(
                    {"type": "childList", "url": self.url, "addedNodes": ["<html>"]}
                )
        self.drains += 1
        payload = {"mutations": list(self._buffer)}
        self._buffer.clear()  # getTraceData resets the page-side buffer
        return payload


class TestTheDrainAnchorsTheDocument(unittest.TestCase):
    """A navigation destination has to be anchored by the drain itself.

    Without it a short-lived page is never anchored at all: its own async anchor
    has not run when the drain arrives, and its buffer dies with the page — so
    every action on that document replays the one before it.
    """

    def test_a_document_that_has_not_self_anchored_is_anchored_by_the_drain(self):
        collector = FakeCollector()
        cap = SnapshotCapturer(collector, PAGE_SCRIPTS)

        mutations = cap.pull_trace().mutations

        self.assertEqual(len(mutations), 1)
        self.assertEqual(mutations[0]["url"], "https://x/secure")
        self.assertEqual(collector.anchor_calls, 1)

    def test_anchoring_is_forced_on_every_drain_but_emits_the_document_once(self):
        # Idempotence is what makes forcing unconditional affordable: the anchor
        # is requested every time and the page answers with it only once.
        collector = FakeCollector()
        cap = SnapshotCapturer(collector, PAGE_SCRIPTS)

        first = cap.pull_trace().mutations
        second = cap.pull_trace().mutations

        self.assertEqual(len(first), 1)
        self.assertEqual(second, [])
        self.assertEqual(collector.anchor_calls, 2)

    def test_an_absent_collector_still_answers_empty(self):
        cap = SnapshotCapturer(FakeCollector(present=False), PAGE_SCRIPTS)

        self.assertEqual(cap.pull_trace().mutations, [])

    def test_a_recovered_collector_is_anchored_by_the_retry(self):
        # The collector was missing, an injection installed it, and the retry is
        # the only chance to anchor a document whose own anchor has not run.
        collector = FakeCollector(present=False)
        cap = SnapshotCapturer(collector, PAGE_SCRIPTS)

        def install() -> bool:
            collector.present = True
            return True

        with mock.patch.object(cap, "_install_now", side_effect=install):
            mutations = cap.pull_trace().mutations

        self.assertEqual(len(mutations), 1)
        self.assertEqual(collector.anchor_calls, 1)


class TestTheServedScriptsAreWhatRuns(unittest.TestCase):
    """The probe, injection and drain are the backend's strings, byte for byte:
    this adapter keeps no copy of its own to drift from the JS adapters'."""

    def test_probe_injection_and_drain_are_the_handed_scripts(self):
        # probe (absent) -> install (not ready yet) -> probe (ready) -> drain
        exec_fn = FakeExec(False, None, True, {"mutations": []})
        cap = SnapshotCapturer(exec_fn, PAGE_SCRIPTS)

        with mock.patch(
            "selenium_devtools.snapshot.load_injectable_script", return_value="SRC"
        ):
            self.assertTrue(cap.inject())
        cap.pull_trace()

        self.assertEqual(
            exec_fn.calls,
            [
                (PAGE_SCRIPTS["collectorReady"], ()),
                (PAGE_SCRIPTS["collectorInject"], ("SRC",)),
                (PAGE_SCRIPTS["collectorReady"], ()),
                (PAGE_SCRIPTS["collectorDrain"], ()),
            ],
        )

    def test_an_injection_that_answers_ready_needs_no_second_probe(self):
        # The served injection returns readiness itself; an appended script
        # runs synchronously, so this is the usual case.
        exec_fn = FakeExec(False, True)
        cap = SnapshotCapturer(exec_fn, PAGE_SCRIPTS)

        with mock.patch(
            "selenium_devtools.snapshot.load_injectable_script", return_value="SRC"
        ):
            self.assertTrue(cap.inject())

        self.assertEqual(len(exec_fn.calls), 2)


class TestStartSnapshotCapture(unittest.TestCase):
    def _tmp_script(self):
        fh = tempfile.NamedTemporaryFile("w", suffix=".js", delete=False)
        fh.write("C")
        fh.close()
        self.addCleanup(lambda: os.path.exists(fh.name) and os.unlink(fh.name))
        return fh.name

    def test_none_and_no_script_without_the_page_scripts(self):
        # A backend that could not serve them (one older than the route): there
        # is nothing to probe, inject or drain with, so DOM capture is off.
        class Driver:
            def __init__(self):
                self.calls = []

            def execute_script(self, script, *args):
                self.calls.append(script)
                return True

        driver = Driver()

        self.assertIsNone(start_snapshot_capture(driver, None))
        self.assertEqual(driver.calls, [])

    def test_returns_capturer_when_driver_can_execute(self):
        class Driver:
            def __init__(self):
                self.calls = []

            def execute_script(self, script, *args):
                self.calls.append(script)
                return True  # ready probe

        driver = Driver()
        cap = start_snapshot_capture(driver, PAGE_SCRIPTS, script_path=self._tmp_script())
        self.assertIsInstance(cap, SnapshotCapturer)
        self.assertTrue(cap.injected)

    def test_none_when_driver_has_no_execute_script(self):
        self.assertIsNone(start_snapshot_capture(object(), PAGE_SCRIPTS))

    def test_none_for_a_native_app_and_no_script_reaches_the_device(self):
        # There is no document to collect from, and the caller already treats
        # None as "nothing to drain" — so the injection, its readiness probe
        # and every later drain are all skipped from this one decision.
        class Driver:
            capabilities = {"platformName": "iOS", "appium:app": "/app.app"}

            def __init__(self):
                self.calls = []

            def execute_script(self, script, *args):
                self.calls.append(script)
                return True

        driver = Driver()

        self.assertIsNone(start_snapshot_capture(driver, PAGE_SCRIPTS))
        self.assertEqual(driver.calls, [])

    def test_a_phone_running_a_browser_still_gets_a_capturer(self):
        # Same phone, but it named a browser: it has a real page, and this is
        # the only DOM capture such a session gets.
        class Driver:
            capabilities = {"platformName": "iOS", "browserName": "Safari"}

            def execute_script(self, script, *args):
                return True

        self.assertIsInstance(
            start_snapshot_capture(Driver(), PAGE_SCRIPTS, script_path=self._tmp_script()),
            SnapshotCapturer,
        )

    def test_the_capturer_survives_a_failed_first_injection(self):
        # Returning None here made the failure terminal: the caller stores None,
        # its post-command refresh skips a missing capturer, and inject() is
        # never called again — so a collector fetch that failed once could never
        # be retried, and a navigation could never re-install it either.
        class Driver:
            def execute_script(self, script, *args):
                return None

        capturer = start_snapshot_capture(Driver(), PAGE_SCRIPTS, script_path="/no/such.js")

        self.assertIsNotNone(capturer)
        self.assertFalse(capturer.injected)

    def test_a_later_command_can_still_install_the_collector(self):
        # The retry path only exists if the capturer is still around to use it.
        ready = {"present": False}

        class Driver:
            def execute_script(self, script, *args):
                if "createElement" in script:
                    ready["present"] = True  # the install lands
                    return True
                return ready["present"]  # the readiness probe

        with mock.patch(
            "selenium_devtools.snapshot.load_injectable_script",
            side_effect=[None, "SOURCE"],  # no source first, then it arrives
        ):
            capturer = start_snapshot_capture(Driver(), PAGE_SCRIPTS, script_path="/no/such.js")
            self.assertFalse(capturer.injected)  # nothing to install yet

            self.assertTrue(capturer.inject())  # the next command retries

        self.assertTrue(capturer.injected)

    def test_none_only_when_the_driver_cannot_run_scripts(self):
        self.assertIsNone(start_snapshot_capture(object(), PAGE_SCRIPTS))


if __name__ == "__main__":
    unittest.main()
