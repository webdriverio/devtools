"""Per-action element capture — what fills the trace's A11y tab.

The JS adapters run these scripts in-process from `core`. This adapter cannot
import that, so the backend serves them and the capture runs per action here.
A Python trace carried 0 `*-elements.json` where a JS Selenium trace of the
same flow carried 12; this is the gap.
"""

import json
import unittest
from unittest import mock

from selenium_devtools import element_scripts, instrumentation, trace_export
from selenium_devtools._contract import (
    ELEMENT_SCRIPTS_PATH,
    RUNNER_ID,
    SCOPE_ACTION_SNAPSHOTS,
)
from selenium_devtools.constants import ACTION_SNAPSHOT_BATCH

SCRIPTS = {"accessibilityTree": "(function(){})", "elements": "(function(){})"}


class FakeTransport:
    def __init__(self, *, sends=True):
        self.connected = True
        self.sent = []
        self._sends = sends

    def send_json(self, scope, data):
        self.sent.append((scope, data))
        return self._sends

    def close(self):
        self.connected = False


class TestFetchingTheScripts(unittest.TestCase):
    def setUp(self):
        element_scripts.reset_cache()

    def tearDown(self):
        element_scripts.reset_cache()

    def _urlopen(self, body, *, raises=None):
        class Response:
            def __enter__(self_inner):
                return self_inner

            def __exit__(self_inner, *a):
                return False

            def read(self_inner):
                return body.encode()

        if raises is not None:
            return mock.patch("urllib.request.urlopen", side_effect=raises)
        return mock.patch("urllib.request.urlopen", return_value=Response())

    def test_the_url_names_this_adapters_runner(self):
        # The scripts bake in a locator dialect; asking without the runner
        # yields locators that look right and select nothing.
        url = element_scripts.scripts_url("localhost", 1234)
        self.assertIn(ELEMENT_SCRIPTS_PATH, url)
        self.assertIn(f"runner={RUNNER_ID}", url)

    def test_a_bare_ipv6_host_is_bracketed(self):
        # Otherwise urllib reads the last colon as the port separator.
        self.assertIn("[::1]:1234", element_scripts.scripts_url("::1", 1234))

    def test_a_well_formed_response_is_returned_and_cached(self):
        with self._urlopen(json.dumps(SCRIPTS)) as opened:
            first = element_scripts.fetch("localhost", 1)
            second = element_scripts.fetch("localhost", 1)
        self.assertEqual(first, SCRIPTS)
        self.assertEqual(second, SCRIPTS)
        self.assertEqual(opened.call_count, 1, "re-fetched a cached script")

    # A backend too old to serve them should cost one request, not one per
    # action — so a failure is cached too.
    def test_a_failure_is_cached_rather_than_retried_per_action(self):
        with self._urlopen("", raises=OSError("no route")) as opened:
            self.assertIsNone(element_scripts.fetch("localhost", 1))
            self.assertIsNone(element_scripts.fetch("localhost", 1))
        self.assertEqual(opened.call_count, 1)

    def test_a_response_of_the_wrong_shape_is_refused(self):
        for body in ['{"elements": "x"}', '{"elements": 1, "accessibilityTree": 2}',
                     '"not-an-object"', "{}"]:
            with self.subTest(body=body):
                element_scripts.reset_cache()
                with self._urlopen(body):
                    self.assertIsNone(element_scripts.fetch("localhost", 1))

    def test_a_different_backend_re_fetches(self):
        # A rerun attaches to another one, and a script from a different
        # version is worse than none.
        with self._urlopen(json.dumps(SCRIPTS)) as opened:
            element_scripts.fetch("localhost", 1)
            element_scripts.fetch("localhost", 2)
        self.assertEqual(opened.call_count, 2)


class TestCapturingPerAction(unittest.TestCase):
    class Driver:
        def __init__(self, elements=None, raises=False):
            self.session_id = "s"
            self._elements = elements
            self._raises = raises
            self.scripts_run = []

        def execute_script(self, script, *args):
            self.scripts_run.append(script)
            if self._raises:
                raise RuntimeError("no such session")
            return self._elements

    def _capture(self, driver, *, trace=True, a11y=True, scripts=SCRIPTS):
        with mock.patch.dict(
            instrumentation._state,
            {
                "trace": trace,
                "a11y": a11y,
                "element_scripts": scripts,
                "action_snapshots": [],
            },
        ):
            instrumentation._capture_action_snapshot(
                driver, "clickElement", 1200, "c2hvdA=="
            )
            return instrumentation.action_snapshots()

    # Two reads, two panes. Capturing only `elements` left the A11y tab
    # reporting "no accessibility snapshot for this command" while 39 element
    # files sat in the same archive — the tab reads the serialized TREE.
    def test_both_the_elements_and_the_accessibility_tree_are_read(self):
        driver = self.Driver(elements=[{"selector": "#go"}])
        snaps = self._capture(driver)
        self.assertEqual(len(driver.scripts_run), 2, "read only one of the two")
        self.assertIn("elements", snaps[0])
        self.assertIn("accessibilityTree", snaps[0])

    def test_one_read_failing_does_not_lose_the_other(self):
        class Half:
            session_id = "s"

            def __init__(self):
                self.calls = 0

            def execute_script(self, script, *args):
                self.calls += 1
                if self.calls == 1:
                    raise RuntimeError("element read blew up")
                return [{"role": "button"}]

        snaps = self._capture(Half())
        self.assertEqual(len(snaps), 1)
        self.assertNotIn("elements", snaps[0])
        self.assertIn("accessibilityTree", snaps[0])

    def test_an_element_tree_is_captured_beside_the_action(self):
        driver = self.Driver(elements=[{"selector": "#go", "role": "button"}])
        snaps = self._capture(driver)
        self.assertEqual(len(snaps), 1)
        self.assertEqual(snaps[0]["command"], "clickElement")
        self.assertEqual(snaps[0]["timestamp"], 1200)
        self.assertEqual(snaps[0]["screenshot"], "c2hvdA==")
        self.assertEqual(snaps[0]["elements"][0]["selector"], "#go")

    # The reads must not land back in the capture hook and grow the timeline an
    # `executeScript` row per action — the bug the CDP window-handle read caused.
    def test_the_reads_run_through_the_guarded_executor(self):
        driver = self.Driver(elements=[{"selector": "#go"}])
        seen = []
        original = instrumentation._guarded_execute_script

        def spy(d):
            seen.append(True)
            return original(d)

        with mock.patch.object(instrumentation, "_guarded_execute_script", spy):
            self._capture(driver)
        self.assertTrue(seen, "read the page without the capture guard")

    def test_nothing_is_captured_outside_trace_mode(self):
        driver = self.Driver(elements=[{"selector": "#go"}])
        self.assertEqual(self._capture(driver, trace=False), [])
        self.assertEqual(driver.scripts_run, [], "paid for a read in live mode")

    def test_nothing_is_captured_with_a11y_off(self):
        driver = self.Driver(elements=[{"selector": "#go"}])
        self.assertEqual(self._capture(driver, a11y=False), [])
        self.assertEqual(driver.scripts_run, [])

    def test_without_the_scripts_it_is_a_no_op(self):
        # A backend too old to serve them.
        driver = self.Driver(elements=[{"selector": "#go"}])
        self.assertEqual(self._capture(driver, scripts=None), [])
        self.assertEqual(driver.scripts_run, [])

    # An empty tree carries nothing the A11y tab can show, and a snapshot with
    # no elements makes the exporter write no *-elements.json anyway.
    def test_an_empty_or_failed_read_records_no_snapshot(self):
        self.assertEqual(self._capture(self.Driver(elements=[])), [])
        self.assertEqual(self._capture(self.Driver(elements=None)), [])
        self.assertEqual(self._capture(self.Driver(raises=True)), [])


class TestStreamingTheSnapshots(unittest.TestCase):
    def test_they_go_out_under_the_action_snapshots_scope(self):
        tx = FakeTransport()
        snaps = [{"timestamp": i, "command": "click"} for i in range(3)]

        self.assertEqual(trace_export.send_action_snapshots(tx, snaps), 3)
        self.assertEqual(tx.sent[0][0], SCOPE_ACTION_SNAPSHOTS)

    def test_a_long_run_is_batched(self):
        tx = FakeTransport()
        total = ACTION_SNAPSHOT_BATCH * 2 + 3
        snaps = [{"timestamp": i, "command": "click"} for i in range(total)]

        self.assertEqual(trace_export.send_action_snapshots(tx, snaps), total)
        self.assertEqual(len(tx.sent), 3)

    def test_a_refused_socket_stops_without_raising(self):
        tx = FakeTransport(sends=False)
        self.assertEqual(trace_export.send_action_snapshots(tx, [{"a": 1}]), 0)
        self.assertEqual(trace_export.send_action_snapshots(None, [{"a": 1}]), 0)


if __name__ == "__main__":
    unittest.main()
