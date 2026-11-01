"""Native app network from the appium-interceptor plugin's proxy, mirroring core's ``appium-interceptor.ts``."""

from __future__ import annotations

import json
import logging
import re
import threading
import time
import weakref
from typing import Any, Callable, Dict, List, Optional

from ._wire_types import NetworkRequest
from .bidi import request_type_for
from .constants import LOGGER_NAME, NATIVE_NETWORK_DRAIN_INTERVAL_S
from .device import driver_is_native_app
from .utils import now_ms

_log = logging.getLogger(f"{LOGGER_NAME}.interceptor")

INTERCEPT_CAPABILITY = "appium:intercept"
APPIUM_OPTIONS = "appium:options"

# Whether each driver's newSession asked for the proxy; the returned capabilities need not echo it.
_requested: "weakref.WeakKeyDictionary[Any, bool]" = weakref.WeakKeyDictionary()

_WHITESPACE = re.compile(r"\s")


def _asks_for_intercept(caps: Any) -> bool:
    """Whether one capability set asks for the proxy, directly or grouped under ``appium:options``."""
    if not isinstance(caps, dict):
        return False
    if caps.get(INTERCEPT_CAPABILITY) is True:
        return True
    grouped = caps.get(APPIUM_OPTIONS)
    return isinstance(grouped, dict) and grouped.get("intercept") is True


def note_session_request(driver: Any, params: Any) -> None:
    """Record whether this driver's newSession set ``appium:intercept: True``."""
    caps = params.get("capabilities") if isinstance(params, dict) else None
    if not isinstance(caps, dict):
        return
    candidates = [caps.get("alwaysMatch")]
    first = caps.get("firstMatch")
    if isinstance(first, list):
        candidates.extend(first)
    asked = any(_asks_for_intercept(c) for c in candidates)
    try:
        _requested[driver] = asked
    except TypeError:
        if asked:
            _log.warning(
                "%s is set but this driver cannot be tracked; native network is not captured",
                INTERCEPT_CAPABILITY,
            )


def flatten_headers(headers: Any) -> Dict[str, str]:
    flat: Dict[str, str] = {}
    if not isinstance(headers, dict):
        return flat
    for name, value in headers.items():
        # The plugin files the response status line as a header ("http/1.1 201 created").
        if not isinstance(name, str) or _WHITESPACE.search(name):
            continue
        flat[name.lower()] = (
            ", ".join(str(v) for v in value) if isinstance(value, list) else str(value)
        )
    return flat


def body_text(body: Any) -> Optional[str]:
    if body is None or body == "":
        return None
    if isinstance(body, str):
        return body
    return json.dumps(body, separators=(",", ":"), ensure_ascii=False)


def to_network_request(entry: Dict[str, Any], row_id: str, observed_at: int) -> NetworkRequest:
    """The plugin records no timing, so a row is stamped when it was first read."""
    url = str(entry.get("url") or "")
    status = entry.get("statusCode")
    response_headers = flatten_headers(entry.get("responseHeaders"))
    content_type = response_headers.get("content-type")
    response_body = body_text(entry.get("responseBody"))
    row: NetworkRequest = {
        "id": row_id,
        "url": url,
        "method": str(entry.get("method") or ""),
        "type": request_type_for(url, content_type),  # type: ignore[typeddict-item]
        "timestamp": observed_at,
        "startTime": observed_at,
        "endTime": observed_at,
        "requestHeaders": flatten_headers(entry.get("requestHeaders")),
        "responseHeaders": response_headers,
    }
    if isinstance(status, (int, float)) and not isinstance(status, bool):
        row["status"] = status
        row["response"] = {
            "fromCache": False,
            "headers": response_headers,
            "mimeType": (content_type or "").split(";")[0].strip(),
            "status": status,
        }
    request_body = body_text(entry.get("requestBody"))
    if request_body is not None:
        row["requestBody"] = request_body
    if response_body is not None:
        row["responseBody"] = response_body
        row["size"] = len(response_body.encode("utf-8"))
    return row


class InterceptorPoller:
    """One listener on one session, read incrementally."""

    def __init__(
        self, execute: Callable[..., Any], clock: Callable[[], float] = time.monotonic
    ) -> None:
        self._execute = execute
        self._clock = clock
        self._last_drain: Optional[float] = None
        self._listener: Optional[str] = None
        self._seen = 0
        # Drains run on the test thread and at teardown, possibly another thread; two at once would list the same entries.
        self._lock = threading.Lock()

    def start(self) -> bool:
        listener = self._execute("interceptor: startListening", {})
        self._listener = listener if isinstance(listener, str) else None
        return self._listener is not None

    def drain(self, throttle: bool = False) -> List[NetworkRequest]:
        """A per-command caller passes ``throttle``: each read returns the listener's whole history, bodies included."""
        with self._lock:
            listener = self._listener
            if listener is None:
                return []
            now = self._clock()
            if (
                throttle
                and self._last_drain is not None
                and now - self._last_drain < NATIVE_NETWORK_DRAIN_INTERVAL_S
            ):
                return []
            self._last_drain = now
            data = self._execute("interceptor: getInterceptedData", {"id": listener})
            # A failed call that answers None would otherwise read as "nothing new".
            if not isinstance(data, list):
                raise RuntimeError("the plugin returned no intercepted data")
            if len(data) <= self._seen:
                return []
            observed_at = now_ms()
            fresh = [
                to_network_request(entry, f"interceptor-{listener}-{index}", observed_at)
                for index, entry in enumerate(data)
                if index >= self._seen and isinstance(entry, dict)
            ]
            self._seen = len(data)
            return fresh


def start(driver: Any, execute: Callable[..., Any]) -> Optional[InterceptorPoller]:
    """A started poller for a native session that asked for the proxy, else None."""
    try:
        asked = _requested.get(driver, False)
    except TypeError:
        asked = False
    if not asked or not driver_is_native_app(driver):
        return None
    poller = InterceptorPoller(execute)
    try:
        started = poller.start()
    except Exception as exc:  # noqa: BLE001 - capture must never break the test
        _log.warning("appium-interceptor listener failed to start: %s", exc)
        started = False
    if not started:
        _log.warning(
            "%s is set but the interceptor listener did not start; is Appium "
            "running with --use-plugins=appium-interceptor?",
            INTERCEPT_CAPABILITY,
        )
        return None
    _log.info("native network capture active via appium-interceptor")
    return poller


def forward(
    capturer: Any, poller: Optional[InterceptorPoller], throttle: bool = False
) -> None:
    """List what the proxy recorded since the last call. A test or session boundary must not pass ``throttle``."""
    if poller is None:
        return
    try:
        requests = poller.drain(throttle)
    except Exception as exc:  # noqa: BLE001 - capture must never break the test
        _log.warning("appium-interceptor read failed: %s", exc)
        return
    if requests:
        capturer.send_network_requests(requests)
