import os
import tempfile
import unittest

from selenium_devtools.output_dir import (
    OUTPUT_SUBDIR,
    ensure_output_dir,
    resolve_adapter_output_dir,
)


class TestResolveAdapterOutputDir(unittest.TestCase):
    def test_groups_output_under_test_results_beside_the_test_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            spec = os.path.join(tmp, "test_login.py")
            open(spec, "w").close()
            self.assertEqual(
                resolve_adapter_output_dir(test_file_path=spec),
                os.path.join(tmp, OUTPUT_SUBDIR),
            )

    def test_falls_back_to_cwd_when_no_test_file_is_known(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(
                resolve_adapter_output_dir(fallback_dir=tmp),
                os.path.join(tmp, OUTPUT_SUBDIR),
            )

    def test_an_explicit_dir_wins_and_is_honored_as_is(self):
        with tempfile.TemporaryDirectory() as tmp:
            spec = os.path.join(tmp, "test_login.py")
            open(spec, "w").close()
            chosen = os.path.join(tmp, "somewhere-else")
            self.assertEqual(
                resolve_adapter_output_dir(
                    user_configured_dir=chosen, test_file_path=spec
                ),
                os.path.join(chosen, OUTPUT_SUBDIR),
            )

    # A test file resolved through an installed package must not collect
    # artifacts; core skips node_modules for the same reason.
    def test_skips_an_installed_package_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            installed = os.path.join(tmp, "lib", "site-packages", "pkg")
            os.makedirs(installed)
            spec = os.path.join(installed, "test_login.py")
            open(spec, "w").close()
            self.assertEqual(
                resolve_adapter_output_dir(test_file_path=spec, fallback_dir=tmp),
                os.path.join(tmp, OUTPUT_SUBDIR),
            )

    def test_falls_through_a_non_writable_candidate(self):
        with tempfile.TemporaryDirectory() as tmp:
            locked = os.path.join(tmp, "locked")
            os.makedirs(locked)
            spec = os.path.join(locked, "test_login.py")
            open(spec, "w").close()
            os.chmod(locked, 0o500)
            try:
                resolved = resolve_adapter_output_dir(
                    test_file_path=spec, fallback_dir=tmp
                )
            finally:
                os.chmod(locked, 0o700)
            self.assertEqual(resolved, os.path.join(tmp, OUTPUT_SUBDIR))

    def test_the_path_is_absolute_even_for_a_relative_test_file(self):
        self.assertTrue(
            os.path.isabs(resolve_adapter_output_dir(test_file_path="tests/test_x.py"))
        )


class TestEnsureOutputDir(unittest.TestCase):
    def test_creates_the_directory_and_returns_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, OUTPUT_SUBDIR)
            self.assertEqual(ensure_output_dir(target), target)
            self.assertTrue(os.path.isdir(target))

    def test_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, OUTPUT_SUBDIR)
            ensure_output_dir(target)
            self.assertEqual(ensure_output_dir(target), target)

    def test_returns_none_when_it_cannot_create(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.chmod(tmp, 0o500)
            try:
                self.assertIsNone(ensure_output_dir(os.path.join(tmp, "nope", "deep")))
            finally:
                os.chmod(tmp, 0o700)
