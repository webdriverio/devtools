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

Network capture subscribes through ``Network.add_event_handler``, the public
observe-only API in the BiDi layer selenium regenerated in 4.44. Before that
release the only way to observe was a private connection plus ``NetworkEvent``,
both of which 4.44 removed; the adapter requires 4.44+ rather than carrying a
second path for versions predating its own first release.

Its generated event dataclasses cannot be used as delivered:
``BeforeRequestSentParameters`` declares only ``initiator`` and the deserializer
DROPS every param not declared, taking the request, its id and the timestamp
with it — which leaves a response with nothing to correlate against. So
``_add_raw_event_handler`` registers the callback with a pass-through
deserializer of its own, writing nothing that another subscriber reads.

``tests/test_selenium_surface.py`` guards that surface against the installed
selenium.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

from .capturer import SessionCapturer
from .constants import (
    BIDI_CAPABILITY,
    BIDI_LEVEL_MAP,
    BIDI_NET_BEFORE_REQUEST,
    BIDI_NET_RESPONSE_COMPLETED,
    LOGGER_NAME,
    SELENIUM_MINIMUM_VERSION,
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

    ``params`` is the raw BiDi ``network.beforeRequestSent`` event params, as
    delivered by ``event_params``.
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
    """Why network capture could not attach, naming a too-old selenium as the
    cause when it is one.

    The adapter needs the BiDi layer selenium regenerated in 4.44, and pyproject
    requires it, but a user can still end up below that — an existing
    environment, a transitive pin, a resolver that had to back off. The bare
    exception is then an AttributeError about a generated attribute, which reads
    like a broken install rather than a version floor.
    """
    version = selenium_version()
    required = ".".join(str(p) for p in SELENIUM_MINIMUM_VERSION)
    if version < SELENIUM_MINIMUM_VERSION:
        installed = ".".join(str(part) for part in version)
        return (
            f"network capture needs selenium >= {required} and {installed} is "
            "installed: the BiDi event API it subscribes through arrived in "
            f"{required}. Console, DOM and command capture are unaffected. "
            f"`pip install --upgrade 'selenium>={required}'` restores it."
        )
    return (
        f"network capture could not attach on selenium {'.'.join(str(p) for p in version)}"
        f" ({exc}). Console, DOM and command capture are unaffected. Please "
        "report this: https://github.com/webdriverio/devtools/issues"
    )


def event_params(event: Any) -> Dict[str, Any]:
    """The BiDi event params dict.

    ``_RawEvent`` passes selenium's params straight through, so this is already a
    dict on every healthy path. It stays as the boundary check because the value
    comes from selenium's dispatch rather than from us: a future release that
    hands the callback something else is then an empty dict and a warning from
    ``_incomplete_event``, not an AttributeError inside the handler.
    """
    return event if isinstance(event, dict) else {}


class _RawEvent:
    """The deserializer selenium's dispatch expects, passing params through.

    Selenium identifies an event by ``event_class`` and deserializes it with
    ``from_json``; its own wrapper builds a generated dataclass there, which for
    these two events silently discards the request and the timestamp.
    """

    def __init__(self, bidi_event: str) -> None:
        self.event_class = bidi_event

    def from_json(self, params: Any) -> Any:
        return params


def supports_event_handler_api() -> bool:
    """True when selenium presents the regenerated BiDi network layer.

    Detection only — nothing is mutated. ``add_event_handler`` is the marker
    rather than something this calls: it is public, it arrived with the layer,
    and the event manager behind it is per-instance so there is nothing to check
    for on the class. A manager that is then missing its parts raises inside
    ``_add_raw_event_handler`` and is reported there.
    """
    try:
        from selenium.webdriver.common.bidi.network import Network
    except ImportError:
        return False
    return hasattr(Network, "add_event_handler")


def _add_raw_event_handler(network: Any, bidi_event: str, callback: Any) -> None:
    """Subscribe ``callback`` to ``bidi_event`` with the RAW params.

    This is selenium's own ``add_event_handler`` body with one substitution: it
    looks its deserializer up in a per-event map shared by every subscriber, and
    we hand ours in directly. ``add_callback`` closes over the deserializer it is
    given, so ours holds for the life of the session.

    Writing ours into that map instead would keep the registration on the public
    API, but there is no safe window in which to do it: the swap has to stay in
    place across ``add_event_handler``, which subscribes over the websocket, and
    any handler another thread registers for the same event during that round
    trip closes over OUR deserializer and receives dicts where it expects
    selenium's generated objects. Passing it in writes nothing shared, so no such
    window exists.
    """
    manager = network._event_manager
    wrapper = _RawEvent(bidi_event)
    callback_id = manager.conn.add_callback(wrapper, callback)
    manager.subscribe_to_event(bidi_event)
    # Selenium counts callbacks per event to decide when a subscription is no
    # longer needed. Ours is registered on the connection directly, so without
    # this it is invisible to that count and another consumer removing their
    # handler would unsubscribe the event out from under us.
    manager.add_callback_to_tracking(bidi_event, callback_id)
    # Returned so a failed attach can undo exactly what it did.
    return wrapper, callback_id


def _undo_registration(
    manager: Any, bidi_event: str, wrapper: Any, callback_id: Any
) -> None:
    """Best-effort unwind of one registration.

    Being counted in selenium's bookkeeping is what makes leaving one behind
    harmful: an abandoned callback keeps the event's callback count above zero,
    so a later consumer removing THEIR handler no longer unsubscribes, and the
    browser keeps sending the event for the rest of the session.

    Each step is guarded on its own. The registration may have failed part-way,
    and a step with nothing to undo must not stop the ones that do. The callback
    and its count go first so ``unsubscribe_from_event`` sees an empty list —
    it only unsubscribes when no callbacks remain, so this cannot take down a
    subscription another consumer is still using.
    """
    for label, undo in (
        ("callback", lambda: manager.conn.remove_callback(wrapper, callback_id)),
        ("count", lambda: manager.remove_callback_from_tracking(bidi_event, callback_id)),
        ("subscription", lambda: manager.unsubscribe_from_event(bidi_event)),
    ):
        try:
            undo()
        except Exception as exc:  # noqa: BLE001 — unwinding must not raise
            _log.debug("could not unwind the %s for %s: %s", label, bidi_event, exc)


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


def _attach_network(
    driver: Any, capturer: SessionCapturer, stats: Optional[Dict[str, Any]] = None
) -> bool:
    """Subscribe to network events WITHOUT interception (see module docstring).

    Returns False (and logs) on any failure — network BiDi is best-effort.

    ``stats`` is filled in for the caller to report at teardown, rather than
    logged per event: the dashboard's Network tab already lists every request, so
    a running count is one Console line per request saying what the UI beside it
    already shows. What the tab cannot show is a request whose response never
    arrived, which is what ``pending`` still holding entries at the end means.
    """
    stats = stats if stats is not None else {}
    stats["captured"] = 0
    pending: Dict[str, Dict[str, Any]] = {}
    stats["pending"] = pending
    # Both handlers are inert until every subscription is in place — see
    # _subscribe_via_event_manager for why a half-subscribed pair is worse than
    # no capture at all.
    active = {"ok": False}

    def on_request_sent(event: Any) -> None:
        if not active["ok"]:
            return
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

    def on_response_completed(event: Any) -> None:
        if not active["ok"]:
            return
        try:
            params = event_params(event)
            if _incomplete_event(params, BIDI_NET_RESPONSE_COMPLETED):
                return
            kwargs = response_completed_kwargs(params, pending)
            if kwargs is not None:
                pending.pop(kwargs["request_id"], None)
                capturer.capture_network(**kwargs)
                stats["captured"] += 1
        except Exception as exc:  # noqa: BLE001
            _warn(f"responseCompleted handler threw: {exc}")

    return _subscribe_via_event_manager(
        driver,
        {
            BIDI_NET_BEFORE_REQUEST: on_request_sent,
            BIDI_NET_RESPONSE_COMPLETED: on_response_completed,
        },
        active,
    )


def _subscribe_via_event_manager(
    driver: Any, handlers: Dict[str, Any], active: Dict[str, bool]
) -> bool:
    """selenium 4.44+: subscribe each handler to its BiDi event.

    Deliberately not ``add_request_handler``/``add_response_handler``: both
    register an intercept even in their high-level form, which pauses every
    request until selenium continues it. This only observes.

    A failure part-way through is handled twice over, because the two problems
    are different. ``active`` is flipped only once EVERY handler is registered,
    and the handlers consult it, so no incomplete DATA is ever produced:
    ``beforeRequestSent`` on its own emits a pending frame per request that only
    ``responseCompleted`` finalizes, which would fill the Network tab with
    requests stuck pending and grow ``pending`` for the rest of the session. That
    also covers the gap between the two subscribes, not just an outright failure.
    Then the registrations already made are unwound, so no STATE is left behind
    either — see ``_undo_registration`` for why an abandoned one is not inert.
    The flag is the guarantee; the unwind is best-effort and may find nothing.
    """
    if not supports_event_handler_api():
        # Checked rather than caught, so a too-old selenium is reported as a
        # version floor instead of an AttributeError about a generated attribute.
        _warn(network_unavailable_reason(AttributeError("no BiDi event API")))
        return False
    manager = None
    registered = []
    try:
        network = driver.network
        manager = network._event_manager
        for bidi_event, callback in handlers.items():
            wrapper, callback_id = _add_raw_event_handler(
                network, bidi_event, callback
            )
            registered.append((bidi_event, wrapper, callback_id))
    except Exception as exc:  # noqa: BLE001
        _warn(f"network subscribe failed, no network events captured: {exc}")
        for bidi_event, wrapper, callback_id in registered:
            _undo_registration(manager, bidi_event, wrapper, callback_id)
        return False
    active["ok"] = True
    return True


def network_summary(stats: Optional[Dict[str, Any]]) -> Optional[str]:
    """One line describing what network capture actually did, or None when there
    is nothing worth saying.

    Reported once at teardown rather than per event. The count is the cheap half;
    the useful half is requests still pending, which means a response never
    arrived and is the one thing the Network tab cannot show on its own.
    """
    if not stats:
        return None
    captured = stats.get("captured", 0)
    unanswered = len(stats.get("pending") or ())
    if not captured and not unanswered:
        return None
    if unanswered:
        return (
            f"network: {captured} request(s) captured, "
            f"{unanswered} still awaiting a response at teardown"
        )
    return f"network: {captured} request(s) captured"


def attach(
    driver: Any, capturer: SessionCapturer, stats: Optional[Dict[str, Any]] = None
) -> bool:
    """Wire BiDi console + network capture onto ``driver``.

    Returns True if at least one channel attached. A driver without the
    ``webSocketUrl`` capability (BiDi not enabled at build time) is skipped with
    a one-line warning — capture continues via the command stream only.

    ``stats`` is an optional bag the caller keeps, to be passed to
    ``network_summary`` when the session ends.
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
    if _attach_network(driver, capturer, stats):
        attached += 1
    return attached > 0
