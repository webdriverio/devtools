"""Recovers the locator an element command acted through.

Selenium consumes the locator at ``findElement`` time and hands back an opaque
handle, so ``clickElement``/``sendKeysToElement`` see only ``{"id": "f.93A…"}``.
Without this, the row reaches the trace with no ``selector`` — and the player's
element overlay, which resolves each row's locator in the replayed document,
has an element id where a selector should be and draws nothing.

The JS Selenium adapter solves the same problem in `helpers/element-locators.ts`,
and this follows its mapping table — including leaving link text unmapped. It
diverges in three places, each forced by the binding: it keys on the element ID
rather than on handle identity (Python's ``WebElement.id`` is a plain string the
moment the find returns, while the JS ``WeakMap`` exists only because ``id_`` is
a promise there); it needs no shorthand-hash forms, which are a JS-only API; and
its ``[id="x"]`` pattern makes the ``*`` optional, because selenium-python's own
LocatorConverter emits the form without it.

Bounded rather than a plain dict: a run that finds elements in a loop would
otherwise pin every handle it ever saw for the length of the run.
"""

from __future__ import annotations

import re
from collections import OrderedDict
from typing import Any, Optional

from .constants import (
    ELEMENT_LOCATOR_CACHE_SIZE,
    FIND_CHILD_COMMANDS,
    FIND_COMMANDS,
)

#: `By.ID` reaches the wire as this CSS form (selenium's own LocatorConverter),
#: while the captured element records carry `#x` — and the point-matching
#: compares the two by string, so the shorter form is the one to store.
_BY_ID_CSS_RE = re.compile(r'^\*?\[id="([\w-]+)"\]$')

#: Element id → the selector that produced it. Insertion-ordered so the oldest
#: entry is the one evicted.
_selectors: "OrderedDict[str, str]" = OrderedDict()


def reset() -> None:
    """Drop every remembered locator. Called on teardown, so a re-enable in the
    same process cannot serve a selector from the previous run's handles."""
    _selectors.clear()


def _canonicalize_css(value: str) -> str:
    match = _BY_ID_CSS_RE.match(value)
    return f"#{match.group(1)}" if match else value


def locator_to_selector(using: Any, value: Any) -> Optional[str]:
    """A W3C ``{using, value}`` pair as the selector string the rest of the
    system speaks, or None for strategies with no selector equivalent.

    Link text is unmapped, exactly as in the JS adapter: its XPath equivalent
    needs the quote-stitching `shared` already implements for captured text
    locators, and a second implementation here is the copy-per-language that
    the element scripts are fetched from the backend to avoid.
    """
    if not isinstance(using, str) or not isinstance(value, str) or not value:
        return None
    if using == "css selector":
        return _canonicalize_css(value)
    if using in ("xpath", "tag name"):
        return value
    return None


def _compose(parent: Optional[str], child: str) -> str:
    """A child find scoped to its parent, when both are plain CSS.

    ``element.find_element(By.CLASS_NAME, "row")`` yields ``.row``, which the
    overlay would resolve against the whole document and box the page's first
    match — a wrong box being worse than no box. XPath is left alone: an
    expression is not concatenable this way.
    """
    if not parent or parent.startswith("/") or child.startswith("/"):
        return child
    return f"{parent} {child}"


def _remember(result: Any, selector: str) -> None:
    """Attribute a selector to the handle(s) a find returned.

    ``findElements`` yields a list; every element gets the plural locator, whose
    first match is what a box would be drawn on.
    """
    for element in result if isinstance(result, list) else [result]:
        element_id = getattr(element, "id", None)
        if not isinstance(element_id, str) or not element_id:
            continue
        _selectors[element_id] = selector
        _selectors.move_to_end(element_id)
    while len(_selectors) > ELEMENT_LOCATOR_CACHE_SIZE:
        _selectors.popitem(last=False)


def selector_for_command(
    command: str, params: Any, result: Any = None
) -> Optional[str]:
    """The selector to stamp on this command's row.

    A find learns one and remembers it against the handle it produced; every
    later command on that handle reads it back. Returns None when the locator
    was never seen or has no selector form — the row then behaves as it did
    before, carrying no selector at all.
    """
    if not isinstance(params, dict):
        return None
    if command in FIND_COMMANDS:
        selector = locator_to_selector(params.get("using"), params.get("value"))
        if selector is None:
            return None
        if command in FIND_CHILD_COMMANDS:
            parent = params.get("id")
            selector = _compose(
                _selectors.get(parent) if isinstance(parent, str) else None,
                selector,
            )
        _remember(result, selector)
        return selector
    element_id = params.get("id")
    if not isinstance(element_id, str):
        # `switchToFrame` also takes `id`, as an index or a serialized element —
        # neither is a handle this registry ever stored.
        return None
    return _selectors.get(element_id)
