# Crítica de la definición — informe consolidado local

Estado vigente: **READY WITH WARNINGS**, consolidado por el padre sobre la
captura final. Este informe es estado de trabajo local; `to-spec` lo publica
junto con el brief.

## Fuentes y capturas

Brief: `docs/features/rpc-child-sessions.md`. Prototipo de referencia:
`.agents/prototypes/rpc-children/` (disposición `reference-only`).

| Ronda | Commit | Resultado |
| --- | --- | --- |
| 1 | `58af30e` | 3 lentes independientes: 2 bloqueantes, 6 advertencias, 1 informativo |
| 2 | `b0602eb` | 3 lentes: reverificación de la ronda 1 y crítica de la admisión por superficies |
| 3 | `598cace` | Lentes 1 y 3: reverificación de las correcciones de la ronda 2 |
| 3b | `c1bcf19` | Lente 1: reverificación del plegado de mayúsculas; veredicto final |

La verificación de la captura y del tracker la hizo el padre; los hallazgos de
las lentes sin acceso a `gh` ni a `bash` se retiraron.

## Hallazgos y disposiciones

| Hallazgo | Clase | Disposición | Quién y fuente |
| --- | --- | --- | --- |
| Pérdida de la cola de mutación por archivo (D7) | bloqueante | Resuelto: admisión por superficies disjuntas, como gentle-shell | Usuario, conversación de definición |
| Conflicto con los ADR 0014 y 0016 | bloqueante | Rechazado: el brief declara el reemplazo y el ADR sustituto es entregable de la especificación | Usuario |
| Configuración MCP del worktree frente al ADR 0021 | advertencia | Corregido en el brief | Usuario |
| Reconciliación tras `/reload` y `continue_child` | advertencia | Corregido en el brief | Usuario |
| Claude Bridge y acceso web del explorador | advertencia | Corregido en el brief | Usuario |
| Protecciones de bash y commits firmados en el hijo RPC | advertencia | Corregido en el brief | Usuario |
| Terminación del árbol de procesos en macOS | advertencia | Riesgo aceptado: no verificable en el entorno disponible; criterio de aceptación de la implementación | Usuario |
| Mecanismos del prototipo como requisitos | informativo | Aceptado: el prototipo queda como referencia | Usuario |
| Escrituras del padre fuera de la admisión | bloqueante | Resuelto: la garantía es entre hijos, a propósito | Usuario |
| Declaración, ciclo de vida e identidad del reclamo | advertencia | Corregido en el brief | Usuario |
| Bloqueo por checkout en lugar de superficies | informativo | Rechazado: el paralelismo de `implement-spec` es una necesidad trazable | Usuario |
| Comparación sin distinguir mayúsculas | advertencia | Corregido en el brief; reverificado y cerrado | Usuario |
| Verificación de captura y del tracker | advertencia | Retirado: lo verificó el padre | Padre |

## Decisions, Deviations, Accepted Risks and Justified Complexity

- **Riesgo aceptado:** macOS sin verificación de terminación completa del
  árbol de procesos. Aceptó el usuario, porque no se puede comprobar aquí.
- **Desviación autorizada:** el brief reemplaza las reglas del ADR 0014 sobre
  hijos en proceso, configuración MCP del padre y ausencia de comprobación al
  lanzar (D7). El ADR sustituto queda como entregable de la especificación.
- **Complejidad justificada:** procesos aislados con configuración propia
  (directorio, raíces MCP y estado de módulo), supervivencia a `/reload`,
  terminación del árbol en Linux y macOS, y admisión por superficies para
  repartir trabajo entre escritores en `implement-spec`.
- **Abierto por diseño, para la especificación:** endurecimiento del canal
  entre padre e hijo, presupuesto de concurrencia por memoria y destino del
  parche de cancelación.

## Veredicto

**READY WITH WARNINGS.** Cada hallazgo tiene disposición; no quedan
bloqueantes ni advertencias sin corregir o aceptar. La advertencia que
permanece con riesgo aceptado es macOS.
