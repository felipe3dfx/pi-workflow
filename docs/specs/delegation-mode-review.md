# Revisión: Delegation mode

Paquete: `GLOSSARY.md` (Delegation mode), ADR 0015, `docs/specs/delegation-mode.md` y los tickets #230, #231 y #232, tal como se publicaron el 2026-10-08.
Handoff: ninguno. La revisión se corrió después de la primera publicación del spec y de los tickets, antes de implementar. No hay Domain Authority Handoff; es una brecha declarada y no bloquea por sí sola.
Lentes: completitud y coherencia, simplificación y alcance, factibilidad y coherencia transversal, en tres sub-agentes independientes.
Veredicto: `READY`.

## Hallazgos dispuestos

1. **D1.** `before_agent_start` solo se dispara cuando el usuario envía un prompt (`agent-session.js:1587`). Los turnos que despierta el resultado de un hijo (`sendMessage` con `triggerTurn`) no lo disparan (`agent-session.js:1804`), así que la sección de orquestador faltaba cuando el padre sintetiza. Lo encontraron dos lentes. Disposición: la sección se agrega con `context_with_system`, en cada llamada al modelo. Corregido en el spec.
2. **D2.** Con Jev encendido en `orchestrator`, un mensaje que solo pide commit o push no tenía un destino válido: `leave` hacía que el gate bloqueara el `bash` del padre, y los hijos no pueden hacer esas operaciones (ADR 0013). Disposición: el criterio estrecho de `stay` también cubre los mensajes que solo piden las operaciones reservadas de `git` y `gh`. Corregido en el spec y en ADR 0015.
3. **D3.** #231 agregaba un rechazo en `/workflow:config` y un aviso en status y doctor que Jev routing no tiene. Además, child session puede estar seated sin `spawn_child` cuando hay un paquete de subagentes heredado (`child-launcher.ts:583-594`). Disposición: la condición pasa a ser "el padre tiene las herramientas de hijos"; sin ellas, el padre se comporta como `opportunistic`. Se eliminan el rechazo y el aviso, y #231 se cierra. Esto revierte la decisión Q8(b) del grilling, por decisión del desarrollador.
4. **D4.** Si #230 salía sin #232, quedaba en producción la combinación que ADR 0015 rechaza. Disposición: #232 se absorbe en #230.
5. **D5.** Con Jev encendido, el `stay` estrecho hace que el gate, sin cambios, bloquee al padre más seguido; la story 12 prometía más. Disposición: la story dice que el modo en sí nunca bloquea y que el veredicto de Jev bloquea como hoy. La consecuencia queda en ADR 0015.
6. **D6.** `/workflow:delegation-check` no estaba definido en `orchestrator`, y su caso de respuesta pequeña espera `stay`. Disposición: el check evalúa el modo actual con expectativas por modo.
7. **D7.** No estaba definido qué hace el padre ante un lanzamiento rechazado. Disposición: la instrucción le pide seguir el rechazo y contarle al operador, sin reintentar en silencio ni hacer el trabajo sin avisar.
8. **D8.** Guardar las dos elecciones en un mismo documento hacía que `set()` de Jev routing borrara el Delegation mode (`workflow-settings.ts:31-36`). Disposición: documento propio en el agent directory, junto a Jev routing.
9. **D9.** La instrucción no exceptuaba los archivos de contexto que el gate ya exime ni las lecturas de `git` previas a un commit, y nombraba el Todo y Operator question aunque no estuvieran seated. Disposición: excepciones explícitas, y el Todo y Operator question se nombran solo si están seated.

Correcciones editoriales sin decisión: la demo de "gracias" en #232 no era reproducible, porque un mensaje sin herramientas nunca llega a Jev; el test de ausencia en el hijo observa el prompt que recibe el factory; "idéntico byte a byte" significa idéntico al comportamiento actual; #230 y #231 repetían el caso sin child session seated.

## Coherencia transversal

| Capacidad | Resultado |
|---|---|
| Documento de Jev routing | Divergencia autorizada: el Delegation mode va en un documento propio (D8). |
| `/workflow:config` y su revisión de Apply | Compatible. |
| Seating de child session | Divergencia autorizada: la condición es tener las herramientas de hijos (D3). |
| Clasificación de Jev | Compatible: los criterios varían por modo sin cambiar la entrada en `opportunistic`. |
| Status y doctor | Sin cambios (D3). |
| Child sessions en el mismo proceso (ADR 0014) | Compatible: los hijos no cargan la extensión, así que la sección no llega a ellos. |

## Decisions, Deviations and Accepted Risks

- ADR 0015 se corrigió antes de implementar: agrega el criterio de `stay` para las operaciones reservadas, la condición de las herramientas de hijos, y la consecuencia de que con Jev encendido el gate bloquea más seguido. Quita el rechazo en `/workflow:config` y el aviso en status y doctor.
- Riesgo aceptado: `orchestrator` es una instrucción, no una garantía; el padre puede hacer trabajo él mismo y nada lo reporta.

## Reverificación

Un revisor independiente confirmó que D1–D9 están aplicadas sin restos contradictorios y que son factibles: `context_with_system` se dispara en cada llamada al modelo, incluidos los turnos que inicia el resultado de un hijo; las herramientas de hijos ya no se ofrecen cuando hay un paquete heredado; el criterio por modo solo cambia el texto de `stay`. Sus cuatro hallazgos se corrigieron en el spec sin decisiones nuevas: qué preserva el handler de `context_with_system`, el riesgo de otra extensión que fija el system prompt, las expectativas del delegation check en `orchestrator`, y que el turno que inicia un hijo se prueba con una sesión real de Pi.

## Informe

`READY`: sin bloqueantes ni advertencias abiertas. El spec corregido se publica junto con este reporte, #232 se absorbe en #230 y #231 se cierra.
