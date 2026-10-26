# ADR 0024: Process-tree membership by recorded process groups

## Status

Acceptance: approval and merge of the introducing PR.

## Decision

Amends: ADR-0023, only its accepted risks that process-tree membership is the `PI_WORKFLOW_PROCESS_TREE` environment mark and that macOS termination is unverified.

Where `/proc` is absent, as on macOS, a child's process tree is every live process that carries the child's environment mark or belongs to a process group recorded for the child, and every process whose parent or group leader is a member. Only there are groups recorded at these points:

- the child Pi's own group when it starts, and the groups of the tree's members when the child becomes ready and when each run ends;
- the group of each command shell of the child's bash, by the command prefix before the command runs, on its first line so the line numbers the shell reports stay unchanged;
- the groups of every child tree's members every 500 ms, by the parent's watchdog.

Where records are used, a group is named by its leader's pid and recorded with the leader's start time. A live process with that pid and another start time has reused the number and is not a member; the watchdog drops a record whose number was reused or whose group it sees empty for a minute. The sweep stops the members, reads them again, and kills them all, repeating until none is left or the tree deadline passes. The records live in a private temporary directory of the parent process, and the sweeps remove them.

macOS strips the environment of platform binaries such as `/bin/sh`, `/bin/bash` and `sleep` from the arguments the kernel exposes, and `ps -E` cannot read the environment of a process that changes its title, Pi included. With the mark alone the sweep found neither the child Pi nor the shells it starts, reported a clean tree and left them running. A process keeps its group when it is orphaned, and a group's number is not reused while the group has members. Linux uses the environment mark alone, unchanged from ADR 0023: no recorded groups, recording or membership closure.

## Considered Options

- Documenting macOS as a known limit, as for Windows. Not adopted: the Owner chose to close the gap in #301.
- Polling alone. Not adopted: a shell that starts a background job and exits leaves an orphan within milliseconds, before any poll sees it; the command prefix records that group before the command runs.
- Reading the kernel's process arguments with a native helper. Not adopted: it finds a retitled Pi, but not platform binaries, whose environment the kernel strips, and it adds a native build.

## Consequences

Accepted risks:

- Where `/proc` is absent, a process whose environment is unreadable, that starts a group or session of its own, and that is orphaned before a recording point sees it escapes the sweep, such as a detached process an MCP server starts and abandons within 500 ms of a child crash.
- Where records are used, a recorded group whose number is reused by an unrelated group leader that exits while its group lives, all within one watchdog interval, is swept. Pruning runs wherever records are used, bounding the stale-record risk by that interval.
- Where `/proc` is absent, the watchdog lists every process every 500 ms while a child tree is recorded: about 13 ms per listing with 750 processes. Each command of a child's bash lists its own shell once.
- Where `/proc` is absent, the 500 ms interval delays the watchdog's notice of a parent death by up to that long within the two-second tree deadline.
