# Revisión: módulos profundos del harness

Paquete: el brief `docs/features/deep-harness-modules.md` (sha256 `8c168ea3…`), con `GLOSSARY.md` (`e950ed8d…`), el ADR 0007 enmendado (`cf5a7dba…`) y el ADR 0009 enmendado (`c5f91466…`).
Handoff: revisión de autoridad de dominio renovada dos veces, `consistent with notes`, sin conflictos ni warnings.
Veredicto: `READY`.

## Hallazgos dispuestos

1. W1. El helper de lectura compartido del agent directory era superficial, tocaba lectores fuera de alcance y era la única causa de una desviación. Disposición del Owner: el ítem se reduce a un agent directory inyectado, el escritor atómico y la verificación de registro compartidos; cada documento conserva su lectura. Se retira la desviación del symlink roto. Resuelto y reverificado.
2. W2. Refrescar el header con la TUI del widget del Shell creaba un riesgo nuevo. Disposición del Owner: el header se refresca por la vía actual de Chrome. Se retira el riesgo. Resuelto y reverificado.
3. W3. El ítem de la regla del Verdict mezclaba dos cambios y retrasaba la entrega. Disposición del Owner: la regla que despierta al padre pasa a la entrega; el ítem conserva solo las primitivas de Visual language importadas en la dirección equivocada. Resuelto y reverificado.
4. W4. Con la desviación de Configure, el plan de Apply se calculaba contra el disco. Disposición del Owner: el guide abre desde el disco y el plan compara contra la selección seated. Resuelto y reverificado.
5. W5. Confirmar no tenía camino de error de escritura. Disposición del Owner: una falla de escritura corta antes del seat y Pi la reporta como hoy. Sin desviación nueva. Resuelto y reverificado.
6. W6. Faltaba el paquete legacy de spawn. Disposición del Owner: escenario nuevo que conserva el comportamiento actual, sin child tools ni gate. Resuelto y reverificado.
7. W7. La entrada Seating decía que una capability sin seat deja de actuar, pero los hijos en curso siguen entregando. Disposición del Owner: no arranca trabajo nuevo y el trabajo aceptado termina (D9). Glosario enmendado. Resuelto y reverificado.
8. W8. Unificar el texto seguro podía cambiar trim, CRLF y escapes. Disposición del Owner: solo se unifican la clase de caracteres y la expansión de tabs. Resuelto y reverificado.
9. W9. Chrome restaura los patches solo al salir con `quit`, y el ADR 0007 decía otra cosa. Disposición del Owner: se conserva el comportamiento y se enmienda el ADR 0007; el test de restauración se conserva. Resuelto y reverificado.
10. W10. La D3 prohibía cambios de asserts que S7 necesita. Disposición del Owner: el oráculo es la salida visible para el operador; los asserts sobre claves internas de widgets pueden cambiar. Resuelto y reverificado.
11. Pregunta de un hijo con child session sin seat. Hoy llega al padre, pero `reply_child` está oculto. Disposición del Owner: se corrige en este feature (D10, desviación 4). Resuelto y reverificado.
12. RV-2. La entrada Seating no tenía la excepción de `reply_child`. Corregido con la disposición de W7 y D10. Resuelto y reverificado.
13. RV-3. Los hijos en cola no estaban definidos con child session sin seat. Corregido: arrancan, terminan y entregan, como hoy (D9). Resuelto y reverificado.
14. A1. D9 y D10 interpretaban el "stops its behavior" del ADR 0009. Disposición del Owner: se aclara el ADR 0009 y se ajusta la D6. Resuelto y reverificado.
15. A2. El ADR 0007 se enmendó sin línea de Status. Corregido en los ADR 0007 y 0009 con la convención "Amended by…". Resuelto y reverificado.

16. `to-spec` encontró una contradicción entre la D10 ("siempre se puede responder") y la oferta congelada del paquete legacy de spawn. Disposición del Owner: gana el legacy. Si el paquete aparece después de la primera oferta, el harness no cambia la oferta de ninguna child tool, `reply_child` incluido. Resuelto y reverificado (RV-4, RV2-1).
17. La ventana de `reply_child` no estaba definida. Corregido: está disponible mientras cualquier hijo espera y se oculta de nuevo cuando ninguno espera y child session no tiene seat. Resuelto y reverificado.
18. D11. Disposición del Owner: una capability que solo necesita saber si tiene seat cumple el "painted through the screen place it declares" del ADR 0009 verificando el seat en su lugar declarado, en lugares que no combinan ocupantes en un solo paint. La primera redacción tenía una condición falsa para su propio ejemplo (RV2-2). Corregido y reverificado. Lectura autorizada del ADR 0009, sin enmienda.
19. Dependencia nueva: Pi activa una tool que se registra de nuevo con otra exposición durante la sesión. Verificada en Pi 1.0.3 (RV2-3).

Los hallazgos informativos de las tres lentes quedaron como aclaraciones del brief sin cambio de decisión, o pasan a `to-spec`: header con un solo ocupante (L2-6), L2-10, retirar `isTerminalSafe` (L2-11), `child-verdict.test.mjs` en la entrega (L3-5), excepción del entorno del subproceso en la verificación del agent directory (L3-6) y la lectura de "widget" del ADR 0009 como posición en pantalla (L3-7).

## Coherencia transversal

| Capacidad | Resultado |
| --- | --- |
| Patching de Chrome | divergencia autorizada: el ADR 0007 se enmienda para coincidir con la restauración al salir |
| Entrega de resultados de hijos | compatible |
| Tool gate | compatible |
| Screen places | compatible |
| Model profiles | compatible |
| Jev routing | compatible |
| Terminal-safe text | compatible |
| Operator question | divergencia autorizada (desviación 2) |
| Oferta de compact rendering | compatible |
| Oferta de CodeGraph access | compatible |
| Setup de companions en Configure | compatible tras retirar la desviación del symlink |
| Seating y guide de Configure | divergencia autorizada (desviación 3) |

## Decisions, Deviations and Accepted Risks

- Desviación aceptada 1. La caja de tareas siempre queda sobre la fila de estado.
- Desviación aceptada 2. Un tab en el texto de una pregunta al operador se pinta como tres espacios.
- Desviación aceptada 3. Abrir `/workflow:config` ya no vuelve a cargar la selección desde disco. El plan compara contra la selección seated.
- Desviación aceptada 4. Mientras un hijo espera respuesta, `reply_child` sigue disponible aunque child session no tenga seat.
- Decisión del Owner. Se enmiendan los ADR 0007 (restauración al salir) y 0009 (qué detiene quitar el seat). Las enmiendas se publican en el mismo cambio que el spec.
- Riesgo aceptado. El estado del Shell sigue siendo global al proceso.
- Riesgo aceptado. Quitar opciones de la extensión rompe a callers externos; no se conoce ninguno.
- Riesgo aceptado. La entrega pasa al core de child sessions y debe conservar el orden actual.

## Informe

La revisión de autoridad encontró un conflicto en la entrada Seating y notas de vocabulario. Se corrigieron antes de las lentes. Las tres lentes independientes no encontraron blockers y dejaron once warnings, dos de ellos el mismo hallazgo. El Owner aprobó las diez recomendaciones y decidió corregir la pregunta del hijo sin respuesta posible.

La reverificación posterior encontró un blocker, porque la revisión de autoridad había quedado vieja tras enmendar el glosario y un ADR, y dos warnings sobre Seating. Se corrigieron y la autoridad se renovó dos veces. La última renovación no encontró conflictos ni warnings.

Durante `to-spec` apareció una contradicción en la D10. Volvió al Owner, que decidió que gana el legacy y aceptó la lectura de la D11. La reverificación enfocada dejó dos warnings de redacción, corregidos y reverificados sin blockers ni warnings.

No quedan warnings sin disponer. Los riesgos tienen aceptación explícita del Owner.
