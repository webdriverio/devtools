"""The suite tree the pytest plugin feeds the dashboard.

The nodeids and `report.location` names here are the ones real pytest emits —
captured from a run of a file holding a class-based and a module-level test:

    LOCATION=('t.py', 1, 'TestLogin.test_valid')  NODEID='t.py::TestLogin::test_valid'
    LOCATION=('t.py', 7, 'test_plain')            NODEID='t.py::test_plain'
"""

import types
import unittest
from unittest import mock

from selenium_devtools import assertions
from selenium_devtools import pytest_plugin as plugin
from selenium_devtools.pytest_plugin import _SuiteRegistry, reported_state
from selenium_devtools.utils import iso

FILE = "test_login_pytest.py"


def _registry_with(*records):
    reg = _SuiteRegistry()
    for nodeid, name, state in records:
        reg.mark_start(nodeid)
        reg.record(nodeid, FILE, name, 0, state)
    return reg


class TestClassBecomesItsOwnNode(unittest.TestCase):
    # pytest has no describe/it: a class IS the grouping construct, so it has to
    # nest the way a mocha `describe` does rather than flatten into the title.
    def test_a_class_nests_its_tests_under_a_suite(self):
        reg = _registry_with(
            (f"{FILE}::TestLogin::test_valid", "TestLogin.test_valid", "passed"),
            (f"{FILE}::TestLogin::test_invalid", "TestLogin.test_invalid", "passed"),
        )
        [file_suite] = reg.snapshot()

        self.assertEqual(file_suite["title"], FILE)
        self.assertEqual(file_suite["tests"], [])  # nothing sits directly on the file
        self.assertEqual(len(file_suite["suites"]), 1)

        group = file_suite["suites"][0]
        self.assertEqual(group["title"], "TestLogin")
        self.assertEqual(group["parent"], FILE)
        self.assertEqual(
            [t["title"] for t in group["tests"]], ["test_valid", "test_invalid"]
        )

    def test_the_leaf_drops_the_class_prefix_pytest_reports(self):
        # `report.location` gives 'TestLogin.test_valid'; the class is its own
        # node now, so repeating it in the row would read as TestLogin.test_valid
        # nested inside TestLogin.
        reg = _registry_with(
            (f"{FILE}::TestLogin::test_valid", "TestLogin.test_valid", "passed"),
        )
        test = reg.snapshot()[0]["suites"][0]["tests"][0]

        self.assertEqual(test["title"], "test_valid")
        self.assertEqual(test["parent"], "TestLogin")
        self.assertEqual(test["fullTitle"], f"{FILE} › TestLogin.test_valid")

    def test_a_module_level_test_stays_on_the_file(self):
        reg = _registry_with((f"{FILE}::test_plain", "test_plain", "passed"))
        [file_suite] = reg.snapshot()

        self.assertEqual([t["title"] for t in file_suite["tests"]], ["test_plain"])
        self.assertEqual(file_suite["suites"], [])

    def test_both_shapes_in_one_file_do_not_bleed_into_each_other(self):
        reg = _registry_with(
            (f"{FILE}::TestLogin::test_valid", "TestLogin.test_valid", "passed"),
            (f"{FILE}::test_plain", "test_plain", "passed"),
        )
        [file_suite] = reg.snapshot()

        # The class's test must not ALSO appear as a direct child of the file.
        self.assertEqual([t["title"] for t in file_suite["tests"]], ["test_plain"])
        self.assertEqual(
            [t["title"] for t in file_suite["suites"][0]["tests"]], ["test_valid"]
        )

    def test_a_parametrized_id_keeps_its_brackets_in_the_leaf(self):
        reg = _registry_with(
            (f"{FILE}::TestLogin::test_valid[chrome]",
             "TestLogin.test_valid[chrome]", "passed"),
        )
        group = reg.snapshot()[0]["suites"][0]

        self.assertEqual(group["title"], "TestLogin")
        self.assertEqual(group["tests"][0]["title"], "test_valid[chrome]")


class TestTheFileOnTheWireIsAbsolute(unittest.TestCase):
    """The `sources` map is keyed by each command's ABSOLUTE callSource, and the
    app pairs a test with its source by exact path. pytest reports a
    rootdir-relative path, so an unresolved one made the Source tab report the
    file as never captured the moment a test was selected."""

    ABS = f"/repo/{FILE}"

    def _recorded(self):
        reg = _SuiteRegistry()
        nodeid = f"{FILE}::TestLogin::test_valid"
        reg.mark_start(nodeid)
        reg.record(nodeid, FILE, "TestLogin.test_valid", 0, "passed",
                   abs_file=self.ABS)
        return reg.snapshot()[0]

    def test_the_test_carries_the_absolute_path(self):
        test = self._recorded()["suites"][0]["tests"][0]

        self.assertEqual(test["file"], self.ABS)
        self.assertEqual(test["callSource"], f"{self.ABS}:1")

    def test_both_suite_levels_carry_it_too(self):
        file_suite = self._recorded()

        self.assertEqual(file_suite["file"], self.ABS)
        self.assertEqual(file_suite["suites"][0]["file"], self.ABS)

    def test_the_readable_title_stays_relative(self):
        # The absolute path is for pairing, not for reading: a tree labelled
        # with a full filesystem path is unusable.
        file_suite = self._recorded()

        self.assertEqual(file_suite["title"], FILE)
        self.assertEqual(file_suite["uid"], FILE)  # nodeids are prefixed by it

    def test_grouping_still_works_when_the_paths_differ(self):
        # The nodeid keeps pytest's relative path, so the grouping key must too.
        reg = _SuiteRegistry()
        for nid, name in (
            (f"{FILE}::TestLogin::test_valid", "TestLogin.test_valid"),
            (f"{FILE}::test_plain", "test_plain"),
        ):
            reg.mark_start(nid)
            reg.record(nid, FILE, name, 0, "passed", abs_file=self.ABS)
        [file_suite] = reg.snapshot()

        self.assertEqual([t["title"] for t in file_suite["tests"]], ["test_plain"])
        self.assertEqual(
            [t["title"] for t in file_suite["suites"][0]["tests"]], ["test_valid"]
        )


class TestTheTreeAppearsBeforeAnythingRuns(unittest.TestCase):
    """Commands stream from the first driver command, but the suites frame used
    to wait for the first test to REPORT — so the tree stayed empty through the
    whole first test while the Actions list filled up beside it."""

    def test_a_collected_test_is_pending_with_no_end(self):
        reg = _SuiteRegistry()
        reg.record(f"{FILE}::test_plain", FILE, "test_plain", 0, "pending")
        [file_suite] = reg.snapshot()

        test = file_suite["tests"][0]
        self.assertEqual(test["state"], "pending")
        self.assertIsNone(file_suite["end"])  # nothing has finished yet

    def test_a_wholly_pending_tree_reads_pending(self):
        reg = _SuiteRegistry()
        for nid, name in (
            (f"{FILE}::TestLogin::test_valid", "TestLogin.test_valid"),
            (f"{FILE}::test_plain", "test_plain"),
        ):
            reg.record(nid, FILE, name, 0, "pending")
        [file_suite] = reg.snapshot()

        self.assertEqual(file_suite["state"], "pending")
        self.assertEqual(file_suite["suites"][0]["state"], "pending")

    def test_the_running_test_is_visible_as_running(self):
        reg = _SuiteRegistry()
        nid = f"{FILE}::test_plain"
        reg.record(nid, FILE, "test_plain", 0, "pending")
        reg.mark_start(nid)
        reg.record(nid, FILE, "test_plain", 0, "running")
        [file_suite] = reg.snapshot()

        self.assertEqual(file_suite["tests"][0]["state"], "running")
        self.assertEqual(file_suite["state"], "running")

    def test_one_finished_test_makes_the_group_running_not_pending(self):
        # Half-done is in progress, not "not started".
        reg = _SuiteRegistry()
        reg.record(f"{FILE}::b", FILE, "b", 0, "pending")
        reg.record(f"{FILE}::a", FILE, "a", 0, "passed")

        self.assertEqual(reg.snapshot()[0]["state"], "running")

    def test_a_pending_test_does_not_freeze_a_start_time(self):
        # Recorded at collection, started later: the duration must come from the
        # real start, not from when pytest happened to collect it.
        reg = _SuiteRegistry()
        nid = f"{FILE}::test_plain"
        reg.record(nid, FILE, "test_plain", 0, "pending")
        reg.mark_start(nid)
        started = reg._starts[nid]
        reg.record(nid, FILE, "test_plain", 0, "passed")

        self.assertEqual(reg.snapshot()[0]["tests"][0]["start"], iso(started))

    def test_a_failure_still_wins_over_pending_siblings(self):
        reg = _SuiteRegistry()
        reg.record(f"{FILE}::b", FILE, "b", 0, "pending")
        reg.record(f"{FILE}::a", FILE, "a", 0, "failed")

        self.assertEqual(reg.snapshot()[0]["state"], "failed")


class TestSiblingPositionIsCarried(unittest.TestCase):
    """The tree renders a suite's own tests then its nested suites, which IS
    mocha's execution order (`Runner.runSuite` runs `suite.tests` first). pytest
    interleaves the two, so it stamps `order` and the app merges the buckets by
    it. That position is the source LINE — see the comment in `record`."""

    # A class holding two tests, and a module-level test written after it.
    CLASS_TESTS = (
        (f"{FILE}::TestLogin::test_valid", "TestLogin.test_valid", 10),
        (f"{FILE}::TestLogin::test_invalid", "TestLogin.test_invalid", 20),
    )
    MODULE_TEST = (f"{FILE}::test_the_login_page_loads",
                   "test_the_login_page_loads", 40)

    def _full_collection(self):
        reg = _SuiteRegistry()
        for nid, name, line in (*self.CLASS_TESTS, self.MODULE_TEST):
            reg.record(nid, FILE, name, line, "pending")
        return reg

    def test_a_class_sits_where_its_first_test_starts(self):
        file_suite = self._full_collection().snapshot()[0]

        self.assertEqual(file_suite["suites"][0]["order"], 10)
        self.assertEqual(file_suite["tests"][0]["order"], 40)

    def test_the_position_survives_a_later_state_change(self):
        # record() runs again at start and at completion; the position must not
        # move as the state settles.
        reg = _SuiteRegistry()
        nid = f"{FILE}::test_plain"
        reg.record(nid, FILE, "test_plain", 7, "pending")
        reg.record(nid, FILE, "test_plain", 7, "passed")

        self.assertEqual(reg.snapshot()[0]["tests"][0]["order"], 7)

    def test_a_rerun_of_one_test_leaves_it_where_it_was(self):
        # A rerun is a fresh process collecting ONE test, so its collection
        # index is 0 — stamping that would send the row to the top of its file,
        # above the class it was written below. The line does not move.
        full = self._full_collection().snapshot()[0]

        rerun = _SuiteRegistry()
        nid, name, line = self.MODULE_TEST
        rerun.record(nid, FILE, name, line, "passed")

        self.assertEqual(
            rerun.snapshot()[0]["tests"][0]["order"],
            full["tests"][0]["order"],
        )
        # …and still after the class it sits below.
        self.assertGreater(
            rerun.snapshot()[0]["tests"][0]["order"],
            full["suites"][0]["order"],
        )


class _Report:
    """The three fields the plugin reads off a pytest TestReport."""

    def __init__(self, when, outcome):
        self.when = when
        self.passed = outcome == "passed"
        self.failed = outcome == "failed"
        self.skipped = outcome == "skipped"


class TestEveryPhaseThatCarriesAnOutcome(unittest.TestCase):
    """Acting only on `call` left a test whose SETUP failed running for the rest
    of the session — no call report ever arrives — and showed a test whose
    TEARDOWN failed as green."""

    def test_the_call_phase_carries_the_ordinary_outcome(self):
        self.assertEqual(reported_state(_Report("call", "passed")), "passed")
        self.assertEqual(reported_state(_Report("call", "failed")), "failed")
        self.assertEqual(reported_state(_Report("call", "skipped")), "skipped")

    def test_a_failed_setup_is_terminal(self):
        # pytest calls this an error and emits no call report at all.
        self.assertEqual(reported_state(_Report("setup", "failed")), "failed")

    def test_a_failed_teardown_fails_the_test(self):
        self.assertEqual(reported_state(_Report("teardown", "failed")), "failed")

    def test_a_skip_surfaces_at_setup(self):
        self.assertEqual(reported_state(_Report("setup", "skipped")), "skipped")

    def test_a_passing_setup_says_nothing(self):
        # Acting on it would mark the test passed before its body ran.
        self.assertIsNone(reported_state(_Report("setup", "passed")))

    def test_a_passing_teardown_says_nothing(self):
        # Acting on it would overwrite a failed call with its clean teardown.
        self.assertIsNone(reported_state(_Report("teardown", "passed")))


class TestStateRollsUp(unittest.TestCase):
    def test_a_failure_inside_a_class_fails_the_class_and_the_file(self):
        reg = _registry_with(
            (f"{FILE}::TestLogin::test_valid", "TestLogin.test_valid", "passed"),
            (f"{FILE}::TestLogin::test_invalid", "TestLogin.test_invalid", "failed"),
        )
        [file_suite] = reg.snapshot()

        self.assertEqual(file_suite["suites"][0]["state"], "failed")
        self.assertEqual(file_suite["state"], "failed")

    def test_all_passing_stays_passed(self):
        reg = _registry_with(
            (f"{FILE}::TestLogin::test_valid", "TestLogin.test_valid", "passed"),
            (f"{FILE}::test_plain", "test_plain", "passed"),
        )
        self.assertEqual(reg.snapshot()[0]["state"], "passed")


if __name__ == "__main__":
    unittest.main()


class _Capturer:
    """Records what capture_command was handed, in the adapter's own kwargs."""

    def __init__(self):
        self.commands = []

    def capture_command(self, **kwargs):
        self.commands.append(kwargs)


class _Item:
    def __init__(self, path=FILE, nodeid=f"{FILE}::test_x"):
        self.path = path
        self.nodeid = nodeid


class _ExcInfo:
    """Stands in for pytest's ExceptionInfo — only what the plugin reads."""

    def __init__(self, value, statement="assert '/secure' in url", lineno=16):
        self.value = value
        entry = types.SimpleNamespace(path=FILE, lineno=lineno, statement=statement)
        self.traceback = [entry]


class TestAssertionRows(unittest.TestCase):
    """Python's `assert` is a statement, so the values come from pytest's own
    hooks — the operands from one, the outcome from another."""

    def setUp(self):
        plugin._comparisons.clear()
        self.capturer = _Capturer()
        self._opted = mock.patch.object(plugin, "_opted_in", return_value=True)
        self._opted.start()
        self._get = mock.patch.object(
            plugin.devtools, "get_capturer", return_value=self.capturer
        )
        self._get.start()

    def tearDown(self):
        self._opted.stop()
        self._get.stop()

    def test_a_passing_assertion_carries_the_operands(self):
        plugin.pytest_assertrepr_compare(None, "==", "Example Domain", "Example Domain")
        plugin.pytest_assertion_pass(
            _Item(), 3, 'title == "Example Domain"', "explanation"
        )

        [row] = self.capturer.commands
        # Named for the operator, so shared's ACTION_MAP resolves it — a bare
        # "assert" is dropped by the trace exporter.
        self.assertEqual(row["command"], "assert.equal")
        self.assertEqual(row["args"], ['title == "Example Domain"'])
        self.assertEqual(
            row["result"],
            {"passed": True, "expected": "Example Domain", "actual": "Example Domain"},
        )
        self.assertIsNone(row["error"])
        self.assertEqual(row["call_source"], f"{FILE}:3")

    def test_a_passing_assertion_with_no_comparison_still_gets_a_row(self):
        # `assert x` has no operands; the row is its source text and outcome.
        plugin.pytest_assertion_pass(_Item(), 7, "[1, 2, 3]", "[1, 2, 3]")

        [row] = self.capturer.commands
        self.assertEqual(row["result"], {"passed": True})

    def test_a_failing_assertion_is_marked_failed_and_carries_the_error(self):
        # The Errors tab collects rows carrying `error`, so a failing assertion
        # has to populate both that and `passed: False`.
        plugin.pytest_assertrepr_compare(
            None, "in", "/secure", "https://example.com/login"
        )
        error = AssertionError("assert '/secure' in 'https://example.com/login'")

        plugin.pytest_exception_interact(
            None, types.SimpleNamespace(excinfo=_ExcInfo(error)), None
        )

        [row] = self.capturer.commands
        self.assertIs(row["result"]["passed"], False)
        self.assertEqual(row["result"]["expected"], "/secure")
        self.assertEqual(row["result"]["actual"], "https://example.com/login")
        self.assertIs(row["error"], error)
        self.assertEqual(row["args"], ["'/secure' in url"])

    def test_a_non_assertion_failure_produces_no_row(self):
        # A TimeoutException is a test error, not an assertion. Emitting a row
        # would invent an assertion the user never wrote.
        plugin.pytest_assertrepr_compare(None, "==", "a", "b")

        plugin.pytest_exception_interact(
            None, types.SimpleNamespace(excinfo=_ExcInfo(RuntimeError("boom"))), None
        )

        self.assertEqual(self.capturer.commands, [])

    def test_a_non_assertion_failure_discards_buffered_operands(self):
        # Left in place, the next assertion would report values belonging to a
        # comparison that failed for another reason entirely.
        plugin.pytest_assertrepr_compare(None, "==", "stale", "values")
        plugin.pytest_exception_interact(
            None, types.SimpleNamespace(excinfo=_ExcInfo(RuntimeError("boom"))), None
        )

        plugin.pytest_assertion_pass(_Item(), 9, "something_else", "expl")

        [row] = self.capturer.commands
        self.assertEqual(row["result"], {"passed": True})  # no inherited operands

    def test_a_plain_script_assert_needs_no_pytest(self):
        # instrumentation.py serves scripts; this only asserts the shared helper
        # reads a traceback, since a script has no hooks at all.
        try:
            raise AssertionError("boom")
        except AssertionError as exc:
            location, source = assertions.assert_site_from_traceback(
                exc.__traceback__
            )

        self.assertIn("test_pytest_plugin.py", location or "")
        self.assertIsNotNone(source)

    def test_capture_is_silent_when_not_opted_in(self):
        self._opted.stop()
        with mock.patch.object(plugin, "_opted_in", return_value=False):
            plugin.pytest_assertion_pass(_Item(), 3, "x == 1", "expl")
        self._opted.start()

        self.assertEqual(self.capturer.commands, [])


class TestTheBytecodeCacheHint(unittest.TestCase):
    """Whether the pass hook is live is decided by what pytest COMPILED, and the
    fix is deleting cached bytecode — which is not always beside the file."""

    def test_it_names_the_central_cache_when_one_is_configured(self):
        # macOS's system python sets sys.pycache_prefix, so clearing the
        # __pycache__ next to the test does nothing at all. Naming the wrong path
        # is worse than naming none: the reader follows it, sees no change, and
        # concludes the advice was wrong rather than the location.
        with mock.patch.object(plugin.sys, "pycache_prefix", "/central/cache"):
            hint = plugin._bytecode_cache_hint()

        self.assertIn("/central/cache", hint)
        self.assertIn("pycache_prefix", hint)

    def test_it_falls_back_to_the_local_pycache(self):
        with mock.patch.object(plugin.sys, "pycache_prefix", None):
            self.assertIn("__pycache__", plugin._bytecode_cache_hint())


class _Config:
    """A pytest Config stand-in whose `getini` TYPE-CHECKS, as pytest 9 does."""

    def __init__(self, *, strict=True, initial=None):
        self.inicfg = dict(initial or {})
        self._inicache = {}
        self._strict = strict

    def getini(self, name):
        if name in self._inicache:
            return self._inicache[name]
        value = self.inicfg.get(name, False)
        if self._strict and isinstance(value, str):
            raise TypeError(
                f"config option {name!r} expects a bool, got str: {value!r}"
            )
        self._inicache[name] = value
        return value


class TestEnablingThePassHook(unittest.TestCase):
    """The value is consumed during COLLECTION, per module, by the rewriter — so
    one pytest will not accept it becomes a collection error in the user's run
    rather than a failure at the point it was set."""

    def test_the_value_survives_a_type_checking_getini(self):
        # pytest 9 rejects the string an ini file would carry. Setting "true"
        # here aborted collection with a TypeError for the whole run.
        config = _Config()

        plugin._enable_assertion_pass_hook(config)

        self.assertIs(config.getini("enable_assertion_pass_hook"), True)

    def test_a_rejected_value_is_reverted_not_left_behind(self):
        class Hostile(_Config):
            def getini(self, name):
                raise TypeError("no value is acceptable")

        config = Hostile()

        with self.assertLogs("selenium_devtools.pytest", level="WARNING"):
            plugin._enable_assertion_pass_hook(config)

        # Left set, the rewriter would hit the same rejection during collection
        # and take the run down with it.
        self.assertNotIn("enable_assertion_pass_hook", config.inicfg)

    def test_a_users_own_setting_is_restored_on_rejection(self):
        class Hostile(_Config):
            def getini(self, name):
                raise TypeError("nope")

        config = Hostile(initial={"enable_assertion_pass_hook": False})

        with self.assertLogs("selenium_devtools.pytest", level="WARNING"):
            plugin._enable_assertion_pass_hook(config)

        self.assertIs(config.inicfg["enable_assertion_pass_hook"], False)

    def test_the_memoized_value_is_dropped_so_the_rewriter_re_reads(self):
        # getini caches on first read, and something reads it before this hook.
        config = _Config()
        config._inicache["enable_assertion_pass_hook"] = False

        plugin._enable_assertion_pass_hook(config)

        self.assertIs(config.getini("enable_assertion_pass_hook"), True)
