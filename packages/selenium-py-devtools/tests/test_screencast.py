import os
import shutil
import tempfile
import unittest

from wdio_selenium_devtools.capturer import SessionCapturer
from wdio_selenium_devtools.screencast import ScreencastRecorder

# 16x16 PNG — a real decodable frame with even dimensions so libvpx/yuv420p can
# actually encode a video (odd/1px dimensions make ffmpeg reject the stream).
_PNG_FRAME = (
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAEElEQVR4"
    "nGNgGAWjYBTAAAADEAABPywr7AAAAABJRU5ErkJggg=="
)


class FakeTransport:
    connected = True

    def __init__(self):
        self.sent = []

    def send_json(self, scope, data):
        self.sent.append((scope, data))
        return True

    def close(self):
        pass


def _stub_shots(*values):
    """A screenshot fn returning each value in turn, then the last forever."""
    seq = list(values)

    def fn():
        return seq.pop(0) if len(seq) > 1 else seq[0]

    return fn


class TestBuffering(unittest.TestCase):
    def test_capture_buffers_frames_per_call(self):
        # Frames are captured synchronously, one per capture() — the seed frame
        # from start() plus one for each explicit capture.
        rec = ScreencastRecorder()
        rec.start(driver=None, screenshot_fn=_stub_shots("a", "b", "c"))
        rec.capture()
        rec.capture()
        self.assertGreaterEqual(len(rec.frames), 2)
        self.assertTrue(all("data" in f and "timestamp" in f for f in rec.frames))

    def test_capture_is_noop_after_stop(self):
        rec = ScreencastRecorder()
        rec.start(driver=None, screenshot_fn=lambda: "x")
        rec.stop()
        rec.stop()  # no raise
        count_after_stop = len(rec.frames)
        self.assertFalse(rec.capture())  # disarmed → no frame
        self.assertEqual(len(rec.frames), count_after_stop)
        self.assertFalse(rec.is_recording)

    def test_stays_armed_when_seed_screenshot_fails(self):
        # A failed seed (page still loading) must not disable the recorder — a
        # later capture can still succeed. The old poll loop died on first miss.
        rec = ScreencastRecorder()
        rec.start(driver=None, screenshot_fn=lambda: None)
        self.assertTrue(rec.is_recording)
        self.assertEqual(rec.frames, [])

    def test_transient_failure_does_not_stop_recording(self):
        calls = {"n": 0}

        def flaky():
            calls["n"] += 1
            if calls["n"] == 2:
                raise RuntimeError("session busy")
            return "shot"

        rec = ScreencastRecorder()
        rec.start(driver=None, screenshot_fn=flaky)  # seed ok (call 1)
        self.assertFalse(rec.capture())  # call 2 raises → skipped, not fatal
        self.assertTrue(rec.is_recording)  # still armed
        self.assertTrue(rec.capture())  # call 3 succeeds
        self.assertGreaterEqual(len(rec.frames), 2)

    def test_duration_zero_below_two_frames(self):
        rec = ScreencastRecorder()
        rec.start(driver=None, screenshot_fn=lambda: "only")
        rec.stop()
        self.assertEqual(rec.duration, 0)

    def test_uses_driver_screenshot_when_no_fn(self):
        class Driver:
            def get_screenshot_as_base64(self):
                return "shot"

        rec = ScreencastRecorder()
        rec.start(Driver())  # seed frame via driver's screenshot
        self.assertTrue(rec.is_recording)
        self.assertGreaterEqual(len(rec.frames), 1)

    def test_start_skips_when_driver_has_no_screenshot(self):
        rec = ScreencastRecorder()
        rec.start(object())  # no get_screenshot_as_base64
        self.assertFalse(rec.is_recording)

    def test_add_frame_buffers_precaptured_screenshot(self):
        # add_frame reuses a screenshot the caller already took (for the command
        # entry) instead of paying for a second round-trip.
        rec = ScreencastRecorder()
        rec.start(driver=None, screenshot_fn=lambda: "seed")
        self.assertTrue(rec.add_frame("reused"))
        self.assertEqual(rec.frames[-1]["data"], "reused")

    def test_add_frame_noop_when_disarmed_or_empty(self):
        rec = ScreencastRecorder()
        self.assertFalse(rec.add_frame("x"))  # not started
        rec.start(driver=None, screenshot_fn=lambda: "seed")
        self.assertFalse(rec.add_frame(None))  # empty payload
        self.assertFalse(rec.add_frame(""))


class TestFinalize(unittest.TestCase):
    def test_finalize_empty_frames_returns_none(self):
        rec = ScreencastRecorder()
        self.assertIsNone(rec.finalize("sess-1"))

    def test_finalize_below_min_frames_returns_none(self):
        rec = ScreencastRecorder()
        rec.start(driver=None, screenshot_fn=lambda: "one")
        rec.stop()
        # Only the seed frame captured → below the 2-frame minimum.
        self.assertIsNone(rec.finalize("sess-1", min_frames=2))

    def test_finalize_skips_encode_without_ffmpeg(self):
        rec = ScreencastRecorder(ffmpeg_path=None)
        rec._ffmpeg = None  # force "ffmpeg unavailable"
        rec._frames = [{"data": "a", "timestamp": 1}, {"data": "b", "timestamp": 2}]
        self.assertIsNone(rec.finalize("sess-1"))


class TestCapturerSend(unittest.TestCase):
    def test_send_screencast_builds_scoped_frame(self):
        cap = SessionCapturer(FakeTransport())
        cap.session_id = "sess-9"
        cap.send_screencast(
            video_path="/tmp/v.webm", video_file="v.webm",
            frame_count=5, duration=1000, start_time=42,
        )
        frames_sent = [d for s, d in cap._tx.sent if s == "screencast"]
        self.assertEqual(len(frames_sent), 1)
        info = frames_sent[0]
        self.assertEqual(info["sessionId"], "sess-9")
        self.assertEqual(info["videoFile"], "v.webm")
        self.assertEqual(info["frameCount"], 5)
        self.assertEqual(info["startTime"], 42)

    def test_send_screencast_noop_without_session(self):
        cap = SessionCapturer(FakeTransport())
        cap.send_screencast(
            video_path="/tmp/v.webm", video_file="v.webm",
            frame_count=5, duration=1000, start_time=42,
        )
        self.assertEqual(cap._tx.sent, [])

    def test_screencast_frame_carries_videopath_for_backend_registry(self):
        # The backend intercepts scope=='screencast', registers `videoPath`, and
        # serves that file at /api/video/:sessionId — so the frame MUST carry
        # videoPath alongside sessionId.
        cap = SessionCapturer(FakeTransport())
        cap.session_id = "sess-9"
        cap.send_screencast(
            video_path="/abs/v.webm", video_file="v.webm",
            frame_count=5, duration=1000, start_time=42,
        )
        info = [d for s, d in cap._tx.sent if s == "screencast"][0]
        self.assertEqual(info["videoPath"], "/abs/v.webm")
        self.assertEqual(info["sessionId"], "sess-9")


class TestScreencastDeliveryEndToEnd(unittest.TestCase):
    """finalize → send_screencast must yield a frame pointing at a real file."""

    @unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg not on PATH")
    def test_finalize_encodes_and_delivers_frame(self):
        out_dir = tempfile.mkdtemp(prefix="screencast-test-")
        self.addCleanup(lambda: shutil.rmtree(out_dir, ignore_errors=True))
        rec = ScreencastRecorder()
        rec._frames = [
            {"data": _PNG_FRAME, "timestamp": 1000},
            {"data": _PNG_FRAME, "timestamp": 1200},
        ]
        info = rec.finalize("sess-7", output_dir=out_dir)
        self.assertIsNotNone(info)
        self.assertTrue(os.path.isfile(info["video_path"]))
        self.assertEqual(info["frame_count"], 2)

        cap = SessionCapturer(FakeTransport())
        cap.session_id = "sess-7"
        cap.send_screencast(**info)
        frame = [d for s, d in cap._tx.sent if s == "screencast"][0]
        # videoPath is what the backend reads off disk to serve the video.
        self.assertTrue(os.path.isfile(frame["videoPath"]))
        self.assertEqual(frame["sessionId"], "sess-7")


if __name__ == "__main__":
    unittest.main()
