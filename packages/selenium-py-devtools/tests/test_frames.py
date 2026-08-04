import json
import unittest

from wdio_selenium_devtools import frames
from wdio_selenium_devtools.utils import to_jsonable


class TestFrames(unittest.TestCase):
    def test_metadata_shape(self):
        m = frames.metadata("sess-1", {"browserName": "chrome"}, "https://x/")
        self.assertEqual(m["type"], "testrunner")
        self.assertEqual(m["sessionId"], "sess-1")
        self.assertEqual(m["capabilities"]["browserName"], "chrome")

    def test_command_log_includes_error_only_when_present(self):
        ok = frames.command_log(
            command="get", args=["u"], result=None, timestamp=2, start_time=1,
            call_source="f.py:1", command_id=3,
        )
        self.assertNotIn("error", ok)
        self.assertEqual(ok["id"], 3)
        bad = frames.command_log(
            command="get", args=[], error=ValueError("nope"),
            timestamp=2, start_time=1, call_source=None, command_id=4,
        )
        self.assertEqual(bad["error"], {"name": "ValueError", "message": "nope"})

    def test_suite_and_test_stats_are_json_serializable(self):
        t = frames.test_stats(
            uid="n::t", title="t", full_title="m › t", parent="m",
            state="passed", file="m.py", start_ms=1000, end_ms=2200,
        )
        s = frames.suite_stats(uid="m.py", title="m.py", file="m.py",
                               start_ms=1000, tests=[t], end_ms=2200, state="passed")
        self.assertEqual(t["_duration"], 1200)
        self.assertEqual(s["type"], "suite")
        self.assertEqual(s["tests"][0]["state"], "passed")
        # start/end must be ISO strings, not numbers (TS Date on the wire).
        self.assertRegex(t["start"], r"^\d{4}-\d{2}-\d{2}T")
        json.dumps(s)  # raises if any field is non-serializable


class TestJsonable(unittest.TestCase):
    def test_passes_through_primitives_and_containers(self):
        self.assertEqual(to_jsonable({"a": [1, "b", True, None]}),
                         {"a": [1, "b", True, None]})

    def test_falls_back_to_str_for_exotic(self):
        class Weird:
            def __repr__(self):
                return "<weird>"

        self.assertEqual(to_jsonable(Weird()), "<weird>")


if __name__ == "__main__":
    unittest.main()
