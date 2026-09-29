import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from selenium_devtools import backend, backend_install, cli
from selenium_devtools.constants import (
    BACKEND_BIN_NAME,
    BACKEND_FETCH_TIMEOUT_S,
    BACKEND_NPM_PACKAGE,
    BACKEND_NPM_VERSION,
    BACKEND_SPAWN_TIMEOUT_S,
)


def _fake_install(
    *,
    entry: str = "dist/server.js",
    bin_field: "dict | None" = None,
    write_entry: bool = True,
) -> Path:
    """Write the tree `npm install` would leave, as `installed_server` reads it:
    a package.json naming the server bin, and the file it names."""
    pkg = (
        backend_install.install_root()
        / "node_modules"
        / BACKEND_NPM_PACKAGE.replace("/", os.sep)
    )
    pkg.mkdir(parents=True, exist_ok=True)
    (pkg / "package.json").write_text(
        json.dumps({"bin": bin_field or {BACKEND_BIN_NAME: entry}})
    )
    server = pkg / entry
    if write_entry:
        server.parent.mkdir(parents=True, exist_ok=True)
        server.write_text("// server")
    return server


class TestInstallRoot(unittest.TestCase):
    def test_root_is_versioned_so_a_pin_bump_installs_beside_the_old_one(self):
        a = backend_install.install_root("1.11.0")
        b = backend_install.install_root("1.12.0")
        self.assertNotEqual(a, b)
        self.assertTrue(str(a).endswith("backend-1.11.0"))

    def test_root_honours_xdg_cache_home(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ, {"XDG_CACHE_HOME": tmp}):
                self.assertTrue(str(backend_install.install_root()).startswith(tmp))

    def test_installed_server_is_none_until_the_entry_script_exists(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ, {"XDG_CACHE_HOME": tmp}):
                self.assertIsNone(backend_install.installed_server())
                server = _fake_install()
                self.assertEqual(backend_install.installed_server(), server)

    def test_the_entry_is_read_from_the_package_not_assumed(self):
        # The entry has moved once already, and a hard-coded path would make a
        # good install look absent — silently sending every run back to npx.
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ, {"XDG_CACHE_HOME": tmp}):
                server = _fake_install(entry="dist/next-server.js")
                self.assertEqual(backend_install.installed_server(), server)

    def test_a_package_naming_no_server_bin_is_not_installed(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ, {"XDG_CACHE_HOME": tmp}):
                _fake_install(bin_field={"show-trace": "dist/show-trace.js"})
                self.assertIsNone(backend_install.installed_server())

    def test_an_entry_the_manifest_names_but_never_wrote_is_not_installed(self):
        # The half-written tree an interrupted `npm install` leaves behind.
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ, {"XDG_CACHE_HOME": tmp}):
                _fake_install(write_entry=False)
                self.assertIsNone(backend_install.installed_server())

    def test_install_is_idempotent_and_does_not_shell_out_when_present(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ, {"XDG_CACHE_HOME": tmp}):
                server = _fake_install()
                with mock.patch("subprocess.run") as run:
                    self.assertEqual(backend_install.install(), server)
                run.assert_not_called()

    def test_install_reports_which_npm_refused_the_package(self):
        # The failure a published install actually hits is a registry that does
        # not carry the version, and the fix depends on WHICH npm was run.
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ, {"XDG_CACHE_HOME": tmp}), mock.patch(
                "selenium_devtools.backend_install.require_node"
            ), mock.patch("shutil.which", return_value="/gated/bin/npm"), mock.patch(
                "subprocess.run", return_value=mock.Mock(returncode=1)
            ):
                with self.assertRaises(RuntimeError) as caught:
                    backend_install.install()
        self.assertIn("/gated/bin/npm", str(caught.exception))


class TestResolutionPrefersTheInstalledBackend(unittest.TestCase):
    """An installed backend must win over npx, or the install bought nothing."""

    def setUp(self):
        for key in ("DEVTOOLS_PORT", "DEVTOOLS_BACKEND_CMD", "DEVTOOLS_APP_REUSE"):
            os.environ.pop(key, None)

    def test_installed_copy_is_spawned_with_node_and_npx_is_not_reached(self):
        installed = Path("/cache/backend-1.11.0/dist/server.js")
        spawned = []

        def fake_spawn(cmd, timeout=BACKEND_SPAWN_TIMEOUT_S):
            spawned.append((cmd, timeout))
            return mock.Mock(), 4321

        with mock.patch.object(backend, "require_node", return_value="/usr/bin/node"), \
             mock.patch.object(backend, "_find_monorepo_backend", return_value=None), \
             mock.patch.object(
                 backend.backend_install, "installed_server", return_value=installed
             ), \
             mock.patch.object(backend, "_spawn_and_wait_for_port", fake_spawn), \
             mock.patch("shutil.which") as which:
            host, port, _ = backend.launch_or_attach()

        which.assert_not_called()
        self.assertEqual(port, 4321)
        self.assertEqual(spawned[0][0], ["/usr/bin/node", str(installed)])

    def test_npx_path_gets_the_fetch_budget_not_the_spawn_budget(self):
        # A cold npx downloads a dependency tree before the server it is timing
        # starts; judged by the spawn budget, a first run fails and the retry
        # succeeds from cache.
        spawned = []

        def fake_spawn(cmd, timeout=BACKEND_SPAWN_TIMEOUT_S):
            spawned.append((cmd, timeout))
            return mock.Mock(), 4321

        with mock.patch.object(backend, "require_node", return_value="/usr/bin/node"), \
             mock.patch.object(backend, "_find_monorepo_backend", return_value=None), \
             mock.patch.object(
                 backend.backend_install, "installed_server", return_value=None
             ), \
             mock.patch.object(backend, "_spawn_and_wait_for_port", fake_spawn), \
             mock.patch("shutil.which", return_value="/usr/bin/npx"):
            backend.launch_or_attach()

        cmd, timeout = spawned[0]
        self.assertIn(f"{BACKEND_NPM_PACKAGE}@{BACKEND_NPM_VERSION}", cmd)
        self.assertEqual(timeout, BACKEND_FETCH_TIMEOUT_S)
        self.assertGreater(BACKEND_FETCH_TIMEOUT_S, BACKEND_SPAWN_TIMEOUT_S)


class TestABrokenInstallDoesNotDisableCapture(unittest.TestCase):
    def setUp(self):
        for key in ("DEVTOOLS_PORT", "DEVTOOLS_BACKEND_CMD", "DEVTOOLS_APP_REUSE"):
            os.environ.pop(key, None)

    def test_an_installed_backend_that_will_not_start_falls_back_to_npx(self):
        # An `npm install` interrupted after writing the entry script leaves a
        # tree that looks installed and cannot run. Preferring it is right;
        # being stuck on it would cost every later run its capture too, until
        # someone deleted a cache directory they were never told about.
        spawned = []

        def fake_spawn(cmd, timeout=BACKEND_SPAWN_TIMEOUT_S):
            spawned.append(cmd)
            if "broken" in cmd[-1]:
                raise RuntimeError("backend exited (code 1) before reporting a port")
            return mock.Mock(), 4321

        with mock.patch.object(backend, "require_node", return_value="/usr/bin/node"), \
             mock.patch.object(backend, "_find_monorepo_backend", return_value=None), \
             mock.patch.object(
                 backend.backend_install,
                 "installed_server",
                 return_value=Path("/cache/broken/server.js"),
             ), \
             mock.patch.object(backend, "_spawn_and_wait_for_port", fake_spawn), \
             mock.patch("shutil.which", return_value="/usr/bin/npx"):
            _, port, _ = backend.launch_or_attach()

        self.assertEqual(port, 4321)
        self.assertEqual(len(spawned), 2)
        self.assertEqual(spawned[1][0], "/usr/bin/npx")


class TestSpawnFailuresCarryTheChildsOutput(unittest.TestCase):
    def test_exit_before_a_port_reports_what_the_child_said(self):
        script = (
            "import sys;"
            "print('npm error code ETARGET');"
            "print('npm error notarget No matching version found');"
            "sys.exit(1)"
        )
        with self.assertRaises(RuntimeError) as caught:
            backend._spawn_and_wait_for_port([sys.executable, "-c", script])
        message = str(caught.exception)
        self.assertIn("ETARGET", message)
        self.assertIn("No matching version found", message)
        self.assertIn("command:", message)

    def test_timeout_names_the_budget_it_exceeded(self):
        script = "import time; time.sleep(5)"
        with self.assertRaises(TimeoutError) as caught:
            backend._spawn_and_wait_for_port([sys.executable, "-c", script], timeout=0.3)
        self.assertIn("0s", str(caught.exception))


class TestCli(unittest.TestCase):
    def test_backend_path_exits_nonzero_and_says_how_when_not_installed(self):
        with mock.patch.object(
            cli.backend_install, "installed_server", return_value=None
        ):
            self.assertEqual(cli.main(["backend-path"]), 1)

    def test_install_backend_delegates_and_reports_success(self):
        with mock.patch.object(
            cli.backend_install, "install", return_value=Path("/cache/server.js")
        ) as install:
            self.assertEqual(cli.main(["install-backend"]), 0)
        install.assert_called_once_with(force=False)

    def test_a_failed_install_is_an_error_exit_not_a_traceback(self):
        with mock.patch.object(
            cli.backend_install, "install", side_effect=RuntimeError("npm said no")
        ):
            self.assertEqual(cli.main(["install-backend"]), 1)


if __name__ == "__main__":
    unittest.main()
