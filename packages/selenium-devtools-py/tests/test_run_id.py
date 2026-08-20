"""Run identity, and how it reaches sibling processes.

The backend keeps or wipes accumulated run state by comparing this across worker
connects, so who decides the id — and when — is the whole behaviour.
"""

import os
import unittest
from unittest import mock

from selenium_devtools._contract import ENV_RUN_ID
from selenium_devtools.run_id import resolve_run_id


class TestResolvingTheRunId(unittest.TestCase):
    def setUp(self):
        self.previous = os.environ.get(ENV_RUN_ID)
        os.environ.pop(ENV_RUN_ID, None)
        self.addCleanup(self._restore)

    def _restore(self):
        if self.previous is None:
            os.environ.pop(ENV_RUN_ID, None)
        else:
            os.environ[ENV_RUN_ID] = self.previous

    def test_an_existing_value_is_adopted_not_replaced(self):
        # A launcher stamps this before forking, so every worker of one run must
        # take what it finds. Generating a fresh id here would make each worker
        # its own run, and the backend would wipe the previous one's data.
        os.environ[ENV_RUN_ID] = "from-the-launcher"

        self.assertEqual(resolve_run_id(), "from-the-launcher")

    def test_a_first_call_generates_and_publishes(self):
        # Published to the environment, not just returned: that is the only
        # channel a forked worker has for inheriting it.
        run_id = resolve_run_id()

        self.assertTrue(run_id)
        self.assertEqual(os.environ[ENV_RUN_ID], run_id)

    def test_it_is_stable_within_a_process(self):
        self.assertEqual(resolve_run_id(), resolve_run_id())

    def test_two_processes_that_both_start_cold_disagree(self):
        # The known limit, and why it is a limit rather than a bug: with no
        # launcher-side hook to stamp first, xdist workers each generate their
        # own. Deriving one from the parent pid would group siblings but would
        # also make two sequential runs share an id and inherit each other's
        # state. Tracked as #297.
        first = resolve_run_id()
        os.environ.pop(ENV_RUN_ID, None)  # a sibling with a cold environment

        self.assertNotEqual(first, resolve_run_id())

    def test_the_env_var_is_the_one_the_js_side_publishes(self):
        # Generated from shared's RUNNER_ENV, so a Python worker and a JS worker
        # in the same run agree rather than each inventing an identity.
        self.assertEqual(ENV_RUN_ID, "DEVTOOLS_RUN_ID")

    def test_an_empty_value_is_treated_as_absent(self):
        # An exported-but-empty var is what a shell leaves behind; adopting ""
        # would send `runId=` and read as no id at all.
        os.environ[ENV_RUN_ID] = ""

        self.assertTrue(resolve_run_id())


if __name__ == "__main__":
    unittest.main()
