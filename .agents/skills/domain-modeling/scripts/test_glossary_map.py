#!/usr/bin/env python3
"""Behavior tests for the domain-modeling glossary-map validator."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("glossary_map.py")


def case_insensitive_filesystem() -> bool:
    """Probe whether this filesystem folds case, instead of assuming a platform.

    A case-insensitive filesystem cannot hold two names that differ only in case, so
    a fixture that writes both ends up with one file and the ambiguity under test
    never exists. Probing beats checking `sys.platform`: macOS can mount a
    case-sensitive volume and Linux can mount a folding one.
    """
    with tempfile.TemporaryDirectory() as probe:
        lower = Path(probe) / "probe.tmp"
        lower.write_text("", encoding="utf-8")
        return (Path(probe) / "PROBE.TMP").exists()


FOLDS_CASE = case_insensitive_filesystem()


def load_glossary_map():
    """Import the script under test as a module, without putting it on `sys.path`."""
    spec = importlib.util.spec_from_file_location("glossary_map_under_test", SCRIPT)
    assert spec is not None
    loader = spec.loader
    assert loader is not None
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


class GlossaryMapCliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def run_glossary_map(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["python3", str(SCRIPT), "--repo", str(self.repo)],
            text=True,
            capture_output=True,
            check=False,
        )

    def test_glossary_map_reports_absent_without_a_root_map(self) -> None:
        (self.repo / "GLOSSARY.md").write_text("# Root glossary\n", encoding="utf-8")

        result = self.run_glossary_map()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "absent\n")

    def test_glossary_map_reports_reachable_glossaries_before_root_glossary(self) -> None:
        (self.repo / "GLOSSARY.md").write_text("# Root glossary\n", encoding="utf-8")
        ordering = self.repo / "src" / "ordering"
        billing = self.repo / "src" / "billing"
        ordering.mkdir(parents=True)
        billing.mkdir(parents=True)
        (ordering / "GLOSSARY.md").write_text("# Ordering\n", encoding="utf-8")
        (billing / "GLOSSARY.md").write_text("# Billing\n", encoding="utf-8")
        (self.repo / "GLOSSARY-MAP.md").write_text(
            "# Glossary Map\n\n## Contexts\n\n"
            "- [Ordering](./src/ordering/GLOSSARY.md) — orders\n"
            "- [Billing](./src/billing/GLOSSARY.md) — billing\n\n"
            "## Relationships\n\n- **Ordering → Billing**: invoices\n",
            encoding="utf-8",
        )

        result = self.run_glossary_map()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            result.stdout,
            "map GLOSSARY-MAP.md\n"
            "context Ordering\tsrc/ordering/GLOSSARY.md\n"
            "context Billing\tsrc/billing/GLOSSARY.md\n",
        )
        self.assertNotIn("Root glossary", result.stdout)

    def test_glossary_map_blocks_zero_entries_without_falling_back_to_root_glossary(self) -> None:
        (self.repo / "GLOSSARY.md").write_text("# Root glossary\n", encoding="utf-8")
        (self.repo / "GLOSSARY-MAP.md").write_text("## Contexts\n", encoding="utf-8")

        result = self.run_glossary_map()

        self.assertEqual(result.returncode, 1)
        self.assertIn("no contextual glossaries listed", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_glossary_map_refuses_a_malformed_map_without_falling_back_to_root_glossary(
        self,
    ) -> None:
        (self.repo / "GLOSSARY.md").write_text("# Root glossary\n", encoding="utf-8")
        (self.repo / "GLOSSARY-MAP.md").write_text(
            "# Glossary Map\n\n## Contexts\n\n- ordering: src/ordering/GLOSSARY.md\n",
            encoding="utf-8",
        )

        result = self.run_glossary_map()

        self.assertEqual(result.returncode, 1)
        self.assertIn("malformed glossary map", result.stderr)
        self.assertNotIn("Root glossary", result.stdout)
        self.assertEqual(result.stdout, "")

    def test_glossary_map_refuses_unreachable_or_outside_glossary_entries(self) -> None:
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "GLOSSARY.md").write_text("# Outside\n", encoding="utf-8")
        cases = {
            "missing": "./src/missing/GLOSSARY.md",
            "outside": "../outside/GLOSSARY.md",
            "not-glossary": "./src/context.txt",
        }
        for name, target in cases.items():
            with self.subTest(name=name):
                (self.repo / "GLOSSARY-MAP.md").write_text(
                    f"## Contexts\n\n- [Context]({target})\n", encoding="utf-8"
                )

                result = self.run_glossary_map()

                self.assertEqual(result.returncode, 1)
                self.assertIn("refused:", result.stderr)
                self.assertEqual(result.stdout, "")

    def test_glossary_map_refuses_control_characters_in_labels(self) -> None:
        context = self.repo / "src" / "orders"
        context.mkdir(parents=True)
        (context / "GLOSSARY.md").write_text("# Orders\n", encoding="utf-8")
        for label in ("Orders\tSales", "Orders\x1fSales", "Orders\x00Sales"):
            with self.subTest(label=label):
                (self.repo / "GLOSSARY-MAP.md").write_text(
                    f"## Contexts\n\n- [{label}](./src/orders/GLOSSARY.md)\n", encoding="utf-8"
                )

                result = self.run_glossary_map()

                self.assertEqual(result.returncode, 1)
                self.assertIn("context label contains a control character", result.stderr)
                self.assertEqual(result.stdout, "")

    def test_glossary_map_refuses_control_characters_in_targets_before_path_resolution(
        self,
    ) -> None:
        context = self.repo / "src" / "orders"
        context.mkdir(parents=True)
        (context / "GLOSSARY.md").write_text("# Orders\n", encoding="utf-8")
        target = "./src/orders/GLOSSARY\x00.md"
        (self.repo / "GLOSSARY-MAP.md").write_text(
            f"## Contexts\n\n- [Orders]({target})\n", encoding="utf-8"
        )

        result = self.run_glossary_map()

        self.assertEqual(result.returncode, 1)
        self.assertIn("glossary target contains a control character", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_glossary_map_refuses_ambiguous_labels_and_glossaries(self) -> None:
        context = self.repo / "src" / "orders"
        context.mkdir(parents=True)
        (context / "GLOSSARY.md").write_text("# Orders\n", encoding="utf-8")
        cases = {
            "labels": "- [Orders](./src/orders/GLOSSARY.md)\n- [orders](./src/orders/GLOSSARY.md)\n",
            "glossaries": "- [Orders](./src/orders/GLOSSARY.md)\n- [Sales](./src/orders/./GLOSSARY.md)\n",
        }
        for name, entries in cases.items():
            with self.subTest(name=name):
                (self.repo / "GLOSSARY-MAP.md").write_text(
                    "## Contexts\n\n" + entries, encoding="utf-8"
                )

                result = self.run_glossary_map()

                self.assertEqual(result.returncode, 1)
                self.assertIn("ambiguous glossary map", result.stderr)
                self.assertEqual(result.stdout, "")

    @unittest.skipIf(
        FOLDS_CASE,
        "this filesystem folds case, so two case-fold-equivalent names cannot coexist; "
        "the same refusal is covered by "
        "test_glossary_map_refuses_several_root_map_candidates",
    )
    def test_glossary_map_refuses_casefold_ambiguous_root_map_names(self) -> None:
        (self.repo / "GLOSSARY-MAP.md").write_text("## Contexts\n", encoding="utf-8")
        (self.repo / "glossary-map.md").write_text("## Contexts\n", encoding="utf-8")

        result = self.run_glossary_map()

        self.assertEqual(result.returncode, 1)
        self.assertIn("ambiguous root glossary map names", result.stderr)

    def test_glossary_map_refuses_several_root_map_candidates(self) -> None:
        """The same refusal, decided in process, so no filesystem can hide it.

        The test above builds the ambiguity out of two real files and therefore only
        runs where the filesystem keeps them apart. This one hands the resolver the
        candidate list directly, so the decision is covered everywhere.
        """
        module = load_glossary_map()
        first = self.repo / "GLOSSARY-MAP.md"
        second = self.repo / "GLOSSARY-MAP.other.md"
        first.write_text("## Contexts\n", encoding="utf-8")
        second.write_text("## Contexts\n", encoding="utf-8")

        original = module.glossary_map_candidates
        module.glossary_map_candidates = lambda repo: [first, second]
        captured = io.StringIO()
        try:
            with contextlib.redirect_stderr(captured), self.assertRaises(SystemExit) as raised:
                module.cmd_glossary_map(self.repo)
        finally:
            module.glossary_map_candidates = original

        self.assertEqual(raised.exception.code, 1)
        self.assertIn("ambiguous root glossary map names", captured.getvalue())

    def test_glossary_map_refuses_a_symlinked_glossary_outside_the_repository(self) -> None:
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "GLOSSARY.md").write_text("# Outside\n", encoding="utf-8")
        source = self.repo / "src"
        source.mkdir()
        (source / "context").symlink_to(outside, target_is_directory=True)
        (self.repo / "GLOSSARY-MAP.md").write_text(
            "## Contexts\n\n- [Outside](./src/context/GLOSSARY.md)\n", encoding="utf-8"
        )

        result = self.run_glossary_map()

        self.assertEqual(result.returncode, 1)
        self.assertIn("resolves outside the repository", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_glossary_map_refuses_invalid_utf8(self) -> None:
        (self.repo / "GLOSSARY-MAP.md").write_bytes(b"## Contexts\n\xff")

        result = self.run_glossary_map()

        self.assertEqual(result.returncode, 1)
        self.assertIn("expected UTF-8 text", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_glossary_map_blocks_a_retired_root_file_with_or_without_its_replacement(self) -> None:
        cases = {
            "context-alone": (["CONTEXT.md"], "retired root CONTEXT.md: rename it to GLOSSARY.md"),
            "context-map-alone": (
                ["CONTEXT-MAP.md"],
                "retired root CONTEXT-MAP.md: rename it to GLOSSARY-MAP.md",
            ),
            "context-casefolded": (
                ["context.md"],
                "retired root context.md: rename it to GLOSSARY.md",
            ),
            "context-with-glossary": (
                ["CONTEXT.md", "GLOSSARY.md"],
                "retired root CONTEXT.md: rename it to GLOSSARY.md",
            ),
            "context-map-with-glossary-map": (
                ["CONTEXT-MAP.md", "GLOSSARY-MAP.md"],
                "retired root CONTEXT-MAP.md: rename it to GLOSSARY-MAP.md",
            ),
        }
        for name, (files, message) in cases.items():
            with self.subTest(name=name):
                for file in files:
                    (self.repo / file).write_text("## Contexts\n", encoding="utf-8")

                result = self.run_glossary_map()

                self.assertEqual(result.returncode, 1)
                self.assertIn(message, result.stderr)
                self.assertEqual(result.stdout, "")
                for file in files:
                    (self.repo / file).unlink()

    def test_glossary_map_refuses_an_entry_pointing_to_a_retired_glossary_name(self) -> None:
        orders = self.repo / "src" / "orders"
        orders.mkdir(parents=True)
        (orders / "CONTEXT.md").write_text("# Orders\n", encoding="utf-8")
        (self.repo / "GLOSSARY-MAP.md").write_text(
            "## Contexts\n\n- [Orders](./src/orders/CONTEXT.md)\n", encoding="utf-8"
        )

        result = self.run_glossary_map()

        self.assertEqual(result.returncode, 1)
        self.assertIn("unreachable glossary entry", result.stderr)
        self.assertEqual(result.stdout, "")


if __name__ == "__main__":
    unittest.main()
