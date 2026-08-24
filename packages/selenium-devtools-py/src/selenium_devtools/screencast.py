"""Screencast recorder — the Python analogue of core's ``ScreencastRecorderBase``.

The recorder owns a frame buffer and the encode; it does not care where frames
came from. Two sources feed it:

* **Chrome, pushed.** :mod:`.cdp_screencast` subscribes to
  ``Page.screencastFrame`` and hands each frame to :meth:`add_frame`. Preferred
  where it is available, because the browser decides when the picture changed.
* **Everything else, one frame per command.** A screenshot taken
  **synchronously on the main thread**, driven from the instrumentation hook.

A background poll thread is deliberately NOT used for that second path:
Selenium's session is not thread-safe, and a screenshot fired from a daemon
thread races the main thread's commands and DOM-trace readback on the same
connection, corrupting both the video and the snapshot. Push mode escapes that
because CDP events arrive on their own websocket rather than the session's
command channel — which is why it is a different mechanism rather than the same
poll loop moved.

On ``stop`` the buffered frames are encoded to a ``.webm`` via ffmpeg *if it's on
PATH* — ffmpeg is an optional dependency, so its absence is a one-line warning
and a skipped encode, never an error.

Everything is defensive: a transient screenshot failure (e.g. mid-navigation) is
skipped and recording continues; a recorder that never captured a frame encodes
nothing. Capture never breaks the user's test.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
import threading
import weakref
from typing import Any, Callable, List, Optional

from .constants import (
    LOGGER_NAME,
    SCREENCAST_IMAGE_FORMAT,
    SCREENCAST_MAX_BUFFER_FRAMES,
    SCREENCAST_MIN_FRAMES,
)
from .output_dir import OUTPUT_SUBDIR, ensure_output_dir
from .types import ScreencastFrame
from .utils import now_ms

#: Screenshot fn signature — injectable so tests drive the buffer without a
#: real driver. Returns a base64 PNG string, or None on a transient failure.
ScreenshotFn = Callable[[], Optional[str]]


_log = logging.getLogger(f"{LOGGER_NAME}.screencast")


def _warn(message: str) -> None:
    _log.warning(message)


def _weak_screenshot(driver: Any) -> ScreenshotFn:
    """A screenshot callable that holds the driver weakly."""
    try:
        ref = weakref.ref(driver)
    except TypeError:  # not weak-referenceable; fall back to the bound method
        return driver.get_screenshot_as_base64

    def take() -> Optional[str]:
        live = ref()
        return live.get_screenshot_as_base64() if live is not None else None

    return take


class ScreencastRecorder:
    def __init__(
        self,
        *,
        ffmpeg_path: Optional[str] = None,
        max_frames: int = SCREENCAST_MAX_BUFFER_FRAMES,
    ) -> None:
        # Resolve ffmpeg once; None means "encoding unavailable, skip it".
        self._ffmpeg = ffmpeg_path or shutil.which("ffmpeg")
        self._frames: List[ScreencastFrame] = []
        self._screenshot: Optional[ScreenshotFn] = None
        self._active = False
        self._max_frames = max(2, max_frames)
        self._buffer_lock = threading.Lock()
        # Frames offered, and how many are offered per one kept. See `_buffer`.
        self._seen = 0
        self._stride = 1
        # The newest frame the stride skipped, held rather than dropped so the
        # recording can still end on it. See `_keep_tail`.
        self._pending_tail: Optional[ScreencastFrame] = None

    # ── public API ────────────────────────────────────────────────────────────

    def start(self, driver: Any, screenshot_fn: Optional[ScreenshotFn] = None) -> None:
        """Arm the recorder. ``screenshot_fn`` is injectable for tests; by
        default it reads ``driver.get_screenshot_as_base64``. Frames are
        captured on the main thread via :meth:`capture` — no background
        polling. Safe to call twice.

        Deliberately captures NO seed frame. Arming happens on the first
        command, before that command runs, so on a fresh driver the page is
        still ``about:blank`` — a page the test never saw. The encoder holds
        each frame for its real inter-frame duration, so that blank was then
        shown for the whole of the opening navigation: measured at 3-4s of
        blank on videos only 3-7s long. The first frame now comes from the
        first command's own screenshot, which the command hook already buffers.
        """
        if self._active:
            return
        if screenshot_fn is not None:
            self._screenshot = screenshot_fn
        elif driver is not None and hasattr(driver, "get_screenshot_as_base64"):
            # Resolved through a weakref, not stored as a bound method: a bound
            # method keeps the driver alive for as long as the recorder does, so
            # a driver dropped without quit() could never be collected.
            self._screenshot = _weak_screenshot(driver)
        else:
            _warn("driver has no get_screenshot_as_base64 — recording skipped")
            return
        self._active = True

    def capture(self) -> bool:
        """Capture one frame synchronously (main thread). No-op if not armed.

        A transient failure — a screenshot taken mid-navigation, a dead session
        — is skipped and recording stays armed, so a single miss never truncates
        the video the way a background poll loop would. Returns True iff a frame
        was buffered."""
        if not self._active:
            return False
        fn = self._screenshot
        if fn is None:
            return False
        try:
            data = fn()
        except Exception:  # noqa: BLE001 — transient miss; keep recording
            return False
        if isinstance(data, str) and data:
            self._buffer(data)
            return True
        return False

    def add_frame(self, data: Optional[str]) -> bool:
        """Buffer a frame from an ALREADY-captured base64 image.

        Serves both sources: the per-command path reuses the screenshot it
        already took for the command entry rather than paying for a second
        round-trip, and CDP push mode hands over frames the browser sent
        unasked. No-op if not armed or the data is empty. Returns True iff a
        frame was buffered.

        Called from the CDP websocket's reader thread as well as the test's, so
        the append is guarded — a list append is atomic under the GIL but the
        decimation below is a read-modify-write.
        """
        if not self._active or not isinstance(data, str) or not data:
            return False
        self._buffer(data)
        return True

    def _buffer(self, data: str) -> None:
        with self._buffer_lock:
            self._seen += 1
            # Thin the INCOMING frames by however often the buffer has been
            # halved. Without this the buffer drifts toward holding only the end
            # of the run: each decimation halves what is already held while new
            # frames keep arriving unthinned. Measured on a 40-frame run at a cap
            # of 6, it kept frames 0, 1, 35, 37, 38, 39 — the last second of the
            # run and nothing from the middle of it.
            if self._seen % self._stride:
                # Held, not discarded: if the recording ends here this is the
                # newest frame there is, and `_keep_tail` folds it in. A video
                # that ends on a retained stride position instead shows a state
                # the run had already left — and the end is what a failure is
                # usually inspected for.
                self._pending_tail = {"data": data, "timestamp": now_ms()}
                return
            self._pending_tail = None
            self._frames.append({"data": data, "timestamp": now_ms()})
            if len(self._frames) > self._max_frames:
                self._decimate()
                self._stride *= 2

    def _decimate(self) -> None:
        """Halve the buffer, keeping the first and last frames.

        Push mode streams from the browser, so the buffer is not bounded by the
        test's own length the way per-command capture is. Dropping every other
        middle frame keeps the run evenly covered: the encoder derives each
        frame's on-screen duration from the timestamps, so the survivors simply
        hold longer. Truncating either end would lose the start or the finish of
        the run outright, which is the part someone is usually looking for.
        """
        frames = self._frames
        self._frames = [frames[0], *frames[1:-1:2], frames[-1]]

    def stop(self) -> None:
        """Disarm the recorder. Idempotent; safe even if start() never ran."""
        self._active = False
        self._keep_tail()

    def _keep_tail(self) -> None:
        """Fold the newest skipped frame in, so the video ends where the run did.

        Thinning the incoming frames is what keeps the buffer's coverage even
        (see `_buffer`), but it also means the last frame offered is only kept
        when the run happens to end on a stride position. `finalize` stops the
        recorder before reading the buffer, which is what makes this the last
        word on what the video ends with.
        """
        with self._buffer_lock:
            tail = self._pending_tail
            self._pending_tail = None
            if tail is None:
                return
            # No cap check: this adds exactly one frame to a buffer already at
            # or under the cap, and the recorder is stopped, so there is no
            # later growth for a decimation to be protecting against.
            self._frames.append(tail)

    @property
    def frames(self) -> List[ScreencastFrame]:
        return list(self._frames)

    @property
    def duration(self) -> int:
        """ms between first and last frame; 0 with fewer than 2 frames."""
        if len(self._frames) < 2:
            return 0
        return self._frames[-1]["timestamp"] - self._frames[0]["timestamp"]

    @property
    def is_recording(self) -> bool:
        return self._active

    # ── finalize ──────────────────────────────────────────────────────────────

    def finalize(
        self,
        session_id: str,
        output_dir: Optional[str] = None,
        *,
        min_frames: int = SCREENCAST_MIN_FRAMES,
        filename_prefix: str = "selenium-py-video",
    ) -> Optional[dict]:
        """Stop, encode the buffered frames to a ``.webm``, and return the
        ``{video_path, video_file, frame_count, duration, start_time}`` metadata
        the capturer forwards — or None if there's nothing to encode / ffmpeg is
        absent. All failures are caught: screencast is best-effort."""
        self.stop()
        frames = self.frames
        if len(frames) < min_frames:
            return None
        if not self._ffmpeg:
            _warn("ffmpeg not found on PATH — skipping video encode "
                  f"({len(frames)} frame(s) captured)")
            return None

        file_name = f"{filename_prefix}-{session_id}.webm"
        target_dir = _writable_dir(output_dir)
        video_path = os.path.join(target_dir, file_name)
        try:
            _encode_webm(frames, video_path, self._ffmpeg)
        except Exception as exc:  # noqa: BLE001 — encode failure must not abort
            _warn(f"encode failed: {exc}")
            return None
        return {
            "video_path": video_path,
            "video_file": file_name,
            "frame_count": len(frames),
            "duration": self.duration,
            "start_time": frames[0]["timestamp"] if frames else None,
        }


def _writable_dir(preferred: Optional[str]) -> str:
    """The directory to encode into. ``preferred`` is the resolved
    ``test-results`` path, which will not exist on a first run, so it is created
    here; a failure falls back to the temp dir rather than losing the video."""
    candidate = preferred or os.path.join(os.getcwd(), OUTPUT_SUBDIR)
    created = ensure_output_dir(candidate)
    if created:
        return created
    return tempfile.gettempdir()


def _encode_webm(frames: List[ScreencastFrame], output_path: str, ffmpeg: str) -> None:
    """Encode base64 frames to a VP8/WebM via ffmpeg's concat demuxer, giving
    each frame its real inter-frame duration (VFR reflects command pauses).
    Forces CFR 10fps + all-intra so the dashboard ``<video>`` can seek —
    mirrors core/video-encoder.ts."""
    import base64

    ext = SCREENCAST_IMAGE_FORMAT
    tmp_dir = tempfile.mkdtemp(prefix="devtools-screencast-")
    try:
        manifest_lines = ["ffconcat version 1.0"]
        for i, frame in enumerate(frames):
            frame_path = os.path.join(tmp_dir, f"frame-{i:06d}.{ext}")
            with open(frame_path, "wb") as fh:
                fh.write(base64.b64decode(frame["data"]))
            next_ts = (
                frames[i + 1]["timestamp"]
                if i + 1 < len(frames)
                else frame["timestamp"] + 100
            )
            duration_s = max((next_ts - frame["timestamp"]) / 1000.0, 0.01)
            manifest_lines.append(f"file '{frame_path}'")
            manifest_lines.append(f"duration {duration_s:.6f}")
        # ffconcat drops the final duration without a trailing file line.
        last_path = os.path.join(tmp_dir, f"frame-{len(frames) - 1:06d}.{ext}")
        manifest_lines.append(f"file '{last_path}'")
        manifest_path = os.path.join(tmp_dir, "manifest.txt")
        with open(manifest_path, "w") as fh:
            fh.write("\n".join(manifest_lines))

        subprocess.run(
            [
                ffmpeg, "-y",
                "-f", "concat", "-safe", "0", "-i", manifest_path,
                "-c:v", "libvpx", "-b:v", "1M", "-pix_fmt", "yuv420p",
                "-vsync", "cfr", "-r", "10",
                "-g", "1", "-keyint_min", "1", "-auto-alt-ref", "0",
                output_path,
            ],
            check=True,
            capture_output=True,
        )
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
