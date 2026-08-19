"""Selenium BiDi capture — browser console, JS exceptions, and network.

Mirrors the JS ``core/bidi.ts`` + ``selenium-devtools/bidi.ts`` split: the pure
event→frame mapping helpers (``console_kwargs`` / ``request_sent_kwargs`` /
``response_completed_kwargs``) take plain dicts/objects and are unit-testable
without selenium; ``attach`` does the selenium wiring and is defensive — a BiDi
failure is a logged no-op, never a raised error into the user's test.

Two constants shape this module:

* BiDi only opens when the session was created with ``webSocketUrl`` truthy
  (``options.web_socket_url = True`` at build). We can't set that from inside
  the ``execute`` wrapper — the session already exists — so attach() checks the
  capability and degrades if it's missing.
* Network events are OBSERVED, never intercepted. Every selenium API that takes
  a request or response handler registers an intercept, which pauses each
  request until selenium continues it; that would change the timing of the page
  under test. Both paths below subscribe instead.

There are two of those paths because selenium 4.44 regenerated the BiDi layer
from a schema, and the pre-4.44 one no longer exists there:

* **4.44+** — ``Network.add_event_handler``, public and observe-only. Its
  generated event dataclasses are lossy (``BeforeRequestSentParameters``
  declares only ``initiator``, and its deserializer DROPS every param not
  declared, taking the request, its id and the timestamp with it), so
  ``register_raw_event_configs`` registers configs whose event class is ``dict``
  and the handlers receive raw params.
* **≤4.43** — ``driver.network.conn`` plus ``NetworkEvent``, which is all those
  versions offer.

``event_params`` is what lets one pair of handlers serve both, and the mapping
helpers below never learn which path ran. ``tests/test_selenium_surface.py``
guards both surfaces against the installed selenium.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

from .capturer import SessionCapturer
from .constants import (
    BIDI_CAPABILITY,
    BIDI_LEVEL_MAP,
    BIDI_NET_BEFORE_REQUEST,
    BIDI_NET_EVENT_KEYS,
    BIDI_NET_RESPONSE_COMPLETED,
    LOGGER_NAME,
    SELENIUM_NETWORK_SURFACE_MOVED_AT,
)
from .utils import now_ms, selenium_version

_log = logging.getLogger(f"{LOGGER_NAME}.bidi")


def _warn(message: str) -> None:
    _log.warning(message)


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


def network_unavailable_reason(exc: Exception) -> str:
    """Why the connection path could not attach.

    Reached on 4.44+ only when ``register_raw_event_configs`` declined, i.e. the
    regenerated layer is installed but did not present the API it is defined by.
    The bare exception there is ``cannot import name 'NetworkEvent'``, which
    reads like a broken install rather than a path that does not apply — so that
    case says what it means and asks for a report, because it is a combination
    the adapter does not know about.
    """
    version = selenium_version()
    if version >= SELENIUM_NETWORK_SURFACE_MOVED_AT:
        installed = ".".join(str(part) for part in version)
        moved_at = ".".join(str(p) for p in SELENIUM_NETWORK_SURFACE_MOVED_AT)
        return (
            f"network capture could not attach on selenium {installed}: its "
            f"{moved_at}+ event-handler API was not usable, and the older "
            f"connection path does not exist there ({exc}). Console, DOM and "
            "command capture are unaffected. Please report this with your "
            "selenium version: https://github.com/webdriverio/devtools/issues"
        )
    return f"network channel unavailable: {exc}"


def event_params(event: Any) -> Dict[str, Any]:
    """The BiDi event params dict, from either subscription path.

    Legacy selenium hands the callback a ``NetworkEvent`` carrying ``.params``;
    4.44+ hands it whatever its deserializer produced, which is the raw params
    dict for the configs registered by ``register_raw_event_configs``. Both
    collapse here so the mapping helpers below only ever see a plain dict.
    """
    if isinstance(event, dict):
        return event
    params = getattr(event, "params", None)
    return params if isinstance(params, dict) else {}


def register_raw_event_configs() -> bool:
    """Register raw-params event configs on selenium 4.44+. False = legacy path.

    MUST run before anything touches ``driver.network``: the deserializers are
    built once, in ``Network.__init__``, from whatever configs exist then.

    Registered under the adapter's own keys so the result does not depend on
    selenium's own duplicate config entries — it ships two keys mapping to
    ``network.beforeRequestSent`` with different classes, and which one wins is
    decided by dict iteration order. Ours are added last and win either way.

    Side effect worth knowing: deserializers are keyed by BiDi event, not by
    config key, so this also makes selenium's own ``response_completed`` handlers
    receive the raw dict in this process. Nothing else in a test run subscribes
    to it, and the dict carries strictly more than the dataclass it replaces.
    """
    try:
        from selenium.webdriver.common.bidi.network import EventConfig, Network
    except ImportError:
        return False  # ≤4.43: no generated layer, use the connection path
    configs = getattr(Network, "EVENT_CONFIGS", None)
    if not isinstance(configs, dict) or not hasattr(Network, "add_event_handler"):
        return False
    for bidi_event, key in BIDI_NET_EVENT_KEYS.items():
        configs.setdefault(key, EventConfig(key, bidi_event, dict))
    return True


_reported_incomplete: set = set()


def _incomplete_event(params: Dict[str, Any], label: str) -> bool:
    """True (and warns ONCE per event type) when an event arrived without the
    fields capture needs.

    The 4.44+ path relies on selenium deserializing to the raw params, so a
    future release that reinstates a typed class for these events would strip
    the request and timestamp and leave every entry uncorrelated. That would
    otherwise show up as a quietly empty Network tab — the exact failure this
    port exists to end — so it is stated instead.

    Once, because the condition is a property of the selenium build rather than
    of a request: warning per event would put one line per HTTP request of the
    run into the user's console and bury the message it is trying to deliver.
    """
    if params.get("request") is not None:
        return False
    if label not in _reported_incomplete:
        _reported_incomplete.add(label)
        _warn(
            f"{label} arrived without a request field, so it cannot be "
            f"correlated — selenium delivered {sorted(params) or 'nothing'}. "
            "Network capture is degraded; please report this with your selenium "
            "version. Further occurrences are not logged."
        )
    return True


def _attach_network(driver: Any, capturer: SessionCapturer) -> bool:
    """Subscribe to network events WITHOUT interception (see module docstring).

    Returns False (and logs) on any failure — network BiDi is best-effort.
    """
    use_event_manager = register_raw_event_configs()

    pending: Dict[str, Dict[str, Any]] = {}

    def on_request_sent(event: Any) -> None:
        try:
            params = event_params(event)
            if _incomplete_event(params, BIDI_NET_BEFORE_REQUEST):
                return
            kwargs = request_sent_kwargs(params)
            if kwargs is not None:
                pending[kwargs["request_id"]] = kwargs
                capturer.capture_network(**kwargs)
        except Exception as exc:  # noqa: BLE001
            _warn(f"beforeRequestSent handler threw: {exc}")

    captured = {"n": 0}

    def on_response_completed(event: Any) -> None:
        try:
            params = event_params(event)
            if _incomplete_event(params, BIDI_NET_RESPONSE_COMPLETED):
                return
            kwargs = response_completed_kwargs(params, pending)
            if kwargs is not None:
                pending.pop(kwargs["request_id"], None)
                capturer.capture_network(**kwargs)
                captured["n"] += 1
                # The first one is the proof the subscription is live end to
                # end; the rest are a count, because an empty Network tab and a
                # tab nobody looked at are indistinguishable after the fact.
                if captured["n"] == 1:
                    _log.info("network capture live, first response: %s", kwargs["url"])
                _log.debug("network entries captured: %d", captured["n"])
        except Exception as exc:  # noqa: BLE001
            _warn(f"responseCompleted handler threw: {exc}")

    if use_event_manager:
        return _subscribe_via_event_manager(
            driver, on_request_sent, on_response_completed
        )
    return _subscribe_via_connection(driver, on_request_sent, on_response_completed)


def _subscribe_via_event_manager(
    driver: Any, on_request_sent: Any, on_response_completed: Any
) -> bool:
    """selenium 4.44+: subscribe through the public ``add_event_handler``.

    Deliberately not ``add_request_handler``/``add_response_handler``: both
    register an intercept even in their high-level form, which pauses every
    request until selenium continues it. This only observes.
    """
    try:
        network = driver.network
        network.add_event_handler(
            BIDI_NET_EVENT_KEYS[BIDI_NET_BEFORE_REQUEST], on_request_sent
        )
        network.add_event_handler(
            BIDI_NET_EVENT_KEYS[BIDI_NET_RESPONSE_COMPLETED], on_response_completed
        )
        _log.info(
            "network capture subscribed via the event-handler API (selenium %s)",
            ".".join(str(p) for p in selenium_version()),
        )
        return True
    except Exception as exc:  # noqa: BLE001
        _warn(f"network subscribe failed: {exc}")
        return False

def _subscribe_via_connection(
    driver: Any, on_request_sent: Any, on_response_completed: Any
) -> bool:
    """selenium ≤4.43: subscribe over the low-level connection.

    Kept because it is the only path on those versions, not as a fallback for a
    4.44+ failure — there `driver.network.conn` and ``NetworkEvent`` do not
    exist, so this cannot recover anything the path above could not do.
    """
    try:
        conn = driver.network.conn
        from selenium.webdriver.common.bidi.network import NetworkEvent  # lazy
        from selenium.webdriver.common.bidi.session import Session  # lazy
    except Exception as exc:  # noqa: BLE001
        _warn(network_unavailable_reason(exc))
        return False

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
        _log.info(
            "network capture subscribed via the connection (selenium %s)",
            ".".join(str(p) for p in selenium_version()),
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
