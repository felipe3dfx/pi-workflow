#!/usr/bin/env python3
"""Behavior tests for the setup-workflow renderer, differ, and router."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("setup_workflow.py")


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


def load_setup_workflow():
    """Import the script under test as a module, without putting it on `sys.path`."""
    spec = importlib.util.spec_from_file_location("setup_workflow_under_test", SCRIPT)
    assert spec is not None
    loader = spec.loader
    assert loader is not None
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


ROUTING_START = "<!-- setup-workflow-routing:start -->"
TARGET_NAMES = ("domain.md", "issue-tracker.md", "pull-requests.md", "quality.md", "workflow.md")
DOMAIN_AUTHORITY_START = "<!-- domain-modeling:authority:start -->"
DOMAIN_AUTHORITY_END = "<!-- domain-modeling:authority:end -->"
ROUTING_BLOCK = """<!-- setup-workflow-routing:start -->

## Workflow Contracts

Read these files in order:

1. `AGENTS.md`
2. `docs/agents/issue-tracker.md`
3. `docs/agents/domain.md`
4. `docs/agents/workflow.md`
5. `docs/agents/quality.md`
6. `docs/agents/pull-requests.md`

<!-- setup-workflow-routing:end -->
"""


class SetupWorkflowCliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        (self.root / "scripts").mkdir()
        (self.root / "scripts" / "setup_workflow.py").write_text(
            SCRIPT.read_text(encoding="utf-8"), encoding="utf-8"
        )
        self.assets = self.root / "assets"
        self.assets.mkdir()
        self.repo = self.root / "repo"
        self.repo.mkdir()
        (self.repo / "AGENTS.md").write_text("# Repo\n", encoding="utf-8")
        self.write_assets()

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def write_assets(self) -> None:
        (self.assets / "issue-tracker-none.md").write_text(
            "# Tracker\n\nstate: {{TRACKER_CAPABILITY_STATE}}\n", encoding="utf-8"
        )
        (self.assets / "domain.md").write_text(
            "# Domain\n\n- Domain authority: `{{DOMAIN_AUTHORITY_PATH}}`\n"
            "- Context map: `{{CONTEXT_MAP_PATH}}`\n\n"
            + DOMAIN_AUTHORITY_START
            + "\nAuthority state: {{DOMAIN_AUTHORITY_STATE}}\n"
            + DOMAIN_AUTHORITY_END
            + "\n",
            encoding="utf-8",
        )
        (self.assets / "workflow.md").write_text(
            "# Workflow\n\nAuthority: `docs/agents/domain.md and the authority it resolves`\n\n"
            "{{WORKING_BASE}}\n",
            encoding="utf-8",
        )
        (self.assets / "quality.md").write_text(
            "# Quality\n\n{{FOCUSED_VALIDATION_COMMANDS}}\n", encoding="utf-8"
        )
        (self.assets / "pull-requests.md").write_text(
            "# PRs\n\n{{COMMIT_CONVENTION}}\n", encoding="utf-8"
        )
        (self.assets / "routing-block.md").write_text(ROUTING_BLOCK, encoding="utf-8")

    def write_values(self, name: str, content: str) -> Path:
        path = self.root / name
        path.write_text(content, encoding="utf-8")
        return path

    def full_values(self) -> str:
        return (
            "TRACKER_CAPABILITY_STATE = unsupported\n"
            "CONTEXT_MAP_PATH = none (confirmed absent)\n"
            "DOMAIN_AUTHORITY_PATH = docs/agents/domain.md\n"
            "DOMAIN_AUTHORITY_STATE = absent (fallback-required)\n"
            "WORKING_BASE = main\n"
            "FOCUSED_VALIDATION_COMMANDS = <marker>\n"
            "COMMIT_CONVENTION = Conventional Commits\n"
        )

    def run_script(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["python3", "scripts/setup_workflow.py", *args],
            cwd=self.root,
            text=True,
            capture_output=True,
            check=False,
        )

    def run_render(self, values_path: Path) -> subprocess.CompletedProcess[str]:
        return self.run_render_with(values_path, TARGET_NAMES)

    def run_render_unapproved(self, values_path: Path) -> subprocess.CompletedProcess[str]:
        return self.run_render_with(values_path, ())

    def run_render_with(
        self, values_path: Path, approvals: tuple[str, ...]
    ) -> subprocess.CompletedProcess[str]:
        arguments = [
            "render",
            "--assets",
            str(self.assets),
            "--values",
            str(values_path),
            "--tracker",
            "none",
            "--repo",
            str(self.repo),
        ]
        for approval in approvals:
            arguments += ["--approve", approval]
        return self.run_script(*arguments)

    def run_diff(self, values_path: Path) -> subprocess.CompletedProcess[str]:
        return self.run_script(
            "diff",
            "--assets",
            str(self.assets),
            "--values",
            str(values_path),
            "--tracker",
            "none",
            "--repo",
            str(self.repo),
        )

    def run_update(self, values_path: Path, *approvals: str) -> subprocess.CompletedProcess[str]:
        arguments = [
            "update",
            "--assets",
            str(self.assets),
            "--values",
            str(values_path),
            "--tracker",
            "none",
            "--repo",
            str(self.repo),
        ]
        for approval in approvals:
            arguments += ["--approve", approval]
        return self.run_script(*arguments)

    def run_context_map(self) -> subprocess.CompletedProcess[str]:
        return self.run_script("context-map", "--repo", str(self.repo))

    def test_context_map_reports_reachable_glossaries_before_root_glossary(self) -> None:
        (self.repo / "CONTEXT.md").write_text("# Root glossary\n", encoding="utf-8")
        ordering = self.repo / "src" / "ordering"
        billing = self.repo / "src" / "billing"
        ordering.mkdir(parents=True)
        billing.mkdir(parents=True)
        (ordering / "CONTEXT.md").write_text("# Ordering\n", encoding="utf-8")
        (billing / "CONTEXT.md").write_text("# Billing\n", encoding="utf-8")
        (self.repo / "CONTEXT-MAP.md").write_text(
            "# Context Map\n\n## Contexts\n\n"
            "- [Ordering](./src/ordering/CONTEXT.md) — orders\n"
            "- [Billing](./src/billing/CONTEXT.md) — billing\n\n"
            "## Relationships\n\n- **Ordering → Billing**: invoices\n",
            encoding="utf-8",
        )

        result = self.run_context_map()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            result.stdout,
            "map CONTEXT-MAP.md\n"
            "context Ordering\tsrc/ordering/CONTEXT.md\n"
            "context Billing\tsrc/billing/CONTEXT.md\n",
        )
        self.assertNotIn("Root glossary", result.stdout)

    def test_context_map_blocks_zero_entries_without_falling_back_to_root_glossary(self) -> None:
        (self.repo / "CONTEXT.md").write_text("# Root glossary\n", encoding="utf-8")
        (self.repo / "CONTEXT-MAP.md").write_text("## Contexts\n", encoding="utf-8")

        result = self.run_context_map()

        self.assertEqual(result.returncode, 1)
        self.assertIn("no contextual glossaries listed", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_context_map_refuses_a_malformed_map_without_falling_back_to_root_glossary(
        self,
    ) -> None:
        (self.repo / "CONTEXT.md").write_text("# Root glossary\n", encoding="utf-8")
        (self.repo / "CONTEXT-MAP.md").write_text(
            "# Context Map\n\n## Contexts\n\n- ordering: src/ordering/CONTEXT.md\n",
            encoding="utf-8",
        )

        result = self.run_context_map()

        self.assertEqual(result.returncode, 1)
        self.assertIn("malformed context map", result.stderr)
        self.assertNotIn("Root glossary", result.stdout)
        self.assertEqual(result.stdout, "")

    def test_context_map_refuses_unreachable_or_outside_glossary_entries(self) -> None:
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "CONTEXT.md").write_text("# Outside\n", encoding="utf-8")
        cases = {
            "missing": "./src/missing/CONTEXT.md",
            "outside": "../outside/CONTEXT.md",
            "not-glossary": "./src/context.txt",
        }
        for name, target in cases.items():
            with self.subTest(name=name):
                (self.repo / "CONTEXT-MAP.md").write_text(
                    f"## Contexts\n\n- [Context]({target})\n", encoding="utf-8"
                )

                result = self.run_context_map()

                self.assertEqual(result.returncode, 1)
                self.assertIn("refused:", result.stderr)
                self.assertEqual(result.stdout, "")

    def test_context_map_refuses_control_characters_in_labels(self) -> None:
        context = self.repo / "src" / "orders"
        context.mkdir(parents=True)
        (context / "CONTEXT.md").write_text("# Orders\n", encoding="utf-8")
        for label in ("Orders\tSales", "Orders\x1fSales", "Orders\x00Sales"):
            with self.subTest(label=label):
                (self.repo / "CONTEXT-MAP.md").write_text(
                    f"## Contexts\n\n- [{label}](./src/orders/CONTEXT.md)\n", encoding="utf-8"
                )

                result = self.run_context_map()

                self.assertEqual(result.returncode, 1)
                self.assertIn("context label contains a control character", result.stderr)
                self.assertEqual(result.stdout, "")

    def test_context_map_refuses_control_characters_in_targets_before_path_resolution(self) -> None:
        context = self.repo / "src" / "orders"
        context.mkdir(parents=True)
        (context / "CONTEXT.md").write_text("# Orders\n", encoding="utf-8")
        target = "./src/orders/CONTEXT\x00.md"
        (self.repo / "CONTEXT-MAP.md").write_text(
            f"## Contexts\n\n- [Orders]({target})\n", encoding="utf-8"
        )

        result = self.run_context_map()

        self.assertEqual(result.returncode, 1)
        self.assertIn("glossary target contains a control character", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_context_map_refuses_ambiguous_labels_and_glossaries(self) -> None:
        context = self.repo / "src" / "orders"
        context.mkdir(parents=True)
        (context / "CONTEXT.md").write_text("# Orders\n", encoding="utf-8")
        cases = {
            "labels": "- [Orders](./src/orders/CONTEXT.md)\n- [orders](./src/orders/CONTEXT.md)\n",
            "glossaries": "- [Orders](./src/orders/CONTEXT.md)\n- [Sales](./src/orders/./CONTEXT.md)\n",
        }
        for name, entries in cases.items():
            with self.subTest(name=name):
                (self.repo / "CONTEXT-MAP.md").write_text(
                    "## Contexts\n\n" + entries, encoding="utf-8"
                )

                result = self.run_context_map()

                self.assertEqual(result.returncode, 1)
                self.assertIn("ambiguous context map", result.stderr)
                self.assertEqual(result.stdout, "")

    @unittest.skipIf(
        FOLDS_CASE,
        "this filesystem folds case, so two case-fold-equivalent names cannot coexist; "
        "the same refusal is covered by "
        "test_context_map_refuses_several_root_map_candidates",
    )
    def test_context_map_refuses_casefold_ambiguous_root_map_names(self) -> None:
        (self.repo / "CONTEXT-MAP.md").write_text("## Contexts\n", encoding="utf-8")
        (self.repo / "context-map.md").write_text("## Contexts\n", encoding="utf-8")

        result = self.run_context_map()

        self.assertEqual(result.returncode, 1)
        self.assertIn("ambiguous root context map names", result.stderr)

    def test_context_map_refuses_several_root_map_candidates(self) -> None:
        """The same refusal, decided in process, so no filesystem can hide it.

        The test above builds the ambiguity out of two real files and therefore only
        runs where the filesystem keeps them apart. This one hands the resolver the
        candidate list directly, so the decision is covered everywhere.
        """
        module = load_setup_workflow()
        first = self.repo / "CONTEXT-MAP.md"
        second = self.repo / "CONTEXT-MAP.other.md"
        first.write_text("## Contexts\n", encoding="utf-8")
        second.write_text("## Contexts\n", encoding="utf-8")

        original = module.context_map_candidates
        module.context_map_candidates = lambda repo: [first, second]
        captured = io.StringIO()
        try:
            with contextlib.redirect_stderr(captured), self.assertRaises(SystemExit) as raised:
                module.cmd_context_map(self.repo)
        finally:
            module.context_map_candidates = original

        self.assertEqual(raised.exception.code, 1)
        self.assertIn("ambiguous root context map names", captured.getvalue())

    def test_context_map_refuses_a_symlinked_glossary_outside_the_repository(self) -> None:
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "CONTEXT.md").write_text("# Outside\n", encoding="utf-8")
        source = self.repo / "src"
        source.mkdir()
        (source / "context").symlink_to(outside, target_is_directory=True)
        (self.repo / "CONTEXT-MAP.md").write_text(
            "## Contexts\n\n- [Outside](./src/context/CONTEXT.md)\n", encoding="utf-8"
        )

        result = self.run_context_map()

        self.assertEqual(result.returncode, 1)
        self.assertIn("resolves outside the repository", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_context_map_refuses_invalid_utf8(self) -> None:
        (self.repo / "CONTEXT-MAP.md").write_bytes(b"## Contexts\n\xff")

        result = self.run_context_map()

        self.assertEqual(result.returncode, 1)
        self.assertIn("expected UTF-8 text", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_render_exposes_all_map_entries_without_a_fixed_selection(self) -> None:
        orders = self.repo / "contexts" / "Orders" / "CONTEXT.md"
        billing = self.repo / "contexts" / "Billing" / "CONTEXT.md"
        for glossary in (orders, billing):
            glossary.parent.mkdir(parents=True, exist_ok=True)
            glossary.write_text(f"# {glossary.parent.name}\n", encoding="utf-8")
        (self.repo / "CONTEXT-MAP.md").write_text(
            "## Contexts\n\n- [Orders](./contexts/Orders/CONTEXT.md)\n"
            "- [Billing](./contexts/Billing/CONTEXT.md)\n",
            encoding="utf-8",
        )
        values = self.write_values(
            "values.txt",
            self.full_values()
            .replace("none (confirmed absent)", "CONTEXT-MAP.md")
            .replace("docs/agents/domain.md", "none (select per invocation)")
            .replace("absent (fallback-required)", "present (map-available)"),
        )

        result = self.run_render(values)

        self.assertEqual(result.returncode, 0, result.stderr)
        domain = (self.repo / "docs" / "agents" / "domain.md").read_text(encoding="utf-8")
        self.assertIn("- Domain authority: `none (select per invocation)`", domain)
        self.assertIn("Authority state: present (map-available)", domain)
        entries = self.run_context_map()
        self.assertEqual(entries.returncode, 0, entries.stderr)
        self.assertIn("context Orders\tcontexts/Orders/CONTEXT.md", entries.stdout)
        self.assertIn("context Billing\tcontexts/Billing/CONTEXT.md", entries.stdout)
        workflow = (self.repo / "docs" / "agents" / "workflow.md").read_text(encoding="utf-8")
        self.assertIn("docs/agents/domain.md and the authority it resolves", workflow)
        self.assertNotIn("none (select per invocation)", workflow)

    def test_render_preserves_lexical_symlinked_authority_paths(self) -> None:
        glossary = self.repo / "contexts" / "orders" / "CONTEXT.md"
        glossary.parent.mkdir(parents=True)
        glossary.write_text("# Orders\n", encoding="utf-8")
        map_source = self.repo / "metadata" / "map.md"
        map_source.parent.mkdir()
        map_source.write_text(
            "## Contexts\n\n- [Orders](./contexts/orders/CONTEXT.md)\n", encoding="utf-8"
        )
        (self.repo / "CONTEXT-MAP.md").symlink_to(map_source)
        map_values = self.write_values(
            "map-values.txt",
            self.full_values()
            .replace("none (confirmed absent)", "CONTEXT-MAP.md")
            .replace("docs/agents/domain.md", "none (select per invocation)")
            .replace("absent (fallback-required)", "present (map-available)"),
        )

        map_result = self.run_render(map_values)

        self.assertEqual(map_result.returncode, 0, map_result.stderr)
        map_domain = (self.repo / "docs" / "agents" / "domain.md").read_text(encoding="utf-8")
        self.assertIn("- Context map: `CONTEXT-MAP.md`", map_domain)
        map_diff_result = self.run_diff(map_values)
        self.assertEqual(map_diff_result.returncode, 0, map_diff_result.stderr)
        self.assertIn(
            f"IDENTICAL {self.repo / 'docs' / 'agents' / 'domain.md'}", map_diff_result.stdout
        )
        context_map_result = self.run_context_map()
        self.assertEqual(context_map_result.returncode, 0, context_map_result.stderr)
        self.assertTrue(context_map_result.stdout.startswith("map CONTEXT-MAP.md\n"))

        for path in (self.repo / "docs" / "agents").glob("*.md"):
            path.unlink()
        (self.repo / "CONTEXT-MAP.md").unlink()
        root_source = self.repo / "metadata" / "root.md"
        root_source.write_text("# Root\n", encoding="utf-8")
        (self.repo / "CONTEXT.md").symlink_to(root_source)
        root_values = self.write_values(
            "root-values.txt",
            self.full_values()
            .replace("docs/agents/domain.md", "CONTEXT.md")
            .replace("absent (fallback-required)", "present (root-selected)"),
        )

        root_result = self.run_render(root_values)

        self.assertEqual(root_result.returncode, 0, root_result.stderr)
        root_domain = (self.repo / "docs" / "agents" / "domain.md").read_text(encoding="utf-8")
        self.assertIn("- Domain authority: `CONTEXT.md`", root_domain)
        root_diff_result = self.run_diff(root_values)
        self.assertEqual(root_diff_result.returncode, 0, root_diff_result.stderr)
        self.assertIn(
            f"IDENTICAL {self.repo / 'docs' / 'agents' / 'domain.md'}", root_diff_result.stdout
        )

    def test_render_accepts_case_preserved_root_selected_authority(self) -> None:
        (self.repo / "context.md").write_text("# Root glossary\n", encoding="utf-8")
        values = self.write_values(
            "values.txt",
            self.full_values()
            .replace("docs/agents/domain.md", "context.md")
            .replace("absent (fallback-required)", "present (root-selected)"),
        )

        result = self.run_render(values)

        self.assertEqual(result.returncode, 0, result.stderr)
        domain = (self.repo / "docs" / "agents" / "domain.md").read_text(encoding="utf-8")
        self.assertIn("- Domain authority: `context.md`", domain)
        self.assertIn("Authority state: present (root-selected)", domain)

    def test_render_withholds_invalid_domain_authority_but_writes_unrelated_playbooks(self) -> None:
        cases = {
            "unknown-state": self.full_values().replace("absent (fallback-required)", "absent"),
            "fallback-external-path": self.full_values().replace(
                "docs/agents/domain.md", "CONTEXT.md"
            ),
            "fallback-map-path": self.full_values().replace(
                "none (confirmed absent)", "CONTEXT-MAP.md"
            ),
        }
        for name, content in cases.items():
            with self.subTest(name=name):
                values = self.write_values("values.txt", content)

                result = self.run_render(values)

                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("WITHHELD", result.stderr)
                self.assertTrue(
                    "invalid domain authority state" in result.stderr or "requires" in result.stderr
                )
                docs = self.repo / "docs" / "agents"
                self.assertFalse((docs / "domain.md").exists())
                for name in ("issue-tracker.md", "workflow.md", "quality.md", "pull-requests.md"):
                    self.assertTrue((docs / name).is_file())
                for path in docs.glob("*.md"):
                    path.unlink()

    def test_render_and_diff_report_a_context_map_directory_without_traceback(self) -> None:
        (self.repo / "CONTEXT-MAP.md").mkdir()
        values = self.write_values(
            "values.txt",
            self.full_values()
            .replace("none (confirmed absent)", "CONTEXT-MAP.md")
            .replace("docs/agents/domain.md", "none (select per invocation)")
            .replace("absent (fallback-required)", "present (map-available)"),
        )

        render_result = self.run_render(values)
        diff_result = self.run_diff(values)

        self.assertEqual(render_result.returncode, 0, render_result.stderr)
        self.assertIn("WITHHELD", render_result.stderr)
        self.assertIn("not a regular file", render_result.stderr)
        self.assertNotIn("Traceback", render_result.stderr)
        self.assertTrue((self.repo / "docs" / "agents" / "workflow.md").is_file())
        self.assertEqual(diff_result.returncode, 0, diff_result.stderr)
        self.assertIn("FORM-DRIFT domain authority withheld", diff_result.stdout)
        self.assertIn("not a regular file", diff_result.stdout)
        self.assertIn(
            f"IDENTICAL {self.repo / 'docs' / 'agents' / 'workflow.md'}", diff_result.stdout
        )
        self.assertNotIn("Traceback", diff_result.stderr)

    def test_render_and_diff_withhold_a_context_map_target_control_character(self) -> None:
        values = self.write_values(
            "values.txt",
            self.full_values()
            .replace("none (confirmed absent)", "CONTEXT-MAP.md")
            .replace("docs/agents/domain.md", "none (select per invocation)")
            .replace("absent (fallback-required)", "present (map-available)"),
        )
        (self.repo / "CONTEXT-MAP.md").write_text(
            "## Contexts\n\n- [Orders](./contexts/CONTEXT\x00.md)\n", encoding="utf-8"
        )

        render_result = self.run_render(values)
        diff_result = self.run_diff(values)

        self.assertEqual(render_result.returncode, 0, render_result.stderr)
        self.assertIn("WITHHELD", render_result.stderr)
        self.assertIn("glossary target contains a control character", render_result.stderr)
        self.assertTrue((self.repo / "docs" / "agents" / "workflow.md").is_file())
        self.assertEqual(diff_result.returncode, 0, diff_result.stderr)
        self.assertIn("FORM-DRIFT domain authority withheld", diff_result.stdout)
        self.assertIn("glossary target contains a control character", diff_result.stdout)
        self.assertNotIn("Traceback", diff_result.stderr)

    def test_render_withholds_a_malformed_context_map_but_writes_unrelated_playbooks(self) -> None:
        (self.repo / "CONTEXT-MAP.md").write_text("## Contexts\n", encoding="utf-8")
        values = self.write_values(
            "values.txt",
            self.full_values()
            .replace("none (confirmed absent)", "CONTEXT-MAP.md")
            .replace("docs/agents/domain.md", "none (select per invocation)")
            .replace("absent (fallback-required)", "present (map-available)"),
        )

        result = self.run_render(values)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("WITHHELD", result.stderr)
        self.assertIn("no contextual glossaries listed", result.stderr)
        docs = self.repo / "docs" / "agents"
        self.assertFalse((docs / "domain.md").exists())
        self.assertTrue((docs / "workflow.md").is_file())

    def test_render_refuses_a_context_map_glossary_outside_the_repository(self) -> None:
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "CONTEXT.md").write_text("# Outside\n", encoding="utf-8")
        source = self.repo / "src"
        source.mkdir()
        (source / "context").symlink_to(outside, target_is_directory=True)
        (self.repo / "CONTEXT-MAP.md").write_text(
            "## Contexts\n\n- [Outside](./src/context/CONTEXT.md)\n", encoding="utf-8"
        )
        values = self.write_values(
            "values.txt",
            self.full_values()
            .replace("none (confirmed absent)", "CONTEXT-MAP.md")
            .replace("docs/agents/domain.md", "none (select per invocation)")
            .replace("absent (fallback-required)", "present (map-available)"),
        )

        result = self.run_render(values)

        self.assertEqual(result.returncode, 1)
        self.assertIn("resolves outside the repository", result.stderr)
        self.assertFalse((self.repo / "docs" / "agents").exists())

    def test_render_withholds_a_fixed_map_selection(self) -> None:
        glossary = self.repo / "contexts" / "Orders" / "CONTEXT.md"
        glossary.parent.mkdir(parents=True)
        glossary.write_text("# Orders\n", encoding="utf-8")
        (self.repo / "CONTEXT-MAP.md").write_text(
            "## Contexts\n\n- [Orders](./contexts/Orders/CONTEXT.md)\n", encoding="utf-8"
        )
        values = self.write_values(
            "values.txt",
            self.full_values()
            .replace("none (confirmed absent)", "CONTEXT-MAP.md")
            .replace("docs/agents/domain.md", "contexts/Orders/CONTEXT.md")
            .replace("absent (fallback-required)", "present (map-available)"),
        )

        result = self.run_render(values)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("WITHHELD", result.stderr)
        self.assertIn(
            "requires DOMAIN_AUTHORITY_PATH = none (select per invocation)", result.stderr
        )
        docs = self.repo / "docs" / "agents"
        self.assertFalse((docs / "domain.md").exists())
        self.assertTrue((docs / "workflow.md").is_file())

    def test_diff_reports_invalid_domain_authority_and_unrelated_playbooks(self) -> None:
        values = self.write_values(
            "values.txt",
            self.full_values().replace("absent (fallback-required)", "absent"),
        )

        result = self.run_diff(values)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("FORM-DRIFT domain authority withheld", result.stdout)
        self.assertNotIn(f"MISSING {self.repo / 'docs' / 'agents' / 'domain.md'}", result.stdout)
        self.assertIn(f"MISSING {self.repo / 'docs' / 'agents' / 'workflow.md'}", result.stdout)

    def test_diff_reports_invalid_handoff_declaration_and_fallback_content(self) -> None:
        values = self.write_values("values.txt", self.full_values())
        self.run_render(values)
        domain = self.repo / "docs" / "agents" / "domain.md"
        domain.write_text(
            domain.read_text(encoding="utf-8").replace(
                "- Context map: `none (confirmed absent)`",
                "- Context map: `CONTEXT-MAP.md`",
            ),
            encoding="utf-8",
        )

        declaration_result = self.run_diff(values)

        self.assertIn("exact Context map handoff declaration", declaration_result.stdout)
        domain.write_text(
            domain.read_text(encoding="utf-8")
            .replace("- Context map: `CONTEXT-MAP.md`", "- Context map: `none (confirmed absent)`")
            .replace(
                DOMAIN_AUTHORITY_END,
                "## Language\n\n**Order**:\nA request.\n" + DOMAIN_AUTHORITY_END,
            ),
            encoding="utf-8",
        )

        fallback_result = self.run_diff(values)

        self.assertIn("non-authoritative empty authority region", fallback_result.stdout)

    def test_render_and_diff_withhold_invalid_fallback_established_authority(self) -> None:
        values = self.write_values(
            "values.txt",
            self.full_values().replace(
                "absent (fallback-required)", "present (fallback-established)"
            ),
        )
        cases = {
            "fake-heading": "Mention ## Language\n\n**Order**:\nA request.\n",
            "fenced-fake-heading": "```md\n## Language\n\n**Order**:\nA request.\n```\n",
            "commented-fake-glossary": "<!--\n## Language\n\n**Order**:\nA request.\n-->\n",
            "unclosed-commented-fake-glossary": "<!--\n## Language\n\n**Order**:\nA request.\n",
            "commented-fake-term": "## Language\n\n<!-- **Order**:\nA request.\n-->\n",
            "mismatched-fence-heading": "```md\n~~~\n## Language\n\n**Order**:\nA request.\n```\n",
            "trailing-fence-text": "```md\n```still-code\n## Language\n\n**Order**:\nA request.\n```\n",
            "short-closing-fence": "````md\n```\n## Language\n\n**Order**:\nA request.\n````\n",
            "empty-definition": "## Language\n\n**Order**:\n\n_Avoid_: Purchase\n",
            "blank-term": "## Language\n\n**   **:\nA request.\n",
            "too-many-sentences": "## Language\n\n**Order**:\nOne. Two. Three.\n",
        }
        for name, authority in cases.items():
            with self.subTest(name=name):
                self.write_assets()
                domain_asset = self.assets / "domain.md"
                domain_asset.write_text(
                    domain_asset.read_text(encoding="utf-8").replace(
                        DOMAIN_AUTHORITY_END, authority + DOMAIN_AUTHORITY_END
                    ),
                    encoding="utf-8",
                )

                render_result = self.run_render(values)
                diff_result = self.run_diff(values)

                self.assertEqual(render_result.returncode, 0, render_result.stderr)
                self.assertIn("WITHHELD", render_result.stderr)
                self.assertTrue((self.repo / "docs" / "agents" / "workflow.md").is_file())
                self.assertEqual(diff_result.returncode, 0, diff_result.stderr)
                self.assertIn("FORM-DRIFT domain authority withheld", diff_result.stdout)
                self.assertNotIn(
                    f"MISSING {self.repo / 'docs' / 'agents' / 'domain.md'}", diff_result.stdout
                )
                for path in (self.repo / "docs" / "agents").glob("*.md"):
                    path.unlink()

    def test_render_and_diff_withhold_invalid_utf8_domain_authority(self) -> None:
        values = self.write_values("values.txt", self.full_values())
        docs = self.repo / "docs" / "agents"
        docs.mkdir(parents=True)
        (docs / "domain.md").write_bytes(b"\xff")

        render_result = self.run_render(values)
        diff_result = self.run_diff(values)

        self.assertEqual(render_result.returncode, 0, render_result.stderr)
        self.assertIn("WITHHELD", render_result.stderr)
        self.assertIn("expected UTF-8 text", render_result.stderr)
        self.assertNotIn("Traceback", render_result.stderr)
        self.assertTrue((docs / "workflow.md").is_file())
        self.assertEqual(diff_result.returncode, 0, diff_result.stderr)
        self.assertIn(f"DIFFERS {docs / 'domain.md'}", diff_result.stdout)
        self.assertIn("is not valid UTF-8 text", diff_result.stdout)
        self.assertNotIn("Traceback", diff_result.stderr)

    def test_diff_reports_fallback_established_without_a_glossary(self) -> None:
        values = self.write_values("values.txt", self.full_values())
        self.run_render(values)
        domain = self.repo / "docs" / "agents" / "domain.md"
        domain.write_text(
            domain.read_text(encoding="utf-8").replace(
                "absent (fallback-required)", "present (fallback-established)"
            ),
            encoding="utf-8",
        )
        established_values = self.write_values(
            "established-values.txt",
            self.full_values().replace(
                "absent (fallback-required)", "present (fallback-established)"
            ),
        )

        result = self.run_diff(established_values)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("fallback-established requires a populated glossary", result.stdout)

    def test_missing_token_errors(self) -> None:
        values = self.write_values("values.txt", "TRACKER_CAPABILITY_STATE = unsupported\n")

        result = self.run_render(values)

        self.assertEqual(result.returncode, 1)
        self.assertIn("missing value for token WORKING_BASE", result.stderr)
        self.assertFalse((self.repo / "docs" / "agents").exists())

    def test_missing_authority_token_with_existing_contract_is_controlled(self) -> None:
        self.run_render(self.write_values("initial-values.txt", self.full_values()))
        values = self.write_values(
            "values.txt",
            self.full_values().replace("DOMAIN_AUTHORITY_PATH = docs/agents/domain.md\n", ""),
        )

        result = self.run_render(values)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("WITHHELD", result.stderr)
        self.assertIn("missing value for token DOMAIN_AUTHORITY_PATH", result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_extra_token_errors(self) -> None:
        values = self.write_values("values.txt", self.full_values() + "UNUSED_TOKEN = something\n")

        result = self.run_render(values)

        self.assertEqual(result.returncode, 1)
        self.assertIn("unused token in values file: UNUSED_TOKEN", result.stderr)

    def test_invalid_capability_state_errors(self) -> None:
        values = self.write_values(
            "values.txt",
            self.full_values().replace(
                "TRACKER_CAPABILITY_STATE = unsupported", "TRACKER_CAPABILITY_STATE = blocked"
            ),
        )

        result = self.run_render(values)

        self.assertEqual(result.returncode, 1)
        self.assertIn("invalid capability state for TRACKER_CAPABILITY_STATE", result.stderr)

    def test_marker_survives_verbatim(self) -> None:
        values = self.write_values("values.txt", self.full_values())

        result = self.run_render(values)

        self.assertEqual(result.returncode, 0, result.stderr)
        quality = (self.repo / "docs" / "agents" / "quality.md").read_text(encoding="utf-8")
        self.assertIn("{{FOCUSED_VALIDATION_COMMANDS}}", quality)

    def test_existing_owned_file_is_never_overwritten(self) -> None:
        values = self.write_values("values.txt", self.full_values())
        docs_dir = self.repo / "docs" / "agents"
        docs_dir.mkdir(parents=True)
        domain_content = (
            "# Hand-written\n\n"
            "- Domain authority: `docs/agents/domain.md`\n"
            "- Context map: `none (confirmed absent)`\n\n"
            + DOMAIN_AUTHORITY_START
            + "\nAuthority state: absent (fallback-required)\n"
            + DOMAIN_AUTHORITY_END
            + "\n"
        )
        (docs_dir / "domain.md").write_text(domain_content, encoding="utf-8")

        result = self.run_render(values)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((docs_dir / "domain.md").read_text(encoding="utf-8"), domain_content)
        self.assertNotIn("WITHHELD", result.stderr)

    def test_diff_reports_identical_for_a_freshly_rendered_tree(self) -> None:
        values = self.write_values("values.txt", self.full_values())
        self.run_render(values)

        result = self.run_diff(values)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("IDENTICAL", result.stdout)
        self.assertNotIn("DIFFERS", result.stdout)

    def test_diff_reports_differs_after_a_hand_edit(self) -> None:
        values = self.write_values("values.txt", self.full_values())
        self.run_render(values)
        (self.repo / "docs" / "agents" / "domain.md").write_text(
            "edited by hand\n", encoding="utf-8"
        )

        result = self.run_diff(values)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("FORM-DRIFT malformed domain authority contract", result.stdout)

    def test_diff_preserves_a_populated_domain_authority_region(self) -> None:
        values = self.write_values("values.txt", self.full_values())
        self.run_render(values)
        domain = self.repo / "docs" / "agents" / "domain.md"
        content = domain.read_text(encoding="utf-8").replace(
            DOMAIN_AUTHORITY_START
            + "\nAuthority state: absent (fallback-required)\n"
            + DOMAIN_AUTHORITY_END,
            DOMAIN_AUTHORITY_START
            + "\nAuthority state: present (fallback-established)\n\n## Language\n\n**Order**:\nA request.\n\n"
            + DOMAIN_AUTHORITY_END,
        )
        domain.write_text(content, encoding="utf-8")

        established_values = self.write_values(
            "established-values.txt",
            self.full_values().replace(
                "absent (fallback-required)", "present (fallback-established)"
            ),
        )
        result = self.run_diff(established_values)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"IDENTICAL {domain}", result.stdout)

    def test_render_withholds_a_malformed_domain_authority_template(self) -> None:
        values = self.write_values("values.txt", self.full_values())
        (self.assets / "domain.md").write_text(
            "# Domain\n- Domain authority: `{{DOMAIN_AUTHORITY_PATH}}`\n"
            "- Context map: `{{CONTEXT_MAP_PATH}}`\n{{DOMAIN_AUTHORITY_STATE}}\n",
            encoding="utf-8",
        )

        result = self.run_render(values)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("WITHHELD", result.stderr)
        self.assertIn("malformed domain authority template", result.stderr)
        docs = self.repo / "docs" / "agents"
        self.assertFalse((docs / "domain.md").exists())
        self.assertTrue((docs / "workflow.md").is_file())

    def test_render_withholds_embedded_domain_authority_markers(self) -> None:
        values = self.write_values("values.txt", self.full_values())
        docs = self.repo / "docs" / "agents"
        docs.mkdir(parents=True)
        domain = docs / "domain.md"
        domain.write_text(
            "prefix " + DOMAIN_AUTHORITY_START + "\n" + DOMAIN_AUTHORITY_END + " suffix\n",
            encoding="utf-8",
        )

        result = self.run_render(values)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("WITHHELD", result.stderr)
        self.assertIn("expected exactly one start marker", result.stderr)
        self.assertTrue((docs / "workflow.md").is_file())

    def test_render_withholds_duplicate_or_reversed_domain_authority_markers(self) -> None:
        values = self.write_values("values.txt", self.full_values())
        cases = {
            "duplicate": DOMAIN_AUTHORITY_START
            + "\n"
            + DOMAIN_AUTHORITY_START
            + "\n"
            + DOMAIN_AUTHORITY_END
            + "\n",
            "reversed": DOMAIN_AUTHORITY_END + "\n" + DOMAIN_AUTHORITY_START + "\n",
        }
        for name, content in cases.items():
            with self.subTest(name=name):
                docs = self.repo / "docs" / "agents"
                docs.mkdir(parents=True, exist_ok=True)
                domain = docs / "domain.md"
                domain.write_text(content, encoding="utf-8")

                result = self.run_render(values)

                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("WITHHELD", result.stderr)
                self.assertTrue(
                    "expected exactly one start marker" in result.stderr
                    or "authority markers are not ordered" in result.stderr
                )
                self.assertTrue((docs / "workflow.md").is_file())
                domain.unlink()

    def test_diff_accepts_crlf_domain_authority_markers(self) -> None:
        values = self.write_values("values.txt", self.full_values())
        self.run_render(values)
        domain = self.repo / "docs" / "agents" / "domain.md"
        domain.write_bytes(domain.read_bytes().replace(b"\n", b"\r\n"))

        result = self.run_diff(values)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"IDENTICAL {domain}", result.stdout)

    def test_render_withholds_a_legacy_domain_contract_without_markers(self) -> None:
        values = self.write_values("values.txt", self.full_values())
        docs = self.repo / "docs" / "agents"
        docs.mkdir(parents=True)
        domain = docs / "domain.md"
        domain.write_text("# Legacy domain contract\n", encoding="utf-8")

        result = self.run_render(values)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("WITHHELD", result.stderr)
        self.assertIn("expected exactly one start marker", result.stderr)
        self.assertEqual(domain.read_text(encoding="utf-8"), "# Legacy domain contract\n")
        self.assertTrue((docs / "workflow.md").is_file())

    def test_routing_append_is_a_noop_when_block_already_present(self) -> None:
        (self.repo / "AGENTS.md").write_text("# Repo\n\n" + ROUTING_BLOCK, encoding="utf-8")
        before = (self.repo / "AGENTS.md").read_text(encoding="utf-8")

        result = self.run_script("routing", "--repo", str(self.repo), "--append")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("already present", result.stdout)
        self.assertEqual((self.repo / "AGENTS.md").read_text(encoding="utf-8"), before)

    def test_render_refuses_when_destination_resolves_outside_the_repo(self) -> None:
        outside = self.root / "outside"
        outside.mkdir()
        (self.repo / "docs").mkdir()
        (self.repo / "docs" / "agents").symlink_to(outside, target_is_directory=True)
        value_sets = (
            self.full_values(),
            self.full_values().replace("WORKING_BASE = main", "WORKING_BASE = "),
        )

        for content in value_sets:
            with self.subTest(malformed_values="WORKING_BASE = \n" in content):
                values = self.write_values("values.txt", content)

                result = self.run_render(values)

                self.assertEqual(result.returncode, 1)
                self.assertIn("resolves outside the repository", result.stderr)
                self.assertEqual(list(outside.iterdir()), [])

    def test_render_refuses_when_root_agents_md_is_absent(self) -> None:
        values = self.write_values("values.txt", self.full_values())
        (self.repo / "AGENTS.md").unlink()

        result = self.run_render(values)

        self.assertEqual(result.returncode, 1)
        self.assertIn("refused: root AGENTS.md is absent", result.stderr)
        self.assertFalse((self.repo / "docs" / "agents").exists())

    def test_render_refuses_on_an_empty_value(self) -> None:
        values = self.write_values(
            "values.txt", self.full_values().replace("WORKING_BASE = main\n", "WORKING_BASE = \n")
        )

        result = self.run_render(values)

        self.assertEqual(result.returncode, 1)
        self.assertIn("empty value for WORKING_BASE", result.stderr)
        self.assertFalse((self.repo / "docs" / "agents").exists())

    def test_routing_append_writes_the_block_verbatim(self) -> None:
        (self.repo / "AGENTS.md").write_text("# Repo\n\nBody.\n", encoding="utf-8")

        result = self.run_script(
            "routing", "--repo", str(self.repo), "--append", "--approve", "AGENTS.md"
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            (self.repo / "AGENTS.md").read_text(encoding="utf-8"),
            "# Repo\n\nBody.\n" + ROUTING_BLOCK,
        )

    def test_routing_append_separates_a_file_with_no_trailing_newline(self) -> None:
        (self.repo / "AGENTS.md").write_text("# Repo", encoding="utf-8")

        result = self.run_script(
            "routing", "--repo", str(self.repo), "--append", "--approve", "AGENTS.md"
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            (self.repo / "AGENTS.md").read_text(encoding="utf-8"),
            "# Repo\n" + ROUTING_BLOCK,
        )

    def test_diff_refuses_when_an_existing_playbook_resolves_outside_the_repo(self) -> None:
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "leak.md").write_text("SECRET\n", encoding="utf-8")
        docs = self.repo / "docs" / "agents"
        docs.mkdir(parents=True)
        (docs / "quality.md").symlink_to(outside / "leak.md")
        values = self.write_values("values.txt", self.full_values())

        result = self.run_diff(values)

        self.assertEqual(result.returncode, 1)
        self.assertIn("resolves outside the repository", result.stderr)
        self.assertNotIn("SECRET", result.stdout)

    def test_render_refuses_when_agents_md_resolves_outside_the_repo(self) -> None:
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "AGENTS.md").write_text("# Elsewhere\n", encoding="utf-8")
        (self.repo / "AGENTS.md").unlink()
        (self.repo / "AGENTS.md").symlink_to(outside / "AGENTS.md")
        values = self.write_values("values.txt", self.full_values())

        result = self.run_render(values)

        self.assertEqual(result.returncode, 1)
        self.assertIn("resolves outside the repository", result.stderr)
        self.assertFalse((self.repo / "docs").exists())

    def test_diff_reports_a_duplicated_routing_marker_as_a_difference(self) -> None:
        (self.repo / "AGENTS.md").write_text(
            "# Repo\n\n" + ROUTING_BLOCK + ROUTING_START + "\nunexpected\n",
            encoding="utf-8",
        )
        values = self.write_values("values.txt", self.full_values())

        result = self.run_diff(values)

        self.assertIn("DIFFERS", result.stdout)
        self.assertIn("unexpected", result.stdout)

    def test_diff_reports_an_invalid_value_as_form_drift_and_continues(self) -> None:
        broken = self.full_values().replace("WORKING_BASE = main", "WORKING_BASE = ")
        values = self.write_values("values.txt", broken)

        result = self.run_diff(values)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("FORM-DRIFT", result.stdout)
        self.assertIn("compare by hand", result.stdout)

    def test_routing_commands_refuse_when_agents_md_resolves_outside_the_repo(self) -> None:
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "AGENTS.md").write_text("# Elsewhere\n" + ROUTING_BLOCK, encoding="utf-8")
        (self.repo / "AGENTS.md").unlink()
        (self.repo / "AGENTS.md").symlink_to(outside / "AGENTS.md")

        for mode in ("--check", "--append"):
            with self.subTest(mode=mode):
                result = self.run_script("routing", "--repo", str(self.repo), mode)

                self.assertEqual(result.returncode, 1)
                self.assertIn("resolves outside the repository", result.stderr)

    def test_render_refuses_when_agents_md_is_a_directory(self) -> None:
        values = self.write_values("values.txt", self.full_values())
        (self.repo / "AGENTS.md").unlink()
        (self.repo / "AGENTS.md").mkdir()

        result = self.run_render(values)

        self.assertEqual(result.returncode, 1)
        self.assertIn("AGENTS.md is not a regular file", result.stderr)
        self.assertFalse((self.repo / "docs").exists())

    def test_render_refuses_existing_playbook_directory_before_writing(self) -> None:
        values = self.write_values("values.txt", self.full_values())
        docs = self.repo / "docs" / "agents"
        docs.mkdir(parents=True)
        (docs / "domain.md").mkdir()

        result = self.run_render(values)

        self.assertEqual(result.returncode, 1)
        self.assertIn("domain.md exists but is not a regular file", result.stderr)
        self.assertEqual(list(docs.iterdir()), [docs / "domain.md"])

    def test_diff_reports_existing_playbook_directory_as_form_drift(self) -> None:
        values = self.write_values("values.txt", self.full_values())
        docs = self.repo / "docs" / "agents"
        docs.mkdir(parents=True)
        (docs / "domain.md").mkdir()

        result = self.run_diff(values)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"DIFFERS {docs / 'domain.md'}", result.stdout)
        diagnostic = f"FORM-DRIFT {docs / 'domain.md'} is not a regular file"
        self.assertEqual(result.stdout.count(diagnostic), 1)

    def test_diff_reports_unrelated_markdown_directory_as_form_drift(self) -> None:
        values = self.write_values("values.txt", self.full_values())
        docs = self.repo / "docs" / "agents"
        docs.mkdir(parents=True)
        (docs / "extra.md").mkdir()

        result = self.run_diff(values)

        self.assertEqual(result.returncode, 0, result.stderr)
        diagnostic = f"FORM-DRIFT {docs / 'extra.md'} is not a regular file"
        self.assertEqual(result.stdout.count(diagnostic), 1)

    def test_diff_refuses_unrelated_file_resolving_outside_the_repo(self) -> None:
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "custom.md").write_text("SECRET\n", encoding="utf-8")
        docs = self.repo / "docs" / "agents"
        docs.mkdir(parents=True)
        (docs / "custom.md").symlink_to(outside / "custom.md")
        value_sets = (
            self.full_values(),
            self.full_values().replace("WORKING_BASE = main", "WORKING_BASE = "),
        )
        for content in value_sets:
            with self.subTest(malformed_values="WORKING_BASE = \n" in content):
                values = self.write_values("values.txt", content)

                result = self.run_diff(values)

                self.assertEqual(result.returncode, 1)
                self.assertIn("resolves outside the repository", result.stderr)
                self.assertNotIn("SECRET", result.stdout)

    def test_routing_append_refuses_when_agents_md_is_absent(self) -> None:
        (self.repo / "AGENTS.md").unlink()

        result = self.run_script("routing", "--repo", str(self.repo), "--append")

        self.assertEqual(result.returncode, 1)
        self.assertIn("refused: AGENTS.md does not exist", result.stderr)
        self.assertFalse((self.repo / "AGENTS.md").exists())

    def test_routing_append_refuses_against_a_hand_edited_block(self) -> None:
        hand_edited = ROUTING_BLOCK.replace(
            "## Workflow Contracts", "## Workflow Contracts (edited)"
        )
        (self.repo / "AGENTS.md").write_text("# Repo\n\n" + hand_edited, encoding="utf-8")
        before = (self.repo / "AGENTS.md").read_text(encoding="utf-8")

        result = self.run_script("routing", "--repo", str(self.repo), "--append")

        self.assertEqual(result.returncode, 1)
        self.assertIn("refused: AGENTS.md carries a routing block that differs", result.stderr)
        self.assertEqual((self.repo / "AGENTS.md").read_text(encoding="utf-8"), before)

    def test_routing_check_exits_2_on_a_differing_block(self) -> None:
        hand_edited = ROUTING_BLOCK.replace(
            "## Workflow Contracts", "## Workflow Contracts (edited)"
        )
        (self.repo / "AGENTS.md").write_text("# Repo\n\n" + hand_edited, encoding="utf-8")

        result = self.run_script("routing", "--repo", str(self.repo), "--check")

        self.assertEqual(result.returncode, 2)
        self.assertIn("differs", result.stdout)

    def test_routing_append_refuses_on_a_stray_start_marker(self) -> None:
        content = "# Repo\n\n<!-- setup-workflow-routing:start -->\n\nsome text\n"
        (self.repo / "AGENTS.md").write_text(content, encoding="utf-8")

        result = self.run_script("routing", "--repo", str(self.repo), "--append")

        self.assertEqual(result.returncode, 1)
        self.assertIn("refused: malformed routing markers in AGENTS.md", result.stderr)
        self.assertEqual((self.repo / "AGENTS.md").read_text(encoding="utf-8"), content)

    def test_update_writes_an_approved_contract_change_and_preserves_recorded_values(self) -> None:
        values = self.write_values("values.txt", self.full_values())
        self.run_render(values)
        (self.assets / "workflow.md").write_text(
            (self.assets / "workflow.md").read_text(encoding="utf-8")
            + "\n## New Section\n\nFixed text.\n",
            encoding="utf-8",
        )

        result = self.run_update(values, "workflow.md")

        self.assertEqual(result.returncode, 0, result.stderr)
        workflow = (self.repo / "docs" / "agents" / "workflow.md").read_text(encoding="utf-8")
        self.assertIn("## New Section", workflow)
        self.assertIn("Fixed text.", workflow)
        self.assertIn("main", workflow)
        self.assertNotIn("{{WORKING_BASE}}", workflow)

    def test_update_refuses_a_section_the_contract_does_not_define(self) -> None:
        values = self.write_values("values.txt", self.full_values())
        docs = self.repo / "docs" / "agents"
        docs.mkdir(parents=True)
        content = (
            "# Quality\n\n## Local Notes\n\nconsumer content\n\n{{FOCUSED_VALIDATION_COMMANDS}}\n"
        )
        (docs / "quality.md").write_text(content, encoding="utf-8")

        result = self.run_update(values, "quality.md")

        self.assertEqual(result.returncode, 1)
        self.assertIn("has a section the contract does not define", result.stderr)
        self.assertIn("## Local Notes", result.stderr)
        self.assertEqual((docs / "quality.md").read_text(encoding="utf-8"), content)

    def test_update_refuses_a_marker_over_a_recorded_value(self) -> None:
        recorded = self.write_values(
            "recorded.txt",
            self.full_values().replace(
                "FOCUSED_VALIDATION_COMMANDS = <marker>",
                "FOCUSED_VALIDATION_COMMANDS = make check",
            ),
        )
        self.run_render(recorded)
        values = self.write_values("values.txt", self.full_values())

        result = self.run_update(values, "quality.md")

        self.assertEqual(result.returncode, 1)
        self.assertIn("would replace a recorded value with a marker", result.stderr)
        self.assertIn("FOCUSED_VALIDATION_COMMANDS", result.stderr)
        quality = (self.repo / "docs" / "agents" / "quality.md").read_text(encoding="utf-8")
        self.assertIn("make check", quality)

    def test_update_writes_nothing_without_approval(self) -> None:
        values = self.write_values("values.txt", self.full_values())
        self.run_render(values)
        workflow = self.repo / "docs" / "agents" / "workflow.md"
        (self.assets / "workflow.md").write_text(
            (self.assets / "workflow.md").read_text(encoding="utf-8") + "\n## New Section\n",
            encoding="utf-8",
        )
        before = workflow.read_text(encoding="utf-8")

        result = self.run_update(values)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"unapproved {workflow}", result.stdout)
        self.assertEqual(workflow.read_text(encoding="utf-8"), before)

    def test_update_reports_identical_and_writes_nothing(self) -> None:
        values = self.write_values("values.txt", self.full_values())
        self.run_render(values)
        docs = self.repo / "docs" / "agents"
        before = {path.name: path.read_text(encoding="utf-8") for path in docs.glob("*.md")}

        result = self.run_update(values, "workflow.md")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("IDENTICAL", result.stdout)
        after = {path.name: path.read_text(encoding="utf-8") for path in docs.glob("*.md")}
        self.assertEqual(before, after)

    def test_update_creates_a_missing_playbook_only_when_approved(self) -> None:
        values = self.write_values("values.txt", self.full_values())
        docs = self.repo / "docs" / "agents"
        docs.mkdir(parents=True)
        (docs / "quality.md").write_text(
            "# Quality\n\n{{FOCUSED_VALIDATION_COMMANDS}}\n", encoding="utf-8"
        )

        first = self.run_update(values)

        self.assertIn(f"MISSING {docs / 'workflow.md'}", first.stdout)
        self.assertFalse((docs / "workflow.md").exists())

        second = self.run_update(values, "workflow.md")

        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertTrue((docs / "workflow.md").is_file())

    def test_update_refuses_an_unknown_approval_name(self) -> None:
        values = self.write_values("values.txt", self.full_values())

        result = self.run_update(values, "nope.md")

        self.assertEqual(result.returncode, 1)
        self.assertIn("approval names an unknown file: nope.md", result.stderr)
        self.assertFalse((self.repo / "docs" / "agents").exists())

    def test_undefined_sections_ignores_headings_inside_fenced_blocks(self) -> None:
        module = load_setup_workflow()
        existing = "# Title\n\n```markdown\n## Summary\n```\n"
        rendered = "# Title\n\n## Evidence\n"

        self.assertEqual(module.undefined_sections(existing, rendered), [])

    def test_undefined_sections_reports_a_heading_the_contract_lacks(self) -> None:
        module = load_setup_workflow()

        self.assertEqual(module.undefined_sections("# T\n\n## Extra\n", "# T\n"), ["## Extra"])

    def test_recorded_tokens_scopes_repeated_bullets_to_their_section(self) -> None:
        module = load_setup_workflow()
        template = "## A\n\n- state: {{A_STATE}}\n\n## B\n\n- state: {{B_STATE}}\n"
        existing = "## A\n\n- state: supported\n\n## B\n\n- state: {{B_STATE}}\n"

        self.assertEqual(module.recorded_tokens(template, existing), {"A_STATE"})

    def test_recorded_tokens_detects_a_value_on_a_reworded_contract_line(self) -> None:
        module = load_setup_workflow()
        template = "## C\n\nUse `{{PROVIDER}}` and open a draft.\n"
        existing = "## C\n\nUse `GitHub` and open a draft with no reviewers.\n"

        self.assertEqual(module.recorded_tokens(template, existing), {"PROVIDER"})

    def test_recorded_tokens_allows_a_new_marker_in_an_existing_section(self) -> None:
        module = load_setup_workflow()
        template = "## C\n\n- A: `{{A}}`\n- New: `{{NEW}}`\n"
        existing = "## C\n\n- A: `value`\n"

        self.assertEqual(module.recorded_tokens(template, existing), {"A"})

    def test_render_writes_nothing_without_approval(self) -> None:
        values = self.write_values("values.txt", self.full_values())

        result = self.run_render_unapproved(values)

        self.assertEqual(result.returncode, 0, result.stderr)
        agents = self.repo / "docs" / "agents"
        self.assertIn(f"MISSING {agents / 'workflow.md'}", result.stdout)
        self.assertFalse(agents.exists())

    def test_update_writes_approved_files_and_refuses_a_foreign_section_in_one_batch(self) -> None:
        values = self.write_values("values.txt", self.full_values())
        self.run_render(values)
        docs = self.repo / "docs" / "agents"
        quality = docs / "quality.md"
        quality.write_text(
            quality.read_text(encoding="utf-8") + "\n## Local Notes\n\nconsumer content\n",
            encoding="utf-8",
        )
        (self.assets / "workflow.md").write_text(
            (self.assets / "workflow.md").read_text(encoding="utf-8") + "\n## New Section\n",
            encoding="utf-8",
        )
        quality_before = quality.read_text(encoding="utf-8")

        result = self.run_update(values, "workflow.md", "quality.md")

        self.assertEqual(result.returncode, 1)
        self.assertIn("has a section the contract does not define", result.stderr)
        self.assertIn("## New Section", (docs / "workflow.md").read_text(encoding="utf-8"))
        self.assertEqual(quality.read_text(encoding="utf-8"), quality_before)

    def test_update_refuses_a_marker_when_a_sibling_token_on_the_line_changed(self) -> None:
        (self.assets / "quality.md").write_text(
            "# Quality\n\nFollow `{{TEST_CONVENTIONS}}`. Budgets are `{{TEST_EXECUTION_CONSTRAINTS}}`.\n",
            encoding="utf-8",
        )
        values_content = (
            "TRACKER_CAPABILITY_STATE = unsupported\n"
            "CONTEXT_MAP_PATH = none (confirmed absent)\n"
            "DOMAIN_AUTHORITY_PATH = docs/agents/domain.md\n"
            "DOMAIN_AUTHORITY_STATE = absent (fallback-required)\n"
            "WORKING_BASE = main\n"
            "COMMIT_CONVENTION = Conventional Commits\n"
            "TEST_CONVENTIONS = docs/agents/testing.md\n"
            "TEST_EXECUTION_CONSTRAINTS = docker compose up\n"
        )
        self.run_render(self.write_values("recorded.txt", values_content))
        marker_values = self.write_values(
            "marker.txt",
            values_content.replace(
                "TEST_CONVENTIONS = docs/agents/testing.md", "TEST_CONVENTIONS = pytest -n 5"
            ).replace(
                "TEST_EXECUTION_CONSTRAINTS = docker compose up",
                "TEST_EXECUTION_CONSTRAINTS = <marker>",
            ),
        )
        quality = self.repo / "docs" / "agents" / "quality.md"
        before = quality.read_text(encoding="utf-8")

        result = self.run_update(marker_values, "quality.md")

        self.assertEqual(result.returncode, 1)
        self.assertIn("would replace a recorded value with a marker", result.stderr)
        self.assertIn("TEST_EXECUTION_CONSTRAINTS", result.stderr)
        self.assertEqual(quality.read_text(encoding="utf-8"), before)

    def test_update_accepts_a_repo_relative_approval(self) -> None:
        values = self.write_values("values.txt", self.full_values())
        docs = self.repo / "docs" / "agents"
        docs.mkdir(parents=True)
        (docs / "quality.md").write_text(
            "# Quality\n\n{{FOCUSED_VALIDATION_COMMANDS}}\n", encoding="utf-8"
        )

        result = self.run_update(values, "docs/agents/workflow.md")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((docs / "workflow.md").is_file())

    def test_update_refuses_an_approval_that_names_a_different_path(self) -> None:
        values = self.write_values("values.txt", self.full_values())

        result = self.run_update(values, "/etc/workflow.md")

        self.assertEqual(result.returncode, 1)
        self.assertIn("approval names an unknown file: /etc/workflow.md", result.stderr)
        self.assertFalse((self.repo / "docs" / "agents").exists())

    def test_routing_append_refuses_without_approval(self) -> None:
        (self.repo / "AGENTS.md").write_text("# Repo\n", encoding="utf-8")
        before = (self.repo / "AGENTS.md").read_text(encoding="utf-8")

        result = self.run_script("routing", "--repo", str(self.repo), "--append")

        self.assertEqual(result.returncode, 1)
        self.assertIn("requires --approve AGENTS.md", result.stderr)
        self.assertEqual((self.repo / "AGENTS.md").read_text(encoding="utf-8"), before)

    def test_update_rewrites_the_domain_shell_and_preserves_the_authority_region(self) -> None:
        values = self.write_values("values.txt", self.full_values())
        self.run_render(values)
        domain = self.repo / "docs" / "agents" / "domain.md"
        domain.write_text(
            domain.read_text(encoding="utf-8").replace(
                DOMAIN_AUTHORITY_START
                + "\nAuthority state: absent (fallback-required)\n"
                + DOMAIN_AUTHORITY_END,
                DOMAIN_AUTHORITY_START
                + "\nAuthority state: present (fallback-established)\n\n## Language\n\n**Order**:\nA request.\n\n"
                + DOMAIN_AUTHORITY_END,
            ),
            encoding="utf-8",
        )
        established = self.write_values(
            "established.txt",
            self.full_values().replace(
                "absent (fallback-required)", "present (fallback-established)"
            ),
        )
        (self.assets / "domain.md").write_text(
            (self.assets / "domain.md")
            .read_text(encoding="utf-8")
            .replace(
                "- Context map: `{{CONTEXT_MAP_PATH}}`\n",
                "- Context map: `{{CONTEXT_MAP_PATH}}`\n\nAdded contract line.\n",
            ),
            encoding="utf-8",
        )
        region_before = domain.read_text(encoding="utf-8").split(DOMAIN_AUTHORITY_START)[1]

        result = self.run_update(established, "domain.md")

        self.assertEqual(result.returncode, 0, result.stderr)
        updated = domain.read_text(encoding="utf-8")
        self.assertIn("Added contract line.", updated)
        self.assertIn("Authority state: present (fallback-established)", updated)
        self.assertEqual(updated.split(DOMAIN_AUTHORITY_START)[1], region_before)


if __name__ == "__main__":
    unittest.main()
