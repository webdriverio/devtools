"""Where the page-side collector comes from.

The backend serves it out of the `@wdio/devtools-script` package it depends on.
That is the only route that works for an installed wheel: the filesystem walk
looks for `packages/script/dist/script.js`, which exists only in a monorepo
checkout, so a pip install used to lose DOM replay with nothing to explain it.
"""

import http.server
import threading
import unittest
from unittest import mock

from selenium_devtools import collector_source


def _serving(handler_body, status=200):
    """A one-request HTTP server on a free port. Returns (host, port, stop)."""

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            self.send_response(status)
            self.send_header("Content-Type", "application/javascript")
            self.end_headers()
            self.wfile.write(handler_body.encode())

        def log_message(self, *_args):  # keep the test output quiet
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    return host, port, server.shutdown


class TestFetchingTheCollector(unittest.TestCase):
    def setUp(self):
        collector_source.reset_cache()

    tearDown = setUp

    def test_returns_the_served_source(self):
        host, port, stop = _serving("window.wdioTraceCollector = {}")
        try:
            self.assertEqual(
                collector_source.fetch_collector_source(host, port),
                "window.wdioTraceCollector = {}",
            )
        finally:
            stop()

    def test_caches_so_a_navigation_does_not_refetch(self):
        # The collector is injected per document; re-fetching 200KB on every
        # navigation would be pure cost for a body that cannot change.
        host, port, stop = _serving("SOURCE")
        try:
            self.assertEqual(collector_source.fetch_collector_source(host, port), "SOURCE")
        finally:
            stop()  # the server is gone; a second fetch must not need it
        self.assertEqual(collector_source.fetch_collector_source(host, port), "SOURCE")

    def test_a_different_backend_is_not_served_the_cached_body(self):
        collector_source._cache.update(origin="http://elsewhere/api/collector", source="OLD")
        host, port, stop = _serving("NEW")
        try:
            self.assertEqual(collector_source.fetch_collector_source(host, port), "NEW")
        finally:
            stop()

    def test_an_older_backend_degrades_with_a_reason(self):
        # A 404 means the backend predates the route. Capture must not break,
        # but the run has lost DOM replay and has to say so.
        host, port, stop = _serving("nope", status=404)
        try:
            with self.assertLogs("selenium_devtools.collector", level="WARNING") as logs:
                self.assertIsNone(collector_source.fetch_collector_source(host, port))
        finally:
            stop()
        self.assertIn("older than the version", "\n".join(logs.output))

    def test_an_unreachable_backend_degrades_with_a_reason(self):
        with self.assertLogs("selenium_devtools.collector", level="WARNING") as logs:
            self.assertIsNone(collector_source.fetch_collector_source("127.0.0.1", 1))
        self.assertIn("could not fetch the collector", "\n".join(logs.output))

    def test_an_empty_body_is_not_a_collector(self):
        host, port, stop = _serving("")
        try:
            with self.assertLogs("selenium_devtools.collector", level="WARNING"):
                self.assertIsNone(collector_source.fetch_collector_source(host, port))
        finally:
            stop()

    def test_the_url_comes_from_the_generated_contract(self):
        from selenium_devtools._contract import COLLECTOR_PATH

        self.assertEqual(
            collector_source.collector_url("h", 1), f"http://h:1{COLLECTOR_PATH}"
        )


class TestInjectionPrefersTheBackend(unittest.TestCase):
    def setUp(self):
        collector_source.reset_cache()

    tearDown = setUp

    def test_a_published_install_gets_the_collector_from_the_backend(self):
        from selenium_devtools import snapshot

        # No monorepo path: exactly what site-packages looks like.
        # Patched on `snapshot`, not on `collector_source`: snapshot imports
        # the function by name, so it holds its own reference.
        with mock.patch.object(snapshot, "resolve_script_path", return_value=None), \
             mock.patch.object(snapshot, "fetch_collector_source", return_value="SRC"):
            wrapped = snapshot.load_injectable_script(backend=("h", 1))

        self.assertIn("SRC", wrapped)

    def test_the_monorepo_path_still_works_against_an_older_backend(self):
        from selenium_devtools import snapshot

        with mock.patch.object(
            snapshot, "fetch_collector_source", return_value=None
        ), mock.patch.object(snapshot, "resolve_script_path", return_value=None):
            with self.assertLogs("selenium_devtools.snapshot", level="WARNING") as logs:
                self.assertIsNone(snapshot.load_injectable_script(backend=("h", 1)))

        self.assertIn("DOM replay is disabled", "\n".join(logs.output))


if __name__ == "__main__":
    unittest.main()
