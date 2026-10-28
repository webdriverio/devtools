"""An assertion row names the element its compared value was read from."""

from __future__ import annotations

import sys
import unittest
from unittest import mock

from selenium_devtools import instrumentation, read_value_locators
from selenium_devtools import pytest_plugin as plugin
from selenium_devtools.capturer import SessionCapturer
from selenium_devtools.constants import READ_VALUE_CACHE_SIZE, READ_VALUE_MAX_LENGTH

from wire_contract import RecordingTransport


class RegistryTest(unittest.TestCase):
    def setUp(self):
        read_value_locators.reset()
        self.addCleanup(read_value_locators.reset)

    def test_the_newest_producer_of_a_value_wins(self):
        read_value_locators.remember("Hello", "h1")
        read_value_locators.remember("Hello", "#flash")
        self.assertEqual(read_value_locators.selector_for("Hello"), "#flash")

    def test_a_driver_level_read_clears_an_older_element_claim(self):
        read_value_locators.remember("Example Domain", "h1")
        read_value_locators.remember("Example Domain", None)
        self.assertIsNone(read_value_locators.selector_for("Example Domain"))

    def test_a_bool_and_an_int_do_not_share_an_entry(self):
        # `True == 1` in Python; the JS registry tells them apart, so this must.
        read_value_locators.remember(True, "#agree")
        self.assertIsNone(read_value_locators.selector_for(1))
        self.assertEqual(read_value_locators.selector_for(True), "#agree")

    def test_only_short_primitives_are_remembered(self):
        for value in ("", "x" * (READ_VALUE_MAX_LENGTH + 1), {"a": 1}, ["a"], None):
            with self.subTest(value=value):
                read_value_locators.remember(value, "#el")
                self.assertIsNone(read_value_locators.selector_for(value))

    def test_the_oldest_value_is_evicted(self):
        for i in range(READ_VALUE_CACHE_SIZE + 1):
            read_value_locators.remember(f"v{i}", f"#e{i}")
        self.assertIsNone(read_value_locators.selector_for("v0"))
        self.assertEqual(read_value_locators.selector_for("v1"), "#e1")

    def test_the_first_operand_that_resolves_wins(self):
        read_value_locators.remember("b", "#b")
        self.assertEqual(read_value_locators.assertion_target("a", "b"), "#b")
        self.assertIsNone(read_value_locators.assertion_target("a", "c"))

    def test_an_observed_value_no_element_produced_stops_the_search(self):
        # `assert driver.title != "Welcome"`, with "Welcome" once read from h1.
        read_value_locators.remember("Welcome", "h1")
        read_value_locators.remember("Example Domain", None)
        self.assertIsNone(
            read_value_locators.assertion_target("Example Domain", "Welcome")
        )


class _Element:
    def __init__(self, element_id: str) -> None:
        self.id = element_id


class PageDriver:
    """A WebDriver as the patched `execute` sees it: two elements and a title."""

    TEXTS = {"e.h1": "Example Domain", "e.flash": "You logged in"}

    def __init__(self) -> None:
        self.session_id = None
        self.caps = {"browserName": "chrome"}
        self._elements = {"h1": "e.h1", "#flash": "e.flash"}

    def execute(self, command, params=None):
        if command == "findElement":
            return {"value": _Element(self._elements[params["value"]])}
        if command == "getElementText":
            return {"value": self.TEXTS[params["id"]]}
        if command == "getTitle":
            return {"value": "Example Domain"}
        if command == "w3cExecuteScript":
            return {"value": "submit"}
        return {"value": None}

    def find(self, selector):
        return self.execute(
            "findElement", {"using": "css selector", "value": selector}
        )["value"]

    def text(self, element):
        return self.execute("getElementText", {"id": element.id})["value"]

    @property
    def title(self):
        return self.execute("getTitle")["value"]


class AssertionRowTargetTest(unittest.TestCase):
    """End to end: a read through the patched driver, then pytest's hooks."""

    def setUp(self):
        instrumentation.uninstall()
        self.tx = RecordingTransport()
        capturer = SessionCapturer(self.tx)
        instrumentation.install(capturer, PageDriver)
        self.addCleanup(instrumentation.uninstall)
        self.driver = PageDriver()
        plugin._comparisons.clear()
        for patcher in (
            mock.patch.object(plugin, "_opted_in", return_value=True),
            mock.patch.object(plugin.devtools, "get_capturer", return_value=capturer),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def _assert_row(self):
        rows = [d[0] for s, d in self.tx.sent if s == "commands"]
        return [r for r in rows if r["command"].startswith("assert.")][-1]

    def _passing_assert(self, left, right, source):
        plugin.pytest_assertrepr_compare(None, "==", left, right)
        plugin.pytest_assertion_pass(
            type("Item", (), {"path": "test_x.py"})(), 3, source, ""
        )

    def test_an_assertion_on_an_element_read_carries_its_selector(self):
        greeting = self.driver.text(self.driver.find("#flash"))
        self._passing_assert(greeting, "You logged in", 'greeting == "You logged in"')
        self.assertEqual(self._assert_row()["selector"], "#flash")

    def test_a_title_assertion_does_not_borrow_an_element_reading_the_same(self):
        self.driver.text(self.driver.find("h1"))
        title = self.driver.execute("getTitle")["value"]
        self._passing_assert(title, "Example Domain", 'title == "Example Domain"')
        self.assertNotIn("selector", self._assert_row())

    def test_an_element_read_after_the_title_takes_the_value_back(self):
        self.driver.execute("getTitle")
        heading = self.driver.text(self.driver.find("h1"))
        self._passing_assert(heading, "Example Domain", 'heading == "Example Domain"')
        self.assertEqual(self._assert_row()["selector"], "h1")

    def test_a_script_atom_on_an_element_reads_from_that_element(self):
        # `get_attribute` and `is_displayed` reach the wire as scripts that take
        # the element as an argument.
        button = self.driver.find("#flash")
        value = self.driver.execute(
            "w3cExecuteScript", {"script": "/* getAttribute */", "args": [button, "type"]}
        )["value"]
        self._passing_assert(value, "submit", 'kind == "submit"')
        self.assertEqual(self._assert_row()["selector"], "#flash")

    def test_a_failing_assertion_carries_it_too(self):
        heading = self.driver.text(self.driver.find("h1"))
        plugin.pytest_assertrepr_compare(None, "==", heading, "Secure Area")
        error = AssertionError("assert 'Example Domain' == 'Secure Area'")
        entry = type(
            "Entry", (), {"path": "test_x.py", "lineno": 4, "statement": "assert heading == 'Secure Area'"}
        )()
        excinfo = type("ExcInfo", (), {"value": error, "traceback": [entry]})()
        plugin.pytest_exception_interact(
            None, type("Call", (), {"excinfo": excinfo})(), None
        )
        self.assertEqual(self._assert_row()["selector"], "h1")

    def test_a_containment_looks_up_the_observed_side(self):
        # `in` puts the expectation on the left.
        heading = self.driver.text(self.driver.find("h1"))
        plugin.pytest_assertrepr_compare(None, "in", "Example", heading)
        plugin.pytest_assertion_pass(
            type("Item", (), {"path": "test_x.py"})(), 3, '"Example" in heading', ""
        )
        self.assertEqual(self._assert_row()["selector"], "h1")

    def test_a_test_start_forgets_the_previous_test_s_reads(self):
        # Regression: a later test's assertion on a value an earlier test read
        # boxed the earlier test's element.
        plugin.pytest_runtest_logstart("test_x.py::test_one", ("test_x.py", 1, "test_one"))
        self.driver.text(self.driver.find("#flash"))
        plugin.pytest_runtest_logstart("test_x.py::test_two", ("test_x.py", 5, "test_two"))
        self._passing_assert("You logged in", "You logged in", 'expected == "You logged in"')
        self.assertNotIn("selector", self._assert_row())

    def test_a_read_within_the_test_still_names_its_element(self):
        plugin.pytest_runtest_logstart("test_x.py::test_one", ("test_x.py", 1, "test_one"))
        greeting = self.driver.text(self.driver.find("#flash"))
        self._passing_assert(greeting, "You logged in", 'greeting == "You logged in"')
        self.assertEqual(self._assert_row()["selector"], "#flash")

    def test_a_re_enable_forgets_the_previous_run_s_reads(self):
        self.driver.text(self.driver.find("#flash"))
        instrumentation.uninstall()
        self.assertIsNone(read_value_locators.selector_for("You logged in"))


@unittest.skipIf(sys.gettrace() is not None, "another trace function is active")
class PlainScriptAssertionTargetTest(unittest.TestCase):
    """A plain script's assert, where an attribute operand is never re-read.

    `driver.title` is left unresolved so reading it cannot issue a phantom
    command, which means the value it produced never reaches the lookup. The
    expected literal must not stand in for it.
    """

    def setUp(self):
        instrumentation.uninstall()
        self.tx = RecordingTransport()
        self.capturer = SessionCapturer(self.tx)
        instrumentation.install(self.capturer, PageDriver)
        self.addCleanup(instrumentation.uninstall)
        self.driver = PageDriver()
        instrumentation._state.pop("assertion_reported", None)
        self.addCleanup(instrumentation._state.pop, "assertion_reported", None)

    def _assert_rows(self):
        rows = [d[0] for s, d in self.tx.sent if s == "commands"]
        return [r for r in rows if r["command"].startswith("assert.")]

    def _traced(self, run):
        with mock.patch.object(instrumentation, "_entry_script", return_value=__file__):
            self.assertTrue(instrumentation.start_assertion_tracing(self.capturer))
        try:
            run()
        finally:
            instrumentation.stop_assertion_tracing()

    def test_a_passing_title_assertion_does_not_box_an_element_reading_the_literal(self):
        driver = self.driver
        driver.text(driver.find("#flash"))  # "You logged in", read from #flash

        def run():
            assert driver.title != "You logged in"

        self._traced(run)
        [row] = self._assert_rows()
        self.assertTrue(row["result"]["passed"])
        self.assertNotIn("selector", row)

    def test_a_failing_title_assertion_does_not_box_an_element_reading_the_literal(self):
        driver = self.driver
        driver.text(driver.find("#flash"))

        def run():
            assert driver.title == "You logged in"

        try:
            run()
        except AssertionError:
            instrumentation._capture_unwinding_assertion(self.capturer)
        [row] = self._assert_rows()
        self.assertFalse(row["result"]["passed"])
        self.assertNotIn("selector", row)

    def test_a_resolved_observed_side_still_carries_its_element(self):
        driver = self.driver
        greeting = driver.text(driver.find("#flash"))

        def run():
            assert greeting == "You logged in"

        self._traced(run)
        [row] = self._assert_rows()
        self.assertEqual(row["selector"], "#flash")


if __name__ == "__main__":
    unittest.main()
