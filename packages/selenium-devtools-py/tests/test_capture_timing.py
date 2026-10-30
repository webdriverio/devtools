"""Opt-in capture timing: the same records and summary the JS adapters write.
The summary math is held to the TypeScript side by mirror-vectors.json; these
cover the switch, the recording and the report."""

import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

from selenium_devtools import capture_timing, instrumentation
from selenium_devtools.constants import ENV_CAPTURE_TIMING

SCRIPTS = {"accessibilityTree": "(function(){})", "elements": "(function(){})"}


def _drain(out_dir):
    printed = []
    path = capture_timing.report(out_dir, printed.append)
    if path is None:
        return [], printed
    with open(path, encoding="utf-8") as fh:
        records = [json.loads(line) for line in fh]
    os.remove(path)
    return records, printed


class Base(unittest.TestCase):
    def setUp(self):
        self.out = tempfile.mkdtemp(prefix="capture-timing-")
        capture_timing.report(self.out, lambda _t: None)

    def tearDown(self):
        capture_timing.report(self.out, lambda _t: None)
        shutil.rmtree(self.out, ignore_errors=True)

    def env(self, value):
        patcher = mock.patch.dict(os.environ, {ENV_CAPTURE_TIMING: value})
        patcher.start()
        self.addCleanup(patcher.stop)


class TestTheSwitch(Base):
    def test_off_unless_set(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertFalse(capture_timing.enabled())
        for value in ("", "0", "false", "no", "OFF"):
            with self.subTest(value):
                self.env(value)
                self.assertFalse(capture_timing.enabled())

    def test_on_for_any_other_value(self):
        for value in ("1", "true", "yes"):
            with self.subTest(value):
                self.env(value)
                self.assertTrue(capture_timing.enabled())

    def test_names_one_file_per_process(self):
        self.assertEqual(capture_timing.file_name(4242), "capture-timing-4242.ndjson")


class TestRecording(Base):
    def test_sequential_reads_are_their_own_service_time(self):
        clock = iter([0.0, 0.0, 0.010, 0.010, 0.250, 0.255])
        with mock.patch("selenium_devtools.capture_timing.time.perf_counter", lambda: next(clock)):
            timer = capture_timing.CaptureTimer("click", "action", False)
            timer.read("screenshot", lambda: "AA")
            timer.read("elements", lambda: [])
            timer.finish()
        records, _ = _drain(self.out)
        self.assertEqual(
            records[0]["probes"],
            [
                {"probe": "screenshot", "issued": 0, "settled": 10, "service": 10, "empty": False},
                {"probe": "elements", "issued": 10, "settled": 250, "service": 240, "empty": True},
            ],
        )
        self.assertEqual(records[0]["total"], 255)
        self.assertEqual(records[0]["trigger"], "action")

    def test_a_read_that_raises_is_recorded_and_still_raises(self):
        timer = capture_timing.CaptureTimer("click", "action", False)

        def boom():
            raise RuntimeError("no such session")

        with self.assertRaises(RuntimeError):
            timer.read("elements", boom)
        timer.finish()
        records, _ = _drain(self.out)
        self.assertTrue(records[0]["probes"][0]["empty"])


class TestReporting(Base):
    def test_appends_and_starts_afresh_after_each_report(self):
        capture_timing.CaptureTimer("click", "action", False).finish()
        printed = []
        path = capture_timing.report(self.out, printed.append)
        capture_timing.CaptureTimer("click", "action", False).finish()
        capture_timing.CaptureTimer("click", "final", False).finish()
        capture_timing.report(self.out, printed.append)
        with open(path, encoding="utf-8") as fh:
            self.assertEqual(len(fh.readlines()), 3)
        self.assertIn("1 captures", printed[0])
        self.assertIn("2 captures", printed[1])
        self.assertIsNone(capture_timing.report(self.out, printed.append))

    def test_still_prints_when_the_file_cannot_be_written(self):
        capture_timing.CaptureTimer("click", "action", False).finish()
        blocked = os.path.join(self.out, "a-file")
        open(blocked, "w").close()
        printed = []
        self.assertIsNone(capture_timing.report(blocked, printed.append))
        self.assertIn("could not write", printed[0])
        self.assertIn("1 captures", printed[1])


class TestTheAdapterCapture(Base):
    class Driver:
        session_id = "s"

        def execute_script(self, script, *args):
            return [{"selector": "#go"}]

    def test_no_timer_while_off_or_outside_trace_mode(self):
        with mock.patch.dict(instrumentation._state, {"trace": True}):
            self.env("0")
            self.assertIsNone(instrumentation._capture_timer(self.Driver(), "click", None))
        with mock.patch.dict(instrumentation._state, {"trace": False}):
            self.env("1")
            self.assertIsNone(instrumentation._capture_timer(self.Driver(), "click", None))

    def test_a_command_a_wait_issued_is_a_wait_poll(self):
        self.env("1")
        with mock.patch.dict(instrumentation._state, {"trace": True}), mock.patch(
            "selenium_devtools.wait_tracking.parent_of", return_value=7
        ):
            timer = instrumentation._capture_timer(self.Driver(), "findElement", object())
        self.assertEqual(timer.trigger, "wait-poll")

    def test_both_page_reads_are_timed(self):
        self.env("1")
        with mock.patch.dict(
            instrumentation._state,
            {"trace": True, "a11y": True, "element_scripts": SCRIPTS, "action_snapshots": []},
        ):
            timer = instrumentation._capture_timer(self.Driver(), "click", None)
            timer.read("screenshot", lambda: "AA")
            instrumentation._capture_action_snapshot(self.Driver(), "click", 1200, "AA", timer)
            timer.finish()
        records, _ = _drain(self.out)
        self.assertEqual(
            [p["probe"] for p in records[0]["probes"]],
            ["screenshot", "elements", "accessibilityTree"],
        )


if __name__ == "__main__":
    unittest.main()
