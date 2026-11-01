# Revisión: contexto del hijo en Fleet

## Paquete y veredicto

- Paquete vigente: `fleet-context-usage/definition-2`.
- Brief: `docs/features/fleet-context-usage.md`.
- SHA256 del brief revisado: `ec1ee5033c8224fb230f404236c3eea854e069e5527366831d424fbbd6b22194`.
- SHA256 de la captura ordenada de artefactos de definition-2:
  `075a1edac3c92b7a97e0d9519f3da11763413fd2e38afc500773d70a4b30c612`.
- La captura permaneció idéntica entre lanzamiento y consolidación; el
  informe incluido en ella era la versión con disposiciones por reverificar.
  Después solo se registraron este veredicto, las disposiciones y el estado
  editorial READY del brief, sin cambios materiales a la definición.
- Veredicto: **READY**. Todos los hallazgos tienen disposición; las
  correcciones fueron reverificadas. No quedan blockers ni warnings abiertos.
- La crítica es de fuentes y definición, no validación de implementación.
  Las lentes no ejecutaron pruebas ni el binario de Pi.

Captura anterior: `fleet-context-usage/definition-1`, SHA256 del brief
`61e326c5c3bb6786c6c2bdb6482e0d51e242e0fcc067dc2a7adeba6d442cd02b`,
SHA256 del paquete
`02a8a8fd825f35c82a15e6d8415e4812b80cf02adb22db25d60c05027c3d82ad`.
Su BLOCKED inicial quedó resuelto por las correcciones y la reverificación.

Tres lentes independientes revisaron la misma captura:

1. Necesidad y coherencia: `ceed0144-3838-4862-aa75-116bd6edfa74`.
2. Alcance y proporcionalidad: `486194b2-36b2-4c38-a743-f277241f820e`.
3. Viabilidad y coherencia transversal: `458e8081-293f-478f-87e4-4e8f2ec83e17`.

La reverificación de definition-2 usó tres contextos independientes:

1. Necesidad y coherencia: `5cf8e42a-fc3a-4c39-af8e-b16253a53341`.
2. Alcance y proporcionalidad: `6d00c51e-cefa-4090-9c4b-d86dbea76d8b`.
3. Viabilidad y coherencia transversal: `436a6bc4-634f-4d4c-9c55-98bc9bdcdb9e`.

La reconciliación de un duplicado de R5 quedó a cargo de su misma lente,
`48b1ccea-721f-449f-93ed-abcdfc1adf2a`, sin cambio de definición.
La lente de alcance verificó documentos y disposiciones; las otras lentes
revisaron además fuentes relevantes, con evidencia anterior sin cambios.

Los duplicados se consolidan por la evidencia más fuerte. Ninguna
recomendación sustituye D1–D14. Los mecanismos pertenecen a `to-spec`.

## Hallazgos consolidados

### R1. Invalidación tras compactación y respuestas tardías

- Lente: viabilidad; relacionado con coherencia.
- Clase: riesgo fundamentado. Severidad: warning.
- Evidencia: D7; `agent-session.js:3500-3521`, eventos de compactación
  `:2323-2337`; `rpc-child.ts:256-267`.
- Necesidad: no presentar contexto previo a una compactación como actual.
- Impacto: si la compactación tiene éxito pero falla o se retrasa la lectura,
  D7 podría conservar el porcentaje anterior. Una respuesta iniciada antes
  de compactar también podría restaurarlo.
- Complejidad: una precedencia funcional explícita; no requiere elegir
  almacenamiento ni transporte en el brief.
- Owner: `feature`, después `to-spec`.
- Recomendación: invalidar al confirmar una compactación exitosa, descartar
  lecturas anteriores que lleguen tarde y mostrar ocupación desconocida
  hasta tener una lectura posterior. Una compactación fallida o abortada
  no invalida por sí sola la medición.
- Disposición: corrección aceptada por el desarrollador mediante `Si` a la
  vista previa de reglas de confianza; aplicada como D12. La invalidación
  inmediata prevalece sobre el fallback y descarta respuestas anteriores.
  Cerrado: las lentes de necesidad y viabilidad verificaron la precedencia
  y que el evento permite distinguir éxito, fallo y aborto. No es aceptación
  de riesgo residual.

### R2. Estado desconocido retenido

- Lente: necesidad y coherencia.
- Clase: riesgo fundamentado. Severidad: warning.
- Evidencia: D5/D7; `getContextUsage()` puede devolver capacidad conocida
  con ocupación null después de compactar.
- Necesidad: representar fielmente el último estado al terminar o reabrir.
- Impacto: los ejemplos no muestran explícitamente la combinación `?` y
  `last`, aunque la composición de D5/D7 la sugiere.
- Complejidad: aclaración de una combinación de estados ya aprobados.
- Owner: `feature`.
- Recomendación: hacer explícito `ctx ? · 200K · last`, sin recuperar un
  porcentaje anterior ni convertir una capacidad conocida en desconocida.
- Disposición: corrección aceptada en la misma vista previa; aplicada como
  D13, con `ctx ? · 200K · last` explícito. Cerrado por la lente de necesidad.

### R3. Dimensiones extremas

- Lentes: necesidad, alcance y viabilidad.
- Clase: riesgo fundamentado. Severidad: warning.
- Evidencia: D9; `children-view.ts:1511-1513` recorta las filas del header
  con `slice(0, rows)` y reserva espacio al transcript.
- Necesidad: no desbordar y no prometer visibilidad imposible.
- Impacto: falta un cierre explícito del recorte cuando ni siquiera caben
  porcentaje y `last`. Una altura mínima puede recortar cualquier fila fija.
- Complejidad: evitar una reorganización especial del header para alturas
  extremas conserva el alcance; el recorte final ya existe en la vista.
- Owner: `feature`; comprobación posterior en `to-spec`.
- Recomendación: conservar barra → conteos → recorte final, sin nuevos
  niveles; acotar la visibilidad fija al espacio disponible del header y
  conservar su recorte vertical actual, sin rediseño para alturas extremas.
- Disposición: corrección aceptada por el desarrollador mediante `Si` a la
  vista previa separada de simplificación R3/R6; aplicada como D10.
  Cerrado por las tres lentes. Es un límite de alcance aprobado, no
  aceptación de riesgo residual.

### R4. Resultado observable de las actualizaciones

- Lente: viabilidad.
- Clase: riesgo fundamentado. Severidad: warning.
- Evidencia: `rpc-child.ts:256-267` no tiene deadline por consulta;
  `:497-499` silencia errores de `entries()`; las respuestas RPC no pasan a
  `onEvent`; `child-handle.ts:40-52` no expone resultado de medición.
- Necesidad: cumplir D6/D7 sin mantener indefinidamente un valor como fresco.
- Impacto: una consulta colgada puede no clasificarse como fallida; una
  respuesta tardía puede no disparar un render.
- Complejidad: sin ampliar estados ni disparadores del producto.
- Owner: `to-spec`, con disposición en `feature`.
- Recomendación: exigir que la síntesis resuelva respuestas, fallo, falta de
  respuesta y notificación de la vista; no seleccionar aquí un timeout,
  canal o estructura de estado.
- Disposición: corrección aceptada en la vista previa de confianza y
  aplicada como D13: un dato retenido durante consulta pendiente o fallida
  se marca `last`, sin prevalecer sobre D12. El brief registra como obligación
  de síntesis resolver finalización/fallo/falta de respuesta y notificar la
  vista. No se seleccionan mecanismos ni se declara riesgo aceptado.
  Cerrado por las lentes de necesidad y viabilidad: el contrato funcional
  está resuelto; el mecanismo aún corresponde a síntesis e implementación.

### R5. Retención con auditoría incompleta

- Lente: viabilidad.
- Clase: riesgo fundamentado. Severidad: warning.
- Evidencia: `child-audit.ts:214-224`, `:324-405`, `:737-750`,
  `:1678-1740`; `children-view.ts:641-654`.
- Necesidad: no fabricar la última medición ni recuperar datos anteriores
  a una invalidación conocida.
- Impacto: límites de captura o un registro sin cierre pueden hacer que
  la medición más reciente no sea recuperable. Un dato anterior podría
  parecer la última medición del contexto posterior.
- Complejidad: retener capacidad y ocupación es parte de D5; no se requiere
  migración ni una nueva garantía de durabilidad ante pérdida de energía.
- Owner: `to-spec`, con disposición en `feature`.
- Recomendación: definir el significado recuperable de `last` y cuándo se
  muestra `ctx unavailable` por falta de evidencia confiable. No aceptar
  pérdida silenciosa ni inferir capacidad a partir del modelo actual.
- Disposición: corrección aceptada en la vista previa de confianza;
  aplicada como D14. Sin evidencia que identifique una medición válida se
  muestra unavailable, sin inferir datos de un contexto anterior. La
  recuperación técnica debe demostrar ese contrato. Cerrado por las lentes
  de necesidad y viabilidad. La advertencia duplicada fue retirada por su
  lente; no se acepta como riesgo ni se afirma implementación existente.

### R6. Mantener los límites ya aprobados

- Lentes: alcance, necesidad y viabilidad.
- Clase: especulativo. Severidad: informative.
- Evidencia: D5–D8; `getSessionStats()` recorre entradas;
  `_limitsModel()` puede devolver un modelo enrutado.
- Necesidad: evitar añadir sondeo por token, un cuarto disparador, estados
  visuales nuevos, migraciones o reconstrucción histórica sin necesidad.
- Impacto: el dato es una instantánea entre los tres disparadores aprobados,
  no un medidor continuo. `last` puede representar un único dato retenido
  en lugar de estados distintos para cada origen.
- Complejidad: se evita ampliar alcance; se conserva la retención aprobada.
- Owner: `feature` y `to-spec`.
- Recomendación: mantener los tres disparadores, un solo significado de
  dato retenido para `last` y ninguna reconstrucción de registros antiguos.
  No convertir mecanismos sugeridos por las lentes en requisitos.
- Disposición: mantener el alcance, aceptado por el desarrollador mediante
  el mismo `Si` a R3/R6; registrado como D11. Sin nuevos disparadores,
  estados de `last` ni reconstrucción histórica. Cerrado por las tres lentes.

### R7. Aclaraciones editoriales y paridad del medidor

- Lentes: necesidad y viabilidad.
- Clase: especulativo. Severidad: informative.
- Evidencia: `children-view.ts:142-146` usa `180.0k tok`, no `180K tok`;
  `chrome.ts:74-80`, `:109-161` contienen formato, redondeo y colores;
  las funciones del medidor no están exportadas. GLOSSARY define Fleet view.
- Necesidad: ejemplos fieles y paridad observable sin refactor ajeno.
- Impacto: el ejemplo podría sugerir cambiar el acumulado, contra D4.
- Complejidad: solo aclaraciones; compartir implementación o comprobar
  paridad pertenece a la síntesis, no requiere decidir arquitectura aquí.
- Owner: `feature` para ejemplos y vocabulario; `to-spec` para paridad.
- Recomendación: ajustar el ejemplo al formato existente; usar Fleet view
  y detalle como descripción, no nuevo término canónico; explicitar el
  mismo porcentaje redondeado y reglas de celdas de la cabecera principal.
- Disposición: corrección editorial aplicada por el orquestador bajo la
  política autónoma. El ejemplo conserva `180.0k tok`; el título usa Fleet
  view y detalle como descripción; se explicitan las reglas numéricas ya
  heredadas de la cabecera principal. Sin cambio de intención. Cerrado por
  las lentes de necesidad y viabilidad.

## Capacidades compartidas

La lente transversal inspeccionó fuentes y muestras hermanas:

| Capacidad | Muestras y evidencia | Resultado |
| --- | --- | --- |
| Medidor principal | `usageColor`, `contextSegments`, `renderHeader`, `test/chrome.test.mjs`, brief header-identity | compatible; decidir reutilización técnica o comprobaciones de paridad después |
| Formato de tokens | `chrome.ts:74-80`, `children-view.ts:142-146` | compatible; el acumulado sigue sin cambios |
| Ancho y saneamiento | header y footer en `chrome.ts`, `chrome-editor.ts:35-37`, header de Fleet | authorized divergence por D9; no reaplicar márgenes |
| Capacidad desconocida | header principal omite; D8 muestra unavailable | authorized divergence explícita para Fleet |
| Header fijo y navegación | `header`, `renderDetail`, `historical`, selección live/history en children-view | compatible; R3 acota dimensiones |
| Acumulado separado | `spent` y sus usos en lista, grupos y header | compatible; no es fuente de ocupación |
| Medición propia del hijo | `getSessionStats`/`getContextUsage`, RPC get_session_stats, request/refresh existentes | compatible a nivel fuente; R1/R4 cerrados en definición |
| Ciclo de vida | ready/dispose/abort, ChildHandle, adopción tras reload, ADR 0023 | compatible; queued sin proceso |
| Auditoría e historial | Evidence/execution/seal/tailOf/summary; historical; child-transcript keyOf; ADR 0026 | compatible a nivel fuente; R5 cerrado en definición |
| Autoridad | GLOSSARY, ADR 0007/0023/0026, brief de historia | authorized divergence respecto del viejo brief in-process, gobernada por ADR 0023 |

No se identificó unauthorized divergence. La ausencia declarada del Domain
Authority Handoff y su authority review es admisible. No hay prototipo ni
Approved Prototype UI Contract. Las limitaciones de runtime no se presentan
como pruebas ejecutadas ni como riesgos aceptados.

## Decisions, Deviations, Accepted Risks and Justified Complexity

- Decisiones: D1–D9 se mantienen con las precisiones registradas;
  D10/D11 recogen la simplificación y D12–D14 las reglas de confianza,
  todas aprobadas por el desarrollador. Ninguna lente puede sustituirlas.
- Desviaciones: únicamente las autorizadas indicadas en la matriz.
- Riesgos aceptados: ninguno. R1–R7 tienen corrección o mantenimiento
  dispuesto y reverificado; están cerrados en la definición.
- Complejidad justificada: retención histórica (D5), distinción entre null
  e unavailable (D3/D8), invalidación poscompactación y dato retenido (D7),
  y prioridad por ancho (D9), todas aprobadas por el desarrollador.
- Revisión requerida: aplicar solo deltas aceptados, devolver correcciones
  a sus lentes y repetir las tres lentes si cambia materialmente el paquete.

## Hallazgos de la reverificación y disposiciones

### V1. Fin tras invalidación sin lectura posterior

- Lente: necesidad. Clase: especulativo. Severidad: informative.
- Evidencia: D12/D13 y las reglas de invalidación y ocupación desconocida.
- Necesidad e impacto: al terminar antes de leer otra vez, no recuperar el
  porcentaje invalidado. La capacidad debe proceder de evidencia disponible.
- Complejidad: ninguna adicional; no crea estado ni requisito de producto.
- Owner: `to-spec`.
- Recomendación de la lente: tratar el caso como consecuencia de D12/D13,
  sin introducir otra decisión funcional.
- Disposición: accepted por el orquestador bajo la política autónoma;
  conservar como caso de síntesis y validación. Sin cambio al brief ni
  aceptación de riesgo. No reconstruir capacidad con un modelo actual.

### V2. Criterio de validez recuperable

- Lentes: necesidad y viabilidad. Evidencia: D14 y R5.
- Clase consolidada: especulativo tras retirar la advertencia duplicada.
  Severidad: informative.
- Necesidad e impacto: vincular ocupación y capacidad al contexto descrito;
  una invalidación perdida no puede dar apariencia de validez a un dato viejo.
- Complejidad: ninguna nueva para la definición; mecanismo sin seleccionar.
- Owner: `to-spec`.
- Recomendación: definir y comprobar evidencia de validez; sin ella,
  unavailable, incluso con pérdida de captura o registros sin cierre.
- Disposición: accepted como obligación de síntesis ya contenida en D14.
  La advertencia N1 de viabilidad fue retirada por su lente como duplicado
  de R5/F3, no por aceptación de riesgo ni por asumir un mecanismo existente.
  La lente confirmó que no queda decisión funcional o técnica en conflicto.

### V3. Mecanismo para respuestas tardías y actualización de la vista

- Lente: viabilidad. Clase: especulativo. Severidad: informative.
- Evidencia: ids correlacionados en `rpc-child.ts:256-267`, `:327-333`;
  manejo asíncrono RPC y orden observable de eventos/respuestas.
- Necesidad e impacto: cumplir D12/D13 y notificar mediciones nuevas sin
  esperar otro evento del hijo.
- Complejidad: ninguna nueva en la definición; no se prescribe un epoch,
  timeout, trama o formato.
- Owner: `to-spec`.
- Recomendación: tratarlo como obligación de síntesis y comprobación.
- Disposición: accepted por el orquestador bajo la política autónoma;
  la lente confirmó esa disposición. Sin cambio material ni riesgo aceptado.

## Handoff a to-spec

La definición aprobada y este informe forman el paquete conjunto para
síntesis técnica. No quedan preguntas materiales abiertas ni hallazgos sin
disposición. No se requiere prototipo funcional adicional según la evidencia.

La síntesis debe resolver adquisición y actualización del dato, invalidación
y respuestas tardías, persistencia y recuperación de validez, paridad del
medidor y pruebas de los estados aprobados. Debe mantener los límites de
D10/D11 y no convertir ejemplos de mecanismos en requisitos heredados.

Continúan sin verificar en runtime: latencia y orden de stats/eventos,
equivalencia del binario con la fuente del paquete, cambios de modelo sin
evento y recuperación bajo fallos de captura. READY es del contrato
funcional, no una afirmación de implementación ni prueba de esas conductas.
Publicación conjunta corresponde a `to-spec`; esta revisión no publica,
crea tickets, hace commits ni autoriza código de producción.
