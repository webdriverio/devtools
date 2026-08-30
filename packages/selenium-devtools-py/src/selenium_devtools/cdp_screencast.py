"""Chrome's push-mode screencast, over CDP.

The per-command recorder in :mod:`.screencast` takes one screenshot per command
on the main thread, which is a real constraint rather than a shortcut: a
Selenium session is not thread-safe, so a poll thread racing the test's own
commands corrupts both the video and the DOM readback.

Chrome can PUSH frames instead. ``Page.startScreencast`` streams them as CDP
events over a **separate websocket**, so frames arrive without issuing anything
on the session's command channel. That is what makes a real frame stream safe
here where a poll loop was not.

The socket is opened by this module rather than by ``driver.start_devtools()``.
Selenium keeps ONE cached ``_websocket_connection`` per driver and hands it to
whichever of BiDi or CDP asks first; the adapter attaches BiDi before this runs,
so ``start_devtools()`` returned the BiDi socket and the screencast commands
reached a BiDi endpoint, which answered ``unknown command: 'Page.startScreencast'``.
BiDi carries console and network capture and is worth far more than a smoother
video, so it keeps the shared connection and the screencast opens its own.

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
        #: Frames are discarded until the test's first command starts. Chrome
        #: sends its current frame the moment `startScreencast` is accepted,
        #: and arming happens during session setup — before that command runs —
        #: so on a fresh driver that frame is an unpainted `about:blank` the
        #: test never saw. Nothing composites again until the destination
        #: paints, and the encoder holds every frame for its real inter-frame
        #: duration, so that one frame played for the whole opening navigation:
        #: measured at 3-4s of blank on 4-6s videos. The per-command recorder
        #: had the same bug and fixed it by taking no seed frame; a pushed
        #: stream cannot, because the browser decides when to send.
        self._accepting = False
        #: True once the browser accepted `startScreencast`. Decides whether a
        #: stop command is owed on the way out.
        self.streaming = False
        # The events arrive on the websocket's own reader thread while `stop`
        # runs on the test's, and both touch `_stopped` and the connection.
        self._lock = threading.Lock()

    @property
    def frame_count(self) -> int:
        return self._frames

    def begin_run(self, seed: Optional[str] = None) -> None:
        """Start keeping frames, from the first COMPLETED command onward.

        `seed` is that command's own screenshot. Chrome sends a frame only when
        something composites, so a stream opened on a page that has finished
        painting may send nothing until the test next changes it — the seed is
        what makes the video begin here rather than at that next change.

        Idempotent, and only the first call seeds: the hook calls this after
        every command rather than tracking which one was first.
        """
        with self._lock:
            if self._accepting:
                return
            self._accepting = True
        if seed:
            self._frames += 1
            self._sink(seed)

    def _on_frame(self, event: Any) -> None:
        """Buffer one pushed frame and acknowledge it.

        Runs on the websocket reader thread. The ack has to happen even when
        the frame is refused — an unacked frame is the last one Chrome sends,
        so dropping the ack would silently end the recording rather than skip
        a frame. That applies to the pre-run frames dropped here too.
        """
        with self._lock:
            if self._stopped:
                return
            accepting = self._accepting
        session_id = getattr(event, "session_id", None)
        try:
            data = getattr(event, "data", None)
            if accepting and isinstance(data, str) and data:
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
        """Stop the stream and close the connection. Idempotent, never raises."""
        with self._lock:
            if self._stopped:
                return
            self._stopped = True
        if self.streaming:
            try:
                self._connection.execute(self._devtools.page.stop_screencast())
            except Exception as exc:  # noqa: BLE001 — a dead session ends it anyway
                _log.debug("screencast: stop was not acknowledged (%s)", exc)
        self._release()

    def discard(self) -> None:
        """Unwind a subscription whose stream never started.

        Deliberately not `stop`: asking the browser to stop a screencast it
        refused to start is what turned a single quiet decline into a second,
        alarming line in the user's console.
        """
        with self._lock:
            self._stopped = True
        self._release()

    def _release(self) -> None:
        if self._callback_id is not None:
            try:
                self._connection.remove_callback(
                    self._devtools.page.ScreencastFrame, self._callback_id
                )
            except Exception as exc:  # noqa: BLE001
                _log.debug("screencast: unsubscribe failed (%s)", exc)
            self._callback_id = None
        # Ours to close — unlike `start_devtools`'s cached connection, which the
        # BiDi session is using for console and network.
        try:
            self._connection.close()
        except Exception as exc:  # noqa: BLE001
            _log.debug("screencast: closing the CDP socket failed (%s)", exc)


#: Where a Chromium driver reports the local debugger, per browser flavour.
_DEBUGGER_ADDRESS_CAPS = ("goog:chromeOptions", "ms:edgeOptions")


def _endpoint_from_capabilities(caps: dict) -> Optional[tuple]:
    """``se:cdp`` — set on a Grid session, absent for a local browser.

    Rejected when it is the BiDi endpoint: with `webSocketUrl` requested that is
    the socket console and network capture runs on, and CDP commands sent there
    come back as `unknown command`.
    """
    url = caps.get("se:cdp")
    version = str(caps.get("se:cdpVersion") or "").split(".")[0]
    if not url or not version or url == caps.get("webSocketUrl"):
        return None
    return version, url


def _endpoint_from_debugger(caps: dict) -> Optional[tuple]:
    """Ask the browser itself, which is the only route for a LOCAL session.

    `se:cdp` is a Grid capability, so on the common case — a chromedriver
    started on this machine — the endpoint has to be read from the debugger
    address the driver reports, exactly as selenium's own `_get_cdp_details`
    does. Uses stdlib urllib rather than selenium's private method: the adapter
    has already been broken once by selenium moving internals out from under it.
    """
    import json
    import re
    import urllib.request

    address = None
    for key in _DEBUGGER_ADDRESS_CAPS:
        options = caps.get(key)
        if isinstance(options, dict) and options.get("debuggerAddress"):
            address = options["debuggerAddress"]
            break
    if not address:
        return None
    with urllib.request.urlopen(  # noqa: S310 — a loopback address from the driver
        f"http://{address}/json/version", timeout=5
    ) as response:
        data = json.loads(response.read())
    url = data.get("webSocketDebuggerUrl")
    match = re.search(r".*/(\d+)\.", str(data.get("Browser") or ""))
    if not url or not match:
        return None
    return match.group(1), url


def cdp_endpoint(driver: Any) -> Optional[tuple]:
    """``(cdp major version, websocket url)`` for this browser, or None."""
    caps = getattr(driver, "capabilities", None) or {}
    if not isinstance(caps, dict):
        return None
    return _endpoint_from_capabilities(caps) or _endpoint_from_debugger(caps)


def _load_devtools(version: str) -> Any:
    """The generated CDP module for this browser's protocol version.

    Imported here, not at module scope: selenium is a hard dependency but this
    submodule is not always present, and a unit test replaces this seam rather
    than the whole library.
    """
    from selenium.webdriver.common.bidi.cdp import import_devtools

    return import_devtools(version)


def _open_connection(url: str, config: Any) -> Any:
    """A websocket of our own to the browser's CDP endpoint."""
    from selenium.webdriver.remote.websocket_connection import WebSocketConnection

    return WebSocketConnection(
        url,
        getattr(config, "websocket_timeout", 30),
        getattr(config, "websocket_interval", 5),
    )


def _connect(driver: Any) -> Optional[tuple]:
    """Open our OWN CDP connection and attach it to the driver's window."""
    resolved = cdp_endpoint(driver)
    if resolved is None:
        _log.debug("screencast: no CDP endpoint of its own to stream over")
        return None
    version, url = resolved
    devtools = _load_devtools(version)
    connection = _open_connection(
        url, getattr(getattr(driver, "command_executor", None), "client_config", None)
    )
    # Address the tab the test is driving, not whatever target is listed first.
    handle = getattr(driver, "current_window_handle", None)
    targets = connection.execute(devtools.target.get_targets())
    target_id = next(
        (t.target_id for t in targets if t.target_id == handle),
        targets[0].target_id if targets else None,
    )
    if target_id is None:
        connection.close()
        return None
    connection.session_id = connection.execute(
        devtools.target.attach_to_target(target_id, True)
    )
    return devtools, connection


def start_push_screencast(
    driver: Any,
    sink: FrameSink,
    *,
    every_nth_frame: int = DEFAULT_EVERY_NTH_FRAME,
    max_edge: int = DEFAULT_MAX_EDGE,
) -> Optional[PushScreencast]:
    """Subscribe to Chrome's frame stream, or return None if it is unavailable.

    None is the ordinary answer on any non-Chromium browser, on a session whose
    only websocket is BiDi, and on a Chrome whose CDP version selenium does not
    bundle. The caller keeps per-command capture in every one of those cases, so
    this reports once at debug level rather than warning about a browser doing
    nothing wrong.
    """
    try:
        opened = _connect(driver)
    except Exception as exc:  # noqa: BLE001 — no usable CDP is a normal outcome
        _log.debug("screencast: could not open a CDP connection (%s)", exc)
        return None
    if opened is None:
        return None
    devtools, connection = opened

    recorder = PushScreencast(connection, devtools, sink)
    try:
        # Recorded before the start command, so a failure there still unwinds
        # the subscription rather than leaving a live callback behind.
        recorder._callback_id = connection.add_callback(
            devtools.page.ScreencastFrame, recorder._on_frame
        )
        connection.execute(
            devtools.page.start_screencast(
                format_=_FORMAT,
                every_nth_frame=every_nth_frame,
                max_width=max_edge,
                max_height=max_edge,
            )
        )
    except Exception as exc:  # noqa: BLE001
        _log.debug("screencast: the browser refused to stream (%s)", exc)
        # Unwind WITHOUT asking it to stop something that never started — that
        # second command is what turned one quiet decline into two alarming
        # lines in the user's console.
        recorder.discard()
        return None
    recorder.streaming = True
    _log.info("screencast: streaming frames from the browser (CDP push mode)")
    return recorder
