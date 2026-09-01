import json
import unittest

from selenium_devtools import frames
from selenium_devtools.utils import to_jsonable


class TestFrames(unittest.TestCase):
    def test_metadata_shape(self):
        m = frames.metadata("sess-1", {"browserName": "chrome"}, "https://x/")
        self.assertEqual(m["type"], "testrunner")
        self.assertEqual(m["sessionId"], "sess-1")
        self.assertEqual(m["capabilities"]["browserName"], "chrome")

    def test_metadata_names_the_runner(self):
        # The app narrows this through `isTestRunnerId`; an absent or foreign
        # value falls back to the same defaults, which is what left the locator
        # dialect and the a11y XPath hint wrong for a Python run.
        m = frames.metadata("sess-1")
        self.assertEqual(m["runner"], "selenium-webdriver")

    def test_metadata_refuses_the_launch_controls(self):
        # Without this the app falls back to DEFAULT_CAPABILITIES (all true), so
        # Run / Rerun / Run-all render enabled and fail on click.
        caps = frames.metadata("sess-1")["options"]["runCapabilities"]
        self.assertEqual(
            caps,
            {"canRunSuites": False, "canRunTests": False, "canRunAll": False},
        )

    def test_metadata_does_not_share_the_capability_constant(self):
        # A caller mutating one frame's options must not rewrite the module
        # constant for every later session.
        frames.metadata("sess-1")["options"]["runCapabilities"]["canRunAll"] = True
        self.assertFalse(
            frames.metadata("sess-2")["options"]["runCapabilities"]["canRunAll"]
        )

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


class MetadataViewportTest(unittest.TestCase):
    """Without a viewport the trace reader frames the replay at a hard-coded
    1280x720, which is whatever the run's window was not."""

    def test_a_viewport_is_carried(self):
        entry = frames.metadata("s1", viewport={"width": 1280, "height": 1024})

        self.assertEqual(entry["viewport"], {"width": 1280, "height": 1024})

    def test_it_is_copied_rather_than_aliased(self):
        source = {"width": 800, "height": 600}
        entry = frames.metadata("s1", viewport=source)
        source["width"] = 1

        self.assertEqual(entry["viewport"]["width"], 800)

    def test_an_unknown_viewport_is_omitted_not_zeroed(self):
        # The reader's own default beats a zero-sized frame, and the app reads
        # absent as unknown.
        self.assertNotIn("viewport", frames.metadata("s1"))
        self.assertNotIn("viewport", frames.metadata("s1", viewport=None))


if __name__ == "__main__":
    unittest.main()
