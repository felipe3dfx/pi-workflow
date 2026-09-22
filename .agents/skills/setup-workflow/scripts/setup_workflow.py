#!/usr/bin/env python3
"""Render, diff, and route setup-workflow's docs/agents/ playbooks."""

from __future__ import annotations

import argparse
import difflib
import re
import sys
import unicodedata
from pathlib import Path
from typing import NoReturn

MARKER = "<marker>"
CAPABILITY_STATES = {"supported", "requires-setup", "unsupported", MARKER}
TRACKER_CHOICES = ("github", "gitlab", "linear", "local-markdown", "none")
SHARED_TEMPLATES = ("domain.md", "workflow.md", "quality.md", "pull-requests.md")
ROUTING_START = "<!-- setup-workflow-routing:start -->"
ROUTING_END = "<!-- setup-workflow-routing:end -->"
DOMAIN_AUTHORITY_START = "<!-- domain-modeling:authority:start -->"
DOMAIN_AUTHORITY_END = "<!-- domain-modeling:authority:end -->"
AUTHORITY_STATES = {
    "present (map-available)",
    "present (root-selected)",
    "absent (fallback-required)",
    "present (fallback-established)",
}
CONFIRMED_ABSENT = "none (confirmed absent)"
SELECTION_REQUIRED = "none (select per invocation)"
CONTEXT_MAP_NAME = "CONTEXT-MAP.md"
CONTEXT_GLOSSARY_NAME = "CONTEXT.md"
CONTEXTS_HEADING = re.compile(r"^##\s+Contexts\s*$", re.IGNORECASE)
SECOND_LEVEL_HEADING = re.compile(r"^##(?:\s|$)")
CONTEXT_ENTRY = re.compile(r"^\s*[-*+]\s+\[([^\]]+)\]\(([^)\s]+)\)(?:\s+.*)?$")
DOMAIN_AUTHORITY_DECLARATION = re.compile(r"^- Domain authority: `([^`]+)`$")
CONTEXT_MAP_DECLARATION = re.compile(r"^- Context map: `([^`]+)`$")
AUTHORITY_STATE_DECLARATION = re.compile(r"^Authority state: (.+)$")
GLOSSARY_TERM = re.compile(r"^\*\*(?=\S)[^*\n]*\S\*\*:$")
LANGUAGE_HEADING = re.compile(r"^##\s+Language\s*$")
FENCE = re.compile(r"^\s*(`{3,}|~{3,})")
SENTENCE = re.compile(r"[^.!?]+[.!?](?=\s|$)", re.DOTALL)
SCRIPT_ASSETS = Path(__file__).resolve().parent.parent / "assets"


class DomainAuthorityError(Exception):
    pass


TOKEN_LINE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$")
PLACEHOLDER = re.compile(r"\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}")
HEADING = re.compile(r"^#{1,6}\s+\S.*$")


def refuse(message: str) -> NoReturn:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def contained(path: Path, repo: Path) -> bool:
    return path.resolve().is_relative_to(repo.resolve())


def require_contained(paths: list[Path], repo: Path) -> None:
    for path in paths:
        if not contained(path, repo):
            refuse(f"refused: {path} resolves outside the repository")


def parse_values(path: Path) -> tuple[dict[str, str], list[str]]:
    values: dict[str, str] = {}
    errors: list[str] = []
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        match = TOKEN_LINE.match(line)
        if match is None:
            errors.append(f"{path}:{line_number}: malformed line")
            continue
        token = match.group(1)
        value = match.group(2).strip()
        if not value:
            errors.append(
                f"{path}:{line_number}: empty value for {token}; "
                "a value is an unresolved marker, none (confirmed absent), or a candidate"
            )
            continue
        values[token] = value
    return values, errors


def tokens_in(text: str) -> set[str]:
    return set(PLACEHOLDER.findall(text))


def selected_templates(tracker: str) -> tuple[str, ...]:
    return (f"issue-tracker-{tracker}.md", *SHARED_TEMPLATES)


def target_name(template_name: str) -> str:
    if template_name.startswith("issue-tracker-"):
        return "issue-tracker.md"
    return template_name


def validate(
    template_tokens: set[str], values: dict[str, str], allowed_tokens: set[str] | None = None
) -> list[str]:
    errors: list[str] = []
    for token in sorted(template_tokens - values.keys()):
        errors.append(f"missing value for token {token}")
    for token in sorted(values.keys() - (allowed_tokens or template_tokens)):
        errors.append(f"unused token in values file: {token}")
    for token in sorted(template_tokens):
        if token.endswith("_CAPABILITY_STATE") and token in values:
            value = values[token]
            if value not in CAPABILITY_STATES:
                errors.append(f"invalid capability state for {token}: {value!r}")
    return errors


def render_text(text: str, values: dict[str, str]) -> str:
    def replace(match: re.Match[str]) -> str:
        value = values[match.group(1)]
        return match.group(0) if value == MARKER else value

    return PLACEHOLDER.sub(replace, text)


def fence_annotated_lines(text: str) -> list[tuple[str, bool]]:
    """Pair every line with whether it is ordinary text rather than code or a fence."""
    annotated: list[tuple[str, bool]] = []
    fence: tuple[str, int] | None = None
    for line in text.splitlines():
        match = FENCE.match(line)
        if match is not None:
            marker = match.group(1)
            if fence is None:
                fence = (marker[0], len(marker))
            elif (
                marker[0] == fence[0]
                and len(marker) >= fence[1]
                and re.fullmatch(rf"\s*{re.escape(fence[0])}{{{fence[1]},}}\s*", line)
            ):
                fence = None
            annotated.append((line, False))
            continue
        annotated.append((line, fence is None))
    return annotated


def section_headings(text: str) -> list[str]:
    return [
        line.rstrip()
        for line, ordinary in fence_annotated_lines(text)
        if ordinary and HEADING.match(line)
    ]


def undefined_sections(existing: str, rendered: str) -> list[str]:
    defined = set(section_headings(rendered))
    return list(
        dict.fromkeys(heading for heading in section_headings(existing) if heading not in defined)
    )


def sections(text: str) -> list[tuple[str | None, list[str]]]:
    result: list[tuple[str | None, list[str]]] = []
    heading: str | None = None
    body: list[str] = []
    for line, ordinary in fence_annotated_lines(text):
        if ordinary and HEADING.match(line):
            result.append((heading, body))
            heading = line.rstrip()
            body = []
            continue
        body.append(line)
    result.append((heading, body))
    return result


def placeholder_matcher(line: str) -> tuple[re.Pattern[str], list[str], list[str]] | None:
    tokens = PLACEHOLDER.findall(line)
    if not tokens:
        return None
    names = [f"group{index}" for index in range(len(tokens))]
    pattern = ""
    position = 0
    for index, match in enumerate(PLACEHOLDER.finditer(line)):
        pattern += re.escape(line[position : match.start()])
        pattern += f"(?P<{names[index]}>.*?)"
        position = match.end()
    pattern += re.escape(line[position:])
    return re.compile(rf"^{pattern}$"), tokens, names


def prefix_records_token(line: str, token: str, bodies: list[list[str]]) -> bool:
    """Whether a reworded contract line still shows a concrete value for the token."""
    prefix = line[: line.find("{{" + token + "}}")]
    if not prefix.strip() or PLACEHOLDER.search(prefix):
        return False
    for body in bodies:
        for existing_line in body:
            if not existing_line.startswith(prefix):
                continue
            remainder = existing_line[len(prefix) :].strip()
            if remainder and remainder != "{{" + token + "}}" and not remainder.startswith("{{"):
                return True
    return False


def recorded_tokens(template: str, existing: str) -> set[str]:
    """Token names the existing playbook fills with a concrete value in the template's section."""
    template_sections = sections(template)
    existing_by_heading: dict[str | None, list[list[str]]] = {}
    for heading, body in sections(existing):
        existing_by_heading.setdefault(heading, []).append(body)
    recorded: set[str] = set()
    for heading, body in template_sections:
        matchers = [pattern for line in body if (pattern := placeholder_matcher(line)) is not None]
        bodies = existing_by_heading.get(heading, [])
        for existing_body in bodies:
            for pattern, tokens, names in matchers:
                for existing_line in existing_body:
                    match = pattern.match(existing_line)
                    if match is None:
                        continue
                    for index, token in enumerate(tokens):
                        value = match.group(names[index]).strip()
                        if value and value != "{{" + token + "}}":
                            recorded.add(token)
    for heading, body in template_sections:
        bodies = existing_by_heading.get(heading, [])
        if not bodies:
            continue
        for line in body:
            for token in tokens_in(line):
                if token not in recorded and prefix_records_token(line, token, bodies):
                    recorded.add(token)
    return recorded


def marker_regressions(rendered: str, existing: str, values: dict[str, str]) -> list[str]:
    markers = {token for token, value in values.items() if value == MARKER}
    if not markers:
        return []
    return sorted(markers & recorded_tokens(rendered, existing))


def render_templates(
    assets: Path,
    values: dict[str, str],
    tracker: str,
    templates: tuple[str, ...] | None = None,
) -> tuple[dict[str, str], list[str]]:
    all_templates = selected_templates(tracker)
    chosen_templates = templates or all_templates
    texts = {name: (assets / name).read_text(encoding="utf-8") for name in chosen_templates}
    template_tokens: set[str] = set()
    allowed_tokens: set[str] = set()
    for name in all_templates:
        allowed_tokens |= tokens_in((assets / name).read_text(encoding="utf-8"))
    for text in texts.values():
        template_tokens |= tokens_in(text)
    errors = validate(template_tokens, values, allowed_tokens)
    if errors:
        return {}, errors
    return {target_name(name): render_text(text, values) for name, text in texts.items()}, []


def approved_target_names(approvals: list[str], targets: set[str]) -> set[str]:
    approved: set[str] = set()
    for value in approvals:
        candidate = value.strip()
        matched = next(
            (
                name
                for name in sorted(targets)
                if candidate in (name, f"docs/agents/{name}", f"./docs/agents/{name}")
            ),
            None,
        )
        if matched is None:
            refuse(f"refused: approval names an unknown file: {candidate}")
        approved.add(matched)
    return approved


def cmd_render(
    assets: Path, values_path: Path, tracker: str, repo: Path, approvals: list[str]
) -> int:
    agents_md = repo / "AGENTS.md"
    require_contained([agents_md], repo)
    if not agents_md.exists():
        refuse("refused: root AGENTS.md is absent; the run stops before any write (step 2)")
    if not agents_md.is_file():
        refuse("refused: root AGENTS.md is not a regular file")
    docs_dir = repo / "docs" / "agents"
    expected_targets = {
        target_name(template): docs_dir / target_name(template)
        for template in selected_templates(tracker)
    }
    require_contained([docs_dir, *expected_targets.values()], repo)
    if docs_dir.exists() and not docs_dir.is_dir():
        refuse(f"refused: {docs_dir} exists but is not a directory")
    if docs_dir.exists():
        require_contained(list(docs_dir.glob("*.md")), repo)
    for target in expected_targets.values():
        if target.exists() and not target.is_file():
            refuse(f"refused: {target} exists but is not a regular file")
    approved = approved_target_names(approvals, set(expected_targets))
    domain_target = expected_targets["domain.md"]
    values, errors = parse_values(values_path)
    authority_errors = authority_value_errors(values, repo)
    unrelated_templates = tuple(name for name in selected_templates(tracker) if name != "domain.md")
    rendered, render_errors = render_templates(assets, values, tracker, unrelated_templates)
    for error in errors + render_errors:
        print(error, file=sys.stderr)
    if errors or render_errors:
        raise SystemExit(1)

    domain_reason: str | None = None
    if authority_errors:
        domain_reason = "; ".join(authority_errors)
    elif domain_target.exists():
        try:
            domain_content = domain_target.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            domain_reason = "expected UTF-8 text"
        else:
            domain_reason = domain_contract_error(domain_content, values, repo)
    else:
        domain_rendered, domain_reason = domain_template_rendering(assets, values, tracker, repo)
        if domain_reason is None:
            rendered.update(domain_rendered)
    if domain_reason is not None:
        print(f"WITHHELD {domain_target}: {domain_reason}", file=sys.stderr)

    targets = {name: expected_targets[name] for name in rendered}
    written: list[Path] = []
    skipped: list[Path] = []
    unapproved: list[Path] = []
    for name, content in rendered.items():
        target = targets[name]
        if target.exists():
            skipped.append(target)
            continue
        if name not in approved:
            unapproved.append(target)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        written.append(target)
    for target in written:
        print(f"wrote {target}")
    for target in skipped:
        print(f"skipped (exists) {target}")
    for target in unapproved:
        print(f"MISSING {target} (no approval; not written)")
    return 0


def domain_marker_offsets(content: str) -> tuple[list[int], list[int]]:
    starts: list[int] = []
    ends: list[int] = []
    offset = 0
    for line in content.splitlines(keepends=True):
        marker = line.rstrip("\r\n")
        if marker == DOMAIN_AUTHORITY_START:
            starts.append(offset)
        if marker == DOMAIN_AUTHORITY_END:
            ends.append(offset)
        offset += len(line)
    return starts, ends


def repository_path(path: Path, repo: Path) -> str:
    require_contained([path], repo)
    return path.relative_to(repo).as_posix()


def root_glossary_candidates(repo: Path) -> list[Path]:
    return sorted(
        (
            path
            for path in repo.iterdir()
            if path.name.casefold() == CONTEXT_GLOSSARY_NAME.casefold()
        ),
        key=lambda path: path.name,
    )


def authority_value_errors(values: dict[str, str], repo: Path | None) -> list[str]:
    required = ("CONTEXT_MAP_PATH", "DOMAIN_AUTHORITY_PATH", "DOMAIN_AUTHORITY_STATE")
    missing = [token for token in required if token not in values]
    if missing:
        return [f"missing value for token {token}" for token in missing]
    state = values["DOMAIN_AUTHORITY_STATE"]
    if state not in AUTHORITY_STATES:
        return [f"invalid domain authority state: {state!r}"]
    authority_path = values["DOMAIN_AUTHORITY_PATH"]
    map_path = values["CONTEXT_MAP_PATH"]
    fallback_path = "docs/agents/domain.md"
    if state == "present (map-available)":
        if authority_path != SELECTION_REQUIRED:
            return [
                f"present (map-available) requires DOMAIN_AUTHORITY_PATH = {SELECTION_REQUIRED}"
            ]
    elif state == "present (root-selected)":
        if authority_path == fallback_path:
            return [f"{state} requires an external DOMAIN_AUTHORITY_PATH"]
    elif authority_path != fallback_path:
        return [f"{state} requires DOMAIN_AUTHORITY_PATH = {fallback_path}"]
    if repo is None:
        return []
    maps = context_map_candidates(repo)
    roots = root_glossary_candidates(repo)
    require_contained([*maps, *roots], repo)
    if state == "present (map-available)":
        if len(maps) != 1 or maps[0].name != CONTEXT_MAP_NAME:
            return ["present (map-available) requires exactly one valid root CONTEXT-MAP.md"]
        try:
            parse_context_map(maps[0], repo)
        except DomainAuthorityError as error:
            return [str(error)]
        expected_map = repository_path(maps[0], repo)
        if map_path != expected_map:
            return [f"present (map-available) requires CONTEXT_MAP_PATH = {expected_map}"]
    elif state == "present (root-selected)":
        if maps:
            return ["present (root-selected) requires no root CONTEXT-MAP.md"]
        if len(roots) != 1 or not roots[0].is_file():
            return ["present (root-selected) requires exactly one root CONTEXT.md"]
        expected_root = repository_path(roots[0], repo)
        if map_path != CONFIRMED_ABSENT:
            return [f"present (root-selected) requires CONTEXT_MAP_PATH = {CONFIRMED_ABSENT}"]
        if authority_path != expected_root:
            return [f"present (root-selected) requires DOMAIN_AUTHORITY_PATH = {expected_root}"]
    else:
        if maps:
            return [f"{state} requires no root CONTEXT-MAP.md"]
        if roots:
            return [f"{state} requires no root CONTEXT.md"]
        if map_path != CONFIRMED_ABSENT:
            return [f"{state} requires CONTEXT_MAP_PATH = {CONFIRMED_ABSENT}"]
    return []


def domain_contract_error(content: str, values: dict[str, str], repo: Path) -> str | None:
    starts, ends = domain_marker_offsets(content)
    if len(starts) != 1 or len(ends) != 1:
        return "expected exactly one start marker and one end marker on their own lines"
    if starts[0] > ends[0]:
        return "authority markers are not ordered"
    lines = content.splitlines()
    authority_declarations = [
        match.group(1) for line in lines if (match := DOMAIN_AUTHORITY_DECLARATION.fullmatch(line))
    ]
    map_declarations = [
        match.group(1) for line in lines if (match := CONTEXT_MAP_DECLARATION.fullmatch(line))
    ]
    if (
        len(authority_declarations) != 1
        or authority_declarations[0] != values["DOMAIN_AUTHORITY_PATH"]
    ):
        return "expected one exact Domain authority handoff declaration"
    if len(map_declarations) != 1 or map_declarations[0] != values["CONTEXT_MAP_PATH"]:
        return "expected one exact Context map handoff declaration"
    region = content[starts[0] + len(DOMAIN_AUTHORITY_START) : ends[0]].replace("\r\n", "\n")
    region_lines = region.strip("\n").split("\n")
    if not region_lines:
        return "authority region has no state declaration"
    state_match = AUTHORITY_STATE_DECLARATION.fullmatch(region_lines[0])
    if state_match is None or state_match.group(1) != values["DOMAIN_AUTHORITY_STATE"]:
        return "authority region state does not exactly match the handoff"
    state = values["DOMAIN_AUTHORITY_STATE"]
    remainder = "\n".join(region_lines[1:]).strip()
    if state == "present (fallback-established)":
        if not has_populated_glossary(remainder):
            return "fallback-established requires a populated glossary in the authority region"
    elif remainder:
        return f"{state} requires a non-authoritative empty authority region"
    return None


def has_populated_glossary(content: str) -> bool:
    lines: list[str] = []
    fence: tuple[str, int] | None = None
    in_comment = False
    for line in content.splitlines():
        visible = ""
        index = 0
        while index < len(line):
            if in_comment:
                end = line.find("-->", index)
                if end == -1:
                    index = len(line)
                    continue
                in_comment = False
                index = end + 3
                continue
            start = line.find("<!--", index)
            if start == -1:
                visible += line[index:]
                break
            visible += line[index:start]
            in_comment = True
            index = start + 4
        match = FENCE.match(visible)
        if match is not None:
            marker = match.group(1)
            if fence is None:
                fence = (marker[0], len(marker))
            elif marker[0] == fence[0] and len(marker) >= fence[1]:
                closing = re.fullmatch(rf"\s*{re.escape(fence[0])}{{{fence[1]},}}\s*", visible)
                if closing is not None:
                    fence = None
            continue
        if fence is None:
            lines.append(visible)
    try:
        language_start = next(
            index for index, line in enumerate(lines) if LANGUAGE_HEADING.fullmatch(line.strip())
        )
    except StopIteration:
        return False

    index = language_start + 1
    while index < len(lines):
        line = lines[index]
        if SECOND_LEVEL_HEADING.match(line.strip()):
            break
        if GLOSSARY_TERM.fullmatch(line.strip()):
            definition: list[str] = []
            index += 1
            while index < len(lines):
                candidate = lines[index].strip()
                if SECOND_LEVEL_HEADING.match(candidate) or GLOSSARY_TERM.fullmatch(candidate):
                    break
                if candidate.startswith("_Avoid_"):
                    break
                if candidate:
                    definition.append(candidate)
                index += 1
            text = " ".join(definition)
            sentences = SENTENCE.findall(text)
            if sentences and len(sentences) <= 2 and "".join(sentences).strip() == text:
                return True
            continue
        index += 1
    return False


def domain_template_rendering(
    assets: Path, values: dict[str, str], tracker: str, repo: Path
) -> tuple[dict[str, str], str | None]:
    domain_rendered, domain_errors = render_templates(assets, values, tracker, ("domain.md",))
    if domain_errors:
        return {}, "; ".join(domain_errors)
    template_error = domain_contract_error(domain_rendered["domain.md"], values, repo)
    if template_error is not None:
        return {}, f"malformed domain authority template: {template_error}"
    return domain_rendered, None


def domain_shell(content: str) -> str:
    starts, ends = domain_marker_offsets(content)
    start = starts[0] + len(DOMAIN_AUTHORITY_START)
    end = ends[0]
    return content[:start] + content[end:]


def report_file_diff(
    rendered: str, existing_path: Path, values: dict[str, str], repo: Path
) -> None:
    if not existing_path.exists():
        print(f"MISSING {existing_path}")
        return
    if not existing_path.is_file():
        print(f"DIFFERS {existing_path}")
        print(f"FORM-DRIFT {existing_path} is not a regular file")
        return
    try:
        existing = existing_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        print(f"DIFFERS {existing_path}")
        print(f"FORM-DRIFT {existing_path} is not valid UTF-8 text")
        return
    if existing_path.name == "domain.md":
        error = domain_contract_error(existing, values, repo)
        if error is not None:
            print(f"DIFFERS {existing_path}")
            print(f"FORM-DRIFT malformed domain authority contract: {error}")
            return
        existing = domain_shell(existing)
        rendered = domain_shell(rendered)
    rendered_lines = rendered.splitlines(keepends=True)
    existing_lines = existing.splitlines(keepends=True)
    if rendered_lines == existing_lines:
        print(f"IDENTICAL {existing_path}")
        return
    print(f"DIFFERS {existing_path}")
    sys.stdout.writelines(
        difflib.unified_diff(
            existing_lines, rendered_lines, fromfile=str(existing_path), tofile="rendered"
        )
    )


def extract_routing_block(content: str) -> str | None:
    start = content.find(ROUTING_START)
    end = content.find(ROUTING_END)
    if start == -1 or end == -1 or end < start:
        return None
    return content[start : end + len(ROUTING_END)]


def load_canonical_routing_block(assets: Path) -> str:
    content = (assets / "routing-block.md").read_text(encoding="utf-8")
    block = extract_routing_block(content)
    if block is None:
        print(f"{assets / 'routing-block.md'} is missing its start/end markers", file=sys.stderr)
        raise SystemExit(1)
    return block


def report_routing_diff(assets: Path, repo: Path) -> None:
    canonical = load_canonical_routing_block(assets)
    agents_path = repo / "AGENTS.md"
    label = f"{agents_path} (routing block)"
    if agents_path.exists() and not agents_path.is_file():
        print(f"DIFFERS {label}")
        print(f"FORM-DRIFT {agents_path} is not a regular file")
        return
    content = agents_path.read_text(encoding="utf-8") if agents_path.exists() else ""
    state = routing_block_state(content, canonical)
    if state == "absent":
        print(f"MISSING {label}")
        return
    if state == "present":
        print(f"IDENTICAL {label}")
        return
    existing_block = content if state == "malformed" else extract_routing_block(content) or content
    print(f"DIFFERS {label}")
    sys.stdout.writelines(
        difflib.unified_diff(
            existing_block.splitlines(keepends=True),
            canonical.splitlines(keepends=True),
            fromfile=str(agents_path),
            tofile="routing-block.md",
        )
    )


def report_surviving_placeholders(docs_dir: Path, repo: Path, expected_paths: set[Path]) -> None:
    if not docs_dir.exists():
        return
    for path in sorted(docs_dir.glob("*.md")):
        require_contained([path], repo)
        if not path.is_file():
            if path not in expected_paths:
                print(f"FORM-DRIFT {path} is not a regular file")
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            print(f"FORM-DRIFT {path} is not valid UTF-8 text")
            continue
        for token in sorted(tokens_in(content)):
            print(f"PLACEHOLDER {path} {{{{{token}}}}}")


def cmd_diff(assets: Path, values_path: Path, tracker: str, repo: Path) -> int:
    docs_dir = repo / "docs" / "agents"
    require_contained([repo / "AGENTS.md", docs_dir], repo)
    if docs_dir.exists():
        require_contained(list(docs_dir.glob("*.md")), repo)
    values, errors = parse_values(values_path)
    unrelated_templates = tuple(name for name in selected_templates(tracker) if name != "domain.md")
    rendered, render_errors = render_templates(assets, values, tracker, unrelated_templates)
    for error in errors + render_errors:
        print(f"FORM-DRIFT {error}")
    if errors or render_errors:
        print("compare by hand; the values file cannot render")
        return 0
    domain_target = docs_dir / "domain.md"
    authority_errors = authority_value_errors(values, repo)
    if authority_errors:
        for error in authority_errors:
            print(f"FORM-DRIFT domain authority withheld: {error}")
    elif domain_target.exists():
        domain_rendered, domain_errors = render_templates(assets, values, tracker, ("domain.md",))
        if domain_errors:
            for error in domain_errors:
                print(f"FORM-DRIFT domain authority withheld: {error}")
        else:
            rendered.update(domain_rendered)
    else:
        domain_rendered, domain_reason = domain_template_rendering(assets, values, tracker, repo)
        if domain_reason is not None:
            print(f"FORM-DRIFT domain authority withheld: {domain_reason}")
        else:
            rendered.update(domain_rendered)
    expected_paths = {docs_dir / name for name in rendered}
    require_contained(list(expected_paths), repo)
    for name in sorted(rendered):
        report_file_diff(rendered[name], docs_dir / name, values, repo)

    report_routing_diff(assets, repo)
    report_surviving_placeholders(docs_dir, repo, expected_paths)
    return 0


def domain_update_content(
    assets: Path, values: dict[str, str], tracker: str, repo: Path, target: Path
) -> str | None:
    authority_errors = authority_value_errors(values, repo)
    if authority_errors:
        print(f"WITHHELD {target}: {'; '.join(authority_errors)}", file=sys.stderr)
        return None
    domain_rendered, domain_errors = render_templates(assets, values, tracker, ("domain.md",))
    if domain_errors:
        print(f"WITHHELD {target}: {'; '.join(domain_errors)}", file=sys.stderr)
        return None
    rendered = domain_rendered["domain.md"]
    if not target.exists():
        return rendered
    try:
        existing = target.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        print(f"WITHHELD {target}: expected UTF-8 text", file=sys.stderr)
        return None
    error = domain_contract_error(existing, values, repo)
    if error is not None:
        print(f"WITHHELD {target}: {error}", file=sys.stderr)
        return None
    starts, ends = domain_marker_offsets(existing)
    region = existing[starts[0] + len(DOMAIN_AUTHORITY_START) : ends[0]]
    shell = domain_shell(rendered)
    return shell.replace(
        DOMAIN_AUTHORITY_START + DOMAIN_AUTHORITY_END,
        DOMAIN_AUTHORITY_START + region + DOMAIN_AUTHORITY_END,
        1,
    )


def cmd_update(
    assets: Path, values_path: Path, tracker: str, repo: Path, approvals: list[str]
) -> int:
    agents_md = repo / "AGENTS.md"
    require_contained([agents_md], repo)
    if not agents_md.exists():
        refuse("refused: root AGENTS.md is absent; the run stops before any write (step 2)")
    if not agents_md.is_file():
        refuse("refused: root AGENTS.md is not a regular file")
    docs_dir = repo / "docs" / "agents"
    expected_targets = {
        target_name(template): docs_dir / target_name(template)
        for template in selected_templates(tracker)
    }
    require_contained([docs_dir, *expected_targets.values()], repo)
    if docs_dir.exists() and not docs_dir.is_dir():
        refuse(f"refused: {docs_dir} exists but is not a directory")
    if docs_dir.exists():
        require_contained(list(docs_dir.glob("*.md")), repo)
    for target in expected_targets.values():
        if target.exists() and not target.is_file():
            refuse(f"refused: {target} exists but is not a regular file")

    values, value_errors = parse_values(values_path)
    template_texts = {
        target_name(template): (assets / template).read_text(encoding="utf-8")
        for template in selected_templates(tracker)
    }
    unrelated = tuple(name for name in selected_templates(tracker) if name != "domain.md")
    rendered, render_errors = render_templates(assets, values, tracker, unrelated)
    for error in value_errors + render_errors:
        print(error, file=sys.stderr)
    if value_errors or render_errors:
        raise SystemExit(1)

    approved = approved_target_names(approvals, set(expected_targets))

    refusals: list[Path] = []
    for name in sorted(expected_targets):
        target = expected_targets[name]
        if name == "domain.md":
            desired = domain_update_content(assets, values, tracker, repo, target)
            if desired is None:
                continue
        else:
            desired = rendered[name]
        if not target.exists():
            if name in approved:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(desired, encoding="utf-8")
                print(f"wrote {target}")
            else:
                print(f"MISSING {target} (no approval; not written)")
            continue
        try:
            existing = target.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            print(f"refused: {target} is not valid UTF-8 text; nothing written", file=sys.stderr)
            refusals.append(target)
            continue
        if name == "domain.md":
            guard_existing = domain_shell(existing)
            guard_desired = domain_shell(desired)
        else:
            guard_existing = existing
            guard_desired = desired
        extra = undefined_sections(guard_existing, guard_desired)
        if extra:
            print(
                f"refused: {target} has a section the contract does not define: "
                f"{', '.join(extra)}; nothing written",
                file=sys.stderr,
            )
            refusals.append(target)
            continue
        if existing == desired:
            print(f"IDENTICAL {target}")
            continue
        print(f"DIFFERS {target}")
        sys.stdout.writelines(
            difflib.unified_diff(
                guard_existing.splitlines(keepends=True),
                guard_desired.splitlines(keepends=True),
                fromfile=str(target),
                tofile="rendered",
            )
        )
        if name not in approved:
            print(f"unapproved {target}: not written")
            continue
        regressions = marker_regressions(template_texts[name], guard_existing, values)
        if regressions:
            print(
                f"refused: {target} would replace a recorded value with a marker: "
                f"{', '.join(regressions)}; nothing written",
                file=sys.stderr,
            )
            refusals.append(target)
            continue
        target.write_text(desired, encoding="utf-8")
        print(f"updated {target}")
    return 1 if refusals else 0


def context_map_candidates(repo: Path) -> list[Path]:
    return sorted(
        (path for path in repo.iterdir() if path.name.casefold() == CONTEXT_MAP_NAME.casefold()),
        key=lambda path: path.name,
    )


def parse_context_map(map_path: Path, repo: Path) -> list[tuple[str, Path]]:
    if not map_path.is_file():
        raise DomainAuthorityError(f"malformed context map {map_path}: not a regular file")
    try:
        lines = map_path.read_text(encoding="utf-8").splitlines()
    except UnicodeDecodeError:
        raise DomainAuthorityError(
            f"malformed context map {map_path}: expected UTF-8 text"
        ) from None

    heading_lines = [
        line_number
        for line_number, line in enumerate(lines, start=1)
        if CONTEXTS_HEADING.fullmatch(line.strip())
    ]
    if len(heading_lines) != 1:
        raise DomainAuthorityError(
            f"malformed context map {map_path}: expected exactly one '## Contexts' heading"
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
                f"malformed context map {map_path}:{line_number}: expected a Markdown glossary link"
            )
        label, target = entry.groups()
        if any(unicodedata.category(character) == "Cc" for character in label):
            raise DomainAuthorityError(
                f"malformed context map {map_path}:{line_number}: context label contains a control character"
            )
        if any(unicodedata.category(character) == "Cc" for character in target):
            raise DomainAuthorityError(
                f"malformed context map {map_path}:{line_number}: glossary target contains a control character"
            )
        if not label.strip() or "#" in target or "?" in target or Path(target).is_absolute():
            raise DomainAuthorityError(
                f"malformed context map {map_path}:{line_number}: expected a relative glossary file link"
            )
        entries.append((label.strip(), map_path.parent / target))

    if not entries:
        raise DomainAuthorityError(
            f"malformed context map {map_path}: no contextual glossaries listed"
        )

    labels: set[str] = set()
    targets: set[str] = set()
    glossaries: list[tuple[str, Path]] = []
    for label, target in entries:
        folded_label = label.casefold()
        if folded_label in labels:
            raise DomainAuthorityError(
                f"ambiguous context map {map_path}: duplicate context label {label!r}"
            )
        labels.add(folded_label)
        require_contained([target], repo)
        if target.name.casefold() != CONTEXT_GLOSSARY_NAME.casefold() or not target.is_file():
            raise DomainAuthorityError(f"unreachable glossary entry in {map_path}: {target}")
        resolved_target = str(target.resolve()).casefold()
        if resolved_target in targets:
            raise DomainAuthorityError(
                f"ambiguous context map {map_path}: duplicate glossary {target}"
            )
        targets.add(resolved_target)
        glossaries.append((label, target))
    return glossaries


def cmd_context_map(repo: Path) -> int:
    if not repo.is_dir():
        refuse(f"refused: repository {repo} is not a directory")
    candidates = context_map_candidates(repo)
    if not candidates:
        print("absent")
        return 0
    require_contained(candidates, repo)
    if len(candidates) != 1 or candidates[0].name != CONTEXT_MAP_NAME:
        names = ", ".join(path.name for path in candidates)
        refuse(f"refused: ambiguous root context map names: {names}")
    map_path = candidates[0]
    if not map_path.is_file():
        refuse(f"refused: malformed context map {map_path}: not a regular file")
    try:
        glossaries = parse_context_map(map_path, repo)
    except DomainAuthorityError as error:
        refuse(f"refused: {error}")
        return 1
    print(f"map {map_path.relative_to(repo).as_posix()}")
    for label, glossary in glossaries:
        print(f"context {label}\t{glossary.relative_to(repo).as_posix()}")
    return 0


def routing_block_state(content: str, canonical: str) -> str:
    start_count = content.count(ROUTING_START)
    end_count = content.count(ROUTING_END)
    if start_count == 0 and end_count == 0:
        return "absent"
    if (
        start_count == 1
        and end_count == 1
        and content.find(ROUTING_START) < content.find(ROUTING_END)
    ):
        block = extract_routing_block(content)
        return "present" if block == canonical else "differs"
    return "malformed"


def cmd_routing(repo: Path, check: bool, append: bool, approvals: list[str]) -> int:
    canonical = load_canonical_routing_block(SCRIPT_ASSETS)
    agents_path = repo / "AGENTS.md"
    require_contained([agents_path], repo)
    exists = agents_path.exists()
    if exists and not agents_path.is_file():
        refuse("refused: AGENTS.md is not a regular file")
    content = agents_path.read_text(encoding="utf-8") if exists else ""
    state = routing_block_state(content, canonical)

    if check:
        if state == "absent":
            print("absent")
            return 1
        if state == "present":
            print("present")
            return 0
        print("differs")
        return 2

    if not exists:
        refuse("refused: AGENTS.md does not exist; resolve it first (step 2)")
    if state == "present":
        print(f"routing block already present in {agents_path}")
        return 0
    if state == "differs":
        refuse(
            "refused: AGENTS.md carries a routing block that differs from the "
            "canonical block; report it, never repair"
        )
    if state == "malformed":
        refuse("refused: malformed routing markers in AGENTS.md")

    if "AGENTS.md" not in {value.strip() for value in approvals}:
        refuse("refused: appending the routing block requires --approve AGENTS.md")

    with agents_path.open("a", encoding="utf-8") as handle:
        if content and not content.endswith("\n"):
            handle.write("\n")
        handle.write(canonical if canonical.endswith("\n") else canonical + "\n")
    print(f"appended routing block to {agents_path}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="setup_workflow.py",
        description="Render, diff, and route setup-workflow's docs/agents/ playbooks.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    render_parser = subparsers.add_parser("render")
    render_parser.add_argument("--assets", required=True, type=Path)
    render_parser.add_argument("--values", required=True, type=Path)
    render_parser.add_argument("--tracker", required=True, choices=TRACKER_CHOICES)
    render_parser.add_argument("--repo", required=True, type=Path)
    render_parser.add_argument("--approve", action="append", default=[], metavar="FILE")

    diff_parser = subparsers.add_parser("diff")
    diff_parser.add_argument("--assets", required=True, type=Path)
    diff_parser.add_argument("--values", required=True, type=Path)
    diff_parser.add_argument("--tracker", required=True, choices=TRACKER_CHOICES)
    diff_parser.add_argument("--repo", required=True, type=Path)

    update_parser = subparsers.add_parser("update")
    update_parser.add_argument("--assets", required=True, type=Path)
    update_parser.add_argument("--values", required=True, type=Path)
    update_parser.add_argument("--tracker", required=True, choices=TRACKER_CHOICES)
    update_parser.add_argument("--repo", required=True, type=Path)
    update_parser.add_argument("--approve", action="append", default=[], metavar="FILE")

    context_map_parser = subparsers.add_parser("context-map")
    context_map_parser.add_argument("--repo", required=True, type=Path)

    routing_parser = subparsers.add_parser("routing")
    routing_parser.add_argument("--repo", required=True, type=Path)
    routing_parser.add_argument("--approve", action="append", default=[], metavar="FILE")
    routing_group = routing_parser.add_mutually_exclusive_group(required=True)
    routing_group.add_argument("--check", action="store_true")
    routing_group.add_argument("--append", action="store_true")

    return parser


def main() -> int:
    arguments = build_parser().parse_args()
    if arguments.command == "render":
        return cmd_render(
            arguments.assets, arguments.values, arguments.tracker, arguments.repo, arguments.approve
        )
    if arguments.command == "diff":
        return cmd_diff(arguments.assets, arguments.values, arguments.tracker, arguments.repo)
    if arguments.command == "update":
        return cmd_update(
            arguments.assets, arguments.values, arguments.tracker, arguments.repo, arguments.approve
        )
    if arguments.command == "context-map":
        return cmd_context_map(arguments.repo)
    return cmd_routing(arguments.repo, arguments.check, arguments.append, arguments.approve)


if __name__ == "__main__":
    raise SystemExit(main())
