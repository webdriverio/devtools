"""WebDriverWait tracking: a wait is one row, and what its condition issued
nests under it.

``WebDriverWait.until`` is a client-side loop, so the ``execute`` chokepoint
sees only its polls and no trace of the wait or of the ``TimeoutException`` it
raised. This patches ``until``/``until_not`` to send the wait's own row before
the first poll, running (a ``startTime``, no result or error), and to replace
it by ``id`` when the wait returns or raises, stamped at completion and
carrying the timeout as its error. Every command the condition issues names
that row as ``parentId``, and each poll's repeat of a call folds into the row
the first poll made. An element-locator condition is named after the element
wait it is (``waitForElementLocated`` on its selector); any other is ``wait``,
named after the condition. That is the Selenium Node.js adapter's
``wait-tracking.ts``, so the two Selenium adapters show a wait the same way.
"""

from __future__ import annotations

import json
import logging
import threading
from typing import Any, Callable, Dict, Iterable, Optional, Tuple

from . import element_locators
from .constants import ELEMENT_WAIT_COMMANDS, EXPECTED_CONDITIONS_MODULE, LOGGER_NAME
from .types import CommandLog
from .utils import call_source, now_ms, to_jsonable

_log = logging.getLogger(f"{LOGGER_NAME}.wait_tracking")

_LABEL_MAX_CHARS = 120

# Element ids differ on every poll (each finds the element afresh), so a call is
# identified by what it does and what it targets, not by the handle it used.
_VOLATILE_PARAMS = ("id", "sessionId")


class WaitScope:
    """One ``until``/``until_not`` call, shared by its polls and its own row."""

    def __init__(self) -> None:
        #: Each call of the condition, by poll key, to the row its repeats fold into.
        self.rows: Dict[str, CommandLog] = {}
        #: The wait's own row, which its polls name as parent; None if it could not be sent.
        self.row: Optional[CommandLog] = None
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


def parent_of(poll: Optional[Tuple[WaitScope, str]]) -> Optional[int]:
    """The id of the wait row this command was issued by, or None outside a wait."""
    row = poll[0].row if poll else None
    return row["id"] if row else None


def note_poll_row(poll: Optional[Tuple[WaitScope, str]], row: CommandLog) -> None:
    if poll:
        scope, key = poll
        scope.rows[key] = row


def wait_row_name(method: Any, negated: bool = False) -> Tuple[str, Optional[str]]:
    """The command a wait's row is named and its selector: an element-locator factory is that element wait, anything else (a negated wait included) is ``wait``."""
    factory = _element_wait_factory(method)
    if negated or factory is None:
        return "wait", None
    return ELEMENT_WAIT_COMMANDS[factory], _locator_selector(_closure_value(method, "locator"))


def _element_wait_factory(method: Any) -> Optional[str]:
    if getattr(method, "__module__", None) != EXPECTED_CONDITIONS_MODULE:
        return None
    qualname = getattr(method, "__qualname__", None)
    if not isinstance(qualname, str) or ".<locals>." not in qualname:
        return None
    factory = qualname.split(".<locals>.")[0]
    return factory if factory in ELEMENT_WAIT_COMMANDS else None


def _closure_value(method: Any, name: str) -> Any:
    names = getattr(getattr(method, "__code__", None), "co_freevars", ())
    cells = getattr(method, "__closure__", None) or ()
    for var, cell in zip(names, cells):
        if var == name:
            return cell.cell_contents
    return None


def _locator_selector(locator: Any) -> Optional[str]:
    """A ``(By, value)`` locator as the selector its ``findElement`` row carries, converted as ``find_element`` converts it (``By.ID`` reads ``#x``)."""
    if not isinstance(locator, (tuple, list)) or len(locator) != 2:
        return None
    by, value = locator
    try:
        from selenium.webdriver.remote.locator_converter import LocatorConverter  # lazy

        by, value = LocatorConverter().convert(by, value)
    except ImportError:
        pass
    return element_locators.locator_to_selector(by, value)


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
    except Exception:  # noqa: BLE001 - an unbound cell, or a captured object whose __repr__ raises
        return "?"


def _safe_label(method: Any) -> str:
    """``condition_label`` for a path that runs before the user's condition, which a label must never fail."""
    try:
        return condition_label(method)
    except Exception:  # noqa: BLE001 - naming is best effort; the wait must run
        return type(method).__name__


def _safe_row_name(method: Any, negated: bool) -> Tuple[str, Optional[str]]:
    """``wait_row_name`` under the same guarantee as ``_safe_label``."""
    try:
        return wait_row_name(method, negated)
    except Exception:  # noqa: BLE001 - naming is best effort; the wait must run
        return "wait", None


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
        outer = _current()
        scope = _scope_for(outer, method, skip_frames)
        _send_running(capturer, self, method, scope, outer, call_source(skip_frames()), negated)
        try:
            result = original(self, _in_poll(method, scope), message)
        except BaseException as exc:
            _conclude(capturer, self, scope, exc)
            raise
        _conclude(capturer, self, scope, None)
        return result

    wait.__wrapped__ = original  # type: ignore[attr-defined]
    return wait


def _scope_for(
    outer: Optional[_Poll], method: Any, skip_frames: Callable[[], Iterable[str]]
) -> WaitScope:
    """A wait inside another wait's condition is the same wait on every outer
    poll, so it keeps one scope across them, keyed like a poll by where it was
    called, what it waits for, its condition's code and how many times this
    evaluation issued it."""
    if outer is None:
        return WaitScope()
    key = outer.nth(
        f"wait {call_source(skip_frames())} {_safe_label(method)} {_code_identity(method)}"
    )
    return outer.scope.nested.setdefault(key, WaitScope())


def _code_identity(method: Any) -> str:
    """The condition's code, the counterpart of the source text TypeScript keys
    on: two lambdas started from one helper share a call site and the label
    ``lambda``, and only this keeps one branch's wait out of another's scope."""
    code = getattr(method, "__code__", None)
    if code is None:
        return ""
    return f"{code.co_filename}:{code.co_firstlineno}:{hash(code)}"


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


def _send_running(
    capturer: Any,
    wait: Any,
    method: Any,
    scope: WaitScope,
    outer: Optional[_Poll],
    src: Optional[str],
    negated: bool,
) -> None:
    """Send the wait's row before its first poll, so what the polls issue has a
    row to nest under while it runs. A wait nested in another's condition runs
    again on each outer poll and keeps its one row, as a poll keeps its own,
    and its first start, which the children it kept from earlier polls follow."""
    label = _safe_label(method)
    if negated:
        label = f"not {label}"
    command, selector = _safe_row_name(method, negated)
    timeout = getattr(wait, "_timeout", None)
    start = now_ms()
    try:
        scope.row = capturer.capture_command(
            command=command,
            args=[label] if timeout is None else [label, timeout],
            start_time=scope.row["startTime"] if scope.row else start,
            timestamp=start,
            call_source=src,
            selector=selector,
            replaces=scope.row,
            parent_id=outer.scope.row["id"] if outer and outer.scope.row else None,
        )
    except Exception as row_exc:  # noqa: BLE001 - a row must never stop the wait
        _log.debug("could not report a wait: %s", row_exc)


def _conclude(
    capturer: Any, wait: Any, scope: WaitScope, exc: Optional[BaseException]
) -> None:
    """Replace the running row by id once the wait has returned or raised."""
    row = scope.row
    if row is None:
        return
    try:
        error = exc
        if exc is not None and hasattr(exc, "msg") and not exc.msg:
            # selenium raises an empty TimeoutException unless the caller passes
            # a message, which would leave the row's error blank.
            error = type(exc)(
                f"Timed out after {getattr(wait, '_timeout', None)}s waiting for {row['args'][0]}"
            )
        scope.row = capturer.capture_command(
            command=row["command"],
            args=row["args"],
            error=error,
            start_time=row["startTime"],
            call_source=row.get("callSource"),
            selector=row.get("selector"),
            replaces=row,
            parent_id=row.get("parentId"),
        )
    except Exception as row_exc:  # noqa: BLE001 - a row must never replace the wait's own error
        _log.debug("could not conclude a wait's row: %s", row_exc)
