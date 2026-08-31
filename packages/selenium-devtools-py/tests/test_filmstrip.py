"""The dense filmstrip in a Python trace.

The JS adapters hand their recorder's buffer straight to the exporter
in-process. An adapter that exports through the backend has to send it, so the
filmstrip becomes a stream like any other — and the recorder, which trace mode
otherwise switches off, has to run for it to exist at all.
"""

import unittest
from unittest import mock

from selenium_devtools import instrumentation, trace_export
from selenium_devtools._contract import SCOPE_SCREENCAST_FRAMES
from selenium_devtools.constants import SCREENCAST_FRAME_BATCH


class FakeTransport:
    def __init__(self, *, sends=True, raises_after=None):
        self.connected = True
        self.sent = []
        self._sends = sends
        self._raises_after = raises_after

    def send_json(self, scope, data):
        if self._raises_after is not None and len(self.sent) >= self._raises_after:
            raise OSError("socket gone")
        self.sent.append((scope, data))
        return self._sends

    def close(self):
        self.connected = False


def frames(n, *, start=0):
    return [{"data": f"f{i}", "timestamp": start + i} for i in range(n)]


class TestStreamingTheFilmstrip(unittest.TestCase):
    def test_frames_go_out_under_the_screencast_frames_scope(self):
        tx = FakeTransport()

        self.assertEqual(trace_export.send_frames(tx, frames(3)), 3)

        scope, batch = tx.sent[0]
        self.assertEqual(scope, SCOPE_SCREENCAST_FRAMES)
        self.assertEqual([f["data"] for f in batch], ["f0", "f1", "f2"])

    # One message carrying a full buffer would sit near the socket's payload
    # limit, and the transport masks payloads in a per-byte Python loop.
    def test_a_large_buffer_is_batched(self):
        tx = FakeTransport()
        total = SCREENCAST_FRAME_BATCH * 2 + 7

        self.assertEqual(trace_export.send_frames(tx, frames(total)), total)

        self.assertEqual(len(tx.sent), 3)
        self.assertEqual(len(tx.sent[0][1]), SCREENCAST_FRAME_BATCH)
        self.assertEqual(len(tx.sent[-1][1]), 7)
        # Every frame reaches the backend exactly once, in order.
        streamed = [f["data"] for _, batch in tx.sent for f in batch]
        self.assertEqual(streamed, [f["data"] for f in frames(total)])

    # Fewer frames is a poorer video, not a broken trace — the run must not fail.
    def test_a_refused_or_throwing_socket_stops_without_raising(self):
        refused = FakeTransport(sends=False)
        self.assertEqual(trace_export.send_frames(refused, frames(120)), 0)

        throwing = FakeTransport(raises_after=1)
        sent = trace_export.send_frames(throwing, frames(120))
        self.assertEqual(sent, SCREENCAST_FRAME_BATCH)

    def test_nothing_to_send_is_not_a_message(self):
        tx = FakeTransport()
        self.assertEqual(trace_export.send_frames(tx, []), 0)
        self.assertEqual(trace_export.send_frames(None, frames(3)), 0)
        self.assertEqual(tx.sent, [])


class TestWhereTheFramesComeFrom(unittest.TestCase):
    """Collected as each session finalizes, because that is the only moment
    they are reachable.

    The first version read them at export time from `_state["sessions"]`, which
    is a WeakKeyDictionary keyed by driver — and `_finalize_screencast` pops the
    recorder off the entry at quit anyway. So a real run streamed nothing and
    the trace fell back to the sparse per-action strip; the unit test passed
    because it populated `sessions` by hand with live recorders.
    """

    class Recorder:
        def __init__(self, buf):
            self._buf = buf
            self.stopped = 0
            self.finalized = 0

        @property
        def frames(self):
            return list(self._buf)

        def stop(self):
            self.stopped += 1

        def finalize(self, *a, **k):
            self.finalized += 1
            return None

    def _finalize(self, recorder, *, trace, filmstrip):
        from selenium_devtools.capturer import SessionCapturer

        entry = {"screencast": recorder}
        with mock.patch.dict(
            instrumentation._state,
            {"trace": trace, "filmstrip": filmstrip, "filmstrip_frames": []},
        ):
            instrumentation._finalize_screencast(
                SessionCapturer(FakeTransport()), "sess", entry
            )
            return instrumentation.screencast_frames()

    def test_the_buffer_is_kept_as_the_session_finalizes(self):
        rec = self.Recorder(frames(3))
        kept = self._finalize(rec, trace=True, filmstrip=True)
        self.assertEqual([f["data"] for f in kept], ["f0", "f1", "f2"])

    # The recorder is popped off the entry here, so anything not taken now is
    # unreachable afterwards.
    def test_nothing_is_kept_without_a_filmstrip(self):
        rec = self.Recorder(frames(3))
        self.assertEqual(self._finalize(rec, trace=True, filmstrip=False), [])

    def test_trace_mode_stops_the_recorder_instead_of_encoding(self):
        rec = self.Recorder(frames(3))
        self._finalize(rec, trace=True, filmstrip=True)
        self.assertEqual(rec.finalized, 0, "encoded a .webm in trace mode")
        self.assertEqual(rec.stopped, 1)

    def test_live_mode_still_encodes_the_video(self):
        rec = self.Recorder(frames(3))
        self._finalize(rec, trace=False, filmstrip=False)
        self.assertEqual(rec.finalized, 1)

    def test_sessions_accumulate_in_time_order(self):
        # A replaced session can finish after a later one started, so quit
        # order is not frame order.
        with mock.patch.dict(
            instrumentation._state,
            {"filmstrip_frames": frames(2, start=100) + frames(2, start=0)},
        ):
            collected = instrumentation.screencast_frames()
        self.assertEqual([f["timestamp"] for f in collected], [0, 1, 100, 101])


class TestWhenTheRecorderRuns(unittest.TestCase):
    """Trace mode switches the recorder off — except for the filmstrip, which
    is the one thing that needs it."""

    def test_the_option_defaults_on_like_the_js_adapters(self):
        import selenium_devtools as pkg

        with mock.patch.dict("os.environ", {}, clear=True):
            self.assertTrue(pkg._filmstrip_enabled(None))

    def test_it_is_opt_out(self):
        import selenium_devtools as pkg

        for value, expected in [
            ("0", False), ("false", False), ("no", False), ("off", False),
            ("", False), ("1", True), ("true", True),
        ]:
            with self.subTest(value=value):
                with mock.patch.dict(
                    "os.environ", {"DEVTOOLS_FILMSTRIP": value}, clear=True
                ):
                    self.assertIs(pkg._filmstrip_enabled(None), expected)

    def test_the_argument_wins(self):
        import selenium_devtools as pkg

        with mock.patch.dict("os.environ", {"DEVTOOLS_FILMSTRIP": "0"}, clear=True):
            self.assertTrue(pkg._filmstrip_enabled(True))


if __name__ == "__main__":
    unittest.main()


class TestTheRecorderRunsForTheFilmstrip(unittest.TestCase):
    """Drives the real session bring-up. The gate added with the trace export
    switched the recorder off in trace mode outright; without the filmstrip
    exception there are no frames to send and every test above passes on an
    empty buffer."""

    class Driver:
        def __init__(self):
            self.session_id = "sess-film"
            self.caps = {"browserName": "chrome"}

        def execute(self, command, params=None):
            return {"value": None}

        def get_screenshot_as_base64(self):
            return "c2hvdA=="

    def setUp(self):
        from selenium_devtools.capturer import SessionCapturer

        instrumentation.uninstall()
        self.cap = SessionCapturer(FakeTransport())

    def tearDown(self):
        instrumentation.uninstall()

    def _bring_up(self, *, trace, filmstrip):
        instrumentation.install(
            self.cap, self.Driver, trace=trace, filmstrip=filmstrip
        )
        with mock.patch.object(instrumentation, "ScreencastRecorder") as rec, \
                mock.patch.object(
                    instrumentation, "start_push_screencast", return_value=None
                ), \
                mock.patch.object(instrumentation, "bidi"), \
                mock.patch.object(instrumentation, "bidi_preload"), \
                mock.patch.object(
                    instrumentation, "collector_source_text", return_value=None
                ):
            instrumentation._ensure_session_setup(self.Driver(), self.cap)
        return rec

    def test_trace_mode_with_a_filmstrip_records(self):
        self._bring_up(trace=True, filmstrip=True).assert_called_once()

    def test_trace_mode_without_one_does_not(self):
        self._bring_up(trace=True, filmstrip=False).assert_not_called()

    def test_live_mode_records_regardless(self):
        # The dashboard video does not depend on the filmstrip option.
        self._bring_up(trace=False, filmstrip=False).assert_called_once()
