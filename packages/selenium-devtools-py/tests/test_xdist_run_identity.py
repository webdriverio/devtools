"""Run identity across a real pytest-xdist run.

The guarantee is not "the environment propagates" — it is an ORDERING: whatever
resolves the id in the controller's ``pytest_configure`` does so before xdist
spawns any worker, so the workers inherit it. A subprocess test cannot see that,
because it stamps the variable itself and then spawns something generic.

So this drives real pytest with real xdist. The temporary project's conftest
deliberately does NOT resolve the id: a conftest's ``pytest_configure`` runs
BEFORE an entry-point plugin's, so resolving there would stamp the environment
earlier than the adapter does and the test would pass however late the adapter
resolved. The resolving is done by a plugin loaded with ``-p``, which is as close
to the adapter's own registration timing as a temp project can get.

Skipped when pytest or pytest-xdist is absent; both are dev-only.
"""

import importlib.util
import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

_HAS_XDIST = all(
    importlib.util.find_spec(name) is not None for name in ("pytest", "xdist")
)

# Resolves the run id at the same lifecycle point the adapter does — its
# `pytest_configure`, which for the adapter is where `enable()` opens the socket.
PLUGIN = '''
import json, os
from pathlib import Path

from selenium_devtools._contract import ENV_RUN_ID
from selenium_devtools.run_id import resolve_run_id

OUT = Path(__file__).parent / "observed"


def pytest_configure(config):
    resolve_run_id()


def pytest_sessionfinish(session, exitstatus):
    OUT.mkdir(exist_ok=True)
    worker = os.environ.get("PYTEST_XDIST_WORKER", "controller")
    (OUT / f"{worker}-{os.getpid()}.json").write_text(json.dumps({
        "worker": worker, "pid": os.getpid(),
        "run_id": os.environ.get(ENV_RUN_ID),
    }))
'''

TESTS = """
def test_a():
    assert True


def test_b():
    assert True


def test_c():
    assert True


def test_d():
    assert True
"""


@unittest.skipUnless(_HAS_XDIST, "pytest-xdist is not installed")
class TestEveryWorkerSharesOneRunId(unittest.TestCase):
    def _run(self, *extra):
        src = str(Path(__file__).resolve().parents[1] / "src")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "conftest.py").write_text("")  # must not resolve; see docstring
            (root / "runid_plugin.py").write_text(textwrap.dedent(PLUGIN))
            (root / "test_parallel.py").write_text(TESTS)
            proc = subprocess.run(
                [sys.executable, "-m", "pytest", "-p", "no:cacheprovider",
                 "-p", "runid_plugin", "-q", *extra],
                cwd=root, capture_output=True, text=True,
                env={"PATH": "/usr/bin:/bin", "PYTHONPATH": f"{src}:{root}"},
            )
            observed = [
                json.loads(p.read_text())
                for p in (root / "observed").glob("*.json")
            ]
            return proc, observed

    def test_two_workers_and_the_controller_agree(self):
        proc, observed = self._run("-n", "2")

        self.assertIn("passed", proc.stdout, proc.stdout + proc.stderr)
        # Controller plus two workers — if only one process reported, xdist did
        # not run and this would pass for the wrong reason.
        self.assertGreaterEqual(len(observed), 3, observed)
        self.assertEqual(len({row["run_id"] for row in observed}), 1, observed)

    def test_four_workers_agree(self):
        proc, observed = self._run("-n", "4")

        self.assertIn("passed", proc.stdout, proc.stdout + proc.stderr)
        self.assertGreaterEqual(len(observed), 5, observed)
        self.assertEqual(len({row["run_id"] for row in observed}), 1, observed)

    def test_the_workers_are_really_separate_processes(self):
        # Guards the guard: one id across one process proves nothing.
        _, observed = self._run("-n", "2")

        self.assertGreaterEqual(len({row["pid"] for row in observed}), 3, observed)
        self.assertIn("gw0", {row["worker"] for row in observed}, observed)


if __name__ == "__main__":
    unittest.main()
