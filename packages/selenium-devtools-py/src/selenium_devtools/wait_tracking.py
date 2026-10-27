"""WebDriverWait tracking: a wait's polls fold into one row per call, and a
wait that fails becomes a row of its own.

``WebDriverWait.until`` is a client-side loop, so the ``execute`` chokepoint
sees only its polls: a ``findElement`` per evaluation, which the trace leaves
unmapped, and no trace of the wait or of the ``TimeoutException`` it raised.
This patches ``until``/``until_not`` to mark the commands issued inside the
condition, so ``execute`` folds each poll's repeat of a call into the row the
first poll made, and to report a failed wait as a ``wait`` row named after its
condition, at the user's call site, taking over its polls' latest row. That is
the Selenium Node.js adapter's ``wait-tracking.ts``, so the two Selenium
adapters show a wait the same way; a passing wait keeps no row of its own in
either.
"""

from __future__ import annotations

import json
import logging
import threading
from typing import Any, Callable, Dict, Iterable, Optional, Tuple

from .constants import LOGGER_NAME
from .types import CommandLog
from .utils import call_source, now_ms, to_jsonable

_log = logging.getLogger(f"{LOGGER_NAME}.wait_tracking")

_LABEL_MAX_CHARS = 120

# Element ids differ on every poll (each finds the element afresh), so a call is
# identified by what it does and what it targets, not by the handle it used.
_VOLATILE_PARAMS = ("id", "sessionId")


class WaitScope:
    """One ``until``/``until_not`` call, shared by its polls and its failure row."""

    def __init__(self) -> None:
        #: Each call of the condition, by poll key, to the row its repeats fold into.
        self.rows: Dict[str, CommandLog] = {}
        #: The latest poll's row, which a failed wait takes over.
        self.last_row: Optional[CommandLog] = None
        #: Waits issued inside this wait's condition, by identity and order.
        self.nested: Dict[str, "WaitScope"] = {}


class _Poll:
    """One evaluation of a wait's condition, counting the calls it has issued."""

    def __init__(self, scope: WaitScope) -> None:
        self.scope = scope
        self.seen: Dict[str, int] = {}

    def nth(self, call: str) -> str:
        n = self.seen.get(call, 0)
        self.seen[call] = n + 1
        return f"{call}#{n}"


_local = threading.local()
_installed: Dict[str, Any] = {}


def _current() -> Optional[_Poll]:
    return getattr(_local, "poll", None)


def poll_of(
    command: str, params: Any, selector: Optional[str]
) -> Optional[Tuple[WaitScope, str]]:
    """The wait this command polls for and its key, or None outside a wait."""
    poll = _current()
    if poll is None:
        return None
    stable = (
        {k: v for k, v in params.items() if k not in _VOLATILE_PARAMS}
        if isinstance(params, dict)
        else params
    )
    call = json.dumps(
        [command, to_jsonable(stable), selector], sort_keys=True, default=str
    )
    return poll.scope, poll.nth(call)


def folds_into(poll: Optional[Tuple[WaitScope, str]]) -> Optional[CommandLog]:
    """The row an earlier poll made for this same call, which this one replaces."""
    return poll[0].rows.get(poll[1]) if poll else None


def note_poll_row(poll: Optional[Tuple[WaitScope, str]], row: CommandLog) -> None:
    if poll:
        scope, key = poll
        scope.rows[key] = row
        scope.last_row = row


def condition_label(method: Any) -> str:
    """A readable name for a wait's condition.

    ``expected_conditions`` are factories returning a private closure, so the
    closure's own name (``_predicate``) says nothing; its factory and captured
    arguments are what the user wrote. A public nested function is named as is,
    since its enclosing function is the test, not a factory.
    """
    name = getattr(method, "__name__", None)
    qualname = getattr(method, "__qualname__", None)
    if not isinstance(name, str) or not isinstance(qualname, str):
        return type(method).__name__
    if name == "<lambda>":
        return "lambda"
    closure = getattr(method, "__closure__", None)
    if name.startswith("_") and "<locals>" in qualname and closure:
        factory = qualname.split(".<locals>")[0].rsplit(".", 1)[-1]
        label = f"{factory}({', '.join(_cell_repr(c) for c in closure)})"
    else:
        label = name
    return label if len(label) <= _LABEL_MAX_CHARS else label[: _LABEL_MAX_CHARS - 1] + "…"


def _cell_repr(cell: Any) -> str:
    try:
        return repr(cell.cell_contents)
    except ValueError:  # an empty cell: the closure's variable was never bound
        return "?"


def install(
    capturer: Any, skip_frames: Callable[[], Iterable[str]], wait_cls: Optional[type] = None
) -> None:
    """Patch ``WebDriverWait.until``/``until_not``; a no-op without selenium."""
    if _installed:
        return
    if wait_cls is None:
        try:
            from selenium.webdriver.support.wait import WebDriverWait  # lazy
        except ImportError:
            return
        wait_cls = WebDriverWait
    originals = {name: getattr(wait_cls, name, None) for name in ("until", "until_not")}
    for name, original in originals.items():
        if callable(original):
            setattr(wait_cls, name, _tracked(original, capturer, skip_frames, name == "until_not"))
    _installed.update(cls=wait_cls, originals=originals)


def uninstall() -> None:
    if not _installed:
        return
    for name, original in _installed["originals"].items():
        if original is not None:
            setattr(_installed["cls"], name, original)
    _installed.clear()


def _tracked(
    original: Callable[..., Any],
    capturer: Any,
    skip_frames: Callable[[], Iterable[str]],
    negated: bool,
) -> Callable[..., Any]:
    def wait(self: Any, method: Any, message: str = "") -> Any:
        scope = _scope_for(_current(), method, skip_frames)
        start = now_ms()
        src = call_source(skip_frames())
        try:
            return original(self, _in_poll(method, scope), message)
        except Exception as exc:
            _report_failure(capturer, self, method, scope, exc, start, src, negated)
            raise

    wait.__wrapped__ = original  # type: ignore[attr-defined]
    return wait


def _scope_for(
    outer: Optional[_Poll], method: Any, skip_frames: Callable[[], Iterable[str]]
) -> WaitScope:
    """A wait inside another wait's condition is the same wait on every outer
    poll, so it keeps one scope across them, keyed like a poll by where it was
    called, what it waits for and how many times this evaluation issued it."""
    if outer is None:
        return WaitScope()
    key = outer.nth(f"wait {call_source(skip_frames())} {condition_label(method)}")
    return outer.scope.nested.setdefault(key, WaitScope())


def _in_poll(method: Any, scope: WaitScope) -> Any:
    if not callable(method):
        return method

    def poll(driver: Any) -> Any:
        previous = _current()
        _local.poll = _Poll(scope)
        try:
            return method(driver)
        finally:
            _local.poll = previous

    return poll


def _report_failure(
    capturer: Any,
    wait: Any,
    method: Any,
    scope: WaitScope,
    exc: BaseException,
    start: int,
    src: Optional[str],
    negated: bool,
) -> None:
    try:
        label = condition_label(method)
        if negated:
            label = f"not {label}"
        timeout = getattr(wait, "_timeout", None)
        error = exc
        if hasattr(exc, "msg") and not exc.msg:
            # selenium raises an empty TimeoutException unless the caller passes
            # a message, which would leave the row's error blank.
            error = type(exc)(f"Timed out after {timeout}s waiting for {label}")
        taken = scope.last_row
        row = capturer.capture_command(
            command="wait",
            args=[label] if timeout is None else [label, timeout],
            error=error,
            start_time=start,
            call_source=src,
            replaces=taken,
        )
        # A wait nested in another's condition runs again on the next outer
        # poll, and its polls must fold into the row the dashboard now holds.
        for key, held in scope.rows.items():
            if held is taken:
                scope.rows[key] = row
        scope.last_row = row
    except Exception as row_exc:  # noqa: BLE001 - a row must never replace the wait's own error
        _log.debug("could not report a failed wait: %s", row_exc)
