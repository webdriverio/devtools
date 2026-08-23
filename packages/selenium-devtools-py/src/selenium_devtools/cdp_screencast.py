"""Chrome's push-mode screencast, over CDP.

The per-command recorder in :mod:`.screencast` takes one screenshot per command
on the main thread, which is a real constraint rather than a shortcut: a
Selenium session is not thread-safe, so a poll thread racing the test's own
commands corrupts both the video and the DOM readback.

Chrome can PUSH frames instead. ``Page.startScreencast`` streams them as CDP
events over a **separate websocket** — `driver.start_devtools()` opens its own
connection and attaches to the current target — so frames arrive without
issuing anything on the session's command channel. That is what makes a real
frame stream safe here where a poll loop was not.

Two things this has to bound, which per-command capture never needed to:

* **Rate.** ``every_nth_frame`` throttles at the source, so frames are dropped
  by the browser instead of buffered and thrown away by us.
* **Acknowledgement.** Chrome stops sending after an unacknowledged frame, so
  every frame is acked. A missed ack does not degrade the stream, it ends it.

Availability is discovered, never assumed: anything other than a Chromium
driver with a reachable CDP endpoint returns None and the caller keeps its
per-command capture. Nothing here may raise into the user's test.
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Callable, Optional

from .constants import LOGGER_NAME, SCREENCAST_IMAGE_FORMAT

_log = logging.getLogger(f"{LOGGER_NAME}.screencast")

#: Frames the browser skips between the ones it sends. Chrome emits on every
#: composite, which for an animation is far more than a filmstrip needs; asking
#: for every 2nd halves the stream at the source rather than downstream.
DEFAULT_EVERY_NTH_FRAME = 2

#: Bounds a frame's longest edge. A retina viewport otherwise streams images
#: several times the size the dashboard renders them at.
DEFAULT_MAX_EDGE = 1280

#: PNG rather than JPEG so the encoder's on-disk frames keep one extension and
#: one decoder; `SCREENCAST_IMAGE_FORMAT` is the single place that is decided.
_FORMAT = SCREENCAST_IMAGE_FORMAT

#: Callback taking one base64 image. Returns whether the frame was buffered,
#: which this module does not act on — it exists so the recorder's `add_frame`
#: can be passed directly.
FrameSink = Callable[[str], Any]


class PushScreencast:
    """A live CDP screencast. Created by :func:`start_push_screencast`."""

    def __init__(self, connection: Any, devtools: Any, sink: FrameSink) -> None:
        self._connection = connection
        self._devtools = devtools
        self._sink = sink
        self._callback_id: Optional[int] = None
        self._frames = 0
        self._stopped = False
        # The events arrive on the websocket's own reader thread while `stop`
        # runs on the test's, and both touch `_stopped` and the connection.
        self._lock = threading.Lock()

    @property
    def frame_count(self) -> int:
        return self._frames

    def _on_frame(self, event: Any) -> None:
        """Buffer one pushed frame and acknowledge it.

        Runs on the websocket reader thread. The ack has to happen even when
        the sink refuses the frame — an unacked frame is the last one Chrome
        sends, so dropping the ack would silently end the recording.
        """
        with self._lock:
            if self._stopped:
                return
        session_id = getattr(event, "session_id", None)
        try:
            data = getattr(event, "data", None)
            if isinstance(data, str) and data:
                self._frames += 1
                self._sink(data)
        except Exception as exc:  # noqa: BLE001 — never kill the reader thread
            _log.debug("screencast frame dropped: %s", exc)
        finally:
            if session_id is not None:
                self._ack(session_id)

    def _ack(self, session_id: Any) -> None:
        try:
            self._connection.execute(
                self._devtools.page.screencast_frame_ack(session_id=session_id)
            )
        except Exception as exc:  # noqa: BLE001 — a dead session ends the run anyway
            _log.debug("screencast ack failed: %s", exc)

    def stop(self) -> None:
        """Stop the stream. Idempotent, and never raises.

        The websocket is left open: `start_devtools` caches one connection per
        driver and closing it here would take the session's other CDP users
        down with it.
        """
        with self._lock:
            if self._stopped:
                return
            self._stopped = True
        try:
            self._connection.execute(self._devtools.page.stop_screencast())
        except Exception as exc:  # noqa: BLE001
            _log.debug("stop_screencast failed: %s", exc)
        if self._callback_id is not None:
            try:
                self._connection.remove_callback(
                    self._devtools.page.ScreencastFrame, self._callback_id
                )
            except Exception as exc:  # noqa: BLE001
                _log.debug("screencast unsubscribe failed: %s", exc)


def start_push_screencast(
    driver: Any,
    sink: FrameSink,
    *,
    every_nth_frame: int = DEFAULT_EVERY_NTH_FRAME,
    max_edge: int = DEFAULT_MAX_EDGE,
) -> Optional[PushScreencast]:
    """Subscribe to Chrome's frame stream, or return None if it is unavailable.

    None is the ordinary answer on any non-Chromium browser, on a grid session
    with no CDP endpoint, and on a Chrome whose CDP version selenium does not
    bundle. The caller keeps per-command capture in every one of those cases,
    so this reports at debug level rather than warning about a browser doing
    nothing wrong.
    """
    start = getattr(driver, "start_devtools", None)
    if not callable(start):
        _log.debug("push screencast unavailable: driver exposes no CDP")
        return None
    try:
        devtools, connection = start()
    except Exception as exc:  # noqa: BLE001 — no CDP is a normal outcome
        _log.debug("push screencast unavailable: %s", exc)
        return None
    if devtools is None or connection is None:
        return None

    recorder = PushScreencast(connection, devtools, sink)
    try:
        callback_id = connection.add_callback(
            devtools.page.ScreencastFrame, recorder._on_frame
        )
        # Recorded before the start command, so a failure there still unwinds
        # the subscription rather than leaving a live callback behind.
        recorder._callback_id = callback_id
        connection.execute(
            devtools.page.start_screencast(
                format_=_FORMAT,
                every_nth_frame=every_nth_frame,
                max_width=max_edge,
                max_height=max_edge,
            )
        )
    except Exception as exc:  # noqa: BLE001
        _log.debug("push screencast could not start: %s", exc)
        recorder.stop()
        return None
    _log.info("screencast: streaming frames from the browser (CDP push mode)")
    return recorder
