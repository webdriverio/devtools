"""Where the page-side collector's source comes from.

The collector is the runtime injected into the page to capture DOM mutations.
It is fetched from the backend, which serves it at ``COLLECTOR_PATH`` out of the
``@wdio/devtools-script`` package it depends on — so the version is matched by
construction and this package ships no copy of a 200KB bundle it would have to
keep in step.

The filesystem walk stays as a fallback for one case: a monorepo checkout run
against a backend older than the route. It cannot work for a published install,
which is the whole reason the route exists — `packages/script/dist/script.js`
does not exist under site-packages, and the wheel ships only
``src/selenium_devtools``.

Fetched once per run and cached: the collector is injected per document, and a
navigation-time round trip for an unchanging 200KB body would be pure cost.
"""

from __future__ import annotations

import logging
import time
import urllib.error
import urllib.request
from typing import Optional

from ._contract import COLLECTOR_PATH
from .constants import (
    COLLECTOR_RETRY_COOLDOWN_S,
    COLLECTOR_RETRY_LIMIT,
    CONNECT_TIMEOUT_S,
    LOGGER_NAME,
)

_log = logging.getLogger(f"{LOGGER_NAME}.collector")

#: Outcome cached for the process, keyed by the backend it came from. A second
#: `enable()` against a different backend must not reuse the first one's answer.
#:
#: A failure is cached too, because the collector is re-injected after EVERY
#: command and an unanswered request costs up to `CONNECT_TIMEOUT_S` each time.
#: But how long it is cached depends on WHY it failed:
#:
#:   * `settled` — the server answered a refusal (a 404: this backend has no
#:     such route). That cannot change while the run lasts, so it is never
#:     asked again.
#:   * `attempts` / `last_try` — nothing answered, or the answer was unusable.
#:     A timeout, reset or DNS failure during the first request is exactly the
#:     kind that recovers, and a published install has no filesystem fallback
#:     to fall back to, so it is retried — after a cooldown, and only up to
#:     `COLLECTOR_RETRY_LIMIT` times so an unreachable backend costs a bounded
#:     amount rather than the whole run.
_cache: dict = {
    "origin": None,
    "source": None,
    "settled": False,
    "attempts": 0,
    "last_try": 0.0,
}


def collector_url(host: str, port: int) -> str:
    """The collector's URL on a backend. A bare IPv6 literal (``::1``, which
    `DEVTOOLS_HOST` may carry and the backend's own log prints) needs authority
    brackets, or the URL is malformed and the fetch fails even though the socket
    transport connected to that same host quite happily."""
    url_host = f"[{host}]" if ":" in host and not host.startswith("[") else host
    return f"http://{url_host}:{port}{COLLECTOR_PATH}"


def reset_cache() -> None:
    """Drop the cached outcome. Called on teardown so a re-enable re-fetches."""
    _cache.update(origin=None, source=None, settled=False, attempts=0, last_try=0.0)


def _retry_is_due() -> bool:
    """False while a transient failure is still cooling off. Without this the
    per-command re-injection would turn every retry into a request per command,
    which is the cost the cache exists to avoid."""
    if _cache["attempts"] == 0:
        return True
    return time.monotonic() - _cache["last_try"] >= COLLECTOR_RETRY_COOLDOWN_S


def fetch_collector_source(host: str, port: int) -> Optional[str]:
    """The collector's JavaScript source from the backend, or None.

    None is a degraded run, never a broken one: DOM replay goes missing while
    commands, console, network and screencast keep working. The reason is
    logged through the package logger so it reaches the dashboard Console
    rather than a stderr line nobody reads.
    """
    url = collector_url(host, port)
    if _cache["origin"] != url:  # a different backend answers for itself
        reset_cache()
    if _cache["settled"]:
        return _cache["source"]
    if not _retry_is_due():
        return None

    def settle(source: Optional[str]) -> Optional[str]:
        """Record a final answer — never asked again for this backend."""
        _cache.update(origin=url, source=source, settled=True)
        return source

    def retry_later(reason: str) -> Optional[str]:
        """Record a transient failure. Retried after the cooldown, up to the
        limit, then given up on so the cost stays bounded."""
        _cache.update(
            origin=url, source=None, attempts=_cache["attempts"] + 1,
            last_try=time.monotonic(),
        )
        if _cache["attempts"] >= COLLECTOR_RETRY_LIMIT:
            _log.warning(
                "giving up on the collector after %d attempts (%s) — "
                "DOM replay is disabled for this run",
                _cache["attempts"], reason,
            )
            return settle(None)
        _log.warning(
            "could not fetch the collector from %s (%s) — retrying on a later "
            "command", url, reason,
        )
        return None

    try:
        with urllib.request.urlopen(url, timeout=CONNECT_TIMEOUT_S) as response:
            source = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        # 404 is the only status that settles the question: this backend has no
        # such route and will not grow one mid-run. Everything else — 429, 500,
        # 502, 503, a proxy hiccup — means the route exists but could not be
        # served just now, which is precisely what the retry is for. The
        # asymmetry is deliberate: wrongly retrying a permanent error costs a
        # bounded few attempts, while wrongly settling a temporary one costs the
        # run its DOM replay.
        if exc.code != 404:
            return retry_later(f"HTTP {exc.code}")
        # Worth naming specifically: an old backend is the likely cause, and the
        # fix is upgrading it rather than debugging the adapter.
        _log.warning(
            "backend at %s:%s does not serve the collector (HTTP %s) — it is "
            "older than the version that added %s, so DOM replay is disabled",
            host, port, exc.code, COLLECTOR_PATH,
        )
        return settle(None)
    except (urllib.error.URLError, OSError, UnicodeDecodeError) as exc:
        # Nothing answered: a timeout, reset or DNS failure. Exactly the kind
        # that recovers, and the kind a first request is most likely to hit.
        return retry_later(str(exc))
    if not source:
        return retry_later("the backend served an empty collector")
    settle(source)
    # Says which path supplied the collector. Without it a run that quietly fell
    # back to the monorepo file looks identical to one served over HTTP, which
    # is the difference between working and not working once installed.
    _log.info("collector fetched from the backend (%d bytes)", len(source))
    return source
