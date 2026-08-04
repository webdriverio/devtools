"""Capture the test's ``print()`` output (stdout) and forward each line to the
dashboard as a ``terminal`` console log, so a test's prints show up alongside
browser logs. ``logging`` output is handled separately by ``logcapture`` (it
usually goes to stderr), so we tee stdout only to avoid double-capturing logs.

Tees stdout (still writes to the real terminal) and splits on newlines. The
adapter's own ``[wdio-devtools]`` lines are skipped so they don't echo back.
"""

from __future__ import annotations

import sys
import threading
from typing import Any, Callable, Optional

# The adapter's own log lines carry this prefix — never re-capture them.
_SELF_PREFIX = "[wdio-devtools]"


class _TeeStream:
    """Wraps a text stream: writes through to it AND emits complete lines."""

    def __init__(self, original: Any, emit: Callable[[str], None]) -> None:
        self._orig = original
        self._emit = emit
        self._buf = ""
        self._lock = threading.Lock()

    def write(self, text: str) -> int:
        written = self._orig.write(text)
        try:
            with self._lock:
                self._buf += text
                while "\n" in self._buf:
                    line, self._buf = self._buf.split("\n", 1)
                    line = line.rstrip("\r")
                    if line.strip() and not line.startswith(_SELF_PREFIX):
                        self._emit(line)
        except Exception:  # noqa: BLE001 — capture must never break the test's output
            pass
        return written

    def flush(self) -> None:
        self._orig.flush()

    def __getattr__(self, name: str) -> Any:
        # Delegate isatty/fileno/encoding/etc. to the wrapped stream.
        return getattr(self._orig, name)


class TerminalCapturer:
    """Tees sys.stdout into the capturer as terminal console logs."""

    def __init__(self, capturer: Any) -> None:
        self._capturer = capturer
        self._orig_out: Optional[Any] = None
        self._emitting = False

    def start(self) -> None:
        if self._orig_out is not None:  # already started
            return
        self._orig_out = sys.stdout
        sys.stdout = _TeeStream(self._orig_out, lambda ln: self._emit("log", ln))

    def stop(self) -> None:
        if self._orig_out is not None:
            sys.stdout = self._orig_out
            self._orig_out = None

    def _emit(self, level: str, line: str) -> None:
        if self._emitting:  # guard against re-entry if forwarding writes anything
            return
        self._emitting = True
        try:
            self._capturer.capture_console(level, [line], source="terminal")
        except Exception:  # noqa: BLE001
            pass
        finally:
            self._emitting = False
