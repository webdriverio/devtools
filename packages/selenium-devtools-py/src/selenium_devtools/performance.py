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
    if not navigation:
        return False
    resources = payload.get("resources") or []
    document_info = payload.get("documentInfo") or {}
    entry["performance"] = {"navigation": navigation, "resources": resources}
    entry["cookies"] = payload.get("cookies")
    entry["documentInfo"] = document_info
    # The row's own result: what the Actions panel prints for a navigation, in
    # the shape the dashboard already renders for the JS adapters.
    entry["result"] = {
        "url": navigated_url,
        "loadTime": (navigation.get("timing") or {}).get("loadTime"),
        "resources": resources,
        "resourceCount": len(resources),
        "cookies": payload.get("cookies"),
        "title": document_info.get("title"),
    }
    return True


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
