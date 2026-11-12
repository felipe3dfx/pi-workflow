# Stopped Tickets

Read this file when a merge conflict, red focused checks on the merged tree, or a stale child branch stops a ticket.

The developer picks one recovery:

- **Re-entry**, in a fresh context as in step 3 that also receives the stop and the last handoff, returning a new handoff under the same batch rule.
- **Reimplementation** on a fresh child branch from the current parent head, recreated at step 3 with the developer's approval to discard its commits.
- **Leaving the ticket stopped.**
