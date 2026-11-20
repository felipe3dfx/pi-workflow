# Revisión de la definición: advisor

Paquete: `advisor/definition-4`.
Handoff: `advisor/feature-review-3`.
Resultado: **READY WITH WARNINGS**.
Parent: #391.
Brief: [advisor.md](advisor.md).

Fecha: 2026-11-20. Prototipo: rama `prototype/advisor-card`, commit `93c0b5e87f2e43597a1cc1b0a403b6cbbc843b19`, contrato de UI v1 aprobado ([approved-advisor-card-v1.md](https://github.com/felipe3dfx/pi-workflow/blob/93c0b5e87f2e43597a1cc1b0a403b6cbbc843b19/prototype/advisor-card/approved-advisor-card-v1.md)), disposición `reference-only`.

Captura del paquete (sha256, verificada contra los archivos):

| Artefacto | sha256 |
|---|---|
| `docs/features/advisor.md` | `4e263f8435cd701d532235b60e84157ea232395cad5cc5fd394fb31c851a9b43` |
| `docs/adr/0030-advisor-capability.md` | `33942d287998c71da9b6d3903c0fa84e682f625e995171c1c1f4f2a8371973ae` |
| `docs/adr/0025-authorize-effects-not-harness-messages.md` | `611c3675e642189c227458d06d6fcb42a570bdb8df78ed6fa53b47c8aadd25b7` |
| `docs/adr/0015-delegation-mode-guided-by-prompt.md` | `d4ebdad9487fae6035a0cf6071883469eefb7da0224bfd3a12757e3d98e39fc6` |
| `docs/adr/0009-guided-configure.md` | `a9e5091f6f5cc517cd6f3d115261575202d2acb13fad77969993eb84df21eca2` |
| `docs/adr/0012-consolidate-workflow-command-entrypoint.md` | `c335bec79019f421c1d8db5bd62dcf0aefa88fae192286e16abc53735f998eac` |
| `GLOSSARY.md` | `5193fb73cb0bed818b7a504eb55316cb2d665592fbb6b88b2c62ee639dcf6708` |

## Veredicto

`READY WITH WARNINGS`. No queda ningún bloqueo. Todo hallazgo tiene disposición: está corregido y reverificado, aceptado como restricción o nota para la spec, rechazado con razón, o lleva `risk accepted` (R1–R7, aceptados por Felipe el 2026-11-20). Las correcciones editoriales finales de la ronda 3 (identificadores NC3-3 a NC3-7, FE3-3, FE3-4) preservaron el significado, por lo que no hizo falta una nueva ejecución de lentes.

## Rondas

| Ronda | Paquete revisado | Resultado |
|---|---|---|
| 1 | `advisor/definition-1` | 2 blockers (FE1, FE3), advertencias NC1–NC6, FE2, FE4–FE8; disposiciones en `dispositions-1`: FE1 decidido por Felipe (opción 2, proyección de texto sin truncar más prompt de sistema en la solicitud, D8b); las demás corregidas, aceptadas o rechazadas |
| 2 | `advisor/definition-2` | 1 blocker (FE2-4); advertencias NC2-1, NC2-2, NC2-3, NC6 residual, FE2-1, FE2-2, FE2-3, FE2-5, FE2-6; Q6 resuelta por Felipe con D14; el resto corregido o aceptado como nota para la spec |
| 3 | `advisor/definition-3` | 1 blocker (NC3-1 = FE3-1: D14 contra ADR 0025); advertencias NC3-2, FE3-2; corregido con ADR 0030 enmendando ADR 0025 y ADR 0015, R7 aceptado; reverificación cerrada sobre `advisor/definition-4` sin blockers ni advertencias abiertos |

Cada ronda usó tres lentes independientes de solo lectura: necesidad y coherencia; alcance y proporcionalidad; factibilidad y coherencia transversal.

## Hallazgos

Los hallazgos duplicados entre lentes se consolidan en una fila, con la clase de la evidencia más fuerte. "Nec." resume la necesidad trazada; "Imp./Compl." el impacto y la complejidad añadida o eliminada.

### Ronda 1 (`dispositions-1`)

| # | Lente | Clase | Evidencia | Nec. / Imp. / Compl. | Sev. | Resp. | Recomendación | Disposición | Estado |
|---|---|---|---|---|---|---|---|---|---|
| NC1 / FE1 | need, feasibility | demonstrated failure | Escenario 8: "exactamente lo que llevaría la siguiente llamada" no era alcanzable y la proyección era una decisión técnica abierta (`context_with_system`, `emitContext`) | Escenario 8, "ve lo que ve el padre" / spec inimplementable / ninguna | blocker | `feature` | Elegir proyección y momento de captura | Felipe: opción 2, proyección de texto sin truncar más prompt de sistema al momento de la solicitud (D8b) | Corregido, reverificado (C13) |
| FE3 | feasibility | demonstrated failure | El lugar de pantalla declarado omitía el overlay que pinta `/workflow:advisor` (place map de ADR 0009) | D11 / divergencia no autorizada del contrato / ninguna | blocker | `feature` | Declarar overlay y message-stream | Corregido (D11) | Corregido, reverificado |
| NC2 / FE5 | need, feasibility | substantiated risk | `delegation-mode.ts:6-31`: `orchestrator` apartaba al padre del advisor | Escenario 12 / el padre no consultaría al advisor / un predicado "offered" | warning | `feature` | Añadir el advisor a la lista que el padre conserva | Corregido (escenario 12) | Corregido, reverificado (C12) |
| NC3 / FE4 / SP4 | need, feasibility, scope | substantiated risk | `reportStatus` no tiene línea por capacidad; escenario 7 introducía una no declarada | Ninguna trazada / reporte fuera de alcance / eliminar la línea | warning | `feature` | Quitar `advisor: on, no model` | Aceptado: sin línea de estado (D12) | Corregido, reverificado (C9 no aplica) |
| NC4 | need | substantiated risk | Archivo del modelo sin estado inválido o ilegible definido | Escenario 7 / comportamiento indefinido / ninguna | warning | `feature` | Definir archivo inválido como sin modelo | Corregido (escenario 7) | Corregido, reverificado |
| NC5 | need | substantiated risk | Sin resultado para una llamada con la tool retirada | Escenario 11 / llamada sin respuesta legible / ninguna | warning | `feature` | Rechazo legible | Corregido (escenario 11) | Corregido, reverificado |
| NC6 / FE6 | need, feasibility | substantiated risk | ADR 0030 no registraba la supersesión de ADR 0009 ni el precedente de ADR 0012 (`/workflow:models`) | Canon coherente / dos autoridades / editorial | warning | `domain-modeling` | Notas de Status en ADR 0009 y ADR 0012; ADR 0030 cita ADR 0012 | Corregido | Corregido, reverificado (residuo en ronda 2) |
| FE7 | feasibility | substantiated risk | GLOSSARY "Agent directory" no listaba el archivo del modelo del advisor | Canon coherente / glosario desactualizado / editorial | warning | `domain-modeling` | Listarlo | Corregido | Corregido, reverificado (C17) |
| FE8 | feasibility | substantiated risk | Modelos virtuales o puenteados del catálogo pueden ejecutar tools propias, contra "el advisor no tiene tools" | Escenario 8 / garantía no cumplible / ninguna | warning | Felipe | Registrar como riesgo | Riesgo aceptado como R4 | Riesgo aceptado |
| NC10 | need | speculative (elevado a riesgo por FE8 y R1) | R1 (contexto a otro proveedor) sin disposición registrada | Ninguna / riesgo sin dueño / ninguna | informative | Felipe | Aceptar o rechazar | Riesgo aceptado R1–R5 | Riesgo aceptado |
| FE2 | feasibility | substantiated risk | Desbordamiento no detectable exactamente antes de enviar (`ContextUsage`, `estimateTokens`) | Escenario 10 / detección imprecisa / eliminar la comprobación previa | warning | `feature` | Tratar el desbordamiento como error del proveedor | Corregido vía SP5 (D8b) | Corregido, reverificado en ronda 2 |
| SP1 | scope | speculative | Dos interruptores (fila de capacidad y archivo del modelo) | Felipe pide on/off en `/workflow:config` / ninguna / eliminar uno | informative | `feature` | Un solo interruptor | Rechazado: Felipe quiere on/off en `/workflow:config` | Rechazado |
| SP2 | scope | speculative | Clave `advisor` ausente leída como apagada mientras el archivo ausente se lee como encendido | Instalaciones existentes / inconsistencia / ninguna | informative | `feature` | Clave ausente = encendido | Aceptado (D3c, ADR 0030) | Corregido, reverificado |
| SP3 | scope | speculative | La tolerancia solo para advisor obliga a un ADR por cada capacidad futura | Ninguna / ADR futuros / generalizar | informative | `feature` | Generalizar la tolerancia | Rechazado: sin necesidad | Rechazado |
| SP5 | scope | speculative | Verificación dedicada de desbordamiento con mensaje propio | Ninguna / complejidad / eliminar | informative | `feature` | Desbordamiento = error del proveedor | Aceptado (D8b) | Corregido, reverificado (ver SP2-1) |
| SP6 / FE9 | scope, feasibility | speculative | Extraer el picker de `model-profiles-editor.ts` (R3) | R3 aceptado / regresión posible / extraer o evitar | informative | spec | Dejar la elección a la spec | Aceptado; luego sustituido por D16 | Corregido (D16) |
| SP7 | scope | speculative | Paso de guardado y aviso de descarte en `/workflow:advisor` | Ninguna / fricción / eliminar | informative | `feature` | Guardar al elegir | Aceptado (D13) | Corregido |
| SP8 | scope | speculative | Rechazar `/workflow:advisor` con la capacidad desasentada | Precedente `/workflow:models` / ninguna / ninguna | informative | `feature` | Permitirlo | Rechazado: se rechaza como `/workflow:models` | Rechazado |
| SP9 | scope | speculative | "Más el prompt de sistema del padre como contexto de solo lectura" | Editorial / ninguna | informative | `feature` | Reescribir | Corregido | Corregido |
| NC7 | need | speculative | Nada se muestra al operador mientras corre la llamada | Pi muestra la fila de la tool / ninguna | informative | `feature` | Mostrar progreso | Rechazado; luego superado por la tarjeta del advisor (D10) | Rechazado |
| NC8 | need | speculative | "Guardar un modelo retira la tool" sin camino que lo dispare | Escenario 6 / texto incorrecto | informative | `feature` | Reescribir | Corregido (redacción) | Corregido, reverificado en ronda 2 |
| NC9 | need | speculative | Instalación nueva asentada pero sin efecto y sin aviso | D3b/D3c / ninguna | informative | `feature` | Añadir aviso | Rechazado: intención de D3b/D3c | Rechazado |
| FE10 | feasibility | speculative (editorial) | `offerTool` vive en `tool-offer.ts` y no donde cita el brief | Editorial | informative | `feature` | Corregir cita | Corregido | Corregido |
| FE11 | feasibility | speculative (evidencia positiva) | A4 y abort son verificables hoy (`usage` del tool result, `signal`) | Ninguna acción | informative | n/a | Ninguna | Sin acción | Cerrado |
| FE12 | feasibility | speculative | Validador de superficie de comandos y tabla del README sin nombrar | Superficie de comandos / editorial | informative | `feature` | Listarlos en capacidades compartidas | Corregido | Corregido |

Notas de la ronda 1: el desarrollador pidió además una buena UI del advisor; el prototipo `prototype/advisor-card` (commit `93c0b5e`, contrato de UI v1 aprobado, `reference-only`) originó D10, el escenario 9 y el cambio de `pointAt` en `chrome-groups.ts`. La pregunta abierta Q6 (mensaje del harness y exención de autorización) se difirió a la spec y se resolvió en la ronda 2.

### Ronda 2 (`dispositions-2`)

| # | Lente | Clase | Evidencia | Nec. / Imp. / Compl. | Sev. | Resp. | Recomendación | Disposición | Estado |
|---|---|---|---|---|---|---|---|---|---|
| FE2-4 | feasibility | demonstrated failure | El escenario 7 contradecía el patrón de archivo declarado (`model-profiles.ts` rechaza y comprueba cambios en disco; `workflow-settings.ts:18-33` lee por defecto y sobrescribe) | Escenario 7 / contradicción interna / ninguna | blocker | `feature` | Citar `createDelegationMode`; sin comprobación de cambios en disco | Corregido | Corregido, reverificado |
| NC2-1 / SP2-1 / FE2-2 | need, scope, feasibility | substantiated risk | El texto de desbordamiento del contrato v1 (con conteo de tokens) contradecía D8b | D8b, escenario 10 / contrato incumplible / eliminar la comprobación previa | warning | `feature` | Reconocer el desbordamiento desde la respuesta fallida del proveedor, sin conteos | Corregido (escenario 10: reemplaza la línea de desbordamiento del contrato v1) | Corregido, reverificado; residuo FE3-2 |
| NC2-2 / FE2-6 / C21 | need, feasibility | substantiated risk (blocker si no se disponía) | Q6 abierta: autorización de la llamada del advisor en el host contextual | Escenario 14 / decisión diferida / un wrap `harnessMessage` | warning | Felipe | Decidir | Felipe: opción 1, herramienta del harness exenta de autorización como `reply_child` (D14, escenario 14) | Corregido; originó NC3-1 |
| NC2-3 | need | substantiated risk | GLOSSARY "Delegation mode" no coincidía con el escenario 12 | Canon coherente / dos autoridades | warning | `domain-modeling` | Añadir "consulting the advisor" | Corregido | Corregido, reverificado; originó NC3-2 |
| NC6 (residual) | need | substantiated risk | Los lugares del advisor faltaban en el contrato de asentamiento de ADR 0009 | Canon coherente / lectura incompleta | warning | `domain-modeling` | Registrar overlay y message-stream | Corregido: ADR 0030 registra los lugares | Corregido, reverificado |
| FE2-1 | feasibility | substantiated risk | La captura en `context_with_system` no ve ediciones de extensiones cargadas después de pi-workflow | Escenario 8 / el advisor recibe un prompt incompleto | warning | `feature` / spec | Restricción de registro tras `registerDelegationMode` | Corregido como restricción de la spec; riesgo aceptado R6 | Corregido, reverificado; riesgo aceptado |
| FE2-3 | feasibility | substantiated risk | `ModelSelectorComponent` de Pi no es construible desde la API de extensiones | Escenario 4 / picker inviable / extracción | warning | `feature` | Extraer el picker de `model-profiles-editor.ts` | Corregido (D16); R3 sigue | Corregido, reverificado |
| NC2-6 | need | speculative | Contrato y brief discrepaban en los estados vacío y rechazado | Escenario 9 / ambigüedad | informative | `feature` | Incluirlos | Corregido (`failed` con consejo vacío, `refused` con llamada tardía) | Corregido, reverificado |
| NC2-7 | need | speculative | No se dice si la llamada en curso aparece en la proyección | Spec / bajo | informative | `to-spec` | Nota | Nota para la spec (Evidence gaps) | Aceptado |
| NC2-8 (= NC8) | need | speculative | "Guardar un modelo retira la tool" | Escenario 6 | informative | `feature` | Reescribir | Corregido (ofrece o retira) | Corregido, reverificado |
| SP2-2 | scope | speculative | Defensas del contrato (S2, estado 18) frente al propio `execute` | Spec / bajo | informative | `to-spec` | Nota | Nota para la spec | Aceptado |
| SP2-3 | scope | speculative | Manejo de ancho del encabezado más allá del truncado simple (H6) | Contrato v1 aprobado / ninguna | informative | `feature` | Simplificar | Rechazado: el acortado intermedio es parte del contrato de UI v1 | Rechazado |
| SP2-4 / FE2-5 | scope, feasibility | speculative (elevado a riesgo) | "Modelo válido" ambiguo entre bien formado y disponible; decide si los fallos del escenario 10 son alcanzables | D15, escenarios 6 y 10 / oferta dependiente del catálogo | warning | `feature` | Válido = archivo bien formado; disponibilidad y thinking al llamar | Corregido (D15) | Corregido, reverificado |
| FE2-7 | feasibility | speculative (redacción) | "El modelo siempre se muestra" inalcanzable en rutas que no llegan a `execute` | Escenario 9 | informative | `feature` | Acotar | Nota para la spec; escenario 9 acotado | Corregido |
| FE2-8, FE2-10 | feasibility | speculative | Helpers de la tarjeta necesitan parámetros (toca tarjetas de child); el prompt capturado lleva la guía del padre sobre el advisor | Spec / bajo | informative | `to-spec` | Notas | Notas para la spec (Evidence gaps) | Aceptado |
| FE2-9 | feasibility | speculative (editorial) | El estado de consejo vacío y la enumeración de fallos del contrato v1 van detrás de su propia respuesta Q2 | Escenarios 9 y 10 | informative | `feature` | Alinear | Corregido; el escenario 10 nombra el texto | Corregido |

### Ronda 3 (dispositions en la conversación)

| # | Lente | Clase | Evidencia | Nec. / Imp. / Compl. | Sev. | Resp. | Recomendación | Disposición | Estado |
|---|---|---|---|---|---|---|---|---|---|
| NC3-1 / FE3-1 | need, feasibility | demonstrated failure | D14 añadía el advisor a la lista cerrada de ADR 0025 (`0025:13`), cuyo criterio excluye tools que actúan sobre servicios externos; ADR 0030 no lo registraba | D14, R1, escenario 14 / contradicción con un ADR aceptado en una regla de seguridad / editorial (una cláusula y una nota de Status) | blocker | `domain-modeling` | Enmendar ADR 0025 solo para añadir el advisor, con el motivo | Corregido: ADR 0030 enmienda ADR 0025 (advisor añadido a la lista cerrada, con motivo), nota de Status en ADR 0025, escenario 14 reescrito citando R4 | Corregido, reverificado |
| NC3-2 | need | substantiated risk | El glosario y el escenario 12 ampliaban la lista de `orchestrator` de ADR 0015 sin registro | Canon coherente / dos autoridades / editorial | warning | `domain-modeling` | Enmendar ADR 0015 solo para añadir la consulta al advisor | Corregido: ADR 0030 enmienda ADR 0015 (el orquestador sigue consultando al advisor), nota de Status en ADR 0015 | Corregido, reverificado |
| FE3-2 | feasibility | substantiated risk | `overflow.d.ts:39-41`: un proveedor (p. ej. Ollama) puede truncar en silencio y no se detecta; el escenario 8 promete contexto sin truncar | Escenario 8, D8b / consejo sobre contexto truncado sin aviso / ninguna | warning | Felipe | Registrar el riesgo, sin detección | Riesgo aceptado como R7 | Riesgo aceptado |
| SP3-1 | scope | speculative | "Ofrecida solo mientras…" se leía como seguimiento continuo del archivo | D5 / posible vigilancia de archivo / eliminar | informative | `feature` | Oferta evaluada en el arranque, al cambiar el asentamiento y al guardar | Corregido: sin vigilancia de archivo; una llamada con archivo inválido tardío devuelve un fallo legible | Corregido, reverificado |
| FE3-3 / NC3-5 | feasibility, need | speculative (editorial) | Línea de estado del brief citaba solo review-1; cita de la exención del mensaje del harness mal ubicada (`reply_child` está en `child-sessions.ts:1794`) | Editorial | informative | `feature` | Corregir | Corregido | Corregido, reverificado |
| NC3-3 | need | speculative | Tipos de fallo C4 del contrato v1 no reconciliados con el escenario 10 | Spec / bajo | informative | `to-spec` | Nota | Corregido como nota de Evidence gaps | Corregido, reverificado |
| NC3-4 | need | speculative | La nota de Status de ADR 0009 cubría solo la cláusula de selección inválida | Canon / editorial | informative | `domain-modeling` | Ampliar la nota a los lugares del advisor | Corregido | Corregido, reverificado |
| FE3-4 / NC3-6 | feasibility, need | speculative (editorial) | ADR 0030 y escenario 14 decían "la misma salida que la llamada del modelo del padre", pero R1 admite otro proveedor; R7 aparecía antes que R6 | Editorial | informative | `domain-modeling` / `feature` | Alinear | Corregido ("same kind of egress, possibly to a different provider"; R6 antes que R7) | Corregido |
| NC3-7 | need | speculative | El fallo del escenario 6 (edición externa) no estaba en la lista del escenario 10; la fuente de D14 citaba solo ADR 0025 | Spec / bajo | informative | `feature` / `to-spec` | Listarlo y citar ADR 0030 | Corregido (escenario 10 lista el fallo; la fuente de D14 cita ADR 0030) | Corregido |

Totales finales: 0 blockers abiertos, 0 advertencias sin disposición, 0 informativos abiertos. Los tres blockers (FE1, FE3, FE2-4) y el de la ronda 3 (NC3-1 = FE3-1) quedaron corregidos y reverificados. Advertencias con `risk accepted`: R1, R3, R4, R5, R6, R7 (R2 corresponde al costo y la latencia, aceptado en la ronda 1 con R1–R5).

## Coherencia transversal

Resultado final de las capacidades C1–C21 (`lens-feasibility-2` y `lens-feasibility-3`).

| # | Capacidad | Resultado |
|---|---|---|
| C1 | Picker de modelo (`model-profiles-editor.ts`) | compatible tras extracción (D16); riesgo R3 aceptado |
| C2 | Lectura y escritura del archivo del modelo | compatible con el patrón citado (`createDelegationMode`); divergencia autorizada respecto de `model-profiles` |
| C3 | `capabilities` / `readSelection` | divergencia autorizada (tolerancia de ADR 0030; cambia la comprobación de número exacto de claves) |
| C4 | Fila de la guía de config que nombra el comando | compatible |
| C5 | `placement` / `seated` (overlay y message-stream) | compatible (D11) |
| C6 | Oferta, retiro y rechazo de llamada tardía | compatible (D15: la oferta depende solo del asiento y del archivo) |
| C7 | Comprobaciones de disponibilidad y thinking (`profilePair`) | compatible |
| C8 | Los children nunca reciben la tool | compatible |
| C9 | Línea de `/workflow:status` | no aplica (eliminada por D12) |
| C10 | Superficie de comandos (uso, validador, README) | compatible |
| C11 | Comando fuera de `/workflow:config` | divergencia autorizada (ADR 0030, precedente `/workflow:models`) |
| C12 | Lista que conserva `orchestrator` | compatible; autorizada por la enmienda de ADR 0015 |
| C13 | Prompt de sistema al momento de la solicitud | compatible; residuo R6 aceptado |
| C14 | Stream puntual con modelo, thinking, abort y usage | compatible |
| C15 | El uso entra en el costo de la sesión | compatible |
| C16 | Desbordamiento como error del proveedor | divergencia autorizada respecto del contrato v1 y de la detección previa (D8b, escenario 10); residuo R7 aceptado |
| C17 | Canon del Agent directory | compatible |
| C18 | Helpers de la tarjeta (familia `child-result-card`) | compatible con extracción (parametrización: nota para la spec) |
| C19 | `chrome-groups` `pointAt` y estado de fila | compatible (una regex, D10) |
| C20 | Fila de tool de Pi: shell propio, update parcial, expansión, clic, abort | compatible |
| C21 | Exención de autorización (D14) | divergencia autorizada (ADR 0025 enmendada por ADR 0030, nota de Status); mecanismo compatible |

Ninguna capacidad quedó con divergencia no autorizada ni con evidencia insuficiente.

## Decisiones, desviaciones, riesgos aceptados y complejidad justificada

| Elemento | Motivo, fuente y evidencia | Impacto y artefacto afectado | Disposición |
|---|---|---|---|
| Tolerancia de `readSelection` para clave `advisor` ausente, leída como encendida (D3c) | Evita bloquear instalaciones existentes en `/workflow:config`; SP2, ADR 0030 | Solo el advisor (SP3 rechazado); `configure.ts` | Aceptada por Felipe, 2026-11-20; recorrido en ADR 0030 y nota en ADR 0009 |
| `/workflow:advisor` fuera de `/workflow:config` (D2b) | Un picker en la guía enmendaría ADR 0009; precedente `/workflow:models`; FE6 | ADR 0012 (nota de Status) | Aceptada; registrada en ADR 0030 |
| D14: el advisor exento de autorización de acciones | Felipe, Q6, 2026-11-20; el operador autoriza al proveedor al elegir el modelo; la salida es del mismo tipo que una llamada de modelo, posiblemente a otro proveedor (R1); el modelo puenteado es R4 | ADR 0025: advisor añadido a la lista cerrada; se mantienen marcador, identidad de esquema y auditoría `kind: "exempt"` | Aceptada; canon registrado (ADR 0030, nota en ADR 0025) |
| Enmienda de ADR 0015: consultar al advisor, mientras se ofrece, en la lista de `orchestrator` | Escenario 12, FE5; sin ella el padre no podría usar la capacidad | ADR 0015 (nota de Status), GLOSSARY "Delegation mode" | Aceptada; registrada en ADR 0030 |
| D8b: proyección de texto sin truncar más prompt de sistema en la solicitud | Felipe, FE1; "ve lo que ve el padre" | Escenario 8; sustituye la verificación previa de desbordamiento | Aceptada |
| Desbordamiento reconocido desde la respuesta fallida, sin conteos | SP2-1 / FE2-2; el escenario 10 reemplaza la línea de desbordamiento del contrato v1 (línea 91), nombrando lo reemplazado | Contrato de UI v1 (`reference-only`) | Aceptada |
| D15: modelo válido = archivo bien formado; disponibilidad y thinking al llamar | SP2-4 / FE2-5 | Escenarios 6 y 10; sin escucha de catálogo | Aceptada |
| D16: picker extraído de `model-profiles-editor.ts` | FE2-3: Pi no ofrece un `ModelRuntime` a extensiones | Escenario 4; riesgo R3 | Aceptada |
| Ordenamiento de registro del captador tras `registerDelegationMode` | FE2-1 | `pi-workflow.ts`; residuo R6 | Restricción para la spec |
| Cambio de `pointAt` en `chrome-groups.ts:508` (una regex) | Contrato v1 F3; D10 | Complejidad justificada | Aceptada |
| Tarjeta del advisor según el contrato v1, con acortado intermedio | SP2-3 rechazado; contrato aprobado | `reference-only` | Aceptada |
| Rechazo de `/workflow:advisor` con la capacidad desasentada | SP8 rechazado; espejo de `/workflow:models` | Escenario 5 | Aceptada |
| Oferta evaluada en el arranque, al asentar y al guardar; sin vigilancia de archivo | SP3-1 | Escenario 6; un fallo legible cubre la edición externa tardía | Aceptada |
| R1: el contexto completo del padre, con resultados de tools, va al proveedor del advisor, que puede ser otro | NC10 | Escenario 14 | `risk accepted`, Felipe, 2026-11-20 |
| R2: costo y latencia por llamada; sin presupuesto | NC10 | Uso entra en el costo de la sesión (C15) | `risk accepted` |
| R3: cambiar el picker podría regresionar `/workflow:models` | SP6 / FE2-3 | `model-profiles-editor.ts` | `risk accepted` |
| R4: un modelo virtual o puenteado puede ejecutar tools propias | FE8 | Escenario 8, enmienda de ADR 0025 | `risk accepted` |
| R5: `ctrl+o` global expande todas las filas de tool, incluido un consejo largo | Prototipo R3 | Tarjeta del advisor | `risk accepted` |
| R6: ediciones al prompt de sistema por extensiones posteriores o por `before_provider_request` no llegan al advisor | FE2-1 | Escenario 8 | `risk accepted` |
| R7: un proveedor puede truncar el contexto en silencio y nada lo detecta | FE3-2 | Escenario 8, D8b | `risk accepted` |
| Brecha de evidencia admisible | No existe un Domain Authority Handoff separado; la autoridad de dominio se consume desde `docs/agents/domain.md` (`GLOSSARY.md`) | Ninguno | Registrada; ver Evidence gaps del brief |

Complejidad justificada: la tolerancia de `readSelection` se traza a las instalaciones existentes; el cambio de `pointAt` al contrato v1 F3; la captura del prompt de sistema en la solicitud al escenario 8 y a D8b; la doble puerta (fila de capacidad más archivo del modelo) a la petición explícita de Felipe de tener on/off en `/workflow:config` (SP1 rechazado).
