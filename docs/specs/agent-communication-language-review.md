# Informe de síntesis: límites de idioma por interlocutor

- Rol: informe de síntesis técnica (to-spec).
- Paquete: `agent-communication-language/v2`.
- Handoff funcional: `agent-communication-language/v2/feature-critic-final`.
- Handoff técnico: `agent-communication-language/v2/to-spec`.
- Especificación: [agent-communication-language.md](agent-communication-language.md).
- Brief estable: [definición aprobada](../features/agent-communication-language.md).
- Revisión funcional final: [feature-critic](../features/agent-communication-language-review.md).

## Estado

- Veredicto funcional preservado: **READY**.
- Especificación candidata: sintetizada.
- Verificación independiente de la síntesis: completada, **PASS documental**.
- Publicación: su estado final y lecturas de vuelta pertenecen al handoff de
  publicación. Implementación: no autorizada.
- QA de comportamiento: no ejecutada.

Este informe registra verificación documental independiente, no publicación
final, aprobación de implementación ni validación de comportamiento.

| Artefacto | SHA256 |
| --- | --- |
| Brief estable | `4a9b841d44f1cb0b12d5eed61ad308222e903f67bc6295697ca772b7bf5dbd5c` |
| Revisión funcional final | `6f7e1bcce5bf7bed662698f9216a8856f201b38cd845b880ce8bd6a9f8f2279d` |
| Especificación candidata | `a100603f3730e95021fd8fec00105178ec863e316851abcb6abff24f0bcb83fc` |

## Readiness

El brief identifica problema, usuario, comportamiento, alcance,
escenarios, invariantes, capacidades compartidas, dependencias y
exclusiones. D1–D5 registran resolutor, fuente, estado y supersesión. La
revisión funcional final corresponde al paquete v2, consolida tres lentes
independientes y no conserva blockers ni warnings sin disposición.

La autoridad semántica es el `GLOSSARY.md` raíz con ADR 0010, ADR 0015,
ADR 0017 y ADR 0025, sin cambios de canon. El Domain Authority Handoff
generado y la revisión de autoridad generada están ausentes; cada ausencia
es una brecha admisible por separado. No hay prototipo ni Approved
Prototype UI Contract, y no se requieren.

La síntesis no repitió el descubrimiento ni cambió el producto aprobado.
El usuario resolvió durante la síntesis las tres decisiones técnicas
importantes: T1 (mecanismo de instrucción), T2 (validación) y T3 (destino
del pull request de documentación).

## Contenido de la especificación

- Contrato observable: seis reglas de idioma y escenarios S1–S8, incluida
  la conservación de claves y valores estables de la consulta.
- Obligatorio por T1: una instrucción dedicada de sesión en el padre,
  independiente del Delegation mode y de las herramientas ofrecidas, y la
  regla en los cuatro Contracts (`explore`, `worker`, `verify` y
  `contextual`).
- Obligatorio por ADR 0015: la sección de Delegation mode y sus
  condiciones no cambian.
- Obligatorio por D5, ADR 0010 y ADR 0025: las superficies de delegación,
  preguntas, respuestas, resultados, Steer y Fleet conservan su forma y
  semántica; no se reescribe ningún mensaje en tránsito.
- Obligatorio por D2: actualizar la premisa de la prueba local sin borrar la
  regla de `AGENTS.md` ni cambiar el idioma de publicación.
- Verificación obligatoria del prompt efectivo de un hijo continuado; si
  exigiera cambiar la semántica de continuación, vuelve como pregunta.

## Recomendación estructural

| Recomendación | Evidencia y motivo |
| --- | --- |
| Una sección privada con nombre mediante `before_agent_start` y `systemPromptOptions.sections` | Documentación de Pi 1.4.0 instalada y su ejemplo oficial `prompt-customizer`: es la personalización preferida, se ejecuta en turnos iniciados por el usuario y por mensajes personalizados que disparan turno, como la entrega de resultados, y registra el delta de secciones. Es el seam existente más útil |

No es una exigencia del usuario. Se descartan `forceSystemPrompt`, el
reemplazo completo del prompt y la mutación del transcript. No requiere un
módulo exportado, una función, una opción pública ni configuración nuevos.

## Decisions, Deviations, Accepted Risks and Justified Complexity

- Decisiones: D1–D5 preservadas con resolutor, fuente, estado y
  supersesión; D2 reemplaza solo el alcance local de `b329eea`. T1–T3
  resueltas por el usuario en to-spec. No queda ninguna decisión importante
  abierta.
- Desviaciones: ninguna.
- Riesgos aceptados: ninguno. Los límites de evidencia no se convierten en
  riesgos aceptados.
- Complejidad justificada: el límite de D1 entre el idioma del usuario y el
  inglés entre agentes; el alcance de D2 para todos los proyectos
  consumidores, que exige la regla en el paquete; y la cobertura de ambos
  modos, ambas variantes y los cuatro Contracts, que deriva de T1. No se
  añade compuerta, clasificador, linter, servicio de traducción, canal ni
  opción pública.

## Pruebas y límites de evidencia

La especificación exige pruebas deterministas de entrega de instrucciones
en el padre (ambos modos y entrega de resultados) y en los hijos (cuatro
Contracts y continuación), además de las pruebas existentes de superficies
sin cambios. La aceptación de comportamiento es QA futura con sesiones
reales de Pi y evidencia de transcript por escenario; sin credenciales o
sin Pi instalado, queda no verificada o bloqueada, nunca aprobada por
inferencia. El gate del repositorio sigue siendo `npm run check`.

Sigue sin demostrarse: la causa raíz completa del síntoma, el cumplimiento
del modelo frente a la instrucción y el prompt efectivo de un hijo
continuado. La presencia de instrucciones prueba entrega, no cumplimiento.
Este informe no registra ejecuciones de pruebas ni de QA.

## Publicación y handoff

Cuatro roles distintos bajo el mismo paquete: brief estable y revisión
funcional final (feature-critic), especificación final y este informe
(to-spec). Según T3, viajan en un pull request solo de documentación hacia
`main`, sin autorización de merge ni de implementación. La identidad del
parent, la publicación y su lectura de vuelta pertenecen al handoff de
publicación.

Tras la verificación independiente y la publicación verificada, se entrega
a `to-tickets` la especificación, este informe, el brief y la revisión
funcional, con D1–D5, T1–T3, invariantes, obligaciones de prueba y el
estado de recomendación del seam.

## Verificación independiente

El verificador independiente devolvió **PASS — documentación únicamente**
para los tres digests de entrada de la tabla y para el informe de síntesis
anterior a esta anotación, SHA256
`bbd25e84159556ddf052b13e4fc241aa234795745f71b2d3b57a890bae091485`.
No encontró contradicciones materiales. Esta anotación cambia el digest de
este informe, no el del brief, la revisión funcional ni la especificación.

El verificador leyó los cuatro documentos, los contratos aplicables,
`GLOSSARY.md`, ADR 0010/0015/0017/0025 y la enmienda pertinente de ADR 0023.
Contrastó la recomendación de Pi con su documentación 1.4.0 completa,
el ejemplo oficial y las declaraciones y fuentes del SDK. Confirmó D1–D5,
T1–T3, el veredicto READY y la separación entre requisitos, recomendaciones,
entrega de instrucciones y comportamiento observado.

Las comprobaciones de solo lectura terminaron con código 0:

- `PASS: 3 supplied hashes, 8 local links`.
- `PASS: cross-document digest identity, no self/circular digest dependencies, whitespace/newline/conflict-marker checks`.
- Diff de archivos tracked y staged vacío; comprobaciones de whitespace sin
  errores. Los cuatro documentos nuevos también se comprobaron explícitamente.

No ejecutó `npm run check`, pruebas de implementación ni QA real. No
reprodujo la conversación original, las lentes funcionales ni el transcript
privado; verificó fidelidad contra las decisiones suministradas y los
artefactos estables, y contrastó por separado las afirmaciones del
repositorio y del SDK. Tampoco realizó publicación ni verificó la identidad
del issue o la PR. La ejecución del gate final y los read-backs de
publicación quedan a cargo del orquestador.
