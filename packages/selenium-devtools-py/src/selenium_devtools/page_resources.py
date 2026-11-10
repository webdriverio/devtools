"""Trace-mode stylesheets and fonts: which drain reads them back, and forwarding each stored URL once."""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

from ._contract import (
    DEFAULT_TRACE_RESOURCES,
    MAX_STORED_RESOURCE_KEYS,
    PAGE_RESOURCE_SETTLE_POLL_S,
    PAGE_RESOURCE_SETTLE_TIMEOUT_S,
    TRACE_RESOURCES_MODES,
)
from .constants import ENV_TRACE_RESOURCES, LOGGER_NAME
from .types import PageScriptsResponse

_log = logging.getLogger(f"{LOGGER_NAME}.page_resources")

_state: Dict[str, Any] = {"mode": "none", "pending": 0, "urls": set(), "keys": []}


def url_key(url: str) -> str:
    """shared's `resourceUrlKey`: 32-bit FNV-1a over the URL's UTF-8 bytes, base 36."""
    # A lone surrogate becomes U+FFFD, as TextEncoder encodes it.
    text = url.encode("utf-16", "surrogatepass").decode("utf-16", "replace")
    value = 0x811C9DC5
    for byte in text.encode("utf-8"):
        value = ((value ^ byte) * 0x01000193) & 0xFFFFFFFF
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = ""
    while True:
        value, rem = divmod(value, 36)
        out = digits[rem] + out
        if value == 0:
            return out


def resolve_mode(argument: Optional[str]) -> str:
    """The trace-mode setting: argument, then a non-empty env var, then `styles`; an unknown value warns."""
    value = argument if argument else os.environ.get(ENV_TRACE_RESOURCES) or None
    if value is None:
        return DEFAULT_TRACE_RESOURCES
    if value not in TRACE_RESOURCES_MODES:
        _log.warning(
            "unknown trace resources mode %r; storing %s. Expected one of: %s",
            value,
            DEFAULT_TRACE_RESOURCES,
            ", ".join(TRACE_RESOURCES_MODES),
        )
        return DEFAULT_TRACE_RESOURCES
    return value


def set_mode(mode: str) -> None:
    _state.update(mode=mode, pending=0, urls=set(), keys=[])


def mode() -> str:
    return _state["mode"]


def drain_call(scripts: PageScriptsResponse) -> Tuple[str, tuple]:
    """The drain script and its arguments: the resource-reading one, given what is stored, or the plain one."""
    if _state["mode"] == "styles":
        script = scripts.get("collectorDrainResources")
        if script:
            return script, (list(_state["keys"]),)
    return scripts["collectorDrain"], ()


def _dicts(value: Any) -> List[Dict[str, Any]]:
    return [v for v in value if isinstance(v, dict)] if isinstance(value, list) else []


def take(trace_data: Any) -> tuple:
    """``(resources, re_reads)`` from a drained payload, each URL once per run, noting reads still in flight."""
    if not isinstance(trace_data, dict):
        return [], []
    pending = trace_data.get("pendingResources")
    if isinstance(pending, (int, float)) and not isinstance(pending, bool):
        _state["pending"] = int(pending)
    fresh = []
    for resource in _dicts(trace_data.get("pageResources")):
        url = resource.get("url")
        if isinstance(url, str) and url not in _state["urls"]:
            _state["urls"].add(url)
            if len(_state["keys"]) < MAX_STORED_RESOURCE_KEYS:
                _state["keys"].append(url_key(url))
            fresh.append(resource)
    return fresh, _dicts(trace_data.get("resourceReReads"))


def settle(drain: Callable[[], None], *, sleep: Callable[[float], None] = time.sleep) -> None:
    """Drain again, bounded, while the page has reads in flight, so the last document's reads are sent."""
    if _state["mode"] == "none":
        return
    deadline = time.monotonic() + PAGE_RESOURCE_SETTLE_TIMEOUT_S
    while _state["pending"] > 0 and time.monotonic() < deadline:
        sleep(PAGE_RESOURCE_SETTLE_POLL_S)
        # A drain that reaches no collector reports nothing; that ends the wait.
        _state["pending"] = 0
        drain()


def reset() -> None:
    set_mode("none")
