---
name: product-review
description: Review one Linear issue from a domain anchor under Owner authority.
---

# Product Review

## Invocation guard

Evaluate this invocation guard before inspecting or handling inputs.

The runtime extension admits only idle interactive invocations and blocks all tools while the capability is pending. Human role membership is an organizational access boundary: this package has no Owner/Developer credential and does not authenticate a person as Owner rather than QA or PS. Later workflow modules must enforce role authority before mutations.

For a forbidden runtime caller, the extension returns the PI_WORKFLOW_PUBLIC_ENTRY_FORBIDDEN blocker before the LLM runs.

## Inputs

Authorized organizational role: Owner.

Trim surrounding whitespace from the invocation arguments before checking the domain anchor.

After trimming, valid input is exactly one uppercase Linear identifier matching `[A-Z][A-Z0-9]*-[1-9][0-9]*` and nothing else. Whitespace-only input is missing. Malformed input or input containing multiple identifiers is invalid.

For missing or invalid input, return exactly this one corrective question:

What single Linear issue ID anchors this product review?

Ask no other question. Stop immediately after the question. Do not invoke tools or perform mutations.

## Evaluación y aprobación

Después de recibir una invocación permitida con un ID válido:

- Evalúa alcance, historias y criterios de aceptación, evidencia, hallazgos, cambios requeridos e impacto en el parent y los issues siblings mediante el borrador estructurado `product-review/v1`.
- Presenta la recomendación del agente y los digests exactos para `Aceptado` y `Cambios requeridos`.
- Solicita al Owner que elija explícitamente uno de esos dos resultados y confirme el issue y el digest correspondiente. No publiques antes de esa aprobación.
- Tras la selección explícita, ejecuta la herramienta únicamente con `issueId`, `result` y `digest`. No proporciones body, authority, revisión ni campos adicionales.
- Informa exactamente el resultado verificado o el blocker.

Nunca cambies estado, assignee, Cycle, labels, estimate, relaciones ni descripción. Done, Stop, reasignación y cierre automático del parent permanecen manuales o nativos de Linear.
