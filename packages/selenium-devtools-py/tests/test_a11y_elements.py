"""Per-action element capture — what fills the trace's A11y tab.

The JS adapters run these scripts in-process from `core`. This adapter cannot
import that, so the backend serves them and the capture runs per action here.
A Python trace carried 0 `*-elements.json` where a JS Selenium trace of the
same flow carried 12; this is the gap.
"""

import contextlib
import json
import unittest
from unittest import mock

from selenium_devtools import element_scripts, instrumentation, trace_export
from selenium_devtools.per_test_capture import PerTestCapture
from selenium_devtools._contract import (
    ELEMENT_SCRIPTS_PATH,
    MAPPED_COMMANDS,
    READ_ONLY_COMMANDS,
    RUNNER_ID,
    SCOPE_ACTION_SNAPSHOTS,
)
from selenium_devtools.constants import ACTION_SNAPSHOT_BATCH

from wire_contract import RecordingTransport

SCRIPTS = {"accessibilityTree": "(function(){})", "elements": "(function(){})"}


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

    def _capture(self, driver, *, trace=True, a11y=True, scripts=SCRIPTS, shot="c2hvdA=="):
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
                driver, "clickElement", 1200, shot
            )
            return instrumentation.action_snapshots()

    def test_a_native_app_keeps_the_screenshot_alone(self):
        """Both reads are page script and they fire on every action, so on a
        session with no document they are the densest source of round trips
        that can only fail. The screenshot is the capture there."""

        class NativeDriver(self.Driver):
            capabilities = {"platformName": "Android", "appium:app": "/app.apk"}

        driver = NativeDriver(elements=[{"selector": "#go"}])
        snaps = self._capture(driver)

        self.assertEqual(driver.scripts_run, [])
        self.assertEqual(
            snaps, [{"timestamp": 1200, "command": "clickElement", "screenshot": "c2hvdA=="}]
        )

    def test_a_phone_running_a_browser_is_still_read(self):
        class MobileWebDriver(self.Driver):
            capabilities = {"platformName": "Android", "browserName": "Chrome"}

        driver = MobileWebDriver(elements=[{"selector": "#go"}])
        snaps = self._capture(driver)

        self.assertEqual(len(driver.scripts_run), 2)
        self.assertIn("elements", snaps[0])

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

    def test_a11y_off_reads_no_tree_and_keeps_the_screenshot(self):
        driver = self.Driver(elements=[{"selector": "#go"}])
        snaps = self._capture(driver, a11y=False)
        self.assertEqual(driver.scripts_run, [])
        self.assertEqual([sorted(s) for s in snaps], [["command", "screenshot", "timestamp"]])

    def test_without_the_scripts_it_reads_no_tree(self):
        # A backend too old to serve them.
        driver = self.Driver(elements=[{"selector": "#go"}])
        snaps = self._capture(driver, scripts=None)
        self.assertEqual(driver.scripts_run, [])
        self.assertEqual([sorted(s) for s in snaps], [["command", "screenshot", "timestamp"]])

    # An empty tree carries nothing the A11y tab can show, and a snapshot with
    # no elements makes the exporter write no *-elements.json anyway.
    def test_an_empty_or_failed_read_keeps_only_the_screenshot(self):
        for driver in (self.Driver(elements=[]), self.Driver(elements=None), self.Driver(raises=True)):
            snaps = self._capture(driver)
            self.assertEqual([sorted(s) for s in snaps], [["command", "screenshot", "timestamp"]])
            self.assertEqual(self._capture(driver, shot=None), [])

    @contextlib.contextmanager
    def _armed(self, driver=None):
        with mock.patch.dict(
            instrumentation._state,
            {
                "trace": True,
                "a11y": True,
                "element_scripts": SCRIPTS,
                "action_snapshots": [],
                "test": PerTestCapture(),
            },
        ):
            yield driver or self.Driver(elements=[{"selector": "#go"}])

    def _gate(self, driver, command, shot="c2hvdA=="):
        instrumentation._maybe_capture_action_snapshot(driver, command, 1200, shot)

    def _captured(self):
        return [snap["command"] for snap in instrumentation.action_snapshots()]

    def test_a_click_is_captured_and_the_reads_after_it_are_not(self):
        with self._armed() as driver:
            self._gate(driver, "clickElement")
            self._gate(driver, "getElementText")
            self._gate(driver, "wait")
            self.assertEqual(self._captured(), ["clickElement"])
            self.assertEqual(len(driver.scripts_run), 2, "read the page for a read")

    def test_a_leading_read_is_the_initial_frame_once_until_the_next_test(self):
        with self._armed() as driver:
            self._gate(driver, "getElementText")
            self._gate(driver, "getElementText")
            self.assertEqual(self._captured(), ["getElementText"])

            instrumentation.reset_test_capture()
            self._gate(driver, "getElementText")
            self.assertEqual(self._captured(), ["getElementText", "getElementText"])

    def test_a_missing_initial_screenshot_is_retried_exactly_once(self):
        with self._armed() as driver:
            self._gate(driver, "getElementText", shot=None)
            self._gate(driver, "getElementText", shot="c2hvdA==")
            self._gate(driver, "getElementText", shot="c2hvdA==")
            snaps = instrumentation.action_snapshots()
            self.assertEqual(len(snaps), 2)
            self.assertNotIn("screenshot", snaps[0])
            self.assertIn("screenshot", snaps[1])

    def test_a_form_submit_is_captured_as_a_page_change(self):
        submit = {"script": "/* submitForm */var form = arguments[0];", "args": []}
        other = {"script": "return 1", "args": []}
        self.assertEqual(
            instrumentation._capture_command("w3cExecuteScript", submit), "submit"
        )
        self.assertEqual(
            instrumentation._capture_command("w3cExecuteScript", other),
            "w3cExecuteScript",
        )
        with self._armed() as driver:
            self._gate(driver, "clickElement")
            self._gate(driver, instrumentation._capture_command("w3cExecuteScript", submit))
            self.assertEqual(self._captured(), ["clickElement", "submit"])

    def test_a_second_missing_initial_screenshot_is_not_retried_again(self):
        with self._armed() as driver:
            self._gate(driver, "clickElement", shot=None)
            self._gate(driver, "getElementText", shot=None)
            self._gate(driver, "getElementText", shot="c2hvdA==")
            self.assertEqual(self._captured(), ["clickElement", "getElementText"])

    def test_a_native_initial_frame_is_its_screenshot(self):
        class NativeDriver(self.Driver):
            capabilities = {"platformName": "Android", "appium:app": "/app.apk"}

        with self._armed(NativeDriver(elements=[{"selector": "#go"}])) as driver:
            self._gate(driver, "getElementText")
            self._gate(driver, "findElements")
            self.assertFalse(instrumentation._state["test"].awaiting_initial_frame)
            self.assertEqual(driver.scripts_run, [])
            self.assertEqual(self._captured(), ["getElementText"])

    # Deny-list: a command the set does not name is captured, so only commands
    # known not to change the page may be listed.
    def test_the_generated_sets_agree_with_the_gate(self):
        self.assertIn("findElement", READ_ONLY_COMMANDS)
        self.assertIn("getElementText", READ_ONLY_COMMANDS)
        self.assertIn("isDisplayed", READ_ONLY_COMMANDS)
        self.assertIn("getElementAttribute", READ_ONLY_COMMANDS)
        self.assertTrue(
            READ_ONLY_COMMANDS.isdisjoint({"get", "clickElement", "submit", "actions", "w3cExecuteScript"})
        )
        self.assertIn("getElementText", MAPPED_COMMANDS)
        self.assertNotIn("findElement", MAPPED_COMMANDS)

    def test_a_script_the_user_runs_is_a_page_change_and_captured(self):
        with self._armed() as driver:
            self._gate(driver, "clickElement")
            self._gate(driver, "w3cExecuteScript")
            self._gate(driver, "actions")
            self.assertEqual(self._captured(), ["clickElement", "w3cExecuteScript", "actions"])

    def test_a_lookup_and_a_text_read_after_a_click_are_not_captured(self):
        with self._armed() as driver:
            self._gate(driver, "clickElement")
            self._gate(driver, "findElement")
            self._gate(driver, "getElementText")
            self.assertEqual(self._captured(), ["clickElement"])

    def test_selenium_atom_scripts_are_read_as_the_reads_they_are(self):
        is_displayed = {"script": "/* isDisplayed */return (function(){}).apply(null, arguments);", "args": []}
        get_attribute = {"script": "/* getAttribute */return (function(){}).apply(null, arguments);", "args": []}
        self.assertEqual(instrumentation._capture_command("w3cExecuteScript", is_displayed), "isDisplayed")
        self.assertEqual(instrumentation._capture_command("w3cExecuteScript", get_attribute), "getElementAttribute")
        with self._armed() as driver:
            self._gate(driver, "clickElement")
            self._gate(driver, instrumentation._capture_command("w3cExecuteScript", is_displayed))
            self._gate(driver, instrumentation._capture_command("w3cExecuteScript", get_attribute))
            self.assertEqual(self._captured(), ["clickElement"])
            self.assertEqual(len(driver.scripts_run), 2, "read the page for an atom read")


class TestTheEndOfATest(unittest.TestCase):
    """The last page change can return before its navigation commits, so its
    capture shows the page it left. The reads after it saw the new page, and
    the end of the test is captured again to replace that stale capture."""

    class Driver:
        session_id = "s"

        def __init__(self):
            self.tree = [{"selector": "#before"}]
            self.scripts_run = 0

        def get_screenshot_as_base64(self):
            return "END"

        def execute_script(self, script, *args):
            self.scripts_run += 1
            return self.tree

    @contextlib.contextmanager
    def _ended(self):
        with mock.patch.dict(
            instrumentation._state,
            {
                "trace": True,
                "a11y": True,
                "element_scripts": SCRIPTS,
                "action_snapshots": [],
                "test": PerTestCapture(awaiting_initial_frame=False, started_ms=1000),
            },
        ):
            yield

    def _step(self, driver, command, timestamp):
        instrumentation._state["test"].rows.append((command, timestamp))
        instrumentation._maybe_capture_action_snapshot(driver, command, timestamp, None)

    def test_the_reads_after_a_click_replace_its_stale_capture(self):
        driver = self.Driver()
        with self._ended():
            self._step(driver, "clickElement", 1200)
            driver.tree = [{"selector": "#after"}]
            self._step(driver, "getElementText", 1300)
            instrumentation.capture_final_frame(driver)
            snaps = instrumentation.action_snapshots()
        self.assertEqual([s["command"] for s in snaps], ["clickElement"])
        self.assertEqual(snaps[0]["timestamp"], 1200)
        self.assertEqual(snaps[0]["elements"][0]["selector"], "#after")

    def test_a_test_that_ends_on_a_capture_takes_no_final_one(self):
        driver = self.Driver()
        with self._ended():
            self._step(driver, "clickElement", 1200)
            reads = driver.scripts_run
            instrumentation.capture_final_frame(driver)
            self.assertEqual(driver.scripts_run, reads, "re-read a page nothing followed")
            self.assertEqual(len(instrumentation.action_snapshots()), 1)

    def test_a_test_with_no_capture_is_stamped_at_its_last_command(self):
        driver = self.Driver()
        with self._ended():
            self._step(driver, "findElement", 1200)
            instrumentation.capture_final_frame(driver)
            snaps = instrumentation.action_snapshots()
        self.assertEqual([(s["command"], s["timestamp"]) for s in snaps], [("findElement", 1200)])

    def test_a_test_with_no_rows_takes_no_final_capture(self):
        driver = self.Driver()
        with self._ended():
            instrumentation.capture_final_frame(driver)
            self.assertEqual(driver.scripts_run, 0)
            self.assertEqual(instrumentation.action_snapshots(), [])

    def test_the_final_capture_is_taken_once_per_test(self):
        driver = self.Driver()
        with self._ended():
            self._step(driver, "clickElement", 1200)
            self._step(driver, "getElementText", 1300)
            instrumentation.capture_final_frame(driver)
            reads = driver.scripts_run
            instrumentation.capture_final_frame(driver)
            self.assertEqual(driver.scripts_run, reads, "the quit repeated the call report's capture")

    def test_a_final_capture_without_a_screenshot_leaves_the_record_unchanged(self):
        driver = self.Driver()
        with self._ended():
            instrumentation._state["test"].rows.append(("clickElement", 1200))
            instrumentation._maybe_capture_action_snapshot(driver, "clickElement", 1200, "SHOT")
            before = dict(instrumentation.action_snapshots()[0])
            driver.tree = [{"selector": "#after"}]
            self._step(driver, "getElementText", 1300)
            with mock.patch.object(instrumentation, "_take_screenshot", return_value=None):
                instrumentation.capture_final_frame(driver)
            snaps = instrumentation.action_snapshots()
        self.assertEqual(snaps, [before])

    def test_a_screenshot_only_final_capture_supersedes_the_screenshot(self):
        driver = self.Driver()
        with self._ended():
            instrumentation._state["test"].rows.append(("clickElement", 1200))
            instrumentation._maybe_capture_action_snapshot(driver, "clickElement", 1200, "SHOT")
            driver.tree = []
            self._step(driver, "getElementText", 1300)
            with mock.patch.object(instrumentation, "_take_screenshot", return_value="END"):
                instrumentation.capture_final_frame(driver)
            snaps = instrumentation.action_snapshots()
        self.assertEqual([(s["timestamp"], s["screenshot"]) for s in snaps], [(1200, "END")])
        self.assertEqual(snaps[0]["elements"][0]["selector"], "#before")

    def test_the_final_frame_comes_from_the_driver_that_captured_last(self):
        owner, other = self.Driver(), self.Driver()
        with self._ended():
            self._step(owner, "clickElement", 1200)
            before = owner.scripts_run
            self._step(other, "getElementText", 1300)
            instrumentation.capture_final_frame()
            self.assertEqual(owner.scripts_run, before + 2, "the owner was not re-read")
            self.assertEqual(other.scripts_run, 0, "a read on another driver took the frame")

    def test_another_drivers_quit_leaves_the_final_frame_to_the_owner(self):
        owner, other = self.Driver(), self.Driver()
        with self._ended():
            self._step(owner, "clickElement", 1200)
            self._step(other, "getElementText", 1300)
            instrumentation.capture_final_frame(other)
            self.assertFalse(instrumentation._state["test"].final_frame_taken)
            before = owner.scripts_run
            instrumentation.capture_final_frame(owner)
            self.assertEqual(owner.scripts_run, before + 2)
            self.assertTrue(instrumentation._state["test"].final_frame_taken)

    def test_window_and_aria_reads_take_no_capture(self):
        driver = self.Driver()
        with self._ended():
            self._step(driver, "w3cGetCurrentWindowHandle", 1200)
            self._step(driver, "getElementAriaRole", 1300)
            self.assertEqual(driver.scripts_run, 0)
            self.assertEqual(instrumentation.action_snapshots(), [])

    def test_a_row_before_the_test_started_does_not_stamp_it(self):
        self.assertIsNone(
            instrumentation._final_frame_stamp([("clickElement", 500)], 1000, None)
        )

    def test_the_stamp_follows_core_final_frame_stamp(self):
        stamp = instrumentation._final_frame_stamp
        rows = [("clickElement", 1200), ("getElementText", 1300)]
        self.assertEqual(stamp(rows, 1000, None), ("getElementText", 1300))
        self.assertEqual(stamp(rows, 1000, 1200), ("clickElement", 1200))
        self.assertIsNone(stamp(rows[:1], 1000, 1200))
        self.assertIsNone(stamp([], 1000, None))


class TestStreamingTheSnapshots(unittest.TestCase):
    def test_they_go_out_under_the_action_snapshots_scope(self):
        tx = RecordingTransport()
        snaps = [{"timestamp": i, "command": "click"} for i in range(3)]

        self.assertEqual(trace_export.send_action_snapshots(tx, snaps), 3)
        self.assertEqual(tx.sent[0][0], SCOPE_ACTION_SNAPSHOTS)

    def test_a_long_run_is_batched(self):
        tx = RecordingTransport()
        total = ACTION_SNAPSHOT_BATCH * 2 + 3
        snaps = [{"timestamp": i, "command": "click"} for i in range(total)]

        self.assertEqual(trace_export.send_action_snapshots(tx, snaps), total)
        self.assertEqual(len(tx.sent), 3)

    def test_a_refused_socket_stops_without_raising(self):
        snapshot = {"timestamp": 1, "command": "click"}
        tx = RecordingTransport(sends=False)
        self.assertEqual(trace_export.send_action_snapshots(tx, [snapshot]), 0)
        self.assertEqual(trace_export.send_action_snapshots(None, [snapshot]), 0)


if __name__ == "__main__":
    unittest.main()
