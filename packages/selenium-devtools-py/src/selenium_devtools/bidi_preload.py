"""Document-start registration of the collector via a BiDi preload script.

The ``<script>``-append path in ``snapshot.py`` can only instrument the document
that exists when it runs, and a ``<script>`` dies with its document. So every
navigation produces a document we learn about afterwards, and everything built on
that — when to re-inject, when to drain, which action owns the new DOM — is
reconstruction, and races. A preload registered for the session runs in EVERY
document before any of that document's own script, so each one instruments itself
and anchors its own DOM at its own ``performance.timeOrigin``. Nothing to detect,
nothing to attribute.

The same registration can hand the page a BiDi channel to PUSH its mutations
down, which is what removes the per-command drain: a drain is a synchronous
``execute_script`` round trip on the user's own command path, and the buffer it
reads is empty once the page emits instead of buffering.

Mirrors ``core/bidi-preload.ts``, which the JS adapters use for the same reasons.

Requires a session created with ``webSocketUrl: true``; ``driver.script`` raises
without it, so this reports False and the caller keeps the ``<script>`` path.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable, List, NamedTuple, Optional

from ._contract import COLLECTOR_MUTATION_CHANNEL, COLLECTOR_SINK_GLOBAL
from .constants import BIDI_CAPABILITY, LOGGER_NAME
from .utils import attr_or

_log = logging.getLogger(f"{LOGGER_NAME}.preload")

#: ``Script.EVENT_CONFIGS`` key for ``script.message`` — the event a channel's
#: emitted argument arrives on. Pinned by tests/test_selenium_surface.py.
_MESSAGE_EVENT = "message"


class Registration(NamedTuple):
    """What the preload attempt achieved.

    Two facts rather than one, because a session can be instrumented at
    document-start and still have no channel to push down — and only the second
    decides whether the per-command drain has anything left to fetch.
    """

    registered: bool
    pushing: bool


#: Nothing was registered: no BiDi, or selenium refused. Named so the caller can
#: state that outcome without constructing it, and never sees a bare tuple —
#: which, being non-empty, would be truthy for either answer.
NOT_REGISTERED = Registration(False, False)


def as_function_declaration(source: str, *, sink: bool = False) -> str:
    """Wrap raw collector source as the function declaration BiDi expects.

    Not the ``wrap_injectable`` IIFE: a preload script IS a function, so the
    bundle's top-level await works directly in its body.

    With ``sink``, the channel's emit function is parked on a window global
    BEFORE the source runs. The collector claims it from its own module body,
    which is what lets the document anchor — the first and largest payload of a
    document's life — go out through the channel too; handed to the source as an
    argument it would arrive after the anchor was already buffered.
    """
    if not sink:
        return f"async () => {{ {source} }}"
    return (
        f"async (emit) => {{ window[{json.dumps(COLLECTOR_SINK_GLOBAL)}] = emit; "
        f"{source} }}"
    )


def can_push(source: str) -> bool:
    """Whether this collector build claims a sink, i.e. can push at all.

    Checked against the source about to be installed, because the caller stops
    draining once a channel is open: a collector built before the sink global
    existed never looks for it, so every mutation would sit in a buffer nobody
    reads and DOM replay would go silent — the one failure this whole path must
    not have. The wheel and the backend that serves the collector are versioned
    independently, so an older pairing is a real configuration rather than a
    hypothetical one.
    """
    return COLLECTOR_SINK_GLOBAL in source


def channel_argument() -> dict:
    """The BiDi ``ChannelValue`` the preload takes as its argument.

    A plain dict rather than selenium's ``ChannelValue`` class:
    ``add_preload_script`` passes ``arguments`` straight into the command params,
    so the wire shape is what it wants (selenium's own DOM-mutation helper builds
    the same dict). The JS side needs the class because its binding calls
    ``asMap()`` on every element.
    """
    return {"type": "channel", "value": {"channel": COLLECTOR_MUTATION_CHANNEL}}


def mutations_from_message(message: Any) -> Optional[List[Any]]:
    """The mutation batch a ``script.message`` carries, or None when it is not
    one of ours.

    Every subscriber on a session sees every ``script.message``, so the channel
    name is what makes one ours. The payload is a JSON STRING by design — BiDi
    serializes a channel's argument as a RemoteValue under an object-depth limit,
    which would silently truncate the document anchor, the one payload that is an
    arbitrarily deep tree. A string is depth-1 and survives whole, so it is
    parsed here rather than read as structured data.
    """
    if attr_or(message, "channel", None) != COLLECTOR_MUTATION_CHANNEL:
        return None
    payload = attr_or(attr_or(message, "data", None), "value", None)
    if not isinstance(payload, str):
        return None
    try:
        parsed = json.loads(payload)
    except ValueError as exc:
        _log.warning("unparseable mutation payload: %s", exc)
        return None
    return parsed if isinstance(parsed, list) else None


def _subscribe_pushed_mutations(
    driver: Any, on_mutations: Callable[[List[Any]], None]
) -> Optional[int]:
    """Subscribe to the collector's pushed batches, returning the callback id, or
    None when the subscription could not be made.

    None rather than a raise, so a session that cannot push still gets a
    document-start preload and keeps being drained. Losing the push costs a round
    trip per command; losing the preload would bring back the whole class of
    races it exists to remove.
    """

    def on_message(message: Any) -> None:
        # Runs on selenium's WebSocket reader thread, which also dispatches the
        # console and network events — an exception escaping here would take
        # those down with it, so the whole body is guarded, sink included.
        try:
            mutations = mutations_from_message(message)
            if mutations:
                on_mutations(mutations)
        except Exception as exc:  # noqa: BLE001 — capture must never break a test
            _log.warning("pushed mutations could not be forwarded: %s", exc)

    try:
        return driver.script.add_event_handler(_MESSAGE_EVENT, on_message)
    except Exception as exc:  # noqa: BLE001 — any selenium/BiDi failure degrades
        _log.warning(
            "could not subscribe to pushed mutations, draining instead: %s", exc
        )
        return None


def _unsubscribe(driver: Any, callback_id: int) -> None:
    """Undo a subscription whose preload then failed to register.

    Left behind it is not inert: selenium counts callbacks per event to decide
    when a subscription is still needed, so an abandoned one keeps the count
    above zero and the browser keeps sending ``script.message`` — to a handler
    that can never receive anything, since no channel was ever handed out.
    """
    try:
        driver.script.remove_event_handler(_MESSAGE_EVENT, callback_id)
    except Exception as exc:  # noqa: BLE001 — unwinding must not raise
        _log.debug("could not unwind the pushed-mutation subscription: %s", exc)


def register_collector_preload(
    driver: Any,
    source: str,
    on_mutations: Optional[Callable[[List[Any]], None]] = None,
) -> Registration:
    """Register the collector to run at document-start in every document of this
    session. ``registered`` False means the caller must fall back to ``<script>``
    injection.

    Registered with NO browsing-context id, which is what makes it global —
    contexts created later are covered, which is exactly the set this exists to
    catch. ``add_preload_script`` forwards no ``contexts`` when it isn't given
    one, and BiDi treats that as every context. That reliance is pinned by a test.

    Passing ``on_mutations`` also opens the channel the page pushes its batches
    down, which is what lets the caller stop draining once per command. Omitting
    it keeps the pull behaviour exactly as it was, and a channel that cannot be
    opened degrades to the same — so the drain has to stay wired either way.
    """
    caps = getattr(driver, "caps", None)
    if not (isinstance(caps, dict) and caps.get(BIDI_CAPABILITY)):
        # Not a warning: the caller already reports the missing capability once,
        # and the `<script>` path still captures DOM — just with the races this
        # module exists to remove.
        _log.debug(
            "%s not set on the session — no document-start preload, using "
            "per-document injection",
            BIDI_CAPABILITY,
        )
        return NOT_REGISTERED
    callback_id = None
    if on_mutations:
        if can_push(source):
            callback_id = _subscribe_pushed_mutations(driver, on_mutations)
        else:
            _log.info(
                "this collector build cannot push — draining after each command"
            )
    pushing = callback_id is not None
    try:
        script = driver.script
        script.add_preload_script(
            function_declaration=as_function_declaration(source, sink=pushing),
            arguments=[channel_argument()] if pushing else None,
        )
    except Exception as exc:  # noqa: BLE001 — any selenium/BiDi failure degrades
        if callback_id is not None:
            _unsubscribe(driver, callback_id)
        _log.warning(
            "BiDi preload unavailable, falling back to per-document injection: %s",
            exc,
        )
        return NOT_REGISTERED
    _log.info(
        "collector registered at document-start, pushing mutations (BiDi preload)"
        if pushing
        else "collector registered at document-start (BiDi preload)"
    )
    return Registration(True, pushing)
