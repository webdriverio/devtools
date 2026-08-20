"""Passing `assert` rows for a plain script, via line tracing.

pytest rewrites `assert` into code that reports its own outcome. A script run as
``python login.py`` gets none of that: by the time ``enable()`` executes, the
module is already compiled, so there is nothing left to rewrite and a passing
assert leaves no trace at all — the statement is a branch with no call in it.

What IS observable is the interpreter's own line events. An assert that passes is
one whose line executes and is followed by another line in the same frame; one
that fails raises on that line. So this watches for the line, then waits to see
which happened. Nothing is re-evaluated: the operands are read from the frame
BEFORE the statement runs, and only when reading them cannot execute user code
(see ``assertions._resolve_operand``).

The cost is a trace function, so this is deliberately narrow:

* only the script named on the command line is traced — every other frame is
  declined outright, so library and adapter code runs at full speed;
* it never installs over an existing trace function, because that is a debugger
  or a coverage tool and this is not worth breaking either;
* pytest runs turn it off — the plugin's hooks are better, giving real operands
  for every assertion rather than the safe subset.
"""

from __future__ import annotations

import linecache
import logging
import os
import sys
from typing import Any, Callable, Dict, Optional, Tuple

from . import assertions
from .constants import LOGGER_NAME

_log = logging.getLogger(f"{LOGGER_NAME}.asserts")

# (source, operands) per (filename, lineno), because a loop hits the same assert
# repeatedly and parsing is the expensive half of this.
_PARSE_CACHE: Dict[Tuple[str, int], Tuple[Optional[str], bool]] = {}


class ScriptAssertionTracer:
    """Reports each `assert` in the traced script as it resolves.

    ``on_assertion(passed, source, operands, location, error)`` is called once
    per executed assert statement.
    """

    def __init__(self, on_assertion: Callable[..., None], script: Optional[str]) -> None:
        self._on_assertion = on_assertion
        self._script = os.path.abspath(script) if script else None
        self._installed = False
        # The assert awaiting an outcome, per frame. Keyed by id(frame) so a
        # recursive call cannot have its pending assert resolved by another
        # frame's line event.
        self._pending: Dict[int, tuple] = {}
        # Bound ONCE, because `self._trace_calls` builds a new bound-method
        # object on every attribute access: comparing `sys.gettrace()` against a
        # fresh one is never identical, so uninstall would silently leave the
        # trace function installed for the rest of the process.
        self._entry = self._trace_calls
        self._lines = self._trace_lines

    # ── lifecycle ────────────────────────────────────────────────────────────

    def install(self) -> bool:
        """True when tracing started. False leaves the script unobserved, which
        costs only the passing rows."""
        if self._installed or not self._script:
            return False
        if not os.path.exists(self._script):
            return False
        existing = sys.gettrace()
        if existing is not None:
            # A debugger or coverage tool owns this. Replacing it would break
            # the user's breakpoints to add a row to a dashboard.
            _log.debug(
                "a trace function is already installed (%r) — passing assertions "
                "will not be captured", existing,
            )
            return False
        sys.settrace(self._entry)
        self._installed = True
        self._arm_running_frames()
        return True

    def _arm_running_frames(self) -> None:
        """Trace the frames that are ALREADY running.

        ``sys.settrace`` only reaches frames entered after it is called, and a
        script calls ``enable()`` from its module body — so that body, which is
        where its assertions live, would emit no line events at all. Every frame
        already on the stack that belongs to the script is opted in by hand.
        """
        frame: Any = sys._getframe()
        while frame is not None:
            if frame.f_code.co_filename == self._script:
                frame.f_trace_lines = True
                frame.f_trace = self._lines
            frame = frame.f_back

    def uninstall(self) -> None:
        if not self._installed:
            return
        self._installed = False
        self._pending.clear()
        if sys.gettrace() is self._entry:
            sys.settrace(None)

    # ── tracing ──────────────────────────────────────────────────────────────

    def _trace_calls(self, frame: Any, event: str, arg: Any) -> Any:
        """Global trace: opt individual frames IN, and decline everything else.

        Returning None for a frame stops line events for it entirely, which is
        what keeps this off the hot path of selenium and the adapter itself.
        """
        if frame.f_code.co_filename == self._script:
            return self._lines
        return None

    def _trace_lines(self, frame: Any, event: str, arg: Any) -> Any:
        try:
            if event == "line":
                # Reaching a new line means the previous assert did not raise.
                self._resolve(frame, error=None)
                self._arm(frame)
            elif event == "exception":
                raised = arg[1] if isinstance(arg, tuple) and len(arg) > 1 else None
                if isinstance(raised, AssertionError):
                    self._resolve(frame, error=raised)
                else:
                    # The assert's own expression raised, so it reached no
                    # verdict at all: `assert "/x" in None` is a TypeError, not
                    # a failure and certainly not a pass. There are three
                    # outcomes here, not two — collapsing this one into "no
                    # error" painted the line GREEN for an assertion that never
                    # ran to completion, which is worse than showing nothing.
                    self._pending.pop(id(frame), None)
            elif event == "return":
                self._resolve(frame, error=None)
        except Exception as exc:  # noqa: BLE001 — tracing must never break the run
            _log.debug("assertion tracing threw: %s", exc)
        return self._lines

    def _arm(self, frame: Any) -> None:
        """Record the assert about to execute, with the values it will compare.

        Read now, before the statement runs: afterwards a failing comparison's
        operands may be gone, and re-reading them could run user code.
        """
        lineno = frame.f_lineno
        filename = frame.f_code.co_filename
        source, is_assert = self._parsed(filename, lineno)
        if not is_assert:
            return
        _, operands = assertions.parse_assert_statement(
            linecache.getline(filename, lineno), frame
        )
        self._pending[id(frame)] = (source, operands, f"{filename}:{lineno}")

    def _resolve(self, frame: Any, *, error: Optional[BaseException]) -> None:
        pending = self._pending.pop(id(frame), None)
        if pending is None:
            return
        source, operands, location = pending
        self._on_assertion(
            passed=error is None,
            source=source,
            operands=operands,
            location=location,
            error=error,
        )

    @staticmethod
    def _parsed(filename: str, lineno: int) -> Tuple[Optional[str], bool]:
        """(condition source, is-an-assert) for one line, cached."""
        key = (filename, lineno)
        cached = _PARSE_CACHE.get(key)
        if cached is not None:
            return cached
        line = linecache.getline(filename, lineno)
        is_assert = line.strip().startswith("assert ")
        source = (
            assertions.parse_assert_statement(line, None)[0] if is_assert else None
        )
        _PARSE_CACHE[key] = (source, is_assert)
        return source, is_assert
