"""Node is a real prerequisite, so say so before failing as something else.

Three failure modes previously surfaced as something that never mentioned Node:
a raw ``FileNotFoundError`` from Popen, ``backend exited (code 1) before
reporting a port``, and a 40-second spawn timeout. What matters here is that
each one is named, and — equally — that attaching to a backend someone else is
running still needs no local Node at all.
"""

import subprocess
import unittest
from pathlib import Path
from unittest import mock

from selenium_devtools import backend, node_runtime
from selenium_devtools.constants import MIN_NODE_MAJOR


def _completed(stdout: str, returncode: int = 0):
    return subprocess.CompletedProcess(
        args=["node", "--version"], returncode=returncode, stdout=stdout, stderr=""
    )


class TestReadingTheVersion(unittest.TestCase):
    def test_parses_the_v_prefixed_form_node_actually_prints(self):
        with mock.patch("subprocess.run", return_value=_completed("v20.11.1\n")):
            self.assertEqual(node_runtime.node_version("node"), (20, 11, 1))

    def test_parses_a_bare_version_too(self):
        with mock.patch("subprocess.run", return_value=_completed("18.0.0")):
            self.assertEqual(node_runtime.node_version("node"), (18, 0, 0))

    def test_surrounding_whitespace_is_still_accepted(self):
        # Node terminates its output with a newline, so whole-line matching has
        # to strip before it compares or every real Node would be refused.
        with mock.patch("subprocess.run", return_value=_completed("  v18.20.4\n")):
            self.assertEqual(node_runtime.node_version("node"), (18, 20, 4))

    def test_anything_unreadable_is_none_rather_than_a_guess(self):
        # A shim on PATH that is not really Node, a non-zero exit, a hang, a
        # binary that cannot be executed at all.
        #
        # The middle three are the ones that matter and the ones the first
        # version of this test missed: output that CONTAINS a version is not
        # output that IS one. Read with `search`, a wrapper mentioning v20
        # passed the floor and the backend then failed to start anyway.
        cases = [
            _completed("not a version"),
            _completed("my-wrapper v20.11.1 (shim)"),
            _completed("Deno 1.2.3"),
            _completed("v20.11.1 and then some"),
            _completed("v20.11.1", returncode=1),
            _completed(""),
        ]
        for result in cases:
            with self.subTest(result=result):
                with mock.patch("subprocess.run", return_value=result):
                    self.assertIsNone(node_runtime.node_version("node"))

        for error in (OSError("boom"), subprocess.TimeoutExpired("node", 5)):
            with self.subTest(error=error):
                with mock.patch("subprocess.run", side_effect=error):
                    self.assertIsNone(node_runtime.node_version("node"))


class TestRequiringNode(unittest.TestCase):
    def test_returns_the_resolved_executable_when_new_enough(self):
        with mock.patch("shutil.which", return_value="/usr/bin/node"), mock.patch.object(
            node_runtime, "node_version", return_value=(MIN_NODE_MAJOR, 0, 0)
        ):
            self.assertEqual(node_runtime.require_node(), "/usr/bin/node")

    def test_missing_node_says_node_and_how_to_get_it(self):
        with mock.patch("shutil.which", return_value=None):
            with self.assertRaises(RuntimeError) as ctx:
                node_runtime.require_node()
        message = str(ctx.exception)
        self.assertIn("Node.js not found", message)
        self.assertIn("nodejs.org", message)
        # Always a way forward that installs nothing.
        self.assertIn("DEVTOOLS_PORT", message)

    def test_an_old_node_names_the_version_found_and_the_one_needed(self):
        # Previously this reached the user as "backend exited (code 1) before
        # reporting a port", which says nothing about Node.
        with mock.patch("shutil.which", return_value="/usr/bin/node"), mock.patch.object(
            node_runtime, "node_version", return_value=(MIN_NODE_MAJOR - 2, 4, 1)
        ):
            with self.assertRaises(RuntimeError) as ctx:
                node_runtime.require_node()
        message = str(ctx.exception)
        self.assertIn(f"{MIN_NODE_MAJOR - 2}.4.1", message)
        self.assertIn(str(MIN_NODE_MAJOR), message)

    def test_a_node_that_will_not_report_a_version_is_refused(self):
        with mock.patch("shutil.which", return_value="/usr/bin/node"), mock.patch.object(
            node_runtime, "node_version", return_value=None
        ):
            with self.assertRaises(RuntimeError) as ctx:
                node_runtime.require_node()
        self.assertIn("did not report a usable version", str(ctx.exception))


class TestWhichPathsNeedNode(unittest.TestCase):
    """Attaching needs no local Node; only the two spawning branches do.

    Every patch here targets ``backend.require_node``, not
    ``node_runtime.require_node``. ``backend`` does ``from .node_runtime import
    require_node``, which binds the function into its own namespace at import,
    so patching the source module leaves the caller pointing at the original —
    the assertion then holds against a mock nothing ever calls. Measured: with
    the check hoisted above the attach branches, the reuse test still passed.
    """

    def test_the_reuse_handshake_never_checks(self):
        with mock.patch.object(
            backend, "reuse_target", return_value=("127.0.0.1", 4321)
        ), mock.patch.object(
            backend, "require_node", side_effect=AssertionError("must not check")
        ) as required:
            host, port, proc = backend.launch_or_attach()
        self.assertEqual((host, port, proc), ("127.0.0.1", 4321, None))
        required.assert_not_called()

    def test_an_explicit_port_never_checks(self):
        with mock.patch.object(backend, "reuse_target", return_value=None), mock.patch(
            "os.environ",
            {"DEVTOOLS_PORT": "5555"},
        ), mock.patch.object(
            backend, "require_node", side_effect=AssertionError("must not check")
        ) as required:
            _, port, proc = backend.launch_or_attach()
        self.assertEqual((port, proc), (5555, None))
        required.assert_not_called()

    def _spawning_run(self, monorepo_dist, npx="/usr/bin/npx"):
        """Drive launch_or_attach down a spawning branch, recording the order.

        Both branches are pinned explicitly. Letting `_find_monorepo_backend`
        answer for real made this test depend on whether `pnpm build` had run —
        green locally with a built dist, and in CI (which runs the Python job
        without building) it fell through to the npx branch and died on the
        empty `os.environ`, because `shutil.which` reads PATH from it.
        """
        calls = []
        with mock.patch.object(backend, "reuse_target", return_value=None), mock.patch(
            "os.environ", {}
        ), mock.patch.object(
            backend, "_find_monorepo_backend", return_value=monorepo_dist
        ), mock.patch(
            "shutil.which", return_value=npx
        ), mock.patch.object(
            backend, "require_node", side_effect=lambda: calls.append("checked") or "/n"
        ), mock.patch.object(
            backend,
            "_spawn_and_wait_for_port",
            side_effect=lambda cmd, **kw: calls.append(cmd) or (mock.Mock(), 6001),
        ):
            _, port, _ = backend.launch_or_attach()
        return port, calls

    def test_the_monorepo_path_checks_before_it_spawns(self):
        port, calls = self._spawning_run(Path("/repo/packages/backend/dist/server.js"))
        self.assertEqual(port, 6001)
        # Checked FIRST, then spawned with the node it resolved.
        self.assertEqual(calls[0], "checked")
        self.assertEqual(calls[1], ["/n", "/repo/packages/backend/dist/server.js"])

    def test_the_npx_path_checks_before_it_spawns(self):
        # The published path: no monorepo dist, so the backend is fetched.
        port, calls = self._spawning_run(None)
        self.assertEqual(port, 6001)
        self.assertEqual(calls[0], "checked")
        self.assertEqual(calls[1][0], "/usr/bin/npx")

    def test_node_without_npx_beside_it_is_reported_as_such(self):
        with mock.patch.object(backend, "reuse_target", return_value=None), mock.patch(
            "os.environ", {}
        ), mock.patch.object(
            backend, "_find_monorepo_backend", return_value=None
        ), mock.patch(
            "shutil.which", return_value=None
        ), mock.patch.object(backend, "require_node", return_value="/n"):
            with self.assertRaises(RuntimeError) as ctx:
                backend.launch_or_attach()
        self.assertIn("no npx alongside it", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
