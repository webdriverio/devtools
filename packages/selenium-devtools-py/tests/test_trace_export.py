"""Asking the backend to build this run's trace.

Python cannot run the transforms, so the archive arrives by request-and-reply
over the worker socket. What matters is less the happy path than the ways it
can go wrong: the reply lands on another thread, the socket outlives a single
export, the backend can refuse, and none of it may take the run down.
"""

import threading
import time
import unittest
from unittest import mock

from selenium_devtools import lifecycle, trace_export
from selenium_devtools._contract import SCOPE_TRACE_EXPORT, SCOPE_TRACE_EXPORTED


class FakeTransport:
    """Answers the export on a separate thread, as the real reader does."""

    def __init__(
        self, *, connected=True, reply=None, sends=True, raises=False, delay=0.0
    ):
        self.connected = connected
        self.sent = []
        self._reply = reply
        self._sends = sends
        self._raises = raises
        # A reply that lands before export() gets to wait would let a version
        # that never waits pass — measured: removing the wait kept every test
        # green, because the answering thread usually won the race.
        self._delay = delay

    def send_json(self, scope, data):
        if self._raises:
            raise OSError("socket gone")
        self.sent.append((scope, data))
        if self._reply is not None and self._sends:
            answer = dict(self._reply)
            answer.setdefault("requestId", data["requestId"])
            def answer_later():
                if self._delay:
                    time.sleep(self._delay)
                trace_export.on_result(answer)

            threading.Thread(target=answer_later, daemon=True).start()
        return self._sends

    def close(self):
        self.connected = False


class TestRequestingAnExport(unittest.TestCase):
    def tearDown(self):
        trace_export.reset()

    def test_the_path_the_backend_reports_is_returned(self):
        # Answered late on purpose: the caller has to wait for it.
        tx = FakeTransport(reply={"path": "/out/trace-sess-1.zip"}, delay=0.15)

        path = trace_export.export(tx, output_dir="/out", session_id="sess-1")

        self.assertEqual(path, "/out/trace-sess-1.zip")
        scope, data = tx.sent[0]
        self.assertEqual(scope, SCOPE_TRACE_EXPORT)
        self.assertEqual(data["outputDir"], "/out")
        self.assertEqual(data["sessionId"], "sess-1")
        self.assertTrue(data["requestId"])

    def test_a_reported_failure_is_none_rather_than_a_raise(self):
        tx = FakeTransport(reply={"error": "nothing captured for this run"})

        self.assertIsNone(
            trace_export.export(tx, output_dir="/out", session_id="s")
        )

    # A run that captured everything and could not write an archive still
    # passed; none of these may reach the user's test.
    def test_no_connection_no_send_and_a_throwing_socket_all_decline(self):
        for tx in (
            None,
            FakeTransport(connected=False),
            FakeTransport(sends=False),
            FakeTransport(raises=True),
        ):
            with self.subTest(transport=tx):
                self.assertIsNone(
                    trace_export.export(tx, output_dir="/out", session_id="s")
                )

    def test_a_backend_that_never_answers_times_out_and_returns(self):
        tx = FakeTransport(reply=None)  # accepts the send, never replies

        path = trace_export.export(
            tx, output_dir="/out", session_id="s", timeout=0.05
        )

        self.assertIsNone(path)
        # And the slot is clear, so the next run is not resolved by this one.
        self.assertIsNone(trace_export._pending)


class TestOnlyTheRequestInFlightIsAnswered(unittest.TestCase):
    """The socket outlives a single export, so a reply has to be matched."""

    def tearDown(self):
        trace_export.reset()

    def test_a_reply_carrying_another_request_id_is_ignored(self):
        tx = FakeTransport(reply={"requestId": "someone-else", "path": "/x.zip"})

        path = trace_export.export(
            tx, output_dir="/out", session_id="s", timeout=0.05
        )

        self.assertIsNone(path)

    def test_a_reply_with_no_export_in_flight_is_harmless(self):
        trace_export.on_result({"requestId": "stale", "path": "/x.zip"})
        trace_export.on_result("not-a-dict")
        trace_export.on_result(None)

    def test_reset_stops_a_late_reply_resolving_the_next_run(self):
        tx = FakeTransport(reply=None)
        trace_export.export(tx, output_dir="/out", session_id="s", timeout=0.05)
        late = dict(tx.sent[0][1])

        trace_export.on_result({"requestId": late["requestId"], "path": "/x.zip"})

        self.assertIsNone(trace_export._pending)


class TestTheReplyIsRouted(unittest.TestCase):
    """The frame arrives as a control message, so the handler has to route it —
    a correct export module reached through nothing is still no archive."""

    def tearDown(self):
        trace_export.reset()

    def test_the_control_handler_hands_the_frame_to_the_exporter(self):
        with mock.patch.object(trace_export, "on_result") as routed:
            lifecycle.on_control(SCOPE_TRACE_EXPORTED, {"requestId": "r1"})
        routed.assert_called_once_with({"requestId": "r1"})

    def test_it_does_not_trigger_the_dashboard_shutdown_path(self):
        with mock.patch.object(lifecycle, "_trigger_shutdown") as shutdown:
            lifecycle.on_control(SCOPE_TRACE_EXPORTED, {"requestId": "r1"})
        shutdown.assert_not_called()

    def test_the_dashboard_closing_still_shuts_down(self):
        with mock.patch.object(lifecycle, "_trigger_shutdown") as shutdown:
            lifecycle.on_control("clientDisconnected", {})
        shutdown.assert_called_once()



class TestTheRunTriggersTheExport(unittest.TestCase):
    """A correct exporter nothing calls writes no archive — and one called on
    every run writes archives for people who never asked for a trace."""

    def setUp(self):
        import selenium_devtools as pkg

        self.pkg = pkg
        self.saved = dict(pkg._active)

    def tearDown(self):
        self.pkg._active.clear()
        self.pkg._active.update(self.saved)
        trace_export.reset()

    def _teardown_with(self, *, trace):
        tx = FakeTransport(reply={"path": "/out/trace.zip"})
        self.pkg._active.update(
            capturer=None, transport=tx, process=None, url=None, handle=None,
            terminal=None, logs=None, excepthook=None, trace=trace,
        )
        with mock.patch.object(trace_export, "export", return_value="/out/t.zip") as ex:
            self.pkg.disable()
        return ex

    def test_trace_mode_exports_on_teardown(self):
        self._teardown_with(trace=True).assert_called_once()

    def test_a_normal_run_exports_nothing(self):
        self._teardown_with(trace=False).assert_not_called()

    # The archive is built by the backend from what this run streamed, and the
    # answer comes back on the same socket — so closing it first would time out
    # every export.
    def test_the_export_happens_before_the_transport_closes(self):
        order = []
        tx = FakeTransport()
        tx.close = lambda: order.append("closed")
        self.pkg._active.update(
            capturer=None, transport=tx, process=None, url=None, handle=None,
            terminal=None, logs=None, excepthook=None, trace=True,
        )
        with mock.patch.object(
            trace_export, "export", side_effect=lambda *a, **k: order.append("export")
        ):
            self.pkg.disable()
        self.assertEqual(order, ["export", "closed"])


class TestWhereTheArchiveLands(unittest.TestCase):
    """Beside the run's video, not in the cwd.

    `uninstall()` clears the resolved output dir, and it runs before the
    export — so reading it at export time yields None and the archive falls
    back to the cwd, which for a runner invoked from a repo root is the repo
    root. That is how a stray test-results/ appears there.
    """

    def setUp(self):
        import selenium_devtools as pkg

        self.pkg = pkg
        self.saved = dict(pkg._active)

    def tearDown(self):
        self.pkg._active.clear()
        self.pkg._active.update(self.saved)
        trace_export.reset()

    def test_the_dir_resolved_during_the_run_is_the_one_used(self):
        # The accessor is deliberately NOT mocked: what this pins is the ORDER,
        # and a stubbed reader answers the same whenever it is called.
        from selenium_devtools import instrumentation

        tx = FakeTransport()
        instrumentation._state["output_dir"] = "/spec/test-results"
        self.pkg._active.update(
            capturer=None, transport=tx, process=None, url=None, handle=None,
            terminal=None, logs=None, excepthook=None, trace=True,
        )
        try:
            with mock.patch.object(trace_export, "export", return_value=None) as ex:
                self.pkg.disable()
        finally:
            instrumentation._state["output_dir"] = None

        self.assertEqual(ex.call_args.kwargs["output_dir"], "/spec/test-results")

    def test_a_run_that_resolved_nothing_still_gets_a_directory(self):
        from selenium_devtools import instrumentation

        tx = FakeTransport()
        self.pkg._active.update(
            capturer=None, transport=tx, process=None, url=None, handle=None,
            terminal=None, logs=None, excepthook=None, trace=True,
        )
        with mock.patch.object(
            instrumentation, "resolved_output_dir", return_value=None
        ), mock.patch.object(trace_export, "export", return_value=None) as ex:
            self.pkg.disable()

        self.assertTrue(ex.call_args.kwargs["output_dir"].endswith("test-results"))


class TestWhoDecidesTraceMode(unittest.TestCase):
    def _enabled(self, arg, env):
        import selenium_devtools as pkg

        with mock.patch.dict("os.environ", {"DEVTOOLS_TRACE": env} if env else {},
                             clear=True):
            return pkg._trace_enabled(arg)

    def test_the_argument_wins_over_the_environment(self):
        # So a script can opt out of an exported default.
        self.assertFalse(self._enabled(False, "1"))
        self.assertTrue(self._enabled(True, ""))

    def test_the_environment_decides_when_the_argument_is_absent(self):
        for value, expected in [
            ("1", True), ("true", True), ("TRUE", True), ("yes", True),
            ("0", False), ("", False), ("off", False),
        ]:
            with self.subTest(value=value):
                self.assertIs(self._enabled(None, value), expected)

    def test_it_is_off_by_default(self):
        self.assertFalse(self._enabled(None, None))


if __name__ == "__main__":
    unittest.main()


class TestTheArchiveBelongsToTheRun(unittest.TestCase):
    """Not to the dashboard window.

    `pytest_sessionfinish` blocks on the window before tearing down, so an
    export that ran at teardown waited for a human — and in CI, which opens no
    window, it happened during process shutdown instead. Neither is when the
    run's data became complete.
    """

    def setUp(self):
        import selenium_devtools as pkg

        self.pkg = pkg
        self.saved = dict(pkg._active)

    def tearDown(self):
        self.pkg._active.clear()
        self.pkg._active.update(self.saved)
        trace_export.reset()

    def _armed(self, *, trace=True, traced=False):
        self.pkg._active.update(
            capturer=None, transport=FakeTransport(), process=None, url=None,
            handle=None, terminal=None, logs=None, excepthook=None,
            trace=trace, traced=traced,
        )

    def test_export_trace_writes_once_and_only_once(self):
        self._armed()
        with mock.patch.object(trace_export, "export", return_value="/o/t.zip") as ex:
            first = self.pkg.export_trace()
            second = self.pkg.export_trace()
        self.assertEqual(first, "/o/t.zip")
        self.assertIsNone(second)
        ex.assert_called_once()

    # Only a SUCCESSFUL export closes the door. This is public API, so a caller
    # may run it early, get nothing, and still expect an archive at the end;
    # latching on the attempt spends that one chance on a transport that was
    # not ready.
    def test_a_failed_export_leaves_the_teardown_fallback_armed(self):
        self._armed()
        with mock.patch.object(trace_export, "export", return_value=None):
            self.assertIsNone(self.pkg.export_trace())
        self.assertFalse(self.pkg._active["traced"])

    def test_teardown_still_writes_after_a_failed_attempt(self):
        self._armed()
        with mock.patch.object(trace_export, "export", return_value=None):
            self.pkg.export_trace()
        with mock.patch.object(trace_export, "export", return_value="/o/t.zip") as ex:
            self.pkg.disable()
        ex.assert_called_once()

    def test_a_successful_export_closes_it(self):
        self._armed()
        with mock.patch.object(trace_export, "export", return_value="/o/t.zip"):
            self.pkg.export_trace()
        self.assertTrue(self.pkg._active["traced"])

    def test_it_does_nothing_when_trace_mode_is_off(self):
        self._armed(trace=False)
        with mock.patch.object(trace_export, "export") as ex:
            self.assertIsNone(self.pkg.export_trace())
        ex.assert_not_called()

    def test_teardown_does_not_export_again(self):
        # The plugin exports at session finish; disable() must not repeat it.
        self._armed(traced=True)
        with mock.patch.object(trace_export, "export") as ex:
            self.pkg.disable()
        ex.assert_not_called()

    def test_teardown_still_covers_a_caller_that_never_asked(self):
        # A plain script calls neither export_trace() nor the plugin.
        self._armed()
        with mock.patch.object(trace_export, "export", return_value=None) as ex:
            self.pkg.disable()
        ex.assert_called_once()


class TestTraceModeOpensNoWindow(unittest.TestCase):
    """The artifact is the output, and `pytest_sessionfinish` blocks on the
    window until a human closes it — so a window turns writing a file into an
    interactive session. The backend still starts: it is what builds the
    archive."""

    def test_trace_mode_suppresses_the_window(self):
        from selenium_devtools import lifecycle

        self.assertFalse(lifecycle.auto_open_enabled(trace=True))

    def test_a_normal_run_still_opens_one(self):
        from selenium_devtools import backend, lifecycle

        with mock.patch.dict("os.environ", {}, clear=True), mock.patch.object(
            backend, "reuse_target", return_value=None
        ):
            self.assertTrue(lifecycle.auto_open_enabled(trace=False))

    def test_the_existing_opt_outs_still_win(self):
        from selenium_devtools import backend, lifecycle

        with mock.patch.dict("os.environ", {"DEVTOOLS_OPEN": "0"}, clear=True), \
                mock.patch.object(backend, "reuse_target", return_value=None):
            self.assertFalse(lifecycle.auto_open_enabled(trace=False))
        # A rerun child reports into the window that launched it.
        with mock.patch.dict("os.environ", {}, clear=True), mock.patch.object(
            backend, "reuse_target", return_value=("127.0.0.1", 1234)
        ):
            self.assertFalse(lifecycle.auto_open_enabled(trace=False))


class TestTraceModeRecordsNoVideo(unittest.TestCase):
    """The archive's frames are the per-command screenshots. The screencast is
    a live-dashboard artifact and `screencastFrames` does not cross the wire
    yet (#290), so recording one in trace mode writes a .webm nothing reads."""

    def setUp(self):
        from selenium_devtools import instrumentation

        self.instr = instrumentation
        instrumentation.uninstall()

    def tearDown(self):
        self.instr.uninstall()

    def test_install_records_the_mode(self):
        from selenium_devtools.capturer import SessionCapturer

        self.instr.install(SessionCapturer(FakeTransport()), FakeDriverForTrace,
                           trace=True)
        self.assertTrue(self.instr._state["trace"])

    def test_a_normal_run_still_records(self):
        from selenium_devtools.capturer import SessionCapturer

        self.instr.install(SessionCapturer(FakeTransport()), FakeDriverForTrace)
        self.assertFalse(self.instr._state["trace"])

    def _bring_up(self, *, trace):
        """Run the real session bring-up and report the entry it built."""
        from selenium_devtools.capturer import SessionCapturer

        cap = SessionCapturer(FakeTransport())
        driver = FakeDriverForTrace()
        self.instr.install(cap, FakeDriverForTrace, trace=trace)
        with mock.patch.object(self.instr, "ScreencastRecorder") as recorder, \
                mock.patch.object(self.instr, "start_push_screencast",
                                  return_value=None), \
                mock.patch.object(self.instr, "bidi"), \
                mock.patch.object(self.instr, "bidi_preload"), \
                mock.patch.object(self.instr, "collector_source_text",
                                  return_value=None):
            entry = self.instr._ensure_session_setup(driver, cap)
        return entry, recorder

    def test_no_recorder_is_created_in_trace_mode(self):
        entry, recorder = self._bring_up(trace=True)
        recorder.assert_not_called()
        if entry is not None:
            self.assertIsNone(entry.get("screencast"))

    def test_a_live_run_creates_one(self):
        # Guards the gate against being always-on: a normal run still records.
        _, recorder = self._bring_up(trace=False)
        recorder.assert_called_once()


class FakeDriverForTrace:
    """Minimal stand-in. Needs a session_id: bring-up returns early without
    one, which would make the gating assertions pass for the wrong reason."""

    def __init__(self):
        self.session_id = "sess-trace"
        self.caps = {"browserName": "chrome"}

    def execute(self, command, params=None):
        return {"value": None}

    def get_screenshot_as_base64(self):
        return "c2hvdA=="


class TestConcurrentExportsAreSerialized(unittest.TestCase):
    """`trace_export` holds ONE pending slot.

    Two overlapping exports both replace it, so the first caller's reply is
    dropped and it waits out the full 60s timeout while the backend builds the
    same archive twice at the same path. Reachable because teardown can run on
    the WS reader thread — `lifecycle._trigger_shutdown` hands it to whoever is
    parked, and runs it itself when nobody is — while a caller is mid-export on
    the main thread.
    """

    def setUp(self):
        import selenium_devtools as pkg

        self.pkg = pkg
        self.saved = dict(pkg._active)
        pkg._active.update(
            capturer=None, transport=FakeTransport(), process=None, url=None,
            handle=None, terminal=None, logs=None, excepthook=None,
            trace=True, traced=False,
        )

    def tearDown(self):
        self.pkg._active.clear()
        self.pkg._active.update(self.saved)
        trace_export.reset()

    def test_only_one_request_is_sent_when_two_callers_overlap(self):
        started = threading.Event()
        release = threading.Event()
        calls = []

        def slow_export(*args, **kwargs):
            calls.append(kwargs.get("session_id"))
            started.set()
            release.wait(2)
            return "/out/trace.zip"

        with mock.patch.object(trace_export, "export", side_effect=slow_export):
            first = threading.Thread(target=self.pkg.export_trace)
            first.start()
            self.assertTrue(started.wait(2), "first export never started")
            # Second caller arrives while the first is still waiting on the
            # backend — it must not replace the pending slot.
            second_result = []
            second = threading.Thread(
                target=lambda: second_result.append(self.pkg.export_trace())
            )
            second.start()
            release.set()
            first.join(3)
            second.join(3)

        self.assertEqual(len(calls), 1, "a second request was sent")
        self.assertEqual(second_result, [None])
        self.assertTrue(self.pkg._active["traced"])

    def test_teardown_waits_for_an_export_already_in_flight(self):
        # Otherwise disable() closes the transport the export is listening on.
        order = []
        release = threading.Event()
        started = threading.Event()

        def slow_export(*args, **kwargs):
            started.set()
            release.wait(2)
            order.append("export-done")
            return "/out/trace.zip"

        tx = self.pkg._active["transport"]
        tx.close = lambda: order.append("closed")

        with mock.patch.object(trace_export, "export", side_effect=slow_export):
            worker = threading.Thread(target=self.pkg.export_trace)
            worker.start()
            self.assertTrue(started.wait(2))
            teardown = threading.Thread(target=self.pkg.disable)
            teardown.start()
            release.set()
            worker.join(3)
            teardown.join(3)

        self.assertEqual(order, ["export-done", "closed"])
