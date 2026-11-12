# Valuable Tests

A valuable test fails when behavior a caller depends on breaks, and passes through every change that leaves that behavior intact. This file is the rubric for that judgement: `tdd` writes tests against it, and the review's Valuable Tests axis grades a diff's tests against it.

The consumer's own testing standards take precedence over this rubric wherever they speak.

## Behavior at agreed seams

A test exercises the system through a public interface at a seam agreed before the test was written, and asserts what a caller can observe there: a returned result, a state the interface exposes, or an effect at a system boundary. Its name states a capability ("an expired card is declined"), not a mechanism ("calls the gateway twice").

A test that reaches past the seam, into a private method, an internal collaborator, or a storage row the interface never exposes, tests the implementation instead of the behavior.

Some changes have no seam of their own. A schema migration or other generated artifact is tested through the behavior it enables; a data migration with real transformation logic is tested at that transformation, once per rule it applies. A removal needs no test of the absence unless a caller or a requirement depends on it, such as an endpoint that must answer not found or a revoked permission: delete or update the tests of the retired behavior instead. A template or partial is tested through the view or flow that serves it.

## Four failure modes

Agent-written tests fail in four recognizable ways. The first three pass today and protect nothing tomorrow; the fourth protects behavior at a price every later change pays.

### Tautological

The expected value is derived the way the code derives it: the test recomputes the sum with the same reduction, rebuilds the string with the same template, or asserts a constant equal to itself. It passes by construction and can never disagree with the code it checks.

Expected values come from a source independent of the implementation: a known literal, a worked example, or a line of the specification.

### Structure-sensitive

The test breaks when the code changes form while behavior stays the same. Tells:

- asserting which internal function was called, how often, or in what order;
- testing a private method, or a helper the public interface already covers;
- snapshotting incidental structure, such as markup, object shape, or a declaration, that no caller depends on;
- asserting a query plan or a timing that no caller observes;
- a name that describes how the code works rather than what it guarantees.

A refactor that breaks such a test teaches nothing, and the cost of fixing it lands on the next change.

### Mocks that hide failure

A test double replaces something the code under test owns, or stands in for a boundary in a way that removes its failure behavior. Tells:

- mocking the team's own modules or internal collaborators instead of exercising them;
- a stubbed dependency that only ever succeeds, so the timeout, rejection, or malformed response the real boundary produces is never exercised;
- an assertion hidden inside the stub, so the test checks the call rather than the outcome;
- verifying through a side channel, such as querying the database after a write, instead of reading the result back through the interface.

Doubles belong at system boundaries the team does not control: external services, time, randomness, and sometimes storage or the file system. Where a boundary is doubled, at least one test drives its failure path through the public interface. A boundary passed in as a narrow, operation-specific interface needs no conditional logic inside its double; a generic fetcher does, and that logic is where tests start to lie.

### Cost out of proportion

Every test runs on every change for the life of the suite, so its cost recurs. A test is out of proportion when it pays for a mechanism the behavior does not need. The consumer's testing standards say what counts as expensive; otherwise, real transaction commits and the database cleanup they force, threads, sockets, subprocesses, and large data volumes do. Tells:

- an expensive mechanism where the behavior is observable without it, such as committing to observe a callback that can be captured inside the test's own transaction, or resetting database sequences no assertion reads;
- an expensive test parametrized over combinations of inputs, or over an axis that never changes the asserted outcome, when the invariant needs one case per outcome and the other cases can run at a cheaper seam;
- data far larger than the limit under test;
- a case another test already covers at the same or a cheaper seam, such as one contract repeated per surface or channel.

Place each pertinent case at the cheapest seam that observes it: input combinations, states, and rejections at a cheap seam, and the expensive mechanism only for the invariant that needs it, such as a real concurrent writer for a lock.

## Deeper modules, sturdier tests

A deep module hides rich behavior behind a small interface. Its tests are few, sit at that interface, and survive any rewrite of the inside. A shallow module, whose interface is as complicated as its implementation, pulls tests toward its internals, and they turn structure-sensitive. When valuable tests are hard to write, the seam is usually in the wrong place; that is a design finding, not a reason to test the internals.
