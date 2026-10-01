# Team Standards and Smell Baseline

The Standards axis reads this file in full, then the repository's `docs/agents/coding-standards.md` when it exists. Where the repository's standards speak to the same point as anything here, the repository's standards win and the point here is suppressed. Skip anything the repository's tooling already enforces, such as formatting, linting, or type rules.

## Team standards

Each standard is a hard violation when the diff breaks it, unless it is marked as a judgement call.

- **Simplest sufficient change.** The diff adds no wrapper, fallback, configuration, or indirection that no current requirement needs.
- **No compatibility layers.** An obsolete path is removed, not kept beside its replacement behind a flag, shim, alias, or migration, unless the ticket or specification requires the old path to keep working.
- **Surgical diff.** The diff reorders, reformats, or refactors nothing unrelated to the ticket.
- **Comments carry constraints.** An added comment states a constraint or invariant the code cannot show. A comment that restates a name, narrates the next line, or describes the change itself is a violation.
- **Existing dependencies first.** New code reuses what the project's dependencies already provide instead of reimplementing it or adding a package. Judgement call.

## Smell baseline

Every smell is a judgement call, never a hard violation: label it as possible ("possible Feature Envy") and quote the hunk. Each entry reads what the smell is, then the usual remedy.

- **Mysterious Name**: a name that does not reveal what the function, variable, or type does or holds. Rename it; when no honest name comes, the design is unclear.
- **Duplicated Code**: the same logic shape in more than one hunk or file of the change. Extract the shared shape and call it from both.
- **Feature Envy**: a function that works on another object's data more than its own. Move it to the data it uses.
- **Data Clumps**: the same few fields or parameters travelling together. Bundle them into one type.
- **Primitive Obsession**: a primitive or string standing in for a domain concept. Give the concept its own small type.
- **Repeated Switches**: the same conditional cascade on the same type in several places. Replace it with polymorphism or one shared map.
- **Shotgun Surgery**: one logical change scattered as edits across many files. Gather what changes together into one module.
- **Divergent Change**: one module edited for several unrelated reasons. Split it so each module changes for one reason.
- **Speculative Generality**: abstraction, parameters, or hooks for needs the ticket does not have. Delete them and inline until a real need appears.
- **Message Chains**: long navigation through a chain of objects the caller should not depend on. Hide the walk behind one method on the first object.
- **Middle Man**: a class or function that mostly delegates onward. Remove it and call the real target.
- **Refused Bequest**: a subtype that ignores or overrides most of what it inherits. Replace inheritance with composition.
