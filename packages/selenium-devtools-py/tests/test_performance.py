"""Navigation timings on the command row.

The row is reported when the command completes and then reported AGAIN, under
`replaceCommand`, once the page has answered for its timings — only the page can.
So there are two things to get right: the shaping of the payload onto the row,
and the fact that a payload worth nothing produces no second frame at all.
"""

import unittest

from selenium_devtools import instrumentation, performance
from selenium_devtools._contract import SCOPE_REPLACE_COMMAND
from selenium_devtools.capturer import SessionCapturer
from selenium_devtools.constants import NAVIGATION_COMMANDS

FULL_PAYLOAD = {
    "navigation": {
        "url": "https://x/secure",
        "timing": {"loadTime": 812, "domReady": 410, "responseTime": 96},
    },
    "resources": [
        {"url": "https://x/app.css", "duration": 21, "size": 4096, "type": "link"},
        {"url": "https://x/app.js", "duration": 44, "size": 90112, "type": "script"},
    ],
    "cookies": "session=abc",
    "documentInfo": {"url": "https://x/secure", "title": "Secure Area"},
}


class FakeTransport:
    connected = True

    def __init__(self):
        self.sent = []

    def send_json(self, scope, data):
        self.sent.append((scope, data))
        return True

    def close(self):
        pass

    def of_scope(self, scope):
        return [data for s, data in self.sent if s == scope]


class TestShapingThePayload(unittest.TestCase):
    def test_a_full_payload_lands_on_the_row(self):
        row = {"command": "get", "timestamp": 1000}

        applied = performance.apply_performance_data(
            row, FULL_PAYLOAD, "https://x/secure"
        )

        self.assertTrue(applied)
        self.assertEqual(row["performance"]["navigation"]["timing"]["loadTime"], 812)
        self.assertEqual(len(row["performance"]["resources"]), 2)
        self.assertEqual(row["cookies"], "session=abc")
        self.assertEqual(row["documentInfo"]["title"], "Secure Area")

    def test_the_row_result_is_what_the_actions_panel_prints(self):
        row = {"command": "get", "timestamp": 1000}

        performance.apply_performance_data(row, FULL_PAYLOAD, "https://x/secure")

        self.assertEqual(
            row["result"],
            {
                "url": "https://x/secure",
                "loadTime": 812,
                "resources": FULL_PAYLOAD["resources"],
                "resourceCount": 2,
                "cookies": "session=abc",
                "title": "Secure Area",
            },
        )

    def test_a_payload_without_navigation_is_no_data_at_all(self):
        # It means the read landed before the document had timings. Applying the
        # empty shell would replace a good row with a worse one.
        row = {"command": "get", "timestamp": 1000}

        applied = performance.apply_performance_data(row, {"resources": []}, None)

        self.assertFalse(applied)
        self.assertNotIn("performance", row)
        self.assertNotIn("result", row)

    def test_nothing_readable_is_declined_rather_than_guessed(self):
        for payload in (None, "", [], {"navigation": None}):
            with self.subTest(payload=payload):
                row = {"command": "get", "timestamp": 1000}
                self.assertFalse(
                    performance.apply_performance_data(row, payload, None)
                )
                self.assertNotIn("performance", row)

    def test_missing_resources_are_an_empty_list_not_an_absence(self):
        row = {"command": "get", "timestamp": 1000}

        performance.apply_performance_data(row, {"navigation": {"url": "u"}}, "u")

        self.assertEqual(row["performance"]["resources"], [])
        self.assertEqual(row["result"]["resourceCount"], 0)


class TestTheUrlTheCommandWasGiven(unittest.TestCase):
    def test_get_carries_its_url(self):
        self.assertEqual(
            performance.navigated_url({"url": "https://x/login"}), "https://x/login"
        )
        self.assertEqual(performance.navigated_url(["https://x/login"]), "https://x/login")

    def test_history_commands_carry_none(self):
        # `refresh`, `goBack` and `goForward` take no url; the row reports the
        # document's own through documentInfo instead.
        for params in (None, {}, [], {"other": 1}, "not-a-url-arg-shape"):
            with self.subTest(params=params):
                self.assertIsNone(performance.navigated_url(params))


class TestTheRowIsReplaced(unittest.TestCase):
    class Driver:
        def __init__(self, payload=FULL_PAYLOAD, raises=False):
            self.payload = payload
            self.raises = raises
            self.scripts = []

        def execute_script(self, script, *args):
            self.scripts.append(script)
            if self.raises:
                raise RuntimeError("no such session")
            return self.payload

    def _capturer(self):
        tx = FakeTransport()
        return SessionCapturer(tx), tx

    def test_the_enriched_row_goes_out_under_replace_command(self):
        cap, tx = self._capturer()
        row = {"command": "get", "timestamp": 4242}

        instrumentation._attach_performance(
            cap, self.Driver(), row, {"url": "https://x/secure"}
        )

        (frame,) = tx.of_scope(SCOPE_REPLACE_COMMAND)
        self.assertEqual(frame["oldTimestamp"], 4242)
        self.assertEqual(frame["command"]["performance"]["navigation"]["url"],
                         "https://x/secure")

    def test_a_payload_worth_nothing_sends_no_second_frame(self):
        cap, tx = self._capturer()

        instrumentation._attach_performance(
            cap, self.Driver(payload={"resources": []}), {"timestamp": 1}, None
        )

        self.assertEqual(tx.of_scope(SCOPE_REPLACE_COMMAND), [])

    def test_a_failed_read_neither_raises_nor_replaces(self):
        # A session torn down between the navigation and this read is ordinary.
        cap, tx = self._capturer()

        instrumentation._attach_performance(
            cap, self.Driver(raises=True), {"timestamp": 1}, None
        )

        self.assertEqual(tx.of_scope(SCOPE_REPLACE_COMMAND), [])

    def test_no_row_is_a_no_op(self):
        cap, tx = self._capturer()

        instrumentation._attach_performance(cap, self.Driver(), None, None)

        self.assertEqual(tx.sent, [])

    def test_the_read_is_not_captured_as_a_user_command(self):
        # It runs through the guarded executor, so the Actions timeline does not
        # grow a `executeScript` row beside every navigation.
        cap, tx = self._capturer()
        driver = self.Driver()

        instrumentation._attach_performance(cap, driver, {"timestamp": 1}, None)

        self.assertEqual(len(driver.scripts), 1)
        self.assertEqual(tx.of_scope("commands"), [])


class TestWhichCommandsAsk(unittest.TestCase):
    def test_the_navigating_commands_are_the_ones_that_land_on_a_document(self):
        self.assertEqual(
            NAVIGATION_COMMANDS, {"get", "refresh", "goBack", "goForward"}
        )

    def test_a_reporting_command_is_not_one_of_them(self):
        # `getCurrentUrl` and friends do not navigate, and asking the page for
        # navigation timings after each would replace unrelated rows.
        for command in ("getCurrentUrl", "findElement", "clickElement", "getTitle"):
            self.assertNotIn(command, NAVIGATION_COMMANDS)


if __name__ == "__main__":
    unittest.main()
