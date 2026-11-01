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

import ast
import linecache
import logging
import os
import sys
from typing import Any, Callable, Dict, Optional, Tuple

from . import assertions
from .constants import LOGGER_NAME

_log = logging.getLogger(f"{LOGGER_NAME}.asserts")

# Per file: {first line of an `assert` -> (last line, condition source)}. Keyed by
# the whole file rather than by line because a statement can SPAN lines, and a
# single line cannot tell you where it ends — `assert (` parses as nothing, and
# resolving on the next line event would call the assert done while it was still
# evaluating. Cached because a loop hits the same assert repeatedly.
_ASSERT_SPANS: Dict[str, Dict[int, Tuple[int, Optional[str]]]] = {}


def _assert_lines(filename: str) -> Dict[int, Tuple[int, Optional[str]]]:
    """Every line belonging to an `assert`, mapped to (its statement's first
    line, its condition source).

    Indexed by EVERY line of the statement, not just its first, because CPython
    does not walk a multi-line statement in order. Measured for an assert
    spanning lines 17-20::

        line=18  line=19  line=18  line=17  line=20  line=17  line=18  exception

    The first event is 18, the first line fires twice in the middle, and in
    another case line 17 never fires at all. So "is this line the start of an
    assert" is unanswerable; "which assert does this line belong to" is not.
    """
    cached = _ASSERT_SPANS.get(filename)
    if cached is not None:
        return cached
    lines: Dict[int, Tuple[int, Optional[str]]] = {}
    try:
        tree = ast.parse("".join(linecache.getlines(filename)))
    except Exception as exc:  # noqa: BLE001 — an unparseable file simply has none
        _log.debug("could not read asserts from %s: %s", filename, exc)
        _ASSERT_SPANS[filename] = lines
        return lines
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assert):
            continue
        end = getattr(node, "end_lineno", None) or node.lineno
        try:
            condition = ast.unparse(node.test)
        except Exception:  # noqa: BLE001 — the row still gets its outcome
            condition = None
        for lineno in range(node.lineno, end + 1):
            lines[lineno] = (node.lineno, condition)
    _ASSERT_SPANS[filename] = lines
    return lines


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
                self._on_line(frame)
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

    def _on_line(self, frame: Any) -> None:
        """Track which assert statement, if any, execution is inside.

        Line numbers within a statement arrive out of order, so the only durable
        question is which statement OWNS the current line. Leaving one means it
        completed without raising; entering a different one means the previous
        completed too.
        """
        filename = frame.f_code.co_filename
        owner = _assert_lines(filename).get(frame.f_lineno)
        pending = self._pending.get(id(frame))
        pending_start = pending[3] if pending is not None else None

        if owner is None:
            if pending is not None:
                self._resolve(frame, error=None)  # left the statement, no raise
            return

        start, condition = owner
        if pending_start == start:
            return  # still inside the same statement, wherever within it
        if pending is not None:
            self._resolve(frame, error=None)
        self._arm(frame, filename, start, condition)

    def _arm(
        self, frame: Any, filename: str, start: int, condition: Optional[str]
    ) -> None:
        """Record the assert now executing, with the values it compares.

        Read from the frame now rather than after: a failing comparison's
        operands may be gone by then, and re-reading them could run user code.
        The condition is the UNPARSED expression, so a multi-line assert is
        labelled with what it tests rather than the `assert (` its first physical
        line happens to hold.
        """
        _, operands = assertions.parse_assert_statement(
            f"assert {condition}" if condition else "", frame
        )
        self._pending[id(frame)] = (
            condition, operands, f"{filename}:{start}", start,
        )

    def _resolve(self, frame: Any, *, error: Optional[BaseException]) -> None:
        pending = self._pending.pop(id(frame), None)
        if pending is None:
            return
        source, operands, location, _start = pending
        self._on_assertion(
            passed=error is None,
            source=source,
            operands=operands,
            location=location,
            error=error,
        )
