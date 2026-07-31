---
name: to-tickets
description: Generate a deterministic Delivery-ticket graph from the exact approved Spec and verified Delivery parent granted by define-product.
---

# To Tickets

Generate the Delivery-ticket graph only from the approved Spec and verified Delivery parent available through the workflow artifact session.

## Requirements

- Preserve the canonical parent identity and approved product intent.
- Produce professional neutral Spanish for every Linear-facing title and description.
- Keep tickets independently testable, implementation-oriented, and traceable to the Spec.
- Express dependencies explicitly and reject cycles.
- Do not publish to Linear or mutate repository files.
- Persist exactly one `delivery-ticket-graph` snapshot through the granted artifact tool.
- Do not infer or replace missing private identities, artifact references, or approval data.
