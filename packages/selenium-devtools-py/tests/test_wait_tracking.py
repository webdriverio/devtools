"""A WebDriverWait is a client-side loop: these drive selenium's real
``WebDriverWait`` over a fake driver through the instrumented chokepoint."""

import unittest
from unittest import mock

from selenium.common.exceptions import NoSuchElementException, TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.remote.locator_converter import LocatorConverter
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.wait import WebDriverWait

from selenium_devtools import instrumentation, wait_tracking
from selenium_devtools.capturer import SessionCapturer

from wire_contract import RecordingTransport


class Element:
    def __init__(self, element_id):
        self.id = element_id

    def is_displayed(self):
        return True


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
        """Replay frames in arrival order the way shared `replaceCommand` applies them."""
        rows = []
        for scope, data in self.tx.sent:
            if scope == "commands":
                rows.extend(data)
            elif scope == "replaceCommand":
                command = data["command"]
                at = next((i for i, r in enumerate(rows) if r["id"] == command["id"]), None)
                if at is None:
                    at = next(
                        (i for i in reversed(range(len(rows)))
                         if rows[i]["timestamp"] == data["oldTimestamp"]),
                        None,
                    )
                if at is None:
                    rows.append(command)
                else:
                    rows[at] = command
        return rows

    def _first_sent(self, row_id):
        for scope, data in self.tx.sent:
            rows = data if scope == "commands" else [data["command"]] if scope == "replaceCommand" else []
            for row in rows:
                if row["id"] == row_id:
                    return scope, row
        return None

    def test_a_timed_out_element_wait_is_one_failed_row_on_its_selector(self):
        driver = PollingDriver()
        locator = (By.CSS_SELECTOR, "#missing")
        with self.assertRaises(TimeoutException):
            WebDriverWait(driver, 0.2, poll_frequency=0.05).until(
                EC.presence_of_element_located(locator)
            )
        self.assertGreater(driver.finds, 1)
        wait, poll = self._rows()
        self.assertEqual(wait["command"], "waitForElementLocated")
        self.assertEqual(wait["selector"], "#missing")
        self.assertEqual(
            wait["args"], ["presence_of_element_located(('css selector', '#missing'))", 0.2]
        )
        self.assertEqual(wait["error"]["name"], "TimeoutException")
        self.assertIn("presence_of_element_located", wait["error"]["message"])
        self.assertTrue(wait["callSource"].startswith(__file__), wait["callSource"])
        self.assertGreater(wait["timestamp"], wait["startTime"])
        # Every poll folded into one row, and it is the wait's child rather than the wait.
        self.assertEqual(poll["command"], "findElement")
        self.assertEqual(poll["parentId"], wait["id"])
        self.assertNotIn("parentId", wait)

    def test_the_wait_row_is_sent_running_before_its_first_poll(self):
        WebDriverWait(PollingDriver(appears_after=2), 1, poll_frequency=0.01).until(
            EC.presence_of_element_located((By.ID, "late"))
        )
        scope, first = self.tx.sent[0]
        self.assertEqual((scope, first[0]["command"]), ("commands", "waitForElementLocated"))
        running = first[0]
        self.assertEqual(running["timestamp"], running["startTime"])
        self.assertNotIn("error", running)
        self.assertIsNone(running["result"])
        last_scope, last = self.tx.sent[-1]
        self.assertEqual(last_scope, "replaceCommand")
        self.assertEqual(last["command"]["id"], running["id"])
        self.assertNotIn("error", last["command"])

    def test_the_selector_is_the_one_the_element_rows_carry(self):
        class ConvertingDriver(PollingDriver):
            """Converts a locator before ``execute``, as selenium's ``find_element`` does."""

            def find_element(self, by, value):
                return super().find_element(*LocatorConverter().convert(by, value))

        WebDriverWait(ConvertingDriver(appears_after=1), 1).until(
            EC.visibility_of_element_located((By.ID, "late"))
        )
        rows = self._rows()
        self.assertEqual(rows[0]["command"], "waitForElementVisible")
        self.assertEqual(rows[0]["selector"], "#late")
        self.assertEqual(rows[1]["selector"], rows[0]["selector"])

    def test_the_wait_s_own_message_is_kept(self):
        with self.assertRaises(TimeoutException):
            WebDriverWait(PollingDriver(), 0.1, poll_frequency=0.05).until(
                EC.presence_of_element_located((By.ID, "x")), "flash never showed"
            )
        self.assertEqual(self._rows()[0]["error"]["message"], "flash never showed")

    def test_a_passing_wait_is_a_row_and_its_polls_fold_under_it_one_row_per_call(self):
        driver = PollingDriver(appears_after=3)
        WebDriverWait(driver, 2, poll_frequency=0.01).until(
            lambda d: d.find_element(By.CSS_SELECTOR, "#late")
            and d.execute("getElementText", {"id": f"e.{d.finds}"})
        )
        self.assertEqual(driver.finds, 3)
        wait, find, text = self._rows()
        self.assertEqual((wait["command"], wait["args"][0]), ("wait", "lambda"))
        self.assertNotIn("error", wait)
        self.assertNotIn("selector", wait)
        self.assertEqual([find["command"], text["command"]], ["findElement", "getElementText"])
        self.assertEqual([find["parentId"], text["parentId"]], [wait["id"], wait["id"]])
        self.assertNotIn("error", find)  # the last poll's outcome stands

    def test_until_not_names_the_negated_condition(self):
        with self.assertRaises(TimeoutException):
            WebDriverWait(PollingDriver(appears_after=1), 0.1, poll_frequency=0.02).until_not(
                EC.presence_of_element_located((By.ID, "late"))
            )
        wait = self._rows()[0]
        self.assertEqual(wait["command"], "wait")
        self.assertEqual(wait["args"][0], "not presence_of_element_located(('id', 'late'))")
        self.assertNotIn("selector", wait)

    def test_commands_outside_a_wait_stay_rows_of_their_own(self):
        driver = PollingDriver(appears_after=1)
        driver.find_element(By.ID, "late")
        driver.find_element(By.ID, "late")
        rows = self._rows()
        self.assertEqual(len(rows), 2)
        self.assertFalse(any("parentId" in r for r in rows))

    def test_a_wait_s_polls_replace_their_own_row_when_an_earlier_row_shares_the_millisecond(self):
        driver = PollingDriver(appears_after=1)
        with mock.patch("selenium_devtools.capturer.now_ms", return_value=1000):
            driver.find_element(By.ID, "before")
            with self.assertRaises(TimeoutException):
                WebDriverWait(PollingDriver(), 0.1, poll_frequency=0.02).until(
                    lambda d: d.find_element(By.ID, "late")
                )
        rows = self._rows()
        self.assertEqual(
            [(r["command"], r["args"][0]) for r in rows],
            [
                ("findElement", {"using": "id", "value": "before"}),
                ("wait", "lambda"),
                ("findElement", {"using": "id", "value": "late"}),
            ],
        )

    def test_a_nested_wait_is_one_row_under_its_outer_wait_across_outer_polls(self):
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
        outer_row, inner_row, poll = self._rows()
        self.assertEqual((outer_row["command"], outer_row["args"][0]), ("wait", "outer"))
        self.assertEqual(inner_row["command"], "waitForElementLocated")
        self.assertEqual(inner_row["parentId"], outer_row["id"])
        self.assertEqual(poll["parentId"], inner_row["id"])
        self.assertEqual(inner_row["error"]["name"], "TimeoutException")
        self.assertEqual(outer_row["error"]["name"], "TimeoutException")

    # Regression: each outer poll re-sent the nested wait with a later start, which its earlier children then preceded.
    def test_a_nested_wait_keeps_its_first_start_across_outer_polls(self):
        driver = PollingDriver()

        def outer(d):
            try:
                WebDriverWait(d, 0.05, poll_frequency=0.02).until(
                    EC.presence_of_element_located((By.ID, "late"))
                )
            except TimeoutException:
                return False
            return True

        with self.assertRaises(TimeoutException):
            WebDriverWait(driver, 0.2, poll_frequency=0.02).until(outer)
        sends = [
            row
            for scope, data in self.tx.sent
            for row in (
                data if scope == "commands"
                else [data["command"]] if scope == "replaceCommand"
                else []
            )
            if row["command"] == "waitForElementLocated"
        ]
        self.assertGreater(len(sends), 2)
        first_start = sends[0]["startTime"]
        self.assertEqual({row["startTime"] for row in sends}, {first_start})
        _, inner_row, poll = self._rows()
        self.assertLessEqual(inner_row["startTime"], poll["startTime"])

    def test_a_row_that_cannot_be_sent_does_not_stop_the_wait(self):
        capture = SessionCapturer.capture_command

        def failing(capturer, **kwargs):
            if kwargs["command"] in ("wait", "waitForElementLocated"):
                raise RuntimeError("socket gone")
            return capture(capturer, **kwargs)

        with mock.patch.object(SessionCapturer, "capture_command", failing):
            self.assertTrue(
                WebDriverWait(PollingDriver(appears_after=1), 1).until(
                    EC.presence_of_element_located((By.ID, "late"))
                )
            )
            with self.assertRaises(TimeoutException):
                WebDriverWait(PollingDriver(), 0.05, poll_frequency=0.02).until(
                    lambda d: d.find_element(By.ID, "late")
                )

    # Regression: a captured object whose __repr__ raised escaped the nested wait's naming and failed the test.
    def test_a_condition_that_cannot_be_named_still_runs(self):
        class Unprintable:
            def __repr__(self):
                raise RuntimeError("no repr")

        def factory(value):
            def _predicate(driver):
                return value is not None

            return _predicate

        driver = PollingDriver()

        def outer(d):
            return WebDriverWait(d, 0.05, poll_frequency=0.02).until(factory(Unprintable()))

        self.assertTrue(WebDriverWait(driver, 0.2, poll_frequency=0.02).until(outer))

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
