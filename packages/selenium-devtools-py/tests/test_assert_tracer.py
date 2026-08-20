"""Passing `assert` rows for a plain script.

A script's assert is compiled before `enable()` runs, so nothing can rewrite it
and a passing one emits no call. The tracer reads the interpreter's line events
instead. These run it for real — installing a trace function is the mechanism, so
faking it would test nothing.
"""

import sys
import unittest

from selenium_devtools.assert_tracer import ScriptAssertionTracer


class _Recorder:
    def __init__(self):
        self.calls = []

    def __call__(self, *, passed, source, operands, location, error):
        self.calls.append(
            {"passed": passed, "source": source, "operands": operands,
             "location": location, "error": error}
        )


class TestWhatItDeclines(unittest.TestCase):
    def test_it_never_replaces_an_existing_trace_function(self):
        """A trace function already installed is a debugger or coverage tool.
        Taking it over would break the user's breakpoints to add a dashboard
        row, which is not a trade worth making."""
        recorder = _Recorder()
        tracer = ScriptAssertionTracer(recorder, __file__)
        marker = lambda *a: None  # noqa: E731 — stands in for a debugger

        sys.settrace(marker)
        try:
            self.assertFalse(tracer.install())
            self.assertIs(sys.gettrace(), marker)  # left exactly as found
        finally:
            sys.settrace(None)

    def test_it_declines_without_a_script(self):
        self.assertFalse(ScriptAssertionTracer(_Recorder(), None).install())

    def test_it_declines_a_script_that_does_not_exist(self):
        self.assertFalse(
            ScriptAssertionTracer(_Recorder(), "/no/such/script.py").install()
        )

    def test_uninstall_is_safe_without_install(self):
        ScriptAssertionTracer(_Recorder(), __file__).uninstall()  # must not raise


@unittest.skipIf(sys.gettrace() is not None, "another trace function is active")
class TestWhatItReports(unittest.TestCase):
    """Traced against THIS file, with the asserts inside called functions — a
    new frame is what `sys.settrace` reaches."""

    def setUp(self):
        self.recorder = _Recorder()
        self.tracer = ScriptAssertionTracer(self.recorder, __file__)
        self.assertTrue(self.tracer.install())
        self.addCleanup(self.tracer.uninstall)

    def test_a_passing_assert_is_reported(self):
        def run():
            flash = "You logged into a secure area!"
            assert "secure area" in flash, flash

        run()
        self.tracer.uninstall()

        [call] = [c for c in self.recorder.calls if c["source"]]
        self.assertTrue(call["passed"])
        self.assertIsNone(call["error"])
        self.assertEqual(call["source"], "'secure area' in flash")
        self.assertEqual(
            call["operands"], ("in", "secure area", "You logged into a secure area!")
        )

    def test_a_failing_assert_is_reported_with_its_error(self):
        def run():
            flash = "nope"
            assert "secure area" in flash, flash

        with self.assertRaises(AssertionError):
            run()
        self.tracer.uninstall()

        [call] = [c for c in self.recorder.calls if c["source"]]
        self.assertFalse(call["passed"])
        self.assertIsInstance(call["error"], AssertionError)

    def test_an_assert_in_a_loop_reports_once_per_execution(self):
        def run():
            for value in (1, 2, 3):
                assert value > 0

        run()
        self.tracer.uninstall()

        reported = [c for c in self.recorder.calls if c["source"]]
        self.assertEqual(len(reported), 3)
        self.assertTrue(all(c["passed"] for c in reported))

    def test_a_non_assertion_exception_is_not_reported_as_failed(self):
        # A TimeoutError on the line after an assert must not be attributed to
        # the assert, and must not be reported as an assertion at all.
        def run():
            assert True
            raise RuntimeError("unrelated")

        with self.assertRaises(RuntimeError):
            run()
        self.tracer.uninstall()

        reported = [c for c in self.recorder.calls if c["source"]]
        self.assertEqual(len(reported), 1)
        self.assertTrue(reported[0]["passed"])  # the assert did pass

    def test_a_side_effecting_operand_is_never_read(self):
        reads = []

        class Page:
            @property
            def url(self):
                reads.append(1)
                return "/secure"

        def run():
            page = Page()
            assert "/secure" in page.url

        run()
        self.tracer.uninstall()

        # Once, by the assert itself — the tracer added no read of its own.
        self.assertEqual(len(reads), 1)
        [call] = [c for c in self.recorder.calls if c["source"]]
        self.assertIsNone(call["operands"])

    def test_lines_that_are_not_asserts_report_nothing(self):
        def run():
            total = 1 + 1
            return total

        run()
        self.tracer.uninstall()

        self.assertEqual([c for c in self.recorder.calls if c["source"]], [])


if __name__ == "__main__":
    unittest.main()
