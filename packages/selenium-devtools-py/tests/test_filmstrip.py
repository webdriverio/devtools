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


class TestALiveSessionStillContributes(unittest.TestCase):
    """An export can run before the last driver quits.

    Frames are only reachable from one place at a time: a finalized session's
    buffer was kept as it finalized, a live one's is still on its recorder — and
    `uninstall` stops live recorders without keeping anything, so reading only
    the finalized accumulator drops whatever the last session recorded.
    """

    class Recorder:
        def __init__(self, buf):
            self._buf = buf

        @property
        def frames(self):
            return list(self._buf)

    def test_a_live_recorder_is_read_as_well(self):
        with mock.patch.dict(
            instrumentation._state,
            {
                "filmstrip_frames": frames(2, start=0),
                "sessions": {"d": {"screencast": self.Recorder(frames(2, start=100))}},
            },
        ):
            collected = instrumentation.screencast_frames()
        self.assertEqual([f["timestamp"] for f in collected], [0, 1, 100, 101])

    def test_a_live_session_alone_is_enough(self):
        with mock.patch.dict(
            instrumentation._state,
            {
                "filmstrip_frames": [],
                "sessions": {"d": {"screencast": self.Recorder(frames(3))}},
            },
        ):
            self.assertEqual(len(instrumentation.screencast_frames()), 3)

    def test_a_recorder_that_raises_does_not_break_the_export(self):
        class Broken:
            @property
            def frames(self):
                raise RuntimeError("session gone")

        with mock.patch.dict(
            instrumentation._state,
            {"filmstrip_frames": frames(2), "sessions": {"d": {"screencast": Broken()}}},
        ):
            self.assertEqual(len(instrumentation.screencast_frames()), 2)


class TestRetriesDoNotDuplicateFrames(unittest.TestCase):
    """A failed export is retried at teardown (#340), and the backend APPENDS
    these — it has no key to replace or dedupe on — so resending the buffer
    would put every frame in the trace twice."""

    def setUp(self):
        import selenium_devtools as pkg

        self.pkg = pkg
        self.saved = dict(pkg._active)

    def tearDown(self):
        self.pkg._active.clear()
        self.pkg._active.update(self.saved)

    def _arm(self):
        self.pkg._active.update(
            capturer=None, transport=FakeTransport(), process=None, url=None,
            handle=None, terminal=None, logs=None, excepthook=None,
            trace=True, traced=False, filmstrip_mark=None,
        )

    def _export_with(self, buf, *, accepted=None):
        """Run one export attempt over `buf`; returns the send_frames mock."""
        take = (lambda tx, f: len(f)) if accepted is None else (lambda tx, f: accepted)
        with mock.patch.object(
            instrumentation, "screencast_frames", return_value=buf
        ), mock.patch.object(
            instrumentation, "resolved_output_dir", return_value="/out"
        ), mock.patch.object(
            trace_export, "send_frames", side_effect=take
        ) as send, mock.patch.object(trace_export, "export", return_value=None):
            self.pkg.export_trace()
        return send

    # The boundary is inclusive, so a retry re-sends the one frame the last
    # attempt ended on — never the buffer. The exporter content-addresses frame
    # bytes, so that duplicate shares a resource with the original.
    def test_a_retry_resends_only_the_boundary_frame(self):
        self._arm()
        buf = frames(10)
        self._export_with(buf)
        send = self._export_with(buf)
        self.assertEqual(
            [f["timestamp"] for f in send.call_args[0][1]], [9],
            "resent more than the boundary frame",
        )

    def test_a_retry_sends_what_a_partial_send_missed(self):
        self._arm()
        buf = frames(10)
        self._export_with(buf, accepted=4)   # 0..3 accepted, watermark 3
        send = self._export_with(buf)
        self.assertEqual(
            [f["timestamp"] for f in send.call_args[0][1]], [3, 4, 5, 6, 7, 8, 9]
        )

    # Two frames can share a millisecond. An exclusive boundary dropped the
    # unsent twin — a hole in the filmstrip — because the watermark had already
    # advanced past its timestamp.
    def test_a_frame_sharing_the_boundary_millisecond_is_not_lost(self):
        self._arm()
        twin_a = {"data": "a", "timestamp": 5}
        twin_b = {"data": "b", "timestamp": 5}
        buf = frames(5) + [twin_a, twin_b] + frames(2, start=6)

        self._export_with(buf, accepted=6)   # ends on twin_a, watermark 5
        send = self._export_with(buf)

        resent = [f["data"] for f in send.call_args[0][1]]
        self.assertIn("b", resent, "dropped the unsent twin")

    # The buffer is BOUNDED and decimated in place — `screencast._decimate`
    # halves it, keeping the ends — so between two attempts the list can shrink
    # and every index shift. An offset would skip frames it never sent.
    def test_a_decimated_buffer_between_attempts_loses_nothing(self):
        self._arm()
        first = frames(10)                       # timestamps 0..9
        self._export_with(first, accepted=6)     # 0..5 accepted, watermark 5

        # The live recorder halves its buffer, then records more.
        decimated = [first[0], *first[1:-1:2], first[-1]] + frames(3, start=10)
        send = self._export_with(decimated)

        resent = [f["timestamp"] for f in send.call_args[0][1]]
        self.assertNotIn(0, resent, "resent a frame the backend already has")
        # 6 and 8 are absent because decimation REMOVED them — they no longer
        # exist to send. 5 is the inclusive boundary.
        self.assertEqual(resent, [5, 7, 9, 10, 11, 12])

    def test_frames_older_than_the_watermark_are_never_resent(self):
        self._arm()
        self._export_with(frames(5))             # watermark 4
        send = self._export_with(frames(5, start=0) + frames(2, start=5))
        self.assertEqual([f["timestamp"] for f in send.call_args[0][1]], [4, 5, 6])


class TestUninstallKeepsLiveFrames(unittest.TestCase):
    """`disable()` uninstalls BEFORE its fallback export, and uninstall replaces
    `sessions` — so a session that never quit would have its frames dropped
    before anything could read them. That is the plain-script path exactly: no
    per-test fixture quits the driver, so the last session is always live."""

    class Recorder:
        def __init__(self, buf):
            self._buf = buf
            self.stopped = 0

        @property
        def frames(self):
            return list(self._buf)

        def stop(self):
            self.stopped += 1

    def tearDown(self):
        instrumentation.uninstall()

    def _uninstall_with(self, *, filmstrip):
        rec = self.Recorder(frames(4))
        sessions = {"driver": {"screencast": rec}}
        with mock.patch.dict(
            instrumentation._state,
            {
                "sessions": sessions,
                "filmstrip": filmstrip,
                "filmstrip_frames": [],
                "installed": False,
            },
        ):
            instrumentation.uninstall()
            kept = list(instrumentation._state["filmstrip_frames"])
        return rec, kept

    def test_a_live_recorders_buffer_survives_uninstall(self):
        rec, kept = self._uninstall_with(filmstrip=True)
        self.assertEqual(len(kept), 4)
        self.assertEqual(rec.stopped, 1, "recorder left running past teardown")

    def test_nothing_is_kept_without_a_filmstrip(self):
        rec, kept = self._uninstall_with(filmstrip=False)
        self.assertEqual(kept, [])
        self.assertEqual(rec.stopped, 1)
