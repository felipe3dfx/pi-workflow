# Resume and Cancellation

Read this file when a run resumes or is cancelled.

## Resume

At step 3: On resume, a child branch without the parent head is recreated when it has no commits of its own, otherwise stale.

## Cancellation

On cancellation, abort an uncommitted merge, preserve every branch and committed merge, and report the last integrated ticket.
