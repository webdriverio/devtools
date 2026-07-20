import os
import tempfile
import unittest
from pathlib import Path

from wdio_selenium_devtools import backend


class TestBackendResolution(unittest.TestCase):
    def setUp(self):
        self._saved = {k: os.environ.get(k) for k in
                       ("DEVTOOLS_PORT", "DEVTOOLS_HOST", "DEVTOOLS_BACKEND_CMD")}
        for k in self._saved:
            os.environ.pop(k, None)

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_port_regex_uses_actual_listening_port(self):
        # The preferred "Starting … on port 3000" line must NOT match — it's not
        # the bound port when 3000 is busy.
        self.assertIsNone(
            backend._PORT_RE.search("Starting application on port 3000")
        )
        # The Fastify "Server listening at …:PORT" line is the real port,
        # including the IPv6 form.
        self.assertEqual(
            backend._PORT_RE.search(
                '{"msg":"Server listening at http://[::1]:63763"}'
            ).group(1),
            "63763",
        )
        self.assertEqual(
            backend._PORT_RE.search("Server listening at http://127.0.0.1:3000").group(1),
            "3000",
        )

    def test_attaches_when_port_env_set_without_spawning(self):
        os.environ["DEVTOOLS_PORT"] = "4321"
        os.environ["DEVTOOLS_HOST"] = "example.test"
        host, port, proc = backend.launch_or_attach()
        self.assertEqual((host, port), ("example.test", 4321))
        self.assertIsNone(proc)  # attached, not owned

    def test_finds_monorepo_backend_when_present(self):
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp) / "packages" / "backend" / "dist"
            dist.mkdir(parents=True)
            (dist / "index.js").write_text("//")
            start = Path(tmp) / "a" / "b" / "mod.py"
            start.parent.mkdir(parents=True)
            self.assertEqual(
                backend._find_monorepo_backend(start=start), dist / "index.js"
            )

    def test_no_monorepo_backend_when_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            start = Path(tmp) / "x" / "y.py"
            start.parent.mkdir(parents=True)
            self.assertIsNone(backend._find_monorepo_backend(start=start))

    def test_pinned_backend_version_is_set(self):
        self.assertRegex(backend.BACKEND_NPM_VERSION, r"^\d+\.\d+\.\d+$")


if __name__ == "__main__":
    unittest.main()
