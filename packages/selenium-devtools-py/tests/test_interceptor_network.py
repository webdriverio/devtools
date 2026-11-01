import unittest
from types import SimpleNamespace
from unittest import mock

from selenium_devtools import instrumentation, interceptor_network
from selenium_devtools import pytest_plugin as plugin
from selenium_devtools.capturer import SessionCapturer

from wire_contract import RecordingTransport

NATIVE_CAPS = {"platformName": "Android", "appium:automationName": "UiAutomator2"}


def _new_session(intercept):
    always = dict(NATIVE_CAPS)
    if intercept is not None:
        always["appium:intercept"] = intercept
    return {"capabilities": {"alwaysMatch": always, "firstMatch": [{}]}}


class FakePlugin:
    """The appium-interceptor execute scripts, answering from a list the test fills."""

    def __init__(self, listener="L1"):
        self.listener = listener
        self.data = []
        self.calls = []

    def __call__(self, script, *args):
        self.calls.append((script, args))
        if script == "interceptor: startListening":
            return self.listener
        if script == "interceptor: getInterceptedData":
            return list(self.data)
        raise AssertionError(f"unexpected script {script}")


class NativeDriver:
    """Stand-in for an Appium driver: execute() is the chokepoint, execute_script the plugin."""

    def __init__(self, plugin_fake=None, caps=None):
        self.session_id = None
        self.capabilities = dict(caps or NATIVE_CAPS)
        self.caps = self.capabilities
        self.plugin = plugin_fake or FakePlugin()
        self.next_session = "sess-1"

    def execute(self, command, params=None):
        if command == "newSession":
            self.session_id = self.next_session
        return {"value": f"ok:{command}"}

    def execute_script(self, script, *args):
        return self.plugin(script, *args)


def _entry(url="https://api.example/x", **over):
    entry = {
        "url": url,
        "method": "GET",
        "statusCode": 200,
        "requestHeaders": {"Accept": "*/*"},
        "responseHeaders": {"content-type": "application/json"},
        "responseBody": {"ok": True},
    }
    entry.update(over)
    return entry


class TestMapping(unittest.TestCase):
    def test_lowercases_names_drops_status_line_and_joins_repeats(self):
        self.assertEqual(
            interceptor_network.flatten_headers(
                {
                    "http/1.1 201 created": "",
                    "Set-Cookie": ["a=1", "b=2"],
                    "Content-Type": "text/plain",
                }
            ),
            {"set-cookie": "a=1, b=2", "content-type": "text/plain"},
        )

    def test_mixed_case_content_type_sets_type_and_mime(self):
        row = interceptor_network.to_network_request(
            _entry(responseHeaders={"Content-Type": "application/json; charset=utf-8"}),
            "interceptor-L1-0",
            1000,
        )
        self.assertEqual(row["type"], "fetch")
        self.assertEqual(row["response"]["mimeType"], "application/json")

    def test_row_shape(self):
        row = interceptor_network.to_network_request(
            _entry(requestBody="q=1"), "interceptor-L1-0", 1000
        )
        self.assertEqual(row["id"], "interceptor-L1-0")
        self.assertEqual(row["method"], "GET")
        self.assertEqual(row["status"], 200)
        self.assertEqual(row["timestamp"], 1000)
        self.assertEqual(row["startTime"], 1000)
        self.assertEqual(row["endTime"], 1000)
        self.assertEqual(row["requestHeaders"], {"accept": "*/*"})
        self.assertEqual(row["requestBody"], "q=1")
        self.assertEqual(row["responseBody"], '{"ok":true}')

    def test_size_counts_bytes_not_characters(self):
        row = interceptor_network.to_network_request(
            _entry(responseBody="héllo"), "id", 1
        )
        self.assertEqual(row["size"], 6)

    def test_empty_bodies_are_absent(self):
        row = interceptor_network.to_network_request(
            _entry(responseBody="", requestBody=None), "id", 1
        )
        self.assertNotIn("responseBody", row)
        self.assertNotIn("requestBody", row)
        self.assertNotIn("size", row)


class TestPoller(unittest.TestCase):
    def test_reads_only_entries_past_the_last_drain(self):
        fake = FakePlugin()
        poller = interceptor_network.InterceptorPoller(fake)
        self.assertTrue(poller.start())
        fake.data = [_entry("https://a/1"), _entry("https://a/2")]
        first = poller.drain()
        fake.data.append(_entry("https://a/3"))
        second = poller.drain()
        third = poller.drain()
        self.assertEqual([r["id"] for r in first], ["interceptor-L1-0", "interceptor-L1-1"])
        self.assertEqual([r["url"] for r in second], ["https://a/3"])
        self.assertEqual(second[0]["id"], "interceptor-L1-2")
        self.assertEqual(third, [])
        self.assertEqual(
            fake.calls[-1], ("interceptor: getInterceptedData", ({"id": "L1"},))
        )

    def test_throttles_per_command_drains_but_never_a_boundary_drain(self):
        fake = FakePlugin()
        now = [100.0]
        poller = interceptor_network.InterceptorPoller(fake, clock=lambda: now[0])
        poller.start()
        reads = lambda: sum(1 for c in fake.calls if c[0] == "interceptor: getInterceptedData")
        poller.drain(throttle=True)
        self.assertEqual(reads(), 1)
        now[0] += interceptor_network.NATIVE_NETWORK_DRAIN_INTERVAL_S - 0.001
        poller.drain(throttle=True)
        self.assertEqual(reads(), 1)
        poller.drain()
        self.assertEqual(reads(), 2)
        now[0] += interceptor_network.NATIVE_NETWORK_DRAIN_INTERVAL_S
        poller.drain(throttle=True)
        self.assertEqual(reads(), 3)

    # A failed call that answers None must surface as a failed read, not as "nothing new".
    def test_a_none_read_is_logged_as_a_failure(self):
        poller = interceptor_network.InterceptorPoller(
            lambda script, *args: "L1" if script == "interceptor: startListening" else None
        )
        poller.start()
        capturer = mock.Mock()
        with self.assertLogs("selenium_devtools.interceptor", "WARNING") as logs:
            interceptor_network.forward(capturer, poller)
        self.assertIn("no intercepted data", logs.output[0])
        capturer.send_network_requests.assert_not_called()

    def test_unstarted_poller_reads_nothing(self):
        fake = FakePlugin(listener=None)
        poller = interceptor_network.InterceptorPoller(fake)
        self.assertFalse(poller.start())
        self.assertEqual(poller.drain(), [])
        self.assertEqual(len(fake.calls), 1)


class TestGate(unittest.TestCase):
    def test_starts_for_a_native_session_that_asked(self):
        driver = NativeDriver()
        interceptor_network.note_session_request(driver, _new_session(True))
        self.assertIsNotNone(interceptor_network.start(driver, driver.execute_script))

    def test_firstmatch_request_counts(self):
        driver = NativeDriver()
        params = {"capabilities": {"alwaysMatch": {}, "firstMatch": [{"appium:intercept": True}]}}
        interceptor_network.note_session_request(driver, params)
        self.assertIsNotNone(interceptor_network.start(driver, driver.execute_script))

    # Appium merges appium:options into the session, so the plugin starts its proxy for these too.
    def test_appium_options_grouping_counts_at_every_level(self):
        grouped = {"appium:options": {"intercept": True}}
        for caps in (
            {"alwaysMatch": grouped},
            {"alwaysMatch": {}, "firstMatch": [{}, grouped]},
        ):
            driver = NativeDriver()
            interceptor_network.note_session_request(driver, {"capabilities": caps})
            self.assertIsNotNone(interceptor_network.start(driver, driver.execute_script))
        driver = NativeDriver()
        interceptor_network.note_session_request(
            driver, {"capabilities": {"alwaysMatch": {"appium:options": {"intercept": "yes"}}}}
        )
        self.assertIsNone(interceptor_network.start(driver, driver.execute_script))

    def test_warns_when_an_asking_driver_cannot_be_tracked(self):
        class Untrackable:
            __slots__ = ()

        with self.assertLogs("selenium_devtools.interceptor", "WARNING") as logs:
            interceptor_network.note_session_request(Untrackable(), _new_session(True))
        self.assertIn("cannot be tracked", logs.output[0])

    def test_stays_off_unless_asked_with_true(self):
        for value in (None, "yes", False):
            driver = NativeDriver()
            interceptor_network.note_session_request(driver, _new_session(value))
            self.assertIsNone(interceptor_network.start(driver, driver.execute_script))
            self.assertEqual(driver.plugin.calls, [])

    def test_stays_off_for_a_session_with_a_document(self):
        driver = NativeDriver(caps={**NATIVE_CAPS, "browserName": "chrome"})
        interceptor_network.note_session_request(driver, _new_session(True))
        self.assertIsNone(interceptor_network.start(driver, driver.execute_script))
        self.assertEqual(driver.plugin.calls, [])

    def test_warns_when_the_plugin_does_not_answer(self):
        driver = NativeDriver(FakePlugin(listener=None))
        interceptor_network.note_session_request(driver, _new_session(True))
        with self.assertLogs("selenium_devtools.interceptor", "WARNING") as logs:
            self.assertIsNone(interceptor_network.start(driver, driver.execute_script))
        self.assertIn("--use-plugins=appium-interceptor", logs.output[0])

    def test_warns_when_the_plugin_command_throws(self):
        driver = NativeDriver()

        def boom(script, *args):
            raise RuntimeError("unknown command")

        interceptor_network.note_session_request(driver, _new_session(True))
        with self.assertLogs("selenium_devtools.interceptor", "WARNING"):
            self.assertIsNone(interceptor_network.start(driver, boom))


class TestInstrumentationWiring(unittest.TestCase):
    def setUp(self):
        instrumentation.uninstall()
        self.tx = RecordingTransport()
        self.cap = SessionCapturer(self.tx)
        instrumentation.install(self.cap, NativeDriver)
        self.driver = NativeDriver()
        self.driver.execute("newSession", _new_session(True))

    def tearDown(self):
        instrumentation.uninstall()

    def _rows(self):
        return [r for s, d in self.tx.sent if s == "networkRequests" for r in d]

    def test_lists_requests_after_each_command_without_duplicates(self):
        self.driver.plugin.data = [_entry("https://a/1")]
        self.driver.execute("findElement", {"using": "id", "value": "x"})
        self.driver.execute("findElement", {"using": "id", "value": "y"})
        self.assertEqual([r["url"] for r in self._rows()], ["https://a/1"])

    def test_plugin_calls_are_not_action_rows(self):
        self.driver.execute("findElement", {"using": "id", "value": "x"})
        commands = [d[0]["command"] for s, d in self.tx.sent if s == "commands"]
        self.assertEqual(commands, ["findElement"])

    def test_quit_lists_what_arrived_after_the_last_command(self):
        self.driver.execute("findElement", {"using": "id", "value": "x"})
        self.driver.plugin.data = [_entry("https://a/late")]
        self.driver.execute("quit")
        self.assertEqual([r["url"] for r in self._rows()], ["https://a/late"])

    def test_test_end_drain_lists_what_arrived_after_the_last_command(self):
        self.driver.execute("findElement", {"using": "id", "value": "x"})
        self.driver.plugin.data = [_entry("https://a/late")]
        instrumentation.drain_native_network(self.cap)
        self.assertEqual([r["url"] for r in self._rows()], ["https://a/late"])

    # Regression: the old listener was read through the driver, which by then addressed the new session.
    def test_a_replaced_session_never_reads_the_old_listener_through_the_new_one(self):
        self.driver.execute("findElement", {"using": "id", "value": "x"})
        before = len(self.driver.plugin.calls)
        self.driver.plugin.listener = "L2"
        self.driver.next_session = "sess-2"
        self.driver.execute("newSession", _new_session(True))
        self.driver.execute("findElement", {"using": "id", "value": "x"})
        old_reads = [
            c for c in self.driver.plugin.calls[before:]
            if c == ("interceptor: getInterceptedData", ({"id": "L1"},))
        ]
        self.assertEqual(old_reads, [])

    def test_a_replaced_session_gets_a_fresh_listener(self):
        self.driver.execute("findElement", {"using": "id", "value": "x"})
        self.driver.plugin.listener = "L2"
        self.driver.plugin.data = []
        self.driver.next_session = "sess-2"
        self.driver.execute("newSession", _new_session(True))
        self.driver.plugin.data = [_entry("https://b/1")]
        self.driver.execute("findElement", {"using": "id", "value": "x"})
        starts = [c for c in self.driver.plugin.calls if c[0] == "interceptor: startListening"]
        self.assertEqual(len(starts), 2)
        self.assertEqual(self._rows()[-1]["id"], "interceptor-L2-0")


class TestPytestHook(unittest.TestCase):
    def test_drains_before_the_outcome_is_recorded(self):
        order = []
        report = SimpleNamespace(
            when="call", skipped=False, passed=True, failed=False,
            nodeid="t.py::test_a", location=("t.py", 1, "test_a"),
        )
        with mock.patch.object(plugin, "_opted_in", return_value=True), mock.patch.object(
            plugin.devtools, "get_capturer", return_value=object()
        ), mock.patch.object(
            instrumentation, "drain_native_network",
            side_effect=lambda c: order.append("drain"),
        ), mock.patch.object(
            plugin._registry, "record", side_effect=lambda *a, **k: order.append("record")
        ), mock.patch.object(plugin, "_publish"):
            plugin.pytest_runtest_logreport(report)
        self.assertEqual(order, ["drain", "record"])


if __name__ == "__main__":
    unittest.main()
