# Revisión de la definición: routing de destino de Jev y contexto uniforme de los hijos

Paquete: `destination-only-jev-routing/definition-1`.
Handoff: `destination-only-jev-routing/feature-review-1`.
Resultado: **READY WITH WARNINGS**.
Parent: #257.
Brief: [destination-only-jev-routing-and-uniform-child-context.md](destination-only-jev-routing-and-uniform-child-context.md).

## Paquete revisado
Las tres lentes revisaron en sub-agentes independientes la misma captura literal del brief, antes de las disposiciones, sobre HEAD `83349b92852992c3def0133f60ec8b98d04e65e6` con el worktree limpio. Cada lente corrió `npm run check` por su cuenta: salida 0, 944 tests, 930 pasan, 0 fallan, 14 omitidos. El desarrollador dispuso cada hallazgo el 2026-10-14 y el brief incorpora esas disposiciones.

## Lentes independientes
| Lente | Resultado | Evidencia |
|---|---|---|
| Completitud y coherencia | BLOCKED antes de disposiciones | 06bf095e; B1, W1 e I3. |
| Simplificación y alcance | Sin bloqueos | d6131f11; I1 e I2. |
| Viabilidad y coherencia transversal | BLOCKED antes de disposiciones | 8a0e9b9c; B1, W1 y diez capacidades compartidas. |

## Hallazgos y disposiciones
| # | Severidad / lentes | Hallazgo y evidencia | Disposición |
|---|---|---|---|
| B1 | Bloqueante; 1 y 3 | La decisión sin filtro citaba una premisa falsa: «los hijos reciben solo el AGENTS.md del repositorio». `extensions/child-sessions.ts:370-391` pasa `getAgentDir()` y solo suprime `APPEND_SYSTEM`; `resource-loader.js:165-190` carga el directorio del agente y los ancestros; `test/child-sessions.test.mjs:2215-2251`; ADR 0014:14. | Aceptada: premisa corregida y decisión sin filtro renovada, con la exposición completa de la cadena de contexto aceptada. Resuelto. |
| W1 | Advertencia; 1 y 3 | Faltaban dependencias: `GLOSSARY.md:63-65,87-89`, `docs/specs/routing-owner.md`, `docs/specs/child-session-capabilities.md`, ADR 0016:13-19 y `test/child-sessions.test.mjs:2215-2247`. | Aceptada: lista de dependencias ampliada; glosario y ADR 0017 fusionados en PR #256. Resuelto. |
| I1 | Informativo; 2 | La segunda clasificación de Jev por lanzamiento (`extensions/child-launcher.ts:478-493`) sobra cuando Jev deja de elegir el rol. | Aceptada en el punto 1 del alcance: solo se guarda el destino por mensaje. Resuelto. |
| I2 | Informativo; 2 | La inspiración en Gentle Shell se limita al texto de los Contracts dentro de `ask_parent` y `report_result`; ADR 0014:26-28 rechaza diseños de subprocesos como gentle-shell. | Aceptada en el punto 5 del alcance. Resuelto. |
| I3 | Informativo; 1 | El repositorio confirma el mecanismo del cambio de rol (`child-launcher.ts:345-423`; `test/child-launcher.test.mjs:683-712,770-786`; `assets/contracts/explore.md:2`; `child-sessions.ts:389`). | El conteo de incidentes queda como brecha de evidencia registrada. |

## Capacidades compartidas
| Capacidad | Disposición |
|---|---|
| Jev routing | Divergencia autorizada por ADR 0017. |
| Fábrica de child sessions y contexto | Evidencia insuficiente durante la revisión; resuelta por la disposición de B1. |
| Contracts por rol | Divergencia autorizada. |
| Tool gate del padre | Compatible. |
| Puntaje de delegation-check | Divergencia autorizada. |
| Model profiles por rol | Compatible. |
| `continue_child` | Compatible; conserva el rol del hijo. |
| children-view, proyección y entrega de resultados | Compatible. |
| Guard de `git`/`gh` en bash | Compatible. |
| Delegation mode | Compatible. |

## Notas para to-spec
- La guía de herramientas distingue las herramientas fijas del Contract de las que agrega el runtime (MCP y web).
- `continue_child` conserva su rol.
- Un rol en caché no pasa a lanzamientos hermanos.
- `chosenBy` (`child-launcher.ts:572`) refleja que el rol lo eligió el padre.

## Decisions, Deviations and Accepted Risks
- Decisión: opción A sobre la opción B recomendada; resolvió el desarrollador.
- Decisión: sin filtro de contexto, renovada tras B1.
- Riesgo aceptado: el padre puede elegir un rol sin la herramienta necesaria; solo lo mitiga la guía.
- Riesgo aceptado: la cadena completa de contexto llega a todos los hijos; lo mitiga la cláusula de precedencia.
- Riesgo aceptado: habilitar una herramienta nueva exige editar Contracts.
- Brecha admisible: no hay Domain Authority Handoff generado.
- Brecha de evidencia: conteo de incidentes basado en una búsqueda parcial de logs.
