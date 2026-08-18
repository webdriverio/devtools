"""Document-start registration of the collector via a BiDi preload script.

The ``<script>``-append path in ``snapshot.py`` can only instrument the document
that exists when it runs, and a ``<script>`` dies with its document. So every
navigation produces a document we learn about afterwards, and everything built on
that — when to re-inject, when to drain, which action owns the new DOM — is
reconstruction, and races. A preload registered for the session runs in EVERY
document before any of that document's own script, so each one instruments itself
and anchors its own DOM at its own ``performance.timeOrigin``. Nothing to detect,
nothing to attribute.

Mirrors ``core/bidi-preload.ts``, which the JS adapters use for the same reason.

Requires a session created with ``webSocketUrl: true``; ``driver.script`` raises
without it, so this reports False and the caller keeps the ``<script>`` path.
"""

from __future__ import annotations

import logging
from typing import Any

from .constants import BIDI_CAPABILITY, LOGGER_NAME

_log = logging.getLogger(f"{LOGGER_NAME}.preload")


def as_function_declaration(source: str) -> str:
    """Wrap raw collector source as the function declaration BiDi expects.

    Not the ``wrap_injectable`` IIFE: a preload script IS a function, so the
    bundle's top-level await works directly in its body.
    """
    return f"async () => {{ {source} }}"


def register_collector_preload(driver: Any, source: str) -> bool:
    """Register the collector to run at document-start in every document of this
    session. False means the caller must fall back to ``<script>`` injection.

    Registered with NO browsing-context id, which is what makes it global —
    contexts created later are covered, which is exactly the set this exists to
    catch. `driver.script.pin` is the public API for it; its docstring says
    "current browsing context", but it forwards no `contexts` argument, and BiDi
    treats that as every context. That reliance is pinned by a test.
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
        return False
    try:
        script = driver.script
        script.pin(as_function_declaration(source))
    except Exception as exc:  # noqa: BLE001 — any selenium/BiDi failure degrades
        _log.warning(
            "BiDi preload unavailable, falling back to per-document injection: %s",
            exc,
        )
        return False
    _log.info("collector registered at document-start (BiDi preload)")
    return True
