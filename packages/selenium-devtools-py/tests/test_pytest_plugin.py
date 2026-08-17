"""The suite tree the pytest plugin feeds the dashboard.

The nodeids and `report.location` names here are the ones real pytest emits —
captured from a run of a file holding a class-based and a module-level test:

    LOCATION=('t.py', 1, 'TestLogin.test_valid')  NODEID='t.py::TestLogin::test_valid'
    LOCATION=('t.py', 7, 'test_plain')            NODEID='t.py::test_plain'
"""

import unittest

from selenium_devtools.pytest_plugin import _SuiteRegistry

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
