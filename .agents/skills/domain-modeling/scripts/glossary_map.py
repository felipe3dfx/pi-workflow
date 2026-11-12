#!/usr/bin/env python3
"""Validate a consumer's root GLOSSARY-MAP.md and list its contextual glossaries."""

from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from pathlib import Path
from typing import NoReturn

GLOSSARY_MAP_NAME = "GLOSSARY-MAP.md"
GLOSSARY_NAME = "GLOSSARY.md"
RETIRED_ROOT_NAMES = {"context.md": GLOSSARY_NAME, "context-map.md": GLOSSARY_MAP_NAME}
CONTEXTS_HEADING = re.compile(r"^##\s+Contexts\s*$", re.IGNORECASE)
SECOND_LEVEL_HEADING = re.compile(r"^##(?:\s|$)")
CONTEXT_ENTRY = re.compile(r"^\s*[-*+]\s+\[([^\]]+)\]\(([^)\s]+)\)(?:\s+.*)?$")


class DomainAuthorityError(Exception):
    pass


def refuse(message: str) -> NoReturn:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def contained(path: Path, repo: Path) -> bool:
    return path.resolve().is_relative_to(repo.resolve())


def require_contained(paths: list[Path], repo: Path) -> None:
    for path in paths:
        if not contained(path, repo):
            refuse(f"refused: {path} resolves outside the repository")


def retired_root_errors(repo: Path) -> list[str]:
    retired = sorted(
        (path for path in repo.iterdir() if path.name.casefold() in RETIRED_ROOT_NAMES),
        key=lambda path: path.name,
    )
    require_contained(retired, repo)
    return [
        f"retired root {path.name}: rename it to {RETIRED_ROOT_NAMES[path.name.casefold()]}"
        for path in retired
    ]


def glossary_map_candidates(repo: Path) -> list[Path]:
    return sorted(
        (path for path in repo.iterdir() if path.name.casefold() == GLOSSARY_MAP_NAME.casefold()),
        key=lambda path: path.name,
    )


def parse_glossary_map(map_path: Path, repo: Path) -> list[tuple[str, Path]]:
    if not map_path.is_file():
        raise DomainAuthorityError(f"malformed glossary map {map_path}: not a regular file")
    try:
        lines = map_path.read_text(encoding="utf-8").splitlines()
    except UnicodeDecodeError:
        raise DomainAuthorityError(
            f"malformed glossary map {map_path}: expected UTF-8 text"
        ) from None

    heading_lines = [
        line_number
        for line_number, line in enumerate(lines, start=1)
        if CONTEXTS_HEADING.fullmatch(line.strip())
    ]
    if len(heading_lines) != 1:
        raise DomainAuthorityError(
            f"malformed glossary map {map_path}: expected exactly one '## Contexts' heading"
        )

    entries: list[tuple[str, Path]] = []
    for line_number, line in enumerate(lines[heading_lines[0] :], start=heading_lines[0] + 1):
        stripped = line.strip()
        if SECOND_LEVEL_HEADING.match(stripped):
            break
        if not stripped:
            continue
        entry = CONTEXT_ENTRY.fullmatch(line)
        if entry is None:
            raise DomainAuthorityError(
                f"malformed glossary map {map_path}:{line_number}: expected a Markdown glossary link"
            )
        label, target = entry.groups()
        if any(unicodedata.category(character) == "Cc" for character in label):
            raise DomainAuthorityError(
                f"malformed glossary map {map_path}:{line_number}: context label contains a control character"
            )
        if any(unicodedata.category(character) == "Cc" for character in target):
            raise DomainAuthorityError(
                f"malformed glossary map {map_path}:{line_number}: glossary target contains a control character"
            )
        if not label.strip() or "#" in target or "?" in target or Path(target).is_absolute():
            raise DomainAuthorityError(
                f"malformed glossary map {map_path}:{line_number}: expected a relative glossary file link"
            )
        entries.append((label.strip(), map_path.parent / target))

    if not entries:
        raise DomainAuthorityError(
            f"malformed glossary map {map_path}: no contextual glossaries listed"
        )

    labels: set[str] = set()
    targets: set[str] = set()
    glossaries: list[tuple[str, Path]] = []
    for label, target in entries:
        folded_label = label.casefold()
        if folded_label in labels:
            raise DomainAuthorityError(
                f"ambiguous glossary map {map_path}: duplicate context label {label!r}"
            )
        labels.add(folded_label)
        require_contained([target], repo)
        if target.name.casefold() != GLOSSARY_NAME.casefold() or not target.is_file():
            raise DomainAuthorityError(f"unreachable glossary entry in {map_path}: {target}")
        resolved_target = str(target.resolve()).casefold()
        if resolved_target in targets:
            raise DomainAuthorityError(
                f"ambiguous glossary map {map_path}: duplicate glossary {target}"
            )
        targets.add(resolved_target)
        glossaries.append((label, target))
    return glossaries


def cmd_glossary_map(repo: Path) -> int:
    if not repo.is_dir():
        refuse(f"refused: repository {repo} is not a directory")
    retired_errors = retired_root_errors(repo)
    if retired_errors:
        refuse(f"refused: {'; '.join(retired_errors)}")
    candidates = glossary_map_candidates(repo)
    if not candidates:
        print("absent")
        return 0
    require_contained(candidates, repo)
    if len(candidates) != 1 or candidates[0].name != GLOSSARY_MAP_NAME:
        names = ", ".join(path.name for path in candidates)
        refuse(f"refused: ambiguous root glossary map names: {names}")
    map_path = candidates[0]
    if not map_path.is_file():
        refuse(f"refused: malformed glossary map {map_path}: not a regular file")
    try:
        glossaries = parse_glossary_map(map_path, repo)
    except DomainAuthorityError as error:
        refuse(f"refused: {error}")
        return 1
    print(f"map {map_path.relative_to(repo).as_posix()}")
    for label, glossary in glossaries:
        print(f"context {label}\t{glossary.relative_to(repo).as_posix()}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="glossary_map.py",
        description="Validate a root GLOSSARY-MAP.md and list its contextual glossaries.",
    )
    parser.add_argument("--repo", required=True, type=Path)
    return cmd_glossary_map(parser.parse_args().repo)


if __name__ == "__main__":
    raise SystemExit(main())
