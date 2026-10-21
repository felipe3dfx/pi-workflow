# Revisión consolidada de la especificación de autorización contextual de acciones

## Identidad y alcance

**Veredicto: READY WITH WARNINGS.** Esta consolidación documenta la síntesis técnica del paquete vigente; no representa una nueva revisión independiente de tres lentes ni una aprobación de implementación o adopción.

- Brief estable: [definición funcional](../features/contextual-action-authorization.md), SHA-256 `be690abb770e27c58e651cf85fd142d55dacd86d6e713a47fe5c36d6e11607b2`.
- Informe funcional final: [revisión funcional](../features/contextual-action-authorization-review.md), SHA-256 `289bd81c0893f8b1eeb8a2d2a32bed421ce2bfdaa3a19af5d93c8bd5ef4992f9`.
- Handoff vigente: **Captura final renovada — deltas de commits y contexto**. Las capturas anteriores son historial. El texto histórico del brief sobre una revisión pendiente queda contextualizado por este handoff renovado, sin modificar el brief.
- Especificación técnica: [autorización contextual de acciones](contextual-action-authorization.md), SHA-256 `e5af2209d509d1da1724704570d64930c83bbb7c98f2ae293603e86ead400a3a`.
- Fuente de síntesis: borrador verificado, SHA-256 `240f7287587db48cb08608178c49ab5a8d2e92ca33966c3c3a5eb288a494e623`. Prototipo de referencia: commit `54f4f01`, solo procedencia de evidencia, no base de implementación.

## Procedencia y resultado

El padre comunica **PASS** del verificador independiente de síntesis: sin desviación material respecto del brief y del handoff funcional vigente. Esta consolidación registra ese resultado comunicado; no inventa una nueva ejecución, tres revisiones técnicas independientes ni evidencia de integración real.

Las tres lentes funcionales renovadas constan en el informe funcional: necesidad/coherencia y alcance/proporcionalidad sin hallazgos nuevos; viabilidad/coherencia transversal conserva las disposiciones de los deltas aprobados. La advertencia sobre un segundo hermano de implementación quedó **WITHDRAWN** conforme a «or all when fewer exist»: hay una implementación de `child-bash` y una de `checkpoint`; el broker de fleet es un llamador compartido. No quedan hallazgos funcionales sin disposición.

La versión final solo ajusta estado editorial, referencias durables y distinción entre especificación y entrega. La precisión sobre `continue_child` limita su capacidad existente a sesiones de fondo completadas y retenidas: no acredita recuperación en primer plano ni selecciona un transporte nuevo. No cambia el comportamiento aprobado ni convierte recomendaciones estructurales en requisitos.

## Advertencias, disposiciones y límites

- **USER-ACCEPTED, solo definición:** integración completa y autorización real con `insufficient evidence`. La aceptación del usuario permite continuar la definición, no producción. Antes de adoptar: validar escalamiento completo y acciones reales, comparar alternativas con errores y latencia medidos y acordar criterios. No hay umbrales, modelo, caché ni presupuesto adicional aprobados.
- **reference-only:** ambos prototipos conservan su disposición; la integración aislada usa decisiones y ejecución simuladas. No demuestra recepción real por SDK, razonamiento del padre ni consentimiento humano real.
- **authorized divergence propuesta:** deltas aprobados de ADRs 0013/0017/0020 en su alcance exacto. Firma, alcance, protección del trabajo ajeno, confirmaciones y aislamiento cuando exista interferencia se conservan. Reconciliar ADRs 0015/0018/0020 y Contract/Checkpoint antes de implementar; el canon y las guardas actuales no cambian por publicación.
- **Brechas de evidencia admisibles:** ausencia separada del Domain Authority Handoff generado y de su revisión de autoridad de solo lectura. Las decisiones funcionales y semánticas están cerradas; no se fabrica autoridad sustitutiva.
- **Límites técnicos:** transporte correlacionado y Run state no son autorización; la cobertura de eventos no constituye sandbox universal. La recuperación en primer plano y sin UI requiere verificación de integración; una decisión material nueva debe volver al responsable y a `feature-critic`.

## Entrega

El par especificación/revisión técnica es distinto de la publicación conjunta del brief estable y su informe funcional exacto. Esta revisión no afirma `PUBLISHED`, creación de issue, read-backs completos, cambios de canon ni aprobación de implementación. El padre debe reinspeccionar equivalencias, publicar únicamente artefactos faltantes o reutilizar coincidencias exactas y verificar todos los read-backs del paquete y handoff vigentes antes de entregar a `to-tickets`.
