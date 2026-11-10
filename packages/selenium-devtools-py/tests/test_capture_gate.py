"""Which commands take the per-action capture, screenshot included.

Trace mode captures only commands that can change the page, as the JS adapters
do: a read, wait or lookup takes no screenshot and its row shows the capture
before it. The classification is held to core's by mirror-vectors.json; these
cover the execute hook that applies it.
"""

import unittest
from unittest import mock

from selenium_devtools import instrumentation
from selenium_devtools.capturer import SessionCapturer
from selenium_devtools.per_test_capture import PerTestCapture

from wire_contract import RecordingTransport

SCRIPTS = {"accessibilityTree": "(function(){})", "elements": "(function(){})"}


class Driver:
    """No session id, so the hook brings up no BiDi, collector or recorder."""

    session_id = None

    def __init__(self):
        self.screenshots = 0
        self.scripts_run = 0

    def execute(self, command, params=None):
        return {"value": "Logout"}

    def get_screenshot_as_base64(self):
        self.screenshots += 1
        return f"SHOT{self.screenshots}"

    def execute_script(self, script, *args):
        self.scripts_run += 1
        return [{"selector": "#go"}]


class Base(unittest.TestCase):
    trace = True

    def setUp(self):
        instrumentation.uninstall()
        self.addCleanup(instrumentation.uninstall)
        self.tx = RecordingTransport()
        instrumentation.install(SessionCapturer(self.tx), Driver)
        patcher = mock.patch.dict(
            instrumentation._state,
            {
                "trace": self.trace,
                "a11y": True,
                "element_scripts": SCRIPTS,
                "action_snapshots": [],
                "test": PerTestCapture(started_ms=0),
            },
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.driver = Driver()

    def run_commands(self, *commands):
        for command in commands:
            self.driver.execute(command, {})

    def row_shots(self):
        rows = [data for scope, data in self.tx.sent if scope == "commands"]
        return [(row[0]["command"], row[0].get("screenshot")) for row in rows]

    def captured(self):
        return [
            (snap["command"], snap.get("screenshot"))
            for snap in instrumentation.action_snapshots()
        ]


class TestTraceMode(Base):
    def test_reads_after_a_click_take_no_screenshot(self):
        self.run_commands("get", "clickElement", "findElement", "getElementText",
                          "isElementEnabled", "getCurrentUrl", "getTitle")
        self.assertEqual(self.driver.screenshots, 2)
        self.assertEqual(self.captured(), [("get", "SHOT1"), ("clickElement", "SHOT2")])
        self.assertEqual(
            [shot for _, shot in self.row_shots()],
            ["SHOT1", "SHOT2", None, None, None, None, None],
        )

    def test_a_read_reuses_the_capture_before_it_at_the_end_of_the_test(self):
        self.run_commands("clickElement", "getElementText")
        self.assertEqual(instrumentation._state["test"].last_captured_ts,
                         instrumentation._state["test"].rows[0][1])

    def test_page_changing_commands_each_capture(self):
        self.run_commands("get", "sendKeysToElement", "clickElement",
                          "w3cExecuteScript", "actions", "refresh")
        self.assertEqual(self.driver.screenshots, 6)
        self.assertEqual(len(self.captured()), 6)

    def test_the_first_mapped_command_of_each_test_captures_even_a_read(self):
        self.run_commands("findElement", "getElementText", "getElementText")
        self.assertEqual(self.captured(), [("getElementText", "SHOT1")])

        instrumentation.reset_test_capture()
        self.run_commands("getTitle", "getCurrentUrl")
        self.assertEqual([c for c, _ in self.captured()], ["getElementText", "getTitle"])
        self.assertEqual(self.driver.screenshots, 2)

    def test_an_appium_is_displayed_read_takes_no_capture(self):
        self.run_commands("clickElement", "isElementDisplayed", "findElements")
        self.assertEqual(self.driver.screenshots, 1)

    def test_a_selenium_is_displayed_atom_takes_no_capture(self):
        self.run_commands("clickElement")
        self.driver.execute(
            "w3cExecuteScript",
            {"script": "/* isDisplayed */return (function(){}).apply(null, arguments);", "args": []},
        )
        self.assertEqual(self.driver.screenshots, 1)


class TestLiveMode(Base):
    trace = False

    def test_every_command_still_takes_its_row_screenshot(self):
        self.run_commands("clickElement", "findElement", "getElementText")
        self.assertEqual(self.driver.screenshots, 3)
        self.assertEqual([shot for _, shot in self.row_shots()], ["SHOT1", "SHOT2", "SHOT3"])
        self.assertEqual(self.captured(), [])


if __name__ == "__main__":
    unittest.main()
