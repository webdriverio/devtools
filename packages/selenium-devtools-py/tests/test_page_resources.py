"""Trace-mode page resources: the option, the drain, and what is forwarded."""

from __future__ import annotations

import os
import unittest
from unittest import mock

from selenium_devtools import page_resources
from selenium_devtools import pytest_plugin as plugin
from selenium_devtools._contract import (
    SCOPE_PAGE_RESOURCES,
    SCOPE_RESOURCE_RE_READS,
)
from selenium_devtools.capturer import SessionCapturer
from selenium_devtools.snapshot import SnapshotCapturer

from page_scripts_fixture import PAGE_SCRIPTS
from test_pytest_config import _Config
from wire_contract import RecordingTransport

RESOURCES_DRAIN = "/* drain with resources */ return getTraceData({resources});"
SCRIPTS = {**PAGE_SCRIPTS, "collectorDrainResources": RESOURCES_DRAIN}
CSS = {
    "url": "https://site.test/site.css",
    "mimeType": "text/css",
    "kind": "stylesheet",
    "data": "cHt9",
    "size": 3,
}
RE_READ = {"url": CSS["url"], "startedAt": 5000, "loadedAt": 1000}


class _Exec:
    def __init__(self, *returns):
        self.calls = []
        self.args = []
        self._returns = list(returns)

    def __call__(self, script, *args):
        self.calls.append(script)
        self.args.append(args)
        return self._returns.pop(0) if self._returns else None


class ModeTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, {}, clear=False)
        patcher.start()
        self.addCleanup(patcher.stop)
        os.environ.pop("DEVTOOLS_TRACE_RESOURCES", None)
        self.addCleanup(page_resources.reset)

    def test_stores_styles_by_default(self):
        self.assertEqual(page_resources.resolve_mode(None), "styles")

    def test_the_argument_wins_over_the_environment(self):
        os.environ["DEVTOOLS_TRACE_RESOURCES"] = "styles"
        self.assertEqual(page_resources.resolve_mode("none"), "none")

    def test_the_environment_answers_when_no_argument_does(self):
        os.environ["DEVTOOLS_TRACE_RESOURCES"] = "none"
        self.assertEqual(page_resources.resolve_mode(None), "none")

    def test_an_empty_variable_is_unset(self):
        os.environ["DEVTOOLS_TRACE_RESOURCES"] = ""
        self.assertEqual(page_resources.resolve_mode(None), "styles")

    def test_an_unknown_value_warns_and_keeps_the_default(self):
        with self.assertLogs(page_resources._log, level="WARNING"):
            self.assertEqual(page_resources.resolve_mode("all"), "styles")


class DrainTest(unittest.TestCase):
    def setUp(self):
        self.addCleanup(page_resources.reset)

    def test_a_storing_run_drains_with_the_resources_script_naming_what_is_stored(self):
        page_resources.set_mode("styles")
        self.assertEqual(page_resources.drain_call(SCRIPTS), (RESOURCES_DRAIN, ([],)))
        page_resources.take({"pageResources": [CSS]})
        self.assertEqual(
            page_resources.drain_call(SCRIPTS),
            (RESOURCES_DRAIN, ([page_resources.url_key(CSS["url"])],)),
        )

    def test_a_backend_without_that_script_gets_the_plain_drain(self):
        page_resources.set_mode("styles")
        self.assertEqual(
            page_resources.drain_call(PAGE_SCRIPTS), (PAGE_SCRIPTS["collectorDrain"], ())
        )

    def test_a_live_run_reads_nothing_back(self):
        page_resources.set_mode("none")
        self.assertEqual(
            page_resources.drain_call(SCRIPTS), (PAGE_SCRIPTS["collectorDrain"], ())
        )

    def test_a_url_already_sent_is_not_sent_again(self):
        page_resources.set_mode("styles")
        first, _ = page_resources.take({"pageResources": [CSS]})
        again, _ = page_resources.take({"pageResources": [CSS]})
        self.assertEqual((first, again), ([CSS], []))

    def test_the_snapshot_drain_returns_the_page_resources(self):
        page_resources.set_mode("styles")
        exec_fn = _Exec(
            {
                "mutations": [],
                "pageResources": [CSS, "junk"],
                "resourceReReads": [RE_READ],
                "pendingResources": 2,
            }
        )
        payload = SnapshotCapturer(exec_fn, SCRIPTS, preloaded=True).pull_trace()

        self.assertEqual(exec_fn.calls, [RESOURCES_DRAIN])
        self.assertEqual(exec_fn.args, [([],)])
        self.assertEqual(payload.page_resources, [CSS])
        self.assertEqual(payload.resource_re_reads, [RE_READ])


class SettleTest(unittest.TestCase):
    def setUp(self):
        self.addCleanup(page_resources.reset)

    def test_drains_until_no_read_is_in_flight(self):
        page_resources.set_mode("styles")
        page_resources.take({"pendingResources": 2})
        answers = [{"pendingResources": 1}, {"pendingResources": 0}]
        drains = []

        def drain():
            drains.append(1)
            page_resources.take(answers.pop(0))

        page_resources.settle(drain, sleep=lambda _s: None)
        self.assertEqual(len(drains), 2)

    def test_a_drain_that_reaches_no_collector_ends_the_wait(self):
        page_resources.set_mode("styles")
        page_resources.take({"pendingResources": 3})
        drains = []
        page_resources.settle(lambda: drains.append(1), sleep=lambda _s: None)
        self.assertEqual(len(drains), 1)

    def test_nothing_waits_in_a_run_that_stores_nothing(self):
        page_resources.take({"pendingResources": 3})
        drains = []
        page_resources.settle(lambda: drains.append(1), sleep=lambda _s: None)
        self.assertEqual(drains, [])


class ForwardTest(unittest.TestCase):
    def test_resources_and_reads_go_on_their_own_scopes(self):
        transport = RecordingTransport()
        SessionCapturer(transport).send_page_resources([CSS], [RE_READ])

        self.assertEqual(transport.of_scope(SCOPE_PAGE_RESOURCES), [[CSS]])
        self.assertEqual(transport.of_scope(SCOPE_RESOURCE_RE_READS), [[RE_READ]])

    def test_nothing_is_sent_for_a_drain_without_them(self):
        transport = RecordingTransport()
        SessionCapturer(transport).send_page_resources([], [])
        self.assertEqual(transport.sent, [])


class PytestOptionTest(unittest.TestCase):
    def test_the_command_line_wins_over_the_ini_file(self):
        config = _Config(
            options={"--devtools-trace-resources": "none"},
            ini={"devtools_trace_resources": "styles"},
        )
        self.assertEqual(plugin._resolve_trace_resources(config), "none")

    def test_the_ini_file_answers_when_the_command_line_does_not(self):
        config = _Config(ini={"devtools_trace_resources": "none"})
        self.assertEqual(plugin._resolve_trace_resources(config), "none")

    def test_an_unset_ini_option_answered_as_a_list_is_unset(self):
        config = _Config(ini={"devtools_trace_resources": []})
        self.assertIsNone(plugin._resolve_trace_resources(config))


if __name__ == "__main__":
    unittest.main()


class EnableTest(unittest.TestCase):
    """enable() sets the mode before it reaches for a backend, so one that cannot start still shows it."""

    def setUp(self):
        patcher = mock.patch.dict(os.environ, {}, clear=False)
        patcher.start()
        self.addCleanup(patcher.stop)
        for name in ("DEVTOOLS_TRACE", "DEVTOOLS_TRACE_RESOURCES", "DEVTOOLS_PORT"):
            os.environ.pop(name, None)
        self.addCleanup(page_resources.reset)

    def _enable(self, **kwargs):
        import selenium_devtools as devtools

        with mock.patch.object(devtools.rerun, "configure_script"), \
                mock.patch.object(devtools.rerun, "log_published"), \
                mock.patch.object(
                    devtools.backend, "launch_or_attach", side_effect=OSError("no backend")
                ):
            self.assertIsNone(devtools.enable(**kwargs))
        return page_resources.mode()

    def test_trace_mode_stores_styles_unless_told_otherwise(self):
        self.assertEqual(self._enable(trace=True), "styles")
        self.assertEqual(self._enable(trace=True, trace_resources="none"), "none")

    def test_the_environment_answers_in_trace_mode(self):
        os.environ["DEVTOOLS_TRACE_RESOURCES"] = "none"
        self.assertEqual(self._enable(trace=True), "none")

    def test_live_mode_reads_nothing_back(self):
        self.assertEqual(self._enable(trace=False, trace_resources="styles"), "none")


class WallTimeTest(unittest.TestCase):
    def test_a_bidi_row_carries_the_browser_clock_start_the_trace_writer_matches_reads_on(self):
        from selenium_devtools import bidi, frames

        kwargs = bidi.request_sent_kwargs(
            {"request": {"request": "r1", "url": CSS["url"], "method": "GET"}, "timestamp": 5002}
        )
        self.assertEqual(frames.network_request(**kwargs)["wallTime"], 5002)
