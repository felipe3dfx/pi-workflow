# Revisión consolidada: uso de contexto del hijo en Fleet

Paquete: `fleet-context-usage/definition-2`.
Handoff de definición: `fleet-context-usage/feature-review-2`.
Identidad de especificación: `fleet-context-usage/specification-1`.
Identidad de este informe: `fleet-context-usage/spec-review-1`.
Especificación: [fleet-context-usage.md](fleet-context-usage.md).
Brief estable: [definición aprobada](../features/fleet-context-usage.md).
Revisión estable: [feature-critic](../features/fleet-context-usage-review.md).
Veredicto preservado: **READY**.
Parent: [#326](https://github.com/felipe3dfx/pi-workflow/issues/326), abierto;
creación y lectura de vuelta verificadas.

## Readiness y alcance de la síntesis

El brief identifica problema, usuario, resultado, escenarios, estados,
acciones, errores, alcance, dependencias y exclusiones. D1–D14 registran
resolutor, fuente, estado y supersesión aceptada. La revisión de feature-critic
corresponde a definition-2, tiene las tres lentes independientes completas
y no conserva blockers ni advertencias sin disposición.

La síntesis no hizo una segunda entrevista ni cambió el producto aprobado.
No seleccionó un mecanismo por preferencia para convertirlo en obligatorio.
La especificación distingue restricciones derivadas de decisiones/ADRs de
recomendaciones estructurales sustentadas en las interfaces existentes.

La comprobación mecánica de cobertura revirtió únicamente las tres
actualizaciones editoriales de estado del brief y reprodujo el digest
revisado por las lentes. No hubo cambio funcional posterior a la crítica.

| Artefacto de entrada | SHA256 |
| --- | --- |
| Brief estable actual | `f6944fdf833ae6cee6a6da7dc025dd45a39454cd25fb2a76d598b6212b0a3dec` |
| Informe estable actual | `e14a49762bbb215986ce33f1b343bc60a74fbd8275abaac1939195e22635c598` |
| Brief revisado antes del estado editorial READY | `ec1ee5033c8224fb230f404236c3eea854e069e5527366831d424fbbd6b22194` |
| Captura conjunta de definition-2 | `075a1edac3c92b7a97e0d9519f3da11763413fd2e38afc500773d70a4b30c612` |

El handoff nombra por identidad la revisión estable y su digest; no inventa
un nuevo veredicto ni reemplaza la publicación conjunta del brief y reporte.

## Autoridad y brechas admisibles

Autoridad: GLOSSARY, docs/agents/domain.md, ADR 0007, ADR 0023 y ADR 0026.
La terminología está cerrada y no se requiere cambio de canon.

- Domain Authority Handoff generado: ausente; brecha admisible por separado.
- Revisión de autoridad generada: ausente; brecha admisible por separado.
- Prototipo y Approved Prototype UI Contract: ninguno, con disposición
  explícita de no requerir prototipo funcional adicional.
- El viejo brief de historia aporta intención; sus afirmaciones in-process
  o de reload no prevalecen sobre ADR 0023.

No se identificó una fuente de autoridad presente que fuera inválida,
bloqueada, obsoleta de forma conflictiva o contradictoria para esta síntesis.

## Hallazgos y reverificación preservados

| Hallazgo | Disposición final |
| --- | --- |
| R1: invalidación y respuestas tardías | Corregido mediante D12; reverificado por necesidad y viabilidad |
| R2: ocupación desconocida más last | Corregido mediante D13; reverificado por necesidad |
| R3: dimensiones extremas | Simplificación D10 aprobada; reverificada por las tres lentes |
| R4: resultado observable de consultas | D13 y obligación de síntesis; reverificado por necesidad y viabilidad |
| R5: evidencia histórica incompleta | D14 y fallback unavailable; reverificado por necesidad y viabilidad |
| R6: límites de alcance | D11 aprobado; disposición conservada y reverificada |
| R7: ejemplos y paridad | Corrección editorial y reglas numéricas explícitas; reverificadas |
| V1: fin tras invalidación sin lectura posterior | Consecuencia de D12/D13, caso de síntesis/prueba; sin nueva decisión de producto |
| V2: evidencia de validez | Obligación de síntesis ya contenida en D14; advertencia duplicada retirada por su lente |
| V3: mecanismo de descarte y notificación | Obligación de síntesis/prueba; sin mecanismo impuesto en el brief |

La síntesis incorpora V1–V3 en el contrato de transiciones, las restricciones
de orden y la recuperación de auditoría. No se acepta un riesgo nuevo por
el hecho de que la implementación todavía no exista.

## Decisiones estructurales de la síntesis

Todas las recomendaciones siguientes son no obligatorias. Su necesidad y
la evidencia están desarrolladas junto a la restricción correspondiente en
la especificación; una alternativa debe conservar el contrato observable.

| Recomendación | Evidencia y motivo |
| --- | --- |
| Consultar stats en el RPC existente, con una consulta en vuelo y marca de actualización pendiente | request/refresh/fail ya existen; evita nuevo canal y cola creciente |
| Aplicar generación de contexto al recibir compactación exitosa | las respuestas se resuelven antes de la entrega asíncrona de eventos; evita revivir porcentajes anteriores |
| Callback estrecho por el Port existente | onEvent/report y hold/bind/adopt proporcionan integración y continuidad de reload |
| Snapshot opcional en el cierre de auditoría, fuera de observaciones con pérdida | seal/tailOf/summary ya proporcionan resumen acotado; evita nuevos eventos y reconstrucción histórica |
| Compartir el cálculo/presentación puro del medidor | segunda superficie real con las mismas reglas; evita deriva sin abstraer todo el layout |
| Timers y fixtures existentes | Schedule, fake Pi y fixtures auditados permiten probar silencio, orden y recuperación sin sleeps nuevos |

La especificación no convierte en decisiones abiertas tres casos ya
resueltos por el contrato: capacidad ausente en una respuesta válida es
unavailable (D8); el estado desconocido poscompactación no restaura un
porcentaje (D12); la confianza histórica depende de evidencia independiente,
no únicamente de que el transcript esté completo (D14).

## Decisions, Deviations, Accepted Risks and Justified Complexity

- Decisiones funcionales: D1–D14 preservadas con fuente, resolutor y
  supersesión. No hay decisión importante abierta ni contradicción material.
- Desviaciones autorizadas frente a la cabecera principal: conteos usados y
  capacidad en Fleet, unavailable en vez de omitir capacidad desconocida,
  y secuencia propia de reducción por ancho. Mismas reglas del medidor.
- Riesgos aceptados: ninguno. No se transforma la ausencia de implementación
  o de pruebas en ejecución en una aceptación tácita de riesgo.
- Complejidad justificada: retención histórica, null distinto de ausencia,
  invalidación prioritaria y descarte de respuestas anteriores, dato retenido
  identificado, y recuperación condicionada a evidencia. Todo deriva de
  decisiones aprobadas o restricciones vigentes.

## Pruebas y evidencia pendiente

La especificación define pruebas observables para RPC, orden de eventos,
consulta pendiente/fallida, muerte del hijo, cierre, reload, auditoría dañada,
paridad del medidor, layout, dimensiones extremas y Pi real aislado.
El comando de aceptación sigue siendo `npm run check`.

La definición pasó ese gate antes de la síntesis: 1464 pruebas aprobadas,
3 omitidas y ninguna fallida, además de la validación de distribución.
Eso valida el repositorio existente, no una barra todavía sin implementar.
La validación de los artefactos de esta publicación se registra al entregarlos.
Mutation testing está unsupported por el contrato del consumidor y no se
impone como condición de entrega.

Siguen sin comprobarse para la funcionalidad nueva: latencia y orden reales
de stats/eventos, equivalencia exacta del binario con la fuente del paquete,
cambios de capacidad sin evento y recuperación de validez ante fallos.
Corresponden a la implementación y a sus pruebas, no a una nueva entrevista.

## Publicación y handoff

Roles distintos que deben leerse de vuelta sin conflicto:

1. Brief estable y reporte estable: publicación conjunta de feature-critic.
2. Especificación final e informe consolidado: publicación de to-spec.
3. Parent único de GitHub: identifica `docs/specs/fleet-context-usage.md`
   por ruta, nunca por commit. Se reutiliza solo una coincidencia abierta
   equivalente; una cerrada, múltiple o conflictiva bloquea la creación.

No hay dependencias entre tickets ni relaciones nativas que inventar antes
de slicing. El parent y los enlaces de entrega se registran en el índice y
en el reporte final de publicación. No se cierra ni se cambia el estado del
parent por publicar la especificación.

Solo tras lectura de vuelta verificada de todos los roles corresponde
PUBLISHED y el handoff a to-tickets. Dicho handoff debe incluir paquete,
revisión READY, parent, decisiones, invariantes, pruebas, recomendaciones,
ausencia de prototipo, desviaciones autorizadas y ninguna advertencia aceptada.
