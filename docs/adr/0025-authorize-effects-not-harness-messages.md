# ADR 0025: Authorize effects, not harness messages

## Status

Acceptance: approval and merge of the introducing PR.

The contextual path remains unadopted; production adoption still belongs to #293.

## Decision

Amends: ADR-0021, only its application of contextual classification to every parent and child dispatch. Its other decisions, and ADR-0022, stay in force. Issue: #315.

Contextual classification does not run for this closed list of harness tools: `reply_child`, `ask_user_question`, `ask_user_choice`, `list_children`, `child_status` and `child_result`. They only carry messages between the parent, its children and the operator, or read child state; none acts on files, processes or external services. Authority is evaluated where an effect happens: the child's action that a reply leads to is classified in the child, with its own assignment. The workflow extension supplies this list and its own inline source, `<inline:pi-workflow>`, to the authorization hook; the exemption applies only when the currently registered tool comes from that source, not to a name alone. Installing the workflow without that named source exempts nothing. Each exempt call still delivers an audit decision with its tool and input; an audit failure does not refuse the message, which authorizes no effect. MCP and third-party tools, `spawn_child`, `continue_child`, `cancel_child`, codemode and every other tool stay classified, and a nested call to a workflow-owned listed tool is not classified while its enclosing call is.

A child's authorization consultation sends its parent only a short reference, the proposed action, the reason and the effects, and asks for a short reply: `ref`, `kind` (`resolved`, `deny` or `pending`), `answer`, and `confirm`. The reference comes from the question's random id, because question numbers restart in every child: a reply without the matching `ref`, such as one sent to the wrong child, leaves the action held. The child's runtime then fills in the question's `id`, `call` and `proposal` and sets `confirmedActions` to exactly the proposed action only when `confirm` is true. A reply's own identity fields and action lists are ignored. The generic authorization check is unchanged: a malformed reply leaves the action held, a denial refuses it, and a confirmation must still pass reclassification and the final current-authority checks.

The classifier rules are unchanged. Narrowing `prohibited` to explicit prohibitions was measured against the #293 corpus and not adopted: both models still read an instruction to ask first as a prohibition, and narrowed gpt-6.1-sol returned scope `within` despite acknowledging a missing instruction, producing a false permit. One sample does not establish why; how to represent unknown instructions remains an open question for a separate change.

## Considered Options

- Give the classifier the conversation, such as the child's question and the operator's answer. Rejected: deciding what to include is open-ended, the transcript is untrusted content that can carry injected authority, and it adds cost and latency without removing the echo of the proposal.
- Let the operator confirm a child's question directly, without the parent's model. Deferred: it is the strictest option, but it removes the parent's ability to resolve what is within its authority. It is reconsidered if a parent is observed fabricating consent.
- Keep classifying messages and only relabel missing facts as held. Rejected alone: the parent has no consultation path for its own held calls, so a held relay still blocks.
- Narrow `prohibited` to explicit prohibitions. Measured and not adopted: it left the denials of ask-first instructions in place and produced a false permit.
- Skip classification for harness messages and correlate replies in the child runtime. Chosen: the smallest change that lets a human decision reach the action it concerns.

## Consequences

A parent relays an operator's decision without a classification call, and the child action it concerns is evaluated once more with that decision. The listed tools lose the classifier's review, which applies only to their message content. A parent model can still misstate the operator's answer in its reply; this decision does not detect that. Missing facts can still be classified as prohibited, which denies an action that should be held for consultation; the human chain no longer depends on it, because the parent's relay is not classified.
