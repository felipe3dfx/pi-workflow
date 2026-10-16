# Comment Format

Read this file in full before drafting a review. The draft has three parts: the review comment, the inline comments, and the event.

## Language and evidence

Write the comment and inline comments in the language the user asks for, else the one the repository's instructions set for pull-request reviews, else the language of the pull request's description; headings, tags, and the discarded list follow it. Code, identifiers, paths, and quoted text stay as they are. Every finding refers to code at the reviewed head, with a repository-relative path and line when it has one, or the requirement line when it is a missing behavior. Mark what the code shows as a fact and what it suggests as a hypothesis, saying what would confirm it; never present a hypothesis as a fact.

## Review comment

Use these sections in this order. A section with nothing to say says so in one line, and every section stays present.

1. **What changes**: one sentence.
2. **Spec / fit to the problem**: whether the change solves the requirement, solved, partial, or not solved, and anything it changes outside that requirement, summarized without repeating the findings below.
3. **Standards / design quality**: the summary against the repository's standards and design quality, without repeating the findings below.
4. **Important decisions**: each decision the Decisions axis surfaced and the critique kept visible, with its documented justification or the statement that none is documented, its impact, and what calls for the human reviewer's judgment. A decision here is neither approved nor rejected by this review.
5. **Blockers**: each finding the critique kept as blocking: what fails, why it matters, its evidence, and how to resolve it, plus the reason for its classification. A grouped finding names the shared problem and each confirmed instance.
6. **Warnings**: each non-blocking finding, with its evidence and the reason it does not block.
7. **What is right**: what the change does well, briefly and specifically.

After the sections, under **Discarded**, list each discarded finding in one line with the reason it was discarded, so the human reviewer can recover it. Then, under a simplification trade heading, give the critique's trade, or one line saying there is none.

In a later round, open sections 5 and 6 with what the previous review raised and is now resolved, then tag each remaining finding as not resolved, partially resolved, introduced by the correction, genuinely new, or pre-existing and missed by the previous review.

## Inline comments

One inline comment per blocker or warning that points at a line in the diff, anchored to that path and line at the reviewed head, repeating the finding briefly with its fix. A finding the provider cannot anchor stays in the review comment only.

## Event

State the verdict the run decided on its own line after the draft, with the head SHA it covers.
