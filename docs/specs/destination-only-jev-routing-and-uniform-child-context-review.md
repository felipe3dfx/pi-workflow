# Revisión: routing de destino de Jev y contexto uniforme de los hijos

Paquete: `destination-only-jev-routing/definition-1`.
Handoff: `destination-only-jev-routing/feature-review-1`.
Especificación: [destination-only-jev-routing-and-uniform-child-context.md](destination-only-jev-routing-and-uniform-child-context.md).
Parent: #257.
Veredicto: `READY WITH WARNINGS`.

## Origen

La especificación sintetiza el brief aceptado sin cambiar decisiones funcionales. La revisión de la definición está en [docs/features/destination-only-jev-routing-and-uniform-child-context-review.md](../features/destination-only-jev-routing-and-uniform-child-context-review.md); este reporte consolida sus hallazgos y lo que agregó la síntesis.

## Hallazgos consolidados

Los cinco hallazgos de `feature-review` quedaron dispuestos: B1, W1, I1 e I2 resueltos por el desarrollador, e I3 registrado como brecha de evidencia. No hay advertencias sin disposición.

La síntesis no encontró definiciones faltantes ni contradicciones con ADR 0017 ni con el glosario. Agregó decisiones estructurales sin cambio funcional:

- Obligatoria: se conservan el seam de Contract y allowlist por rol y los canales `ask_parent` y `report_result`, por ADR 0017 y la disposición I2.
- Recomendación: separar el estado del destino por mensaje de la selección de rol por lanzamiento en el seam actual del launcher.
- Reconciliación: `routing-owner.md`, `child-session-capabilities.md` y `child-session-delegation.md`, con sus revisiones, reciben avisos de reemplazo sin reescribir su contenido histórico.

## Decisions, Deviations and Accepted Risks

- Divergencia autorizada: Jev routing, Contracts y delegation-check, por ADR 0017.
- Riesgo aceptado: el padre puede elegir un rol sin la herramienta necesaria; solo lo mitiga la guía.
- Riesgo aceptado: la cadena completa de contexto llega a todos los hijos; lo mitiga la precedencia del Contract.
- Riesgo aceptado: habilitar una herramienta nueva exige editar Contracts.
- Brecha admisible: no hay Domain Authority Handoff generado.
- Brecha de evidencia: el conteo de incidentes viene de una búsqueda parcial de logs.
