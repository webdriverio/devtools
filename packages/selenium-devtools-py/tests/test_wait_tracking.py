"""A WebDriverWait is a client-side loop: these drive selenium's real
``WebDriverWait`` over a fake driver through the instrumented chokepoint."""

import unittest

from selenium.common.exceptions import NoSuchElementException, TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.wait import WebDriverWait

from selenium_devtools import instrumentation, wait_tracking
from selenium_devtools.capturer import SessionCapturer

from wire_contract import RecordingTransport


class Element:
    def __init__(self, element_id):
        self.id = element_id


class PollingDriver:
    """Finds `#late` only from the `appears_after`th attempt, with a fresh element id each time."""

    def __init__(self, appears_after=None):
        self.session_id = None
        self.caps = {"browserName": "chrome"}
        self.finds = 0
        self.appears_after = appears_after

    def execute(self, command, params=None):
        if command == "findElement":
            self.finds += 1
            if self.appears_after is None or self.finds < self.appears_after:
                raise NoSuchElementException("no such element: #late")
            return {"value": Element(f"e.{self.finds}")}
        if command == "getElementText":
            return {"value": "hello"}
        return {"value": None}

    def find_element(self, by, value):
        return self.execute("findElement", {"using": by, "value": value})["value"]


class TestWaitRows(unittest.TestCase):
    def setUp(self):
        instrumentation.uninstall()
        self.tx = RecordingTransport()
        instrumentation.install(SessionCapturer(self.tx), PollingDriver)
        self.addCleanup(instrumentation.uninstall)

    def _sent(self, scope):
        return [d for s, d in self.tx.sent if s == scope]

    def _rows(self):
        """The rows as the dashboard holds them once every replace has applied."""
        rows = [d[0] for d in self._sent("commands")]
        for replace in self._sent("replaceCommand"):
            index = next(
                i for i, r in enumerate(rows) if r["timestamp"] == replace["oldTimestamp"]
            )
            rows[index] = replace["command"]
        return rows

    def test_a_timed_out_wait_is_one_failed_row_named_after_its_condition(self):
        driver = PollingDriver()
        locator = (By.CSS_SELECTOR, "#missing")
        with self.assertRaises(TimeoutException):
            WebDriverWait(driver, 0.2, poll_frequency=0.05).until(
                EC.presence_of_element_located(locator)
            )
        self.assertGreater(driver.finds, 1)
        rows = self._rows()
        self.assertEqual(len(rows), 1, rows)
        row = rows[0]
        self.assertEqual(row["command"], "wait")
        self.assertEqual(
            row["args"], ["presence_of_element_located(('css selector', '#missing'))", 0.2]
        )
        self.assertEqual(row["error"]["name"], "TimeoutException")
        self.assertIn("presence_of_element_located", row["error"]["message"])
        self.assertTrue(row["callSource"].startswith(__file__), row["callSource"])

    def test_the_wait_s_own_message_is_kept(self):
        with self.assertRaises(TimeoutException):
            WebDriverWait(PollingDriver(), 0.1, poll_frequency=0.05).until(
                EC.presence_of_element_located((By.ID, "x")), "flash never showed"
            )
        self.assertEqual(self._rows()[0]["error"]["message"], "flash never showed")

    def test_a_passing_wait_s_polls_fold_into_one_row_per_call(self):
        driver = PollingDriver(appears_after=3)
        WebDriverWait(driver, 2, poll_frequency=0.01).until(
            lambda d: d.find_element(By.CSS_SELECTOR, "#late")
            and d.execute("getElementText", {"id": f"e.{d.finds}"})
        )
        self.assertEqual(driver.finds, 3)
        rows = self._rows()
        self.assertEqual([r["command"] for r in rows], ["findElement", "getElementText"])
        self.assertNotIn("error", rows[0])  # the last poll's outcome stands

    def test_a_failed_lambda_wait_takes_over_its_polls_row(self):
        with self.assertRaises(TimeoutException):
            WebDriverWait(PollingDriver(), 0.1, poll_frequency=0.02).until(
                lambda d: d.find_element(By.ID, "late")
            )
        rows = self._rows()
        self.assertEqual([(r["command"], r["args"][0]) for r in rows], [("wait", "lambda")])

    def test_until_not_names_the_negated_condition(self):
        with self.assertRaises(TimeoutException):
            WebDriverWait(PollingDriver(), 0.1, poll_frequency=0.02).until_not(
                lambda d: True
            )
        self.assertEqual(self._rows()[0]["args"][0], "not lambda")

    def test_commands_outside_a_wait_stay_rows_of_their_own(self):
        driver = PollingDriver(appears_after=1)
        driver.find_element(By.ID, "late")
        driver.find_element(By.ID, "late")
        self.assertEqual(len(self._rows()), 2)

    def test_a_nested_wait_keeps_one_scope_across_outer_polls(self):
        driver = PollingDriver()
        outer_polls = []

        def outer(d):
            outer_polls.append(1)
            try:
                WebDriverWait(d, 0.05, poll_frequency=0.02).until(
                    EC.presence_of_element_located((By.ID, "late"))
                )
            except TimeoutException:
                return False
            return True

        with self.assertRaises(TimeoutException):
            WebDriverWait(driver, 0.2, poll_frequency=0.02).until(outer)
        self.assertGreater(len(outer_polls), 1)
        rows = self._rows()
        self.assertEqual([(r["command"], r["args"][0]) for r in rows][-1], ("wait", "outer"))
        self.assertEqual(len(rows), 2, rows)  # the inner wait's row, then the outer's

    def test_uninstall_restores_selenium_s_methods(self):
        instrumentation.uninstall()
        self.assertFalse(hasattr(WebDriverWait.until, "__wrapped__"))
        self.assertFalse(hasattr(WebDriverWait.until_not, "__wrapped__"))


class TestConditionLabel(unittest.TestCase):
    def test_labels(self):
        def ready(driver):
            return True

        class Custom:
            def __call__(self, driver):
                return True

        self.assertEqual(wait_tracking.condition_label(ready), "ready")
        self.assertEqual(wait_tracking.condition_label(lambda d: d), "lambda")
        self.assertEqual(wait_tracking.condition_label(Custom()), "Custom")
        self.assertEqual(
            wait_tracking.condition_label(EC.title_is("Home")), "title_is('Home')"
        )


if __name__ == "__main__":
    unittest.main()
