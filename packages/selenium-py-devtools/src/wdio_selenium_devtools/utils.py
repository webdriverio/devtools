"""Small framework-agnostic helpers. No third-party imports."""

from __future__ import annotations

import json
import time
import traceback
from typing import Any, Iterable


def now_ms() -> int:
    """Epoch milliseconds — the timestamp unit every frame uses."""
    return int(time.time() * 1000)


def iso(ms: int) -> str:
    """ISO-8601 string. SuiteStats.start/end are TS Dates on the wire."""
    base = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ms / 1000))
    return f"{base}.{ms % 1000:03d}Z"


def to_jsonable(value: Any, _depth: int = 0) -> Any:
    """Coerce an arbitrary value into something json.dumps can handle.

    Selenium command params/results may carry WebElement refs or other
    non-serializable objects; the wire only speaks JSON, so anything exotic
    degrades to its string form rather than blowing up the send.
    """
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if _depth > 6:
        return str(value)
    if isinstance(value, dict):
        return {str(k): to_jsonable(v, _depth + 1) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(v, _depth + 1) for v in value]
    try:
        json.dumps(value)
        return value
    except (TypeError, ValueError):
        return str(value)


def call_source(skip_substrings: Iterable[str]) -> str | None:
    """First stack frame outside the adapter + selenium internals, as
    ``path:line`` — what the dashboard shows as the command's origin."""
    skips = tuple(skip_substrings)
    # Innermost-last; walk outward (reversed) to find the user's frame.
    for frame in reversed(traceback.extract_stack()[:-1]):
        if not any(s in frame.filename for s in skips):
            return f"{frame.filename}:{frame.lineno}"
    return None
