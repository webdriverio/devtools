"""Screencast recorder — the Python analogue of core's ``ScreencastRecorderBase``.

Frames are captured **synchronously on the main thread, one per command**
(``driver.get_screenshot_as_base64()``), driven from the instrumentation hook.
A background poll thread is deliberately NOT used: Selenium's session is not
thread-safe, and a screenshot fired from a daemon thread races the main thread's
commands and DOM-trace readback on the same connection — corrupting both the
video and the snapshot. The reference JS adapters avoid this too (CDP push-mode
screencast / per-command screenshots on the command queue), so we mirror that.

On ``stop`` the buffered frames are encoded to a ``.webm`` via ffmpeg *if it's on
PATH* — ffmpeg is an optional dependency, so its absence is a one-line warning
and a skipped encode, never an error.

A CDP push-mode fast-path (Chrome ``Page.startScreencast`` via
``execute_cdp_cmd``) is a future optimization — noted here, not implemented;
per-command capture works on every browser selenium drives.

Everything is defensive: a transient screenshot failure (e.g. mid-navigation) is
skipped and recording continues; a recorder that never captured a frame encodes
nothing. Capture never breaks the user's test.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from typing import Any, Callable, List, Optional

from .constants import SCREENCAST_IMAGE_FORMAT, SCREENCAST_MIN_FRAMES
from .types import ScreencastFrame
from .utils import now_ms

#: Screenshot fn signature — injectable so tests drive the buffer without a
#: real driver. Returns a base64 PNG string, or None on a transient failure.
ScreenshotFn = Callable[[], Optional[str]]


def _warn(message: str) -> None:
    print(f"[wdio-devtools] screencast: {message}", file=sys.stderr)


class ScreencastRecorder:
    def __init__(self, *, ffmpeg_path: Optional[str] = None) -> None:
        # Resolve ffmpeg once; None means "encoding unavailable, skip it".
        self._ffmpeg = ffmpeg_path or shutil.which("ffmpeg")
        self._frames: List[ScreencastFrame] = []
        self._screenshot: Optional[ScreenshotFn] = None
        self._active = False

    # ── public API ────────────────────────────────────────────────────────────

    def start(self, driver: Any, screenshot_fn: Optional[ScreenshotFn] = None) -> None:
        """Arm the recorder and capture a seed frame. ``screenshot_fn`` is
        injectable for tests; by default it reads
        ``driver.get_screenshot_as_base64``. Frames are captured on the main
        thread via :meth:`capture` — no background polling. Safe to call twice."""
        if self._active:
            return
        if screenshot_fn is not None:
            self._screenshot = screenshot_fn
        elif driver is not None and hasattr(driver, "get_screenshot_as_base64"):
            self._screenshot = driver.get_screenshot_as_base64
        else:
            _warn("driver has no get_screenshot_as_base64 — recording skipped")
            return
        self._active = True
        self.capture()  # best-effort seed frame

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
            self._frames.append({"data": data, "timestamp": now_ms()})
            return True
        return False

    def add_frame(self, data: Optional[str]) -> bool:
        """Buffer a frame from an ALREADY-captured base64 screenshot — lets the
        caller reuse the per-command screenshot it took for the command entry
        instead of paying for a second screenshot round-trip. No-op if not armed
        or the data is empty. Returns True iff a frame was buffered."""
        if not self._active or not isinstance(data, str) or not data:
            return False
        self._frames.append({"data": data, "timestamp": now_ms()})
        return True

    def stop(self) -> None:
        """Disarm the recorder. Idempotent; safe even if start() never ran."""
        self._active = False

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
    candidate = preferred or os.getcwd()
    if os.path.isdir(candidate) and os.access(candidate, os.W_OK):
        return candidate
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
