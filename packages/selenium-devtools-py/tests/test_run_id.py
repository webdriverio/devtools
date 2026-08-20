"""Run identity, and how it reaches sibling processes.

The backend keeps or wipes accumulated run state by comparing this across worker
connects, so who decides the id — and when — is the whole behaviour.
"""

import os
import unittest
from unittest import mock

from selenium_devtools._contract import ENV_RUN_ID
from selenium_devtools.run_id import reset_run_id, resolve_run_id


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

    def test_a_second_logical_run_in_one_process_gets_a_new_id(self):
        """One process can host several runs — enable(), disable(), enable().

        An id that outlives the first makes the backend read the second as a
        continuation and keep the first run's commands, logs, network data and
        baselines. Only reachable once the id started being sent at all: with no
        runId every connect wiped, so this was previously correct by accident.
        """
        first = resolve_run_id()
        reset_run_id()

        self.assertNotEqual(resolve_run_id(), first)

    def test_reset_leaves_an_inherited_id_alone(self):
        # A launcher exports this before forking, and it is how siblings agree
        # they are one run. Clearing it here would split a parallel run into one
        # run per worker.
        os.environ[ENV_RUN_ID] = "from-the-launcher"

        reset_run_id()

        self.assertEqual(os.environ.get(ENV_RUN_ID), "from-the-launcher")

    def test_reset_is_safe_when_nothing_was_generated(self):
        reset_run_id()  # must not raise
        self.assertIsNone(os.environ.get(ENV_RUN_ID))

    def test_reset_after_adopting_then_generating_clears_only_ours(self):
        # Adopt a launcher's id, reset (no-op), then start cold and generate one:
        # that one IS ours and must clear.
        os.environ[ENV_RUN_ID] = "inherited"
        reset_run_id()
        os.environ.pop(ENV_RUN_ID, None)
        mine = resolve_run_id()

        reset_run_id()

        self.assertIsNone(os.environ.get(ENV_RUN_ID))
        self.assertNotEqual(mine, "inherited")

    def test_the_env_var_is_the_one_the_js_side_publishes(self):
        # Generated from shared's RUNNER_ENV, so a Python worker and a JS worker
        # in the same run agree rather than each inventing an identity.
        self.assertEqual(ENV_RUN_ID, "DEVTOOLS_RUN_ID")

    def test_an_empty_value_is_treated_as_absent(self):
        # An exported-but-empty var is what a shell leaves behind; adopting ""
        # would send `runId=` and read as no id at all.
        os.environ[ENV_RUN_ID] = ""

        self.assertTrue(resolve_run_id())



class TestDisableEndsTheRun(unittest.TestCase):
    """`reset_run_id` existing is not the behaviour — `disable()` calling it is.

    Tested through disable() rather than the helper, because a test that only
    exercises the helper stays green when the call site is deleted, which is the
    failure it is meant to prevent.
    """

    def setUp(self):
        self.previous = os.environ.get(ENV_RUN_ID)
        self.addCleanup(self._restore)

    def _restore(self):
        if self.previous is None:
            os.environ.pop(ENV_RUN_ID, None)
        else:
            os.environ[ENV_RUN_ID] = self.previous

    def test_disable_clears_an_id_this_process_generated(self):
        import selenium_devtools as devtools

        os.environ.pop(ENV_RUN_ID, None)
        generated = resolve_run_id()

        devtools.disable()

        self.assertIsNone(os.environ.get(ENV_RUN_ID))
        self.assertNotEqual(resolve_run_id(), generated)  # the next run is new

    def test_disable_leaves_a_launcher_stamped_id_alone(self):
        import selenium_devtools as devtools

        os.environ[ENV_RUN_ID] = "from-the-launcher"

        devtools.disable()

        self.assertEqual(os.environ.get(ENV_RUN_ID), "from-the-launcher")


if __name__ == "__main__":
    unittest.main()
