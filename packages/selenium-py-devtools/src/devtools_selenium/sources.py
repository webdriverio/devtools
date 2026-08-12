"""Read test-file source safely for the dashboard's Source tab.

The Source tab matches a command's ``callSource`` (an absolute ``path:line``)
against the keys of the ``sources`` map, so callers key by the same absolute
path. Reads are size-capped, encoding-tolerant, and never raise.
"""

from __future__ import annotations

import os
from typing import Dict, Iterable, Optional

# Cap matches the intent of the JS adapter: a test file, not a bundle. Anything
# larger is almost certainly not the source the Source tab wants to show.
MAX_SOURCE_BYTES = 2 * 1024 * 1024


def read_source(path: str) -> Optional[str]:
    """Return the file's text, or None if it is missing, oversized, or unreadable."""
    try:
        if not os.path.isfile(path):
            return None
        if os.path.getsize(path) > MAX_SOURCE_BYTES:
            return None
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            return handle.read()
    except OSError:
        return None


def collect_sources(paths: Iterable[str]) -> Dict[str, str]:
    """Map each readable absolute path to its source text; skip the rest."""
    result: Dict[str, str] = {}
    for path in paths:
        if not path or path in result:
            continue
        text = read_source(path)
        if text is not None:
            result[path] = text
    return result
