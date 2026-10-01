# Valuable Tests

A valuable test fails when behavior a caller depends on breaks, and passes through every change that leaves that behavior intact. This file is the rubric for that judgement: `tdd` writes tests against it, and the review's Valuable Tests axis grades a diff's tests against it.

The consumer's own testing standards take precedence over this rubric wherever they speak.

## Behavior at agreed seams

A test exercises the system through a public interface at a seam agreed before the test was written, and asserts what a caller can observe there: a returned result, a state the interface exposes, or an effect at a system boundary. Its name states a capability ("an expired card is declined"), not a mechanism ("calls the gateway twice").

A test that reaches past the seam, into a private method, an internal collaborator, or a storage row the interface never exposes, tests the implementation instead of the behavior.

## Three failure modes

Agent-written tests fail in three recognizable ways. Each one passes today and protects nothing tomorrow.

### Tautological

The expected value is derived the way the code derives it: the test recomputes the sum with the same reduction, rebuilds the string with the same template, or asserts a constant equal to itself. It passes by construction and can never disagree with the code it checks.

Expected values come from a source independent of the implementation: a known literal, a worked example, or a line of the specification.

### Structure-sensitive

The test breaks when the code changes form while behavior stays the same. Tells:

- asserting which internal function was called, how often, or in what order;
- testing a private method, or a helper the public interface already covers;
- snapshotting incidental structure, such as markup or object shape, that no caller depends on;
- a name that describes how the code works rather than what it guarantees.

A refactor that breaks such a test teaches nothing, and the cost of fixing it lands on the next change.

### Mocks that hide failure

A test double replaces something the code under test owns, or stands in for a boundary in a way that removes its failure behavior. Tells:

- mocking the team's own modules or internal collaborators instead of exercising them;
- a stubbed dependency that only ever succeeds, so the timeout, rejection, or malformed response the real boundary produces is never exercised;
- an assertion hidden inside the stub, so the test checks the call rather than the outcome;
- verifying through a side channel, such as querying the database after a write, instead of reading the result back through the interface.

Doubles belong at system boundaries the team does not control: external services, time, randomness, and sometimes storage or the file system. Where a boundary is doubled, at least one test drives its failure path through the public interface. A boundary passed in as a narrow, operation-specific interface needs no conditional logic inside its double; a generic fetcher does, and that logic is where tests start to lie.

## Deeper modules, sturdier tests

A deep module hides rich behavior behind a small interface. Its tests are few, sit at that interface, and survive any rewrite of the inside. A shallow module, whose interface is as complicated as its implementation, pulls tests toward its internals, and they turn structure-sensitive. When valuable tests are hard to write, the seam is usually in the wrong place; that is a design finding, not a reason to test the internals.
