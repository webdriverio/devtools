import os
import tempfile
import unittest
from pathlib import Path

from selenium_devtools import backend
from selenium_devtools._contract import ENV_REUSE, ENV_REUSE_HOST, ENV_REUSE_PORT


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
            (dist / "server.js").write_text("//")
            start = Path(tmp) / "a" / "b" / "mod.py"
            start.parent.mkdir(parents=True)
            self.assertEqual(
                backend._find_monorepo_backend(start=start), dist / "server.js"
            )

    def test_no_monorepo_backend_when_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            start = Path(tmp) / "x" / "y.py"
            start.parent.mkdir(parents=True)
            self.assertIsNone(backend._find_monorepo_backend(start=start))

    def test_pinned_backend_version_is_set(self):
        self.assertRegex(backend.BACKEND_NPM_VERSION, r"^\d+\.\d+\.\d+$")


class TestRerunChildReportsIntoTheDashboardThatAskedForIt(unittest.TestCase):
    """A rerun is a fresh process the backend spawns, pointed back at itself.

    Ignoring that handshake is silent in the worst way: the child launches a
    second backend and reports its run there, so the window the user pressed
    Rerun in never updates.
    """

    KEYS = (ENV_REUSE, ENV_REUSE_HOST, ENV_REUSE_PORT, "DEVTOOLS_PORT",
            "DEVTOOLS_HOST", "DEVTOOLS_BACKEND_CMD")

    def setUp(self):
        self._saved = {k: os.environ.get(k) for k in self.KEYS}
        for k in self.KEYS:
            os.environ.pop(k, None)

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def _handshake(self, host="127.0.0.1", port="5599"):
        os.environ[ENV_REUSE] = "1"
        os.environ[ENV_REUSE_HOST] = host
        os.environ[ENV_REUSE_PORT] = port

    def test_it_attaches_to_the_inherited_backend_without_spawning(self):
        self._handshake()

        host, port, proc = backend.launch_or_attach()

        self.assertEqual((host, port), ("127.0.0.1", 5599))
        self.assertIsNone(proc)  # attached, so teardown must not kill it

    def test_the_handshake_wins_over_an_ambient_port_preference(self):
        # DEVTOOLS_PORT is inherited from the parent's environment, but the
        # backend that requested this run is the one it must report to.
        os.environ["DEVTOOLS_PORT"] = "4321"
        self._handshake(port="5599")

        _, port, _ = backend.launch_or_attach()

        self.assertEqual(port, 5599)

    def test_no_handshake_means_no_reuse(self):
        self.assertIsNone(backend.reuse_target())

    def test_a_partial_or_malformed_handshake_is_ignored(self):
        for label, env in (
            ("no host", {ENV_REUSE: "1", ENV_REUSE_PORT: "5599"}),
            ("no port", {ENV_REUSE: "1", ENV_REUSE_HOST: "127.0.0.1"}),
            ("flag off", {ENV_REUSE: "0", ENV_REUSE_HOST: "h", ENV_REUSE_PORT: "1"}),
            ("port not a number",
             {ENV_REUSE: "1", ENV_REUSE_HOST: "h", ENV_REUSE_PORT: "later"}),
        ):
            with self.subTest(label):
                for k in (ENV_REUSE, ENV_REUSE_HOST, ENV_REUSE_PORT):
                    os.environ.pop(k, None)
                os.environ.update(env)

                # Degrades to launching its own backend rather than raising.
                self.assertIsNone(backend.reuse_target())


if __name__ == "__main__":
    unittest.main()
