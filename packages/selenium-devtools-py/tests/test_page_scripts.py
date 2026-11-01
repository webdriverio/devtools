"""The collector and performance scripts, fetched from the backend.

This adapter used to carry its own copies, and they drifted from the JS ones in
both directions. The backend now serves shared's strings; these tests cover the
fetch, its cache, and the degraded run when the backend cannot answer.
"""

import json
import unittest
import urllib.error
from unittest import mock

from selenium_devtools import page_scripts
from selenium_devtools._contract import PAGE_SCRIPTS_PATH

from page_scripts_fixture import PAGE_SCRIPTS


class TestFetchingThePageScripts(unittest.TestCase):
    def setUp(self):
        page_scripts.reset_cache()
        self.addCleanup(page_scripts.reset_cache)

    def _urlopen(self, body, *, raises=None):
        class Response:
            def __enter__(self_inner):
                return self_inner

            def __exit__(self_inner, *a):
                return False

            def read(self_inner):
                return body.encode()

        if raises is not None:
            return mock.patch("urllib.request.urlopen", side_effect=raises)
        return mock.patch("urllib.request.urlopen", return_value=Response())

    def test_the_url_is_the_generated_contract_path(self):
        self.assertEqual(
            page_scripts.scripts_url("localhost", 1234),
            f"http://localhost:1234{PAGE_SCRIPTS_PATH}",
        )

    def test_a_bare_ipv6_host_is_bracketed(self):
        self.assertIn("[::1]:1234", page_scripts.scripts_url("::1", 1234))

    def test_a_well_formed_response_is_returned_and_cached(self):
        # They run after every command; one request per run is the cost.
        with self._urlopen(json.dumps(PAGE_SCRIPTS)) as opened:
            first = page_scripts.fetch("localhost", 1)
            second = page_scripts.fetch("localhost", 1)
        self.assertEqual(first, PAGE_SCRIPTS)
        self.assertEqual(second, PAGE_SCRIPTS)
        self.assertEqual(opened.call_count, 1)

    def test_an_old_backend_costs_one_request_and_says_so(self):
        # A backend older than the route answers 404. DOM replay is then off,
        # which is worth a warning rather than a debug line nobody reads.
        missing = urllib.error.HTTPError(
            "http://localhost:1", 404, "Not Found", {}, None
        )
        with self._urlopen("", raises=missing) as opened, self.assertLogs(
            "selenium_devtools", level="WARNING"
        ) as logs:
            self.assertIsNone(page_scripts.fetch("localhost", 1))
            self.assertIsNone(page_scripts.fetch("localhost", 1))
        self.assertEqual(opened.call_count, 1)
        self.assertIn("DOM replay", "\n".join(logs.output))

    def test_a_response_missing_any_script_is_refused(self):
        for key in PAGE_SCRIPTS:
            with self.subTest(missing=key):
                page_scripts.reset_cache()
                body = {k: v for k, v in PAGE_SCRIPTS.items() if k != key}
                with self._urlopen(json.dumps(body)):
                    self.assertIsNone(page_scripts.fetch("localhost", 1))

    def test_a_different_backend_re_fetches(self):
        with self._urlopen(json.dumps(PAGE_SCRIPTS)) as opened:
            page_scripts.fetch("localhost", 1)
            page_scripts.fetch("localhost", 2)
        self.assertEqual(opened.call_count, 2)


if __name__ == "__main__":
    unittest.main()
