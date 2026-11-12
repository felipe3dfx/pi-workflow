# Existing Child Branch

Read this file at step 3 when the ticket's child branch already exists.

Recreate it from the current parent head when it lacks the parent head and has no commits of its own, or when the developer chose its reimplementation and approved discarding its commits; recreate only when no worktree has it checked out or holds uncommitted changes on it. Deleting the branch to drop the commits the developer approved discarding is the only forced operation. When the developer chose reimplementation but recreation is refused, the ticket stays stopped: name the worktree.
