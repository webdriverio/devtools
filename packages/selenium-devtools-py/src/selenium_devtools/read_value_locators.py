"""Value to locator provenance: which element's read produced a given value.

Python's ``assert`` compares VALUES, not elements: ``assert heading.text ==
"Secure Area"`` names no element, so an assertion row can only name its target
if something remembers which element each read value came from. This mirrors
the JS adapters' registry (``packages/core/src/read-value-locators.ts``), which
this package cannot import: every captured command's result is remembered with
the command's selector, and an assertion looks its compared operands up.

A driver-level read (``title``, ``current_url``) records its value as belonging
to NO element. That sentinel is load-bearing: without it a page-title assertion
inherits the box of an element whose text happens to read the same.
"""

from __future__ import annotations

from collections import OrderedDict
from typing import Any, Hashable, Optional, Tuple

from .constants import READ_VALUE_CACHE_SIZE, READ_VALUE_MAX_LENGTH

#: (kind, value) to selector, or None for a value no element produced. Keyed by
#: kind too, because Python's ``True == 1`` would otherwise share one entry.
#: Insertion-ordered so the newest producer wins and the oldest is evicted.
_selectors: "OrderedDict[Tuple[str, Hashable], Optional[str]]" = OrderedDict()


def reset() -> None:
    """Forget every value, so a re-enable cannot attribute a previous run's read."""
    _selectors.clear()


def _key(value: Any) -> Optional[Tuple[str, Hashable]]:
    """The registry key for a rememberable value, or None.

    Primitives only: an assertion on a read compares by value, and holding an
    object would pin it for the run.
    """
    if isinstance(value, str):
        if not value or len(value) > READ_VALUE_MAX_LENGTH:
            return None
        return ("str", value)
    if isinstance(value, bool):
        return ("bool", value)
    # One kind for int and float, as JavaScript has one number: a read of `3`
    # must name the assertion that compares it with `3.0`, which Python passes.
    if isinstance(value, (int, float)):
        return ("number", value)
    return None


def remember(value: Any, selector: Optional[str]) -> None:
    """Attribute a command result to the element it was read from, or to none."""
    key = _key(value)
    if key is None:
        return
    # Pop before set so order is recency: the newest producer wins the lookup,
    # and the least recent is what eviction drops.
    _selectors.pop(key, None)
    _selectors[key] = selector
    while len(_selectors) > READ_VALUE_CACHE_SIZE:
        _selectors.popitem(last=False)


def selector_for(value: Any) -> Optional[str]:
    """The locator of the element whose read most recently produced ``value``."""
    key = _key(value)
    return _selectors.get(key) if key is not None else None


def assertion_target(*operands: Any) -> Optional[str]:
    """The element an assertion was about: the first operand the registry knows.

    Callers pass the observed side first, the way node:assert puts its subject
    first. An operand recorded as no element's stops the search too, or a title
    assertion compared against a literal some element once read would take
    that element's box.
    """
    for operand in operands:
        key = _key(operand)
        if key is not None and key in _selectors:
            return _selectors[key]
    return None
