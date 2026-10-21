# Findings Register

Read this file in full before dispatch whenever the caller hands the review a register of findings that earlier reviews adjudicated.

Each register entry carries a finding that earlier reviews rejected or the developer decided, never one accepted and fixed, with its ID, axis, location, claim, evidence, terminal verdict with its evidence or reason, and the developer's decision where one exists. The register never makes a review corrective: a full review stays full, and a corrective one stays corrective.

- Give each axis only its own axis's entries, with the rule below added to its brief. An axis receives no other axis's entries.
- An axis does not re-raise a finding that matches an entry, the same claim at the same location or requirement, unless it cites new evidence that the reviewed head shows and that is absent from the entry's evidence, verdict reason, and decision. It reports such a finding with a new ID, naming the entry it reopens and quoting the new evidence.
