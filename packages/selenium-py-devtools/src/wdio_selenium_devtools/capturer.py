"""Session capturer — the Python analogue of core's ``SessionCapturerBase``.

Owns the transport, a per-session command counter, and the normalize→send
path. Deliberately thin: it turns already-captured data into wire frames and
pushes them. No driver knowledge lives here (that's instrumentation.py); no
post-processing lives here (that's the backend's job, per the architecture).
"""

from __future__ import annotations

import threading
from typing import Any, List, Optional, Protocol

from . import frames
from ._contract import (
    SCOPE_COMMANDS,
    SCOPE_CONSOLE_LOGS,
    SCOPE_METADATA,
    SCOPE_NETWORK_REQUESTS,
    SCOPE_SUITES,
)
from .utils import now_ms, to_jsonable


class Transport(Protocol):
    connected: bool

    def send_json(self, scope: str, data: Any) -> bool: ...
    def close(self) -> None: ...


class SessionCapturer:
    def __init__(self, transport: Transport) -> None:
        self._tx = transport
        self._command_counter = 0
        self._lock = threading.Lock()
        self._metadata_sent = False
        self.session_id: Optional[str] = None

    # ── metadata ───────────────────────────────────────────────────────────────

    def ensure_metadata(
        self, session_id: str, capabilities: Optional[dict], url: Optional[str]
    ) -> None:
        if self._metadata_sent or not session_id:
            return
        self._metadata_sent = True
        self.session_id = session_id
        self._tx.send_json(
            SCOPE_METADATA,
            frames.metadata(session_id, to_jsonable(capabilities or {}), url),
        )

    # ── commands ───────────────────────────────────────────────────────────────

    def capture_command(
        self,
        *,
        command: str,
        args: Any,
        result: Any = None,
        error: Optional[BaseException] = None,
        start_time: int,
        call_source: Optional[str],
    ) -> None:
        with self._lock:
            self._command_counter += 1
            command_id = self._command_counter
        norm_args = args if isinstance(args, list) else ([] if args is None else [args])
        entry = frames.command_log(
            command=command,
            args=to_jsonable(norm_args),
            result=to_jsonable(result),
            error=error,
            timestamp=now_ms(),
            start_time=start_time,
            call_source=call_source,
            command_id=command_id,
        )
        self._tx.send_json(SCOPE_COMMANDS, [entry])

    # ── console / network ────────────────────────────────────────────────────────

    def capture_console(self, level: str, args: List[Any], source: str = "browser") -> None:
        self._tx.send_json(
            SCOPE_CONSOLE_LOGS,
            [frames.console_log(level=level, args=to_jsonable(args),
                                timestamp=now_ms(), source=source)],
        )

    def capture_network(self, **kwargs: Any) -> None:
        self._tx.send_json(SCOPE_NETWORK_REQUESTS, [frames.network_request(**kwargs)])

    # ── suites ───────────────────────────────────────────────────────────────────

    def send_suites(self, suites: List[dict]) -> None:
        self._tx.send_json(SCOPE_SUITES, suites)

    def close(self) -> None:
        self._tx.close()
