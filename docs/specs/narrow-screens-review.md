# Informe de síntesis: Chrome en pantallas estrechas

- Rol: informe de síntesis técnica (to-spec).
- Paquete: `narrow-screens/definition-1`.
- Especificación: [narrow-screens.md](narrow-screens.md), identidad `narrow-screens/specification-1`.
- Brief estable: [definición aceptada](../features/narrow-screens.md).
- Revisión funcional final: [feature-critic](../features/narrow-screens-review.md).
- Contrato de prototipo: [approved-narrow-screens-v1.md](../../prototype/narrow-screens/approved-narrow-screens-v1.md), solo referencia.

## Estado

- Veredicto funcional preservado: **READY WITH WARNINGS** (comprobación final del 2026-11-21).
- Especificación: sintetizada; no implementada.
- Publicación, issue padre y lecturas de vuelta: pertenecen al handoff de publicación.
- QA de comportamiento, comprobación en el dispositivo y `npm run check` de implementación: no ejecutados.

Este informe consolida la crítica funcional vigente y la síntesis; no es una revisión independiente de implementación ni declara validación de comportamiento.

## Readiness

El brief identifica problema, usuario, alcance en tres slices, escenarios, decisiones con resolutor, fuente, estado y supersesión, supuestos, capacidades compartidas, dependencias, desviaciones, riesgos y exclusiones. El prototipo tiene disposición explícita: solo referencia, contrato v1, con una nota de puntos superados en la que gana el brief. La revisión funcional corresponde al paquete `narrow-screens/definition-1`, consolida tres lentes independientes y no conserva blockers ni warnings sin disposición.

- Autoridad semántica: `GLOSSARY.md`, estado `present (root-selected)`. No se suministró Domain Authority Handoff; la ausencia es admisible porque las decisiones funcionales y semánticas están cerradas, y queda como brecha de evidencia.
- ADR vinculantes: 0007, 0019 y 0031. ADR 0031 (aprobada por el owner el 2026-11-21) enmienda ADR 0019 por debajo de 60 columnas, y ADR 0019 lleva el puntero de enmienda.
- `docs/features/header-identity.md` sigue siendo autoritativo para el header.

La síntesis no repitió el descubrimiento ni cambió el producto aprobado. Durante la síntesis el padre resolvió, bajo la delegación del owner, dos ambigüedades de asignación:

- Aclaración del mapa de slices (padre, 2026-11-21): los elementos derivados del carril de glifos van al slice 1; el hint de thinking, la palabra de estado y el motivo de las tarjetas, los colores de error y aborto, la sangría colgante de Asked y las reglas de etiquetas de D-open-2 van al slice 2. La tarjeta Advisor se divide: cabecera corta `Advisor 12s ›`, modelo en su propia línea y cola siempre visible en el slice 1; glifo `◆` en lugar de `◇` en el slice 2. Es una asignación de comportamiento ya aprobado, no un cambio funcional.
- D-open-2 (delegada por el owner; padre, 2026-11-21): la palabra de fase `stopped` del Advisor también pasa a `cancelled` por debajo de 60 columnas, en el slice 2, porque la justificación delegada era precisamente esa discrepancia.

## Hallazgos de la síntesis

- Nota del brief sobre `foldChat`: no aplica margen propio. Suministra la sangría que consumen tres puntos de `chrome-groups.ts`: la fila de etiqueta de grupo, el recorte del ratón por fila y el punto de activación del cursor de teclado. La especificación lista esos tres puntos como sitios de margen en lugar de `foldChat`, dentro de la disposición W2.
- `marginFor` es compartido por el header, la fila de estado, el footer, el editor, la pregunta al operador, la Fleet view y los selectores de Pi. Cambiarlo globalmente movería el header, contra B3; la especificación lo registra como restricción obligatoria.
- Para que la regla D-open-1 se cumpla, la tabla única de glifos de estado debe conservar los glifos anchos actuales (`□`, `⧖`).
- Por el contrato de `docs/specs/bounded-todo.md`, NS-28 sustituye por debajo de 60 columnas solo las filas de marco, las filas en blanco y el objetivo `×`, dentro del mismo presupuesto de filas.
- Brecha de evidencia cerrada: la revisión funcional citaba HEAD `42f760d`, pero ese commit es ancestro de `7fad399`, que es el HEAD inspeccionado y el commit de los renders. `extensions/` coincide con los renders.

## Decisiones estructurales

| ID | Decisión | Etiqueta y fuente |
|---|---|---|
| S-01 | Una constante de 60 columnas y un único predicado estrecho que lee las columnas vivas del terminal en cada render | Obligatoria: NS-01, NS-02; W3, W1 |
| S-01a | Constante y predicado en el módulo de visual language, alimentados por el TUI que ya tiene el Chrome; respuesta "ancho" sin terminal montado | Recomendación |
| S-02 | Un helper de márgenes con valores izquierdo y derecho separados en cada sitio, con una prueba de desplazamiento del ratón por sitio | Obligatoria: NS-04; W2 |
| S-02a | Profundizar el seam existente de `edgeFor` | Recomendación |
| S-03 | El margen compartido del editor y los overlays no cambia el header | Obligatoria: NS-25; B3 |
| S-03a | Margen estrecho aplicado en cada consumidor, sin tocar la llamada del header | Recomendación |
| S-04 | Una tabla de glifos de estado en `visual-language.ts` con mapeos Run state y Task state, fila `⊘` y glifos anchos actuales | Obligatoria: NS-14; W6, W10 |
| S-05 | Un formateador de duraciones compartido por `formatDuration` y `childElapsed` | Obligatoria: NS-07; B1 |
| S-05a | `childElapsed` calcula milisegundos y delega el formato | Recomendación |
| S-06 | `RuntimeNoticeCard` recibe por separado la cabecera, la acción y el estado opcional | Obligatoria: NS-22; B2 |
| S-07 | Formato de hints, marco, scroll con hints fijos y marcador de selección solo en el módulo de menús compartido | Obligatoria: NS-16, NS-11; W8, W7 |
| S-08 | La pregunta al operador no publica hints de footer por debajo de 60 columnas y los muestra dentro del panel | Obligatoria: ADR 0031; W5 |
| S-09 | Ancho de overlay calculado al abrir; sin reflow | Obligatoria: NS-09; W9 |
| S-10 | La cabecera del Todo es objetivo de colapso; capacidad sin filas de marco | Obligatoria: NS-28; W4 |
| S-11 | Parche nuevo de Markdown en el conjunto de parches de mensajes, con nota de fuente | Obligatoria: ADR 0007; S2 |
| S-11a | Usar la propiedad de tema `codeBlockIndent` donde baste | Recomendación |

## Desviaciones, riesgos aceptados y brechas

- Desviación aprobada: por debajo de 60 columnas, la pregunta al operador sustituye el cursor `❯` y las descripciones a la derecha de `prototype/operator-question/approved-questions-v2.md`, y muestra sus hints dentro del panel mientras el footer oculta los suyos. Registrada por ADR 0031, que enmienda ADR 0019; ubicación, ancho, marco y altura no cambian.
- Riesgo aceptado W9: un overlay abierto durante un cambio de tamaño que cruza 60 columnas no se redistribuye y conserva su diseño hasta reabrirse. Aceptado por el owner el 2026-11-21: es raro y reabrirlo lo corrige.
- Brecha W6 para `domain-modeling`: la etiqueta de UI "Subagents" no es un término del glosario, que nombra Child session; también queda pendiente qué estado del glosario nombra cada fila de la tabla de glifos (Run state o Task state). La especificación conserva la etiqueta "Subagents" como comportamiento actual y no renombra nada.
- Brechas abiertas: el tamaño real del terminal en el iPhone y el ancho de los glifos con fuentes de respaldo de iOS. Son el criterio de salida del slice 2.
- Riesgos con mitigación: el sello cambia de posición durante el streaming; una actualización de Pi puede romper los parches, ahora también el de Markdown.
- Complejidad justificada: dos diseños por componente, por D-open-1.

## Pruebas y límites de evidencia

La especificación exige pruebas de salida renderizada y enrutamiento del ratón en los seams existentes más útiles, con los helpers de `test/support/README.md`, pruebas de regresión del diseño ancho a 60 y 100 columnas, pruebas de límite a 59 y 60, y pruebas de conservación del estado al cambiar de tamaño. La comprobación en el dispositivo y la revisión visual del streaming son manuales y no se declaran. El gate sigue siendo `npm run check` en el commit exacto de cada implementación. Mutation testing no está soportado por la política nativa y no bloquea.

## Publicación y handoff

Cuatro roles bajo el mismo paquete: brief estable y revisión funcional (feature-critic), especificación final y este informe (to-spec). El índice de especificaciones deja el campo de tracker pendiente hasta que exista el issue padre. Tras la publicación verificada, se entrega a `to-tickets` la especificación, este informe, el brief y la revisión funcional, con NS-01 a NS-35, D-open-1, D-open-2, la aclaración del mapa de slices, S-01 a S-11, invariantes, la desviación de ADR 0031, el riesgo aceptado W9, la brecha W6 y la compuerta del slice 2.
