"""The page scripts the snapshot and performance capture run, fetched from the
backend.

The collector readiness probe, its ``<script>`` injection, the forced-anchor
drain and the navigation timing read all live in ``@wdio/devtools-shared`` as
browser source, which this adapter cannot import. The backend serves them, as
it serves the collector and the element scripts, so the strings are the ones
the JS adapters run. Copies drifted: the JS performance script lacked the outer
``return`` this adapter's copy had.

Fetched once per run and cached, a failure included, since they are run after
every command. Without them DOM replay and navigation timings are off for the
run; nothing here raises into the user's test.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Optional

from ._contract import PAGE_SCRIPTS_PATH
from .constants import ELEMENT_SCRIPTS_FETCH_TIMEOUT_S, LOGGER_NAME
from .types import PageScriptsResponse

_log = logging.getLogger(f"{LOGGER_NAME}.page_scripts")

_KEYS = ("collectorReady", "collectorInject", "collectorDrain", "capturePerformance")

#: Keyed by the backend it came from, like the element scripts: a re-enable may
#: attach to a different one.
_cache: dict = {"origin": None, "scripts": None, "settled": False}


def reset_cache() -> None:
    """Drop the cached scripts. Called on teardown so a re-enable re-fetches."""
    _cache.update(origin=None, scripts=None, settled=False)


def scripts_url(host: str, port: int) -> str:
    """The endpoint on a backend; a bare IPv6 literal is bracketed, as
    `collector_url` does."""
    url_host = f"[{host}]" if ":" in host and not host.startswith("[") else host
    return f"http://{url_host}:{port}{PAGE_SCRIPTS_PATH}"


def fetch(host: str, port: int) -> Optional[PageScriptsResponse]:
    """The four page scripts from the backend, or None on anything at all: no
    route (a backend older than it), a refused connection, a body that is not
    the promised shape."""
    origin = (host, port)
    if _cache["settled"] and _cache["origin"] == origin:
        return _cache["scripts"]

    scripts: Optional[PageScriptsResponse] = None
    try:
        with urllib.request.urlopen(  # noqa: S310 - a loopback backend we launched
            scripts_url(host, port), timeout=ELEMENT_SCRIPTS_FETCH_TIMEOUT_S
        ) as response:
            body = json.loads(response.read().decode("utf-8"))
        if isinstance(body, dict) and all(
            isinstance(body.get(k), str) and body.get(k) for k in _KEYS
        ):
            scripts = {
                "collectorReady": body["collectorReady"],
                "collectorInject": body["collectorInject"],
                "collectorDrain": body["collectorDrain"],
                "capturePerformance": body["capturePerformance"],
            }
        else:
            _log.warning("page scripts: unexpected response shape")
    except (urllib.error.URLError, OSError, ValueError) as exc:
        # A warning, not debug: unlike the A11y scripts this costs DOM replay,
        # and an old backend is the likely cause, fixed by upgrading it.
        _log.warning(
            "page scripts unavailable from %s:%s (%s); DOM replay and "
            "navigation timings are off this run",
            host, port, exc,
        )

    _cache.update(origin=origin, scripts=scripts, settled=True)
    return scripts
