# Revisión de la definición: Claude Bridge

Paquete: `claude-bridge-support/definition-1`.
Handoff: `claude-bridge-support/feature-review-1`.
Resultado: **READY WITH WARNINGS**.
Parent: [#238](https://github.com/felipe3dfx/pi-workflow/issues/238).
Brief: [claude-bridge-support.md](claude-bridge-support.md).

## Paquete revisado y aprobación
Las tres lentes revisaron la misma captura literal del brief. El desarrollador
aprobó la intención, el rechazo previo del modelo no disponible, la ausencia de
fallback y el prototipo reference-only. Los rótulos históricos «Proposed» del
brief no reabren decisiones: la aprobación explícita cerró esos estados.
La petición posterior de publicación no autoriza implementación.

## Lentes independientes
| Lente | Resultado | Evidencia |
|---|---|---|
| Completitud y coherencia | READY WITH WARNINGS | d83428ae; sin nuevos bloqueos o decisiones abiertas. |
| Simplificación y alcance | READY WITH WARNINGS | ac712a70; reutiliza el seam existente sin delegación paralela. |
| Viabilidad y coherencia transversal | READY WITH WARNINGS | ebcf9f6d, tras reverificación af1d6229 y aceptación explícita de F1. |

## Hallazgos y disposiciones
| Hallazgo | Severidad / responsable | Evidencia, impacto y disposición |
|---|---|---|
| Ausencia de autoridad Bridge generada | Informativo; domain-modeling/feature | GLOSSARY.md es autoridad raíz; ausencia de handoff y revisión generados declarada, admisible por separado. Sin conflicto semántico pendiente. |
| Prototipo y cobertura limitados | Advertencia; prototype/to-spec | Adaptación temporal, contexto sintético, una combinación de versiones/modelo y padre completo solo offline. Reference-only y pruebas de producción pendientes aceptados expresamente. |
| Cancelación y caché | Advertencia; feature | Aviso de contexto obsoleto y llamada abandonada también ocurren sin Bridge; cancelación cooperativa. Caché de 256 claves no implica límite de todos los objetos. Riesgos aceptados; sin limpieza privada ni corrección de cancelación. |
| F1: reconstrucción del padre | Advertencia; desarrollador/feature | Cierre del hijo borra espejos compartidos; padre inactivo reconstruye historial. Marcadores conservados; costo de caché/reproducción no cuantificado. Aceptado explícitamente sin mitigación y verificado de nuevo. |
| F1-I1: umbral del probe concurrente | Informativo; prototype | Script registró exit2 por exigir dos espejos cuando solo el hijo terminado tenía uno. Fuente y reevaluación independiente confirmaron que esa única condición era incorrecta. No se presenta el script como aprobado. |

## Capacidades compartidas
| Capacidad | Disposición |
|---|---|
| Model profiles y catálogo | Compatible; preserva herencia, thinking y rechazo sin fallback. |
| Contracts, herramientas y contexto por rol | Compatible; sin skills/harness/spawn_child ni AskClaude activo en hijos. |
| Extensiones curadas | Divergencia de intención autorizada; requiere enmienda de ADR 0014 antes de entrega. |
| Resultados, Steer y cancelación | Compatible a nivel de definición; riesgos de cancelación aceptados. |
| Continuación de hijos completados | Compatible; nuevo hijo y conversación guardada; otras fuentes rechazadas. |
| MCP/web y entrega automática del padre | Evidencia de producción insuficiente; criterio posterior de entrega aceptado. |
| Companion independiente e instalación explícita | Compatible; incorporación al catálogo después de validar producción. |

## Decisiones, desviaciones y riesgos aceptados
Resolver: desarrollador. Fuentes: descubrimiento, aprobación literal del brief,
elección de extensión oficial, exclusión de AskClaude, alcance de cancelación,
disposición reference-only y aceptación posterior de F1. No hay supersesiones.
La ampliación de extensiones de ADR 0014 requiere una enmienda antes de entrega;
no se cambió canon durante esta revisión. No hay advertencias sin disposición.

## Evidencia y límites
Pi 1.1.0, Bridge 0.9.2 (b2e7255ece0b8bfd3a6429fd5c147fd59984c785),
Claude Code 2.1.296 y Haiku 4.5-low. Probes reales de roles/herramientas,
Steer y continuación completada; comparación offline de cancelación.
F1 idle: tres requests y 18.820 s. F1 concurrente: seis requests y 14.308 s;
sesiones públicas directas y barreras sintéticas, no gestor completo/MCP/web.
Evidencia temporal: `/tmp/pi-claude-bridge-prototype.YmrJ75/`.
No se garantiza aislamiento universal ni limpieza de procesos en todo caso.

## Condiciones de entrega
Validar gestor, padre completo, MCP/web, confianza y cobertura de versiones/modelos;
aceptar la enmienda de ADR 0014 y completar el quality gate.
Los intentos históricos fallaron en firmas de fixtures o agotaron 120 segundos.
La validación de publicación posterior aprobó `npm run check` en 16.1 segundos:
855 tests, 854 aprobados, 0 fallidos y 1 omitido; distribución aprobada.
No se cambió ni omitió la configuración de firma. Esta validación documental
no sustituye las pruebas de integración de producción.

## Handoff
Brief y reporte son el par de feature-review; no son sustituidos por el par
especificación/reporte consolidado de to-spec. La revisión permite publicación,
pero no es evidencia de implementación ni de incorporación del companion.
