# Revisión funcional final: límites de idioma por interlocutor

## Identidad y veredicto

- Rol: revisión funcional final (feature-critic).
- Paquete: `agent-communication-language/v2`.
- Handoff funcional: `agent-communication-language/v2/feature-critic-final`.
- Brief estable: [agent-communication-language.md](agent-communication-language.md).
- SHA256 del brief estable:
  `4a9b841d44f1cb0b12d5eed61ad308222e903f67bc6295697ca772b7bf5dbd5c`.
- Veredicto: **READY**. No quedan blockers ni warnings sin disposición.

Las lentes revisaron el paquete capturado en la conversación de definición,
es decir, el brief aceptado en español y su aclaración v2. El brief estable
es su captura en inglés con el mismo significado; el digest identifica ese
archivo, no una captura distinta revisada por las lentes. No hubo cambio
funcional después de la reverificación.

La crítica es estática: revisó documentos, fuentes del repositorio y el
transcript observado. No ejecutó pruebas, no validó comportamiento, no
seleccionó un mecanismo de implementación y no cambió código, archivos,
commits ni publicaciones.

## Lentes independientes

Tres lentes independientes revisaron un mismo paquete capturado:

1. Necesidad y coherencia (hallazgos F1–F8).
2. Alcance y proporcionalidad (hallazgos F1–F4).
3. Viabilidad y coherencia transversal (hallazgos F1–F6).

La aclaración v2 aprobada por el usuario es editorial: precisa el alcance
padre↔hijo original. Las lentes afectadas, necesidad y coherencia y
viabilidad, la reverificaron y no informan ningún blocker ni warning de
definición restante. La simplificación de redacción opcional de la lente de
alcance fue rechazada por el usuario; esa disposición, por sí sola, no es
material y no requirió reverificación.

## Disposiciones consolidadas

### C1. Simplificación del contenido transportado

- Origen: alcance F1.
- Disposición: rechazada por el usuario (D4). Se conserva la enumeración
  explícita original: código, identificadores, salidas de herramientas,
  citas y artefactos.

### C2. Conversación en el idioma del usuario

- Origen: alcance F2.
- Disposición: la recomendación de eliminar o no validar esta parte fue
  retirada. D1 sigue siendo complejidad justificada. Los mensajes de los
  hijos no reinician el idioma de la conversación con el usuario.

### C3. Arquitectura de cumplimiento y calidad de la evidencia

- Origen: alcance F3, necesidad F7, viabilidad F3.
- Disposición: se retiraron el criterio de éxito basado solo en la
  presencia de instrucciones y las afirmaciones de un mecanismo obligatorio
  de instrucciones o código. Los límites de evidencia existentes se
  reconocen; no son un riesgo de ejecución aceptado.
- La recomendación informativa residual de evitar una arquitectura de
  compuerta, clasificador o linter sin justificación se aceptó, bajo la
  política autónoma, como recomendación para la síntesis técnica. No es una
  decisión de mecanismo ni cambia la intención de producto. La síntesis
  técnica debe justificar el mecanismo y la validación de comportamiento.

### C4. Cobertura y premisa de la prueba local

- Origen: necesidad F1/F6, viabilidad F1/F3/F6, alcance F4.
- Disposición: corregida en las notas de handoff y cerrada a nivel de
  definición. Quedan cubiertas ambas direcciones, las variantes contextual y
  no contextual, los cuatro contratos, ambos modos de delegación y las
  superficies de herramientas existentes. La premisa de la prueba local es
  un objetivo esperado de implementación, no una contradicción de producto.
  No se exige borrar la regla local de `AGENTS.md` ni un ADR nuevo.

### C5. Canal de aclaración existente y respuestas directas en Fleet

- Origen: necesidad F2/F3, viabilidad F5.
- Disposición: corregida mediante D5, aprobada por el usuario y
  reverificada de forma independiente por ambas lentes. Solo se usan
  `spawn_child`, `continue_child` y `reply_child`; no hay un canal nuevo del
  padre a un hijo en ejecución. Steer y las respuestas directas del operador
  en Fleet no se modifican. Los informes y preguntas del hijo al padre
  quedan en inglés.

### C6. Evidencia adicional

- Origen: viabilidad F4.
- Disposición: el padre verificó en la línea 83 del transcript de origen un
  resultado de hijo con Reason y descripciones de `files_changed` en
  español. Cierra una nota de evidencia de apoyo; nunca fue un fallo de
  definición.

### Otros hallazgos retirados o consolidados

- Necesidad F4/F5/F8: alcance de la instrucción explícita de idioma del
  usuario, citas y solapamiento con el idioma de publicación. Retirados o
  consolidados en C1, C2 y D2.
- Viabilidad F2: la precedencia general de ADR 0017 se había leído mal.
  Retirado. No se introduce ninguna anulación de la jerarquía de
  instrucciones.

## Capacidades compartidas

Delegación y continuación, preguntas del hijo con respuestas del padre,
entrega de resultados, y Steer y respuestas en Fleet excluidas son
compatibles con el comportamiento deseado. Se preservan sus semánticas
actuales. No se identificó ninguna divergencia no autorizada.

## Autoridad

La autoridad semántica es el `GLOSSARY.md` raíz, resuelto por
`docs/agents/domain.md`, junto con ADR 0010, ADR 0015, ADR 0017 y ADR 0025.
No se propone ningún cambio de canon.

- Domain Authority Handoff generado: ausente; brecha admisible.
- Revisión de autoridad de solo lectura generada: ausente; brecha admisible.

Ninguna fuente de autoridad presente está malformada, bloqueada, obsoleta
ni contradictoria para esta definición.

## Decisions, Deviations, Accepted Risks and Justified Complexity

- Decisiones: D1, separación inicial de idioma solicitada por el usuario;
  D2, alcance general del harness elegido por el usuario, que reemplaza solo
  el alcance local previo de `b329eea`; D3, brief aceptado solo para la
  crítica; D4, enumeración original del contenido conservada; D5, exclusión
  aceptada de los mensajes directos del operador en Fleet y aclaración de
  canales existentes. Resolutor: el usuario. Estado: aceptadas, salvo la
  simplificación rechazada de D4. Fuente: elecciones en la conversación de
  definición. No queda ninguna pregunta funcional material.
- Desviaciones: ninguna autorizada.
- Riesgos aceptados: ninguno.
- Complejidad justificada: el límite explícito de D1 entre el idioma del
  usuario y el inglés entre agentes, y el alcance de D2 para todos los
  proyectos consumidores.

## Límites de validación

Crítica estática e inspección del transcript únicamente. Sin pruebas ni
verificación de comportamiento, sin causa raíz de ejecución completa
demostrada y sin mecanismo de implementación seleccionado.

## Siguiente paso

Entregar el brief v2 aceptado y este informe a `to-spec` para la síntesis
técnica y su publicación bajo su propio procedimiento. La implementación no
está autorizada.
