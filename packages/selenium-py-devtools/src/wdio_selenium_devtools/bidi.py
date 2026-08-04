"""Selenium BiDi capture — browser console, JS exceptions, and network.

Mirrors the JS ``core/bidi.ts`` + ``selenium-devtools/bidi.ts`` split: the pure
event→frame mapping helpers (``console_kwargs`` / ``request_sent_kwargs`` /
``response_completed_kwargs``) take plain dicts/objects and are unit-testable
without selenium; ``attach`` does the selenium wiring and is defensive — a BiDi
failure is a logged no-op, never a raised error into the user's test.

Two selenium-version realities shape this module (selenium 4.36):

* BiDi only opens when the session was created with ``webSocketUrl`` truthy
  (``options.web_socket_url = True`` at build). We can't set that from inside
  the ``execute`` wrapper — the session already exists — so attach() checks the
  capability and degrades if it's missing.
* selenium's high-level ``network.add_request_handler`` *intercepts* (pauses)
  requests. We deliberately avoid it: we subscribe to the network events via
  the low-level connection so requests are observed but never stalled.
"""

from __future__ import annotations

import sys
from typing import Any, Dict, List, Optional, Tuple

from .capturer import SessionCapturer
from .constants import (
    BIDI_CAPABILITY,
    BIDI_LEVEL_MAP,
    BIDI_NET_BEFORE_REQUEST,
    BIDI_NET_RESPONSE_COMPLETED,
)
from .utils import now_ms


def _warn(message: str) -> None:
    print(f"[wdio-devtools] BiDi: {message}", file=sys.stderr)


# ── pure mapping helpers (no selenium) ───────────────────────────────────────


def normalize_level(level: Any) -> str:
    """Map a BiDi log level onto the shared LogLevel union (fallback: log)."""
    return BIDI_LEVEL_MAP.get(str(level or "").lower(), "log")


def remote_value_to_py(value: Any) -> Any:
    """Deserialize one BiDi RemoteValue into a JSON-friendly Python value.

    The reverse of selenium's ``Script.__convert_to_local_value``: console args
    arrive as ``{"type": ..., "value": ...}`` RemoteValues, not raw values, so
    ``console.log('a', {b:1}, 42)`` yields dicts we unwrap into ``'a'``,
    ``{'b': 1}``, ``42``. Anything unrecognized degrades to its string form.
    """
    if not isinstance(value, dict) or "type" not in value:
        return value
    kind = value.get("type")
    inner = value.get("value")
    if kind in ("null", "undefined"):
        return None
    if kind in ("string", "boolean", "number"):
        # BiDi encodes NaN/Infinity/-0 as the strings "NaN"/"Infinity"/"-0" —
        # passed through as-is since JSON can't represent the float specials.
        return inner
    if kind == "bigint":
        try:
            return int(inner)
        except (TypeError, ValueError):
            return str(inner)
    if kind in ("array", "set") and isinstance(inner, list):
        return [remote_value_to_py(item) for item in inner]
    if kind in ("object", "map") and isinstance(inner, list):
        out: Dict[str, Any] = {}
        for pair in inner:
            if isinstance(pair, (list, tuple)) and len(pair) == 2:
                key = remote_value_to_py(pair[0])
                out[str(key)] = remote_value_to_py(pair[1])
        return out
    if kind in ("date", "regexp"):
        return inner
    # error/function/node/window/symbol/promise/… — no serializable value.
    return value.get("value", kind)


def _args_from_entry(entry: Any) -> Optional[List[Any]]:
    """Deserialized console args if the entry carries any, else None.

    Returns None (not []) when ``args`` is absent so the caller can fall back to
    ``.text`` — an empty list is a real console call with no arguments.
    """
    raw = _attr(entry, "args", None)
    if not isinstance(raw, list):
        return None
    return [remote_value_to_py(v) for v in raw]


def console_kwargs(entry: Any) -> Tuple[str, List[Any]]:
    """(level, args) for capturer.capture_console from a BiDi console entry.

    Accepts selenium's ConsoleLogEntry dataclass (``.level`` / ``.method`` /
    ``.args`` / ``.text``) or a plain dict — so tests pass dicts, no selenium
    needed. Prefers ``method`` (the actual console.X call — log/info/warn/error/
    debug) over ``level`` (coarser), and maps every RemoteValue arg, falling
    back to ``.text`` only when no ``args`` are present.
    """
    level = _attr(entry, "method", None) or _attr(entry, "level", "info")
    args = _args_from_entry(entry)
    if args is None:
        text = _attr(entry, "text", None)
        if text is None:
            text = _attr(entry, "message", "")
        args = [text]
    return normalize_level(level), args


def js_error_kwargs(entry: Any) -> Tuple[str, List[Any]]:
    """(level, args) for a BiDi JavaScript exception — always ``error`` level.

    JavaScriptLogEntry carries ``text`` (the message) and a ``stacktrace`` dict
    rather than ``args``. We render message + formatted stack as a single arg so
    the Console panel shows the full error, never an empty/duplicate entry.
    """
    text = _attr(entry, "text", None)
    if text is None:
        text = _attr(entry, "message", "")
    message = str(text or "")
    stack = _format_stacktrace(_attr(entry, "stacktrace", None))
    combined = f"{message}\n{stack}" if stack else message
    return "error", [combined]


def _format_stacktrace(stacktrace: Any) -> str:
    """Render a BiDi ``StackTrace`` ({callFrames:[{functionName,url,lineNumber,
    columnNumber}]}) into ``at fn (url:line:col)`` lines — empty string if none."""
    if not isinstance(stacktrace, dict):
        return ""
    frames = stacktrace.get("callFrames")
    if not isinstance(frames, list):
        return ""
    lines: List[str] = []
    for frame in frames:
        if not isinstance(frame, dict):
            continue
        fn = frame.get("functionName") or "<anonymous>"
        url = frame.get("url") or ""
        line = frame.get("lineNumber")
        col = frame.get("columnNumber")
        location = url
        if line is not None:
            location = f"{url}:{line}"
            if col is not None:
                location = f"{url}:{line}:{col}"
        lines.append(f"    at {fn} ({location})" if location else f"    at {fn}")
    return "\n".join(lines)


def request_sent_kwargs(params: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """kwargs for the initial (pending) network frame, or None if unidentifiable.

    ``params`` is the BiDi ``network.beforeRequestSent`` event params — the
    ``.params`` dict on selenium's NetworkEvent.
    """
    request = params.get("request") or {}
    request_id = str(request.get("request") or params.get("id") or "")
    if not request_id:
        return None
    start_time = int(params.get("timestamp") or now_ms())
    return {
        "request_id": request_id,
        "url": request.get("url") or "",
        "method": request.get("method") or "GET",
        "status": None,
        "timestamp": now_ms(),
        "start_time": start_time,
        "request_type": request_type_for(request.get("url") or ""),
        "request_headers": headers_to_object(request.get("headers")),
    }


def response_completed_kwargs(
    params: Dict[str, Any], pending: Dict[str, Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    """kwargs for the finalized network frame, merged over the pending request.

    Returns None when the matching request wasn't seen (out-of-order events) —
    the caller skips rather than inventing a half-populated entry.
    """
    request = params.get("request") or {}
    request_id = str(request.get("request") or params.get("id") or "")
    prev = pending.get(request_id)
    if prev is None:
        return None
    response = params.get("response") or {}
    start_time = int(prev.get("start_time") or now_ms())
    end_time, time = _response_timing(
        request.get("timings"), start_time, params.get("timestamp")
    )
    merged = dict(prev)
    merged.update(
        status=_int_or(response.get("status"), prev.get("status")),
        status_text=response.get("statusText"),
        timestamp=now_ms(),
        end_time=end_time,
        time=time,
        size=_int_or(response.get("bytesReceived"), None),
        request_type=request_type_for(
            prev.get("url") or "", response.get("mimeType")
        ),
        response_headers=headers_to_object(response.get("headers")),
    )
    return merged


def request_type_for(url: str, mime_type: Optional[str] = None) -> str:
    """Classify a request into the dashboard's Network-tab categories.

    Prefers the response mime type; falls back to URL-extension heuristics.
    Ported from core/net.ts getRequestType so the wire shape matches the JS
    adapters exactly.
    """
    ct = (mime_type or "").lower()
    u = url.lower()
    if "text/html" in ct:
        return "document"
    if "text/css" in ct:
        return "stylesheet"
    if "javascript" in ct or "ecmascript" in ct:
        return "script"
    if "image/" in ct:
        return "image"
    if "font/" in ct or "woff" in ct:
        return "font"
    if "application/json" in ct:
        return "fetch"
    if u.endswith(".html") or u.endswith(".htm"):
        return "document"
    if u.endswith(".css"):
        return "stylesheet"
    if u.endswith(".js") or u.endswith(".mjs"):
        return "script"
    if any(u.endswith(ext) for ext in (".png", ".jpg", ".jpeg", ".gif", ".svg",
                                       ".webp", ".ico")):
        return "image"
    if any(u.endswith(ext) for ext in (".woff", ".woff2", ".ttf", ".eot",
                                       ".otf")):
        return "font"
    return "xhr"


def headers_to_object(headers: Any) -> Optional[Dict[str, str]]:
    """Flatten BiDi's ``[{name, value:{value}}]`` header list to a lowercased
    ``{name: value}`` dict. Returns None for a non-list (absent) input."""
    if not isinstance(headers, list):
        return None
    out: Dict[str, str] = {}
    for h in headers:
        if not isinstance(h, dict):
            continue
        name = str(h.get("name") or "").lower()
        if not name:
            continue
        value = h.get("value")
        if isinstance(value, str):
            out[name] = value
        elif isinstance(value, dict) and isinstance(value.get("value"), str):
            out[name] = value["value"]
        else:
            out[name] = str(value)
    return out


def _attr(obj: Any, name: str, default: Any) -> Any:
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _int_or(value: Any, fallback: Any) -> Any:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _response_timing(
    timings: Any, start_time: int, timestamp: Any
) -> Tuple[int, int]:
    """(end_time, duration_ms) preferring the browser's FetchTimingInfo — it's
    immune to BiDi events arriving batched in one tick (which collapses the
    event timestamps and yields 0-duration requests). Falls back to the event
    timestamp delta when timings are unavailable."""
    if isinstance(timings, dict):
        req = timings.get("requestTime")
        end = timings.get("responseEnd")
        if isinstance(req, (int, float)) and isinstance(end, (int, float)) and end > req:
            time = round(end - req)
            return start_time + time, time
    end_time = _int_or(timestamp, None)
    if end_time is None:
        end_time = now_ms()
    return end_time, max(0, end_time - start_time)


# ── selenium wiring (defensive) ───────────────────────────────────────────────


def _bidi_enabled(driver: Any) -> bool:
    caps = getattr(driver, "caps", None)
    return bool(isinstance(caps, dict) and caps.get(BIDI_CAPABILITY))


def _attach_console(driver: Any, capturer: SessionCapturer) -> bool:
    try:
        script = driver.script
    except Exception as exc:  # noqa: BLE001 — any selenium/BiDi failure is a no-op
        _warn(f"script channel unavailable: {exc}")
        return False

    def on_console_entry(entry: Any) -> None:
        try:
            level, args = console_kwargs(entry)
            capturer.capture_console(level, args, source="browser")
        except Exception as exc:  # noqa: BLE001
            _warn(f"console handler threw: {exc}")

    def on_js_error(entry: Any) -> None:
        try:
            level, args = js_error_kwargs(entry)
            capturer.capture_console(level, args, source="browser")
        except Exception as exc:  # noqa: BLE001
            _warn(f"JS error handler threw: {exc}")

    try:
        script.add_console_message_handler(on_console_entry)
        script.add_javascript_error_handler(on_js_error)
        return True
    except Exception as exc:  # noqa: BLE001
        _warn(f"console/JS handlers failed to attach: {exc}")
        return False


def _attach_network(driver: Any, capturer: SessionCapturer) -> bool:
    """Subscribe to network events WITHOUT interception (see module docstring).

    Uses the low-level connection so requests are only observed. Returns False
    (and logs) on any failure — network BiDi is best-effort.
    """
    try:
        conn = driver.network.conn
        from selenium.webdriver.common.bidi.network import NetworkEvent  # lazy
        from selenium.webdriver.common.bidi.session import Session  # lazy
    except Exception as exc:  # noqa: BLE001
        _warn(f"network channel unavailable: {exc}")
        return False

    pending: Dict[str, Dict[str, Any]] = {}

    def on_request_sent(event: Any) -> None:
        try:
            kwargs = request_sent_kwargs(getattr(event, "params", {}) or {})
            if kwargs is not None:
                pending[kwargs["request_id"]] = kwargs
                capturer.capture_network(**kwargs)
        except Exception as exc:  # noqa: BLE001
            _warn(f"beforeRequestSent handler threw: {exc}")

    def on_response_completed(event: Any) -> None:
        try:
            kwargs = response_completed_kwargs(
                getattr(event, "params", {}) or {}, pending
            )
            if kwargs is not None:
                pending.pop(kwargs["request_id"], None)
                capturer.capture_network(**kwargs)
        except Exception as exc:  # noqa: BLE001
            _warn(f"responseCompleted handler threw: {exc}")

    try:
        conn.execute(
            Session(conn).subscribe(
                BIDI_NET_BEFORE_REQUEST, BIDI_NET_RESPONSE_COMPLETED
            )
        )
        conn.add_callback(NetworkEvent(BIDI_NET_BEFORE_REQUEST), on_request_sent)
        conn.add_callback(
            NetworkEvent(BIDI_NET_RESPONSE_COMPLETED), on_response_completed
        )
        return True
    except Exception as exc:  # noqa: BLE001
        _warn(f"network subscribe failed: {exc}")
        return False


def attach(driver: Any, capturer: SessionCapturer) -> bool:
    """Wire BiDi console + network capture onto ``driver``.

    Returns True if at least one channel attached. A driver without the
    ``webSocketUrl`` capability (BiDi not enabled at build time) is skipped with
    a one-line warning — capture continues via the command stream only.
    """
    if not _bidi_enabled(driver):
        _warn(
            f"{BIDI_CAPABILITY} not set on the session — enable BiDi with "
            "options.web_socket_url = True to capture console/network"
        )
        return False
    attached = 0
    if _attach_console(driver, capturer):
        attached += 1
    if _attach_network(driver, capturer):
        attached += 1
    return attached > 0
