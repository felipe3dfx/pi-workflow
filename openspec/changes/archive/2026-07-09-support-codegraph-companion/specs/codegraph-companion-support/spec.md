# CodeGraph Companion Support Specification

## Purpose

Define CodeGraph companion visibility, readiness diagnostics, setup guidance, and runtime baseline expectations for `pi-workflow`.

## Requirements

### Requirement: Recommended CodeGraph Companion

The system MUST treat CodeGraph as a recommended companion package while preserving the explicit user-controlled companion installation model.

#### Scenario: CodeGraph companion is missing

- GIVEN the user checks companion status without the CodeGraph companion installed
- WHEN companion status is displayed
- THEN CodeGraph MUST appear as recommended and missing
- AND the output MUST NOT imply that CodeGraph was auto-installed

#### Scenario: CodeGraph companion is installed

- GIVEN the CodeGraph companion package is installed
- WHEN companion status is displayed
- THEN CodeGraph MUST appear as installed or available
- AND other companion status entries MUST remain unchanged

### Requirement: CodeGraph Readiness Diagnostics

The system MUST report CodeGraph readiness separately for the companion package, the CodeGraph CLI, and the current project's index state.

#### Scenario: CLI is unavailable

- GIVEN the CodeGraph companion is expected but the `codegraph` CLI is not available on `PATH`
- WHEN diagnostics run
- THEN the report MUST identify the missing CLI as a readiness gap
- AND the report SHOULD include concise setup guidance

#### Scenario: Project index is missing

- GIVEN the CodeGraph CLI is available but the current project has no CodeGraph index
- WHEN diagnostics run in that project
- THEN the report MUST identify the missing project index as a readiness gap
- AND the report SHOULD guide the user to initialize the index explicitly

#### Scenario: CodeGraph is ready

- GIVEN the companion package, CLI, and project index are available
- WHEN diagnostics run
- THEN the report MUST show CodeGraph as ready
- AND it MUST NOT report false warnings for other companions

### Requirement: README Setup Guidance

The README MUST document the recommended CodeGraph setup flow, including companion installation, CLI availability, project indexing, and how to verify readiness.

#### Scenario: User follows setup documentation

- GIVEN a user reads the main README installation guidance
- WHEN they look for CodeGraph support
- THEN the README MUST explain the required companion and CLI prerequisites
- AND it MUST describe how to verify readiness with project diagnostics

#### Scenario: User cannot use CodeGraph yet

- GIVEN a user is on an environment that does not meet CodeGraph prerequisites
- WHEN they read the setup guidance
- THEN the README SHOULD make the prerequisite gap clear before installation attempts

### Requirement: Node Baseline Alignment

The package metadata, documentation, and validation behavior MUST align on Node.js `>=22.19` as the supported baseline.

#### Scenario: Package baseline is inspected

- GIVEN package metadata or README requirements are inspected
- WHEN the supported Node.js version is shown
- THEN the baseline MUST be `>=22.19`

#### Scenario: Package validation runs

- GIVEN package validation runs against the project metadata
- WHEN the Node.js baseline is checked
- THEN validation MUST accept `>=22.19` as the expected minimum
- AND it MUST fail or warn on lower declared baselines according to existing validation severity conventions
