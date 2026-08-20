"""Assertion rows from Python's `assert` statement.

The JS adapters patch `node:assert`, which is a function call. Python's `assert`
is a STATEMENT — there is nothing to wrap — so the values have to come from
pytest's own rewriter, and what it exposes differs per outcome:

* A FAILING comparison calls ``pytest_assertrepr_compare`` with the operator and
  both operands. Always available.
* A PASSING assertion calls ``pytest_assertion_pass`` with the source text and an
  explanation, and — only then — routes passing comparisons through
  ``pytest_assertrepr_compare`` as well, so passing rows carry values too. That
  path exists only when ``enable_assertion_pass_hook`` is on, which the plugin
  switches on for itself; see ``pytest_plugin`` for the bytecode-cache caveat.

This module is the pure half: operands in, wire shape out, no pytest import, so
the mapping is testable without a test run inside a test run.
"""

from __future__ import annotations

import ast
import linecache
import traceback
from typing import Any, Dict, Optional, Tuple

# Operators whose LEFT operand is the expectation rather than the observation.
# `assert "/secure" in url` reads as expected-in-actual, the reverse of
# `assert title == "Example Domain"` where the left side is what was observed.
# Getting this backwards silently swaps every containment row's two values.
_EXPECTATION_ON_LEFT = frozenset({"in", "not in"})

# The row label. One name for every assertion, because Python's `assert` has no
# matcher vocabulary to name it by — the expression itself carries the meaning
# and travels as the row's argument.
ASSERT_COMMAND = "assert"


def expected_and_actual(op: str, left: Any, right: Any) -> Tuple[Any, Any]:
    """(expected, actual) for a comparison, accounting for operand order."""
    if op in _EXPECTATION_ON_LEFT:
        return left, right
    return right, left


def collapsed_result(
    *,
    passed: bool,
    op: Optional[str] = None,
    left: Any = None,
    right: Any = None,
    message: Optional[str] = None,
) -> Dict[str, Any]:
    """A `CollapsedAssertResult` for the wire: ``{passed, expected, actual,
    message}``.

    The app reads `passed: false` as the row having failed, so this is what makes
    an assertion render red rather than as an ordinary command.

    ``op`` is None for an assertion that is not a comparison — `assert x`, or a
    call — where there are no two operands to report. The row still carries its
    outcome and its source text, which is all such an assertion has.
    """
    result: Dict[str, Any] = {"passed": passed}
    if op is not None:
        expected, actual = expected_and_actual(op, left, right)
        result["expected"] = expected
        result["actual"] = actual
    # `assert cond, msg` makes the message whatever `msg` evaluated to, and the
    # idiomatic `assert needle in haystack, haystack` makes that the actual value
    # — so it would render as a third row repeating the second verbatim.
    if message and message not in {_display(result.get(k)) for k in ("expected", "actual")}:
        result["message"] = message
    return result


def _display(value: Any) -> Optional[str]:
    """`value` as the string a message would be compared against."""
    return None if value is None else str(value)


_AST_OPERATORS = {
    ast.Eq: "==",
    ast.NotEq: "!=",
    ast.Lt: "<",
    ast.LtE: "<=",
    ast.Gt: ">",
    ast.GtE: ">=",
    ast.In: "in",
    ast.NotIn: "not in",
    ast.Is: "is",
    ast.IsNot: "is not",
}

_UNRESOLVED = object()


def _resolve_operand(node: ast.AST, frame: Any) -> Any:
    """The value of one side of a comparison, or ``_UNRESOLVED``.

    Only reads that CANNOT run user code: a literal, or a bare name looked up in
    the frame that failed. An attribute or a call is left unresolved even though
    it is often the more interesting side, because evaluating it here would
    re-run it — `driver.current_url` would issue another WebDriver command,
    showing up as a phantom row, and anything with a side effect would take it.
    """
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name) and frame is not None:
        for scope in (frame.f_locals, frame.f_globals):
            if node.id in scope:
                return scope[node.id]
    return _UNRESOLVED


def parse_assert_statement(
    line: str, frame: Any = None
) -> Tuple[Optional[str], Optional[Tuple[str, Any, Any]]]:
    """(condition source, operands) read from a plain script's `assert` line.

    A script's assert is never rewritten, so this is the only route to the values
    — and it is deliberately partial. Operands come back only for a single
    comparison whose sides are both safe to read; everything else yields the
    condition text alone, which is still more than the bare message.
    """
    text = (line or "").strip()
    # Falls back to the text with the keyword removed, so an assert this cannot
    # parse (a continuation line, say) still labels its row readably.
    fallback = text[len("assert ") :].strip() if text.startswith("assert ") else text
    try:
        parsed = ast.parse(text)
    except (SyntaxError, ValueError):
        return fallback or None, None
    if not parsed.body or not isinstance(parsed.body[0], ast.Assert):
        return fallback or None, None
    test = parsed.body[0].test
    # The condition without the `, message` half, which is not part of it.
    try:
        source = ast.unparse(test)
    except Exception:  # noqa: BLE001 — unparse is best effort
        source = None
    if not isinstance(test, ast.Compare) or len(test.ops) != 1:
        return source, None
    op = _AST_OPERATORS.get(type(test.ops[0]))
    if op is None:
        return source, None
    left = _resolve_operand(test.left, frame)
    right = _resolve_operand(test.comparators[0], frame)
    if left is _UNRESOLVED or right is _UNRESOLVED:
        return source, None
    return source, (op, left, right)


def innermost_frame(exc: BaseException) -> Any:
    """The frame the exception was raised in, which is where its locals live."""
    tb = exc.__traceback__
    if tb is None:
        return None
    while tb.tb_next is not None:
        tb = tb.tb_next
    return tb.tb_frame


def assert_site_from_traceback(tb: Any) -> Tuple[Optional[str], Optional[str]]:
    """(``path:line``, source text) of the innermost frame of a traceback.

    For a PLAIN SCRIPT — `python login.py` — pytest is not involved, so nothing
    rewrote the `assert` and there are no operands to report: only the line that
    failed and the message Python built. Strictly less than a pytest run gives,
    and still the difference between a failure the dashboard shows and one it
    does not.

    Passing assertions have no equivalent here and cannot be given one. The
    statement compiles to a branch with no call to observe, and by the time
    ``enable()`` runs the script's own module is already compiled, so there is
    nothing left to rewrite.
    """
    try:
        frames = traceback.extract_tb(tb)
    except Exception:  # noqa: BLE001 — diagnostics must not raise
        return None, None
    if not frames:
        return None, None
    frame = frames[-1]
    location = f"{frame.filename}:{frame.lineno}" if frame.filename else None
    # The statement verbatim — `parse_assert_statement` needs the `assert`
    # keyword to recognise it, and owns turning it into a readable condition.
    source = (frame.line or linecache.getline(frame.filename, frame.lineno)).strip()
    return location, source or None


class ComparisonBuffer:
    """The most recent comparison pytest reported, held until a row claims it.

    pytest hands over the operands and the outcome through two separate hooks,
    and there is no id tying them together. They are adjacent in practice — the
    comparison is reported immediately before the pass hook fires, or immediately
    before the AssertionError propagates — so the row takes whatever is newest
    and CONSUMES it. Consuming matters: a stale comparison attached to a later
    assertion is worse than no values at all, because it looks authoritative.
    """

    def __init__(self) -> None:
        self._latest: Optional[Tuple[str, Any, Any]] = None

    def record(self, op: str, left: Any, right: Any) -> None:
        self._latest = (op, left, right)

    def take(self) -> Optional[Tuple[str, Any, Any]]:
        latest, self._latest = self._latest, None
        return latest

    def clear(self) -> None:
        self._latest = None
