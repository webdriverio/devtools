"""Node is a real prerequisite, so say so before failing as something else.

Three failure modes previously surfaced as something that never mentioned Node:
a raw ``FileNotFoundError`` from Popen, ``backend exited (code 1) before
reporting a port``, and a 40-second spawn timeout. What matters here is that
each one is named, and — equally — that attaching to a backend someone else is
running still needs no local Node at all.
"""

import subprocess
import unittest
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

    def test_anything_unreadable_is_none_rather_than_a_guess(self):
        # A shim on PATH that is not really Node, a non-zero exit, a hang, a
        # binary that cannot be executed at all.
        cases = [
            _completed("not a version"),
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
    """Attaching needs no local Node; only the two spawning branches do."""

    def test_the_reuse_handshake_never_checks(self):
        with mock.patch.object(
            backend, "reuse_target", return_value=("127.0.0.1", 4321)
        ), mock.patch.object(
            node_runtime, "require_node", side_effect=AssertionError("must not check")
        ) as required:
            host, port, proc = backend.launch_or_attach()
        self.assertEqual((host, port, proc), ("127.0.0.1", 4321, None))
        required.assert_not_called()

    def test_an_explicit_port_never_checks(self):
        with mock.patch.object(backend, "reuse_target", return_value=None), mock.patch(
            "os.environ",
            {"DEVTOOLS_PORT": "5555"},
        ), mock.patch.object(
            node_runtime, "require_node", side_effect=AssertionError("must not check")
        ) as required:
            _, port, proc = backend.launch_or_attach()
        self.assertEqual((port, proc), (5555, None))
        required.assert_not_called()

    def test_the_spawning_path_checks_before_it_spawns(self):
        calls = []
        with mock.patch.object(backend, "reuse_target", return_value=None), mock.patch(
            "os.environ", {}
        ), mock.patch.object(
            backend, "require_node", side_effect=lambda: calls.append("checked") or "/n"
        ), mock.patch.object(
            backend,
            "_spawn_and_wait_for_port",
            side_effect=lambda cmd, **kw: calls.append(cmd) or (mock.Mock(), 6001),
        ):
            _, port, _ = backend.launch_or_attach()
        self.assertEqual(port, 6001)
        # Checked FIRST, then spawned with the node it resolved.
        self.assertEqual(calls[0], "checked")
        self.assertEqual(calls[1][0], "/n")


if __name__ == "__main__":
    unittest.main()
