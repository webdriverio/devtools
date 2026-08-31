"""Ask the backend to build this run's trace archive.

Python cannot run the transforms: they are TypeScript in ``packages/trace`` —
the zip writer, action events, HAR, mutation reattribution — and porting them
would be the second copy of ~2,000 lines, with a third waiting for the next
language. That is what #298 decided against. The backend already accumulates
every frame this run sent (it does so for Preserve & Rerun), so it assembles
the artifact and answers with where it landed.

Two consequences worth knowing:

* **The export is a request, not a local write.** It travels on the worker
  socket and the answer comes back on the reader thread, so the caller blocks
  on an event rather than a return value.
* **A run has one artifact.** The backend's accumulator is run-scoped, so the
  archive covers the run rather than a session or a test. Per-test slicing is a
  later ticket; it needs boundaries only the adapter knows.

Nothing here may raise into the user's test — a run that captured everything
and failed to write an archive is still a run that passed.
"""

from __future__ import annotations

import logging
import threading
import uuid
from dataclasses import dataclass
from typing import Any, Optional

from ._contract import SCOPE_SCREENCAST_FRAMES, SCOPE_TRACE_EXPORT
from .constants import (
    LOGGER_NAME,
    SCREENCAST_FRAME_BATCH,
    TRACE_EXPORT_TIMEOUT_S,
)

_log = logging.getLogger(f"{LOGGER_NAME}.trace")


@dataclass
class _Pending:
    """The one export in flight. A run produces a single archive, so this is a
    module-level slot rather than a registry keyed by id — but the id is still
    checked, so a late reply from a previous run cannot resolve this one."""

    request_id: str
    done: threading.Event
    path: Optional[str] = None
    error: Optional[str] = None


_pending: Optional[_Pending] = None
_lock = threading.Lock()


def on_result(data: Any) -> None:
    """Handle a ``traceExported`` frame. Runs on the transport's reader thread.

    Ignores anything that does not answer the request actually in flight: the
    socket outlives a single export, and resolving on id alone is what keeps a
    stale reply from unblocking the wrong caller.
    """
    if not isinstance(data, dict):
        return
    with _lock:
        pending = _pending
        if pending is None or data.get("requestId") != pending.request_id:
            return
        path = data.get("path")
        error = data.get("error")
        pending.path = path if isinstance(path, str) else None
        pending.error = error if isinstance(error, str) else None
        pending.done.set()


def reset() -> None:
    """Forget any in-flight export. Called when a run tears down so the next
    one cannot be resolved by the previous one's reply."""
    global _pending
    with _lock:
        _pending = None


def send_frames(transport: Any, frames: list) -> int:
    """Stream the filmstrip to the backend ahead of the export request.

    In batches: a run's buffer reaches the recorder's cap of a couple of
    thousand JPEG frames, and one message carrying all of them would sit near
    the socket's payload limit — and the transport masks its payload in a
    per-byte Python loop, measured at ~57 MB/s, so a single huge frame is a
    visible stall as well as a risk.

    Returns how many frames were accepted. A partial send is not an error worth
    failing the run over: the exporter thins the filmstrip anyway, and fewer
    frames is a poorer video rather than a broken trace.
    """
    if not frames or transport is None:
        return 0
    sent = 0
    for start in range(0, len(frames), SCREENCAST_FRAME_BATCH):
        batch = frames[start : start + SCREENCAST_FRAME_BATCH]
        try:
            if not transport.send_json(SCOPE_SCREENCAST_FRAMES, batch):
                break
        except Exception as exc:  # noqa: BLE001 — never break the test
            _log.debug("filmstrip batch dropped: %s", exc)
            break
        sent += len(batch)
    if sent:
        _log.debug("streamed %d filmstrip frame(s) for the trace", sent)
    return sent


def export(
    transport: Any,
    *,
    output_dir: str,
    session_id: str,
    timeout: float = TRACE_EXPORT_TIMEOUT_S,
) -> Optional[str]:
    """Request the archive and block until the backend answers.

    Returns the path written, or None — no backend, a refused request, a
    backend that reported a failure, or one that did not answer in time. Every
    one of those is logged and none of them raises: the archive is the point of
    the run only when the run itself succeeded.
    """
    global _pending
    if transport is None or not getattr(transport, "connected", False):
        _log.debug("no dashboard connection; skipping trace export")
        return None

    pending = _Pending(request_id=uuid.uuid4().hex, done=threading.Event())
    with _lock:
        _pending = pending

    sent = False
    try:
        sent = transport.send_json(
            SCOPE_TRACE_EXPORT,
            {
                "requestId": pending.request_id,
                "outputDir": output_dir,
                "sessionId": session_id,
            },
        )
    except Exception as exc:  # noqa: BLE001 — a failed export is not a failed run
        _log.warning("could not ask for a trace export: %s", exc)
    if not sent:
        reset()
        return None

    if not pending.done.wait(timeout):
        _log.warning(
            "the dashboard did not answer the trace export within %.0fs; "
            "the run is unaffected",
            timeout,
        )
        reset()
        return None

    reset()
    if pending.error:
        _log.warning("trace export failed: %s", pending.error)
        return None
    if pending.path:
        _log.info("trace written to %s", pending.path)
    return pending.path
