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
import urllib.error
import urllib.request
from typing import Optional

from ._contract import COLLECTOR_PATH
from .constants import CONNECT_TIMEOUT_S, LOGGER_NAME

_log = logging.getLogger(f"{LOGGER_NAME}.collector")

#: Outcome cached for the process, keyed by the backend it came from. A second
#: `enable()` against a different backend must not reuse the first one's answer.
#:
#: FAILURE is cached too, as `source=None` with `settled=True`. The collector is
#: re-injected after EVERY command, so an unreachable backend would otherwise
#: repeat a synchronous request — up to `CONNECT_TIMEOUT_S` each — once per
#: command, turning a degraded run into an unusably slow one and flooding the
#: log with the same warning. The answer cannot change mid-run: either this
#: backend serves the collector or it does not.
_cache: dict = {"origin": None, "source": None, "settled": False}


def collector_url(host: str, port: int) -> str:
    """The collector's URL on a backend. A bare IPv6 literal (``::1``, which
    `DEVTOOLS_HOST` may carry and the backend's own log prints) needs authority
    brackets, or the URL is malformed and the fetch fails even though the socket
    transport connected to that same host quite happily."""
    url_host = f"[{host}]" if ":" in host and not host.startswith("[") else host
    return f"http://{url_host}:{port}{COLLECTOR_PATH}"


def reset_cache() -> None:
    """Drop the cached outcome. Called on teardown so a re-enable re-fetches."""
    _cache.update(origin=None, source=None, settled=False)


def fetch_collector_source(host: str, port: int) -> Optional[str]:
    """The collector's JavaScript source from the backend, or None.

    None is a degraded run, never a broken one: DOM replay goes missing while
    commands, console, network and screencast keep working. The reason is
    logged through the package logger so it reaches the dashboard Console
    rather than a stderr line nobody reads.
    """
    url = collector_url(host, port)
    if _cache["origin"] == url and _cache["settled"]:
        return _cache["source"]

    def settle(source: Optional[str]) -> Optional[str]:
        _cache.update(origin=url, source=source, settled=True)
        return source

    try:
        with urllib.request.urlopen(url, timeout=CONNECT_TIMEOUT_S) as response:
            source = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        # A 404 is the specific, actionable case: the backend predates the
        # route, so say which version introduced it rather than just the code.
        _log.warning(
            "backend at %s:%s does not serve the collector (HTTP %s) — it is "
            "older than the version that added %s, so DOM replay is disabled",
            host, port, exc.code, COLLECTOR_PATH,
        )
        return settle(None)
    except (urllib.error.URLError, OSError, UnicodeDecodeError) as exc:
        _log.warning(
            "could not fetch the collector from %s (%s) — DOM replay is disabled",
            url, exc,
        )
        return settle(None)
    if not source:
        _log.warning("the backend served an empty collector — DOM replay is disabled")
        return settle(None)
    settle(source)
    # Says which path supplied the collector. Without it a run that quietly fell
    # back to the monorepo file looks identical to one served over HTTP, which
    # is the difference between working and not working once installed.
    _log.info("collector fetched from the backend (%d bytes)", len(source))
    return source
