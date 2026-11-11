"""Which commands take the per-action capture, screenshot included.

Trace mode captures only commands that can change the page, as the JS adapters
do: a read, wait or lookup takes no screenshot and its row shows the capture
before it. The classification is held to core's by mirror-vectors.json; these
cover the execute hook that applies it.
"""

import time
import unittest
from unittest import mock

from selenium.webdriver.support.wait import WebDriverWait

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


class Recorder:
    def __init__(self):
        self.frames = []

    def add_frame(self, data):
        self.frames.append(data)
        return True

    def stop(self):
        pass


class TestTheFilmstrip(Base):
    """Without a pushed stream the per-command screenshots are the filmstrip, so
    the commands that take no capture still owe it frames."""

    def setUp(self):
        super().setUp()
        self.clock = [10_000]
        patcher = mock.patch.object(instrumentation, "now_ms", lambda: self.clock[0])
        patcher.start()
        self.addCleanup(patcher.stop)
        self.driver.session_id = "s"
        self.recorder = Recorder()
        self.entry = {"session_id": "s", "screencast": self.recorder, "snapshot": None}
        instrumentation._state["sessions"][self.driver] = self.entry

    def frames(self):
        return list(self.recorder.frames)

    def test_every_poll_a_wait_issues_adds_a_frame(self):
        instrumentation._state["test"].awaiting_initial_frame = False
        polls = iter([False, False, True])
        WebDriverWait(self.driver, 5, poll_frequency=0.01).until(
            lambda d: d.execute("getElementText", {}) and next(polls)
        )
        self.assertEqual(self.frames(), ["SHOT1", "SHOT2", "SHOT3"])
        self.assertEqual(instrumentation.action_snapshots(), [])

    def test_a_read_outside_a_wait_adds_a_frame_once_the_poll_interval_has_passed(self):
        self.run_commands("clickElement")
        self.clock[0] += 199
        self.run_commands("getElementText")
        self.assertEqual(self.frames(), ["SHOT1"])
        self.clock[0] += 1
        self.run_commands("getElementText")
        self.assertEqual(self.frames(), ["SHOT1", "SHOT2"])
        self.assertEqual([c for c, _ in self.captured()], ["clickElement"])

    def test_a_read_frame_is_not_a_row_screenshot(self):
        self.run_commands("clickElement")
        self.clock[0] += 500
        self.run_commands("getElementText")
        self.assertEqual([shot for _, shot in self.row_shots()], ["SHOT1", None])

    def test_page_changing_commands_add_their_capture_as_before(self):
        self.run_commands("get", "clickElement", "sendKeysToElement")
        self.assertEqual(self.frames(), ["SHOT1", "SHOT2", "SHOT3"])
        self.assertEqual(self.driver.screenshots, 3)

    def test_the_end_of_test_capture_ends_the_filmstrip(self):
        self.run_commands("clickElement")
        time.sleep(0.005)  # rows are stamped by the real clock; the read must follow the capture
        self.run_commands("getElementText")
        instrumentation.capture_final_frame(self.driver)
        self.assertEqual(self.frames(), ["SHOT1", "SHOT2"])

    def test_a_pushed_stream_takes_no_extra_screenshot(self):
        self.entry["screencast_push"] = mock.Mock()
        self.run_commands("clickElement")
        self.clock[0] += 1000
        self.run_commands("getElementText")
        WebDriverWait(self.driver, 5, poll_frequency=0.01).until(
            lambda d: d.execute("getElementText", {})
        )
        self.assertEqual(self.driver.screenshots, 1)
        self.assertEqual(self.frames(), [])

    def test_live_mode_is_unchanged(self):
        instrumentation._state["trace"] = False
        self.run_commands("clickElement", "getElementText")
        self.assertEqual(self.frames(), ["SHOT1", "SHOT2"])
        self.assertEqual(self.driver.screenshots, 2)


if __name__ == "__main__":
    unittest.main()
