# Agent Files

Read this before preparing the approval preview when the tracker playbook has a "Ticket Body and Agent Attachments" section. For that tracker it replaces two rules of the main skill: "an issue specification is its own parent", with the preview choice to use the specification issue itself, and "Create a file specification's parent after its read-back". Every other reuse, conflict, read-back, and approval control there still applies.

- The parent is always a Spanish issue following tracker publication fields and that section. It is never the specification itself: its body is the summary the section defines, and no artifact is published as a body or a comment.
- The parent carries three files, linked from its body by role: the final technical specification, the stable brief, and the consolidated `feature-critic` report. The joint publication of the brief and report and the final publication of the specification and report publish these same files; a report file already linked is replaced by the consolidated one, never duplicated.
- Reuse the issue the definition started from, or one open issue that already links these files, even without children. A closed match or multiple candidates blocks with no mutation request. Preview whether to reuse or create.
- When a reused parent holds an artifact as its body or a comment, the preview lists rewriting the body and deleting each such comment as effects; deleting a comment always asks.
- The parent exists before its files: create or reuse it, then upload each file from its local path and link it as the section defines. The preview shows each file by path and role and the body literally.
- Set `PUBLISHED` only when, besides the main skill's conditions, the parent's files pass the section's published check and no comment on the parent carries an artifact.
