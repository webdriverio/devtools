"""Navigation and resource timing for a navigation command.

The dashboard shows this on the command ROW rather than under a scope of its
own: `CommandLog.performance` (plus `cookies`, `documentInfo` and a synthesized
`result`) is what the Actions panel reads when a navigation is selected. So the
row is sent when the command completes, then sent again — under
`replaceCommand` — once the page has been asked for its timings.

The browser-side script is shared's `CAPTURE_PERFORMANCE_SCRIPT`, served by the
backend (`page_scripts`). The shaping below mirrors core's
`applyPerformanceData`, which is Node-side and so cannot be served.

Unlike the JS adapters this does NOT sleep before reading. They wait 500 ms for
navigation entries to populate because their navigation command can resolve
before the load event; selenium's `get()` returns after it under the default
page-load strategy, so the entries are already there — and a sleep on this
thread would be a real delay in the user's test rather than a detached await.
A payload without a `navigation` entry is discarded instead, which is the same
guard the JS side applies to a too-early read.
"""

from __future__ import annotations

import logging
import math
from decimal import ROUND_HALF_UP, Context, Decimal
from typing import Any, Dict, Optional

from .constants import LOGGER_NAME

_log = logging.getLogger(f"{LOGGER_NAME}.performance")


def apply_performance_data(
    entry: Dict[str, Any],
    payload: Optional[Any],
    navigated_url: Optional[str] = None,
) -> bool:
    """Fold a captured payload onto a command row in place.

    Returns whether anything was applied, so the caller can skip the replace
    frame entirely. A payload with no `navigation` entry is nothing worth
    showing — it means the read landed before the document had timings — and is
    treated as no data rather than as empty data.
    """
    if not isinstance(payload, dict):
        return False
    navigation = payload.get("navigation")
    # An object, even an empty one, is a navigation: core reads it as truthy.
    if not isinstance(navigation, dict):
        return False
    resources = payload.get("resources")
    document_info = payload.get("documentInfo")
    # A field the page did not answer stays absent, as core leaves it undefined;
    # an invented `[]` or `0` would claim the page had no resources.
    entry["performance"] = _present(navigation=navigation, resources=resources)
    entry.update(_present(cookies=payload.get("cookies"), documentInfo=document_info))
    # The row's own result: what the Actions panel prints for a navigation, in
    # the shape the dashboard already renders for the JS adapters.
    entry["result"] = _present(
        url=navigated_url,
        loadTime=format_milliseconds((navigation.get("timing") or {}).get("loadTime")),
        resources=resources,
        resourceCount=len(resources) if isinstance(resources, list) else None,
        cookies=payload.get("cookies"),
        title=document_info.get("title") if isinstance(document_info, dict) else None,
    )
    return True


#: Private, so a test that changes the thread's decimal context cannot make a navigation raise.
_MS_CONTEXT = Context(prec=40, rounding=ROUND_HALF_UP, traps=[])


def format_milliseconds(ms: Any) -> Optional[str]:
    """A duration for the row's summary, as core formats it: two decimals, ties
    rounded up like JS ``toFixed`` rather than to even."""
    if isinstance(ms, bool) or not isinstance(ms, (int, float)) or not math.isfinite(ms):
        return None
    rounded = Decimal(ms).quantize(Decimal("0.01"), context=_MS_CONTEXT)
    return f"{rounded} ms"


def _present(**fields: Any) -> Dict[str, Any]:
    return {k: v for k, v in fields.items() if v is not None}


def navigated_url(args: Any) -> Optional[str]:
    """The url a navigation command was given, when it was given one.

    `refresh`, `goBack` and `goForward` carry none — the row then reports the
    document's own url through `documentInfo` instead.
    """
    if isinstance(args, dict):
        url = args.get("url")
        return url if isinstance(url, str) else None
    if isinstance(args, (list, tuple)) and args and isinstance(args[0], str):
        return args[0]
    return None
