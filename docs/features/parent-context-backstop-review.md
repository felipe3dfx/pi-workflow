# Revisión de la definición: Parent Context Backstop

Brief revisado: [parent-context-backstop.md](parent-context-backstop.md). Tres lentes independientes (necesidad y coherencia, alcance y proporcionalidad, factibilidad y coherencia transversal), con dos rondas de reverificación.

## Veredicto

`READY`

Todos los hallazgos tienen disposición; no queda ningún bloqueante ni warning sin corregir.

## Hallazgos y disposiciones

| ID | Lente | Clase | Severidad | Hallazgo | Disposición |
| --- | --- | --- | --- | --- | --- |
| B1 | Necesidad | Falla demostrada | blocker | El umbral min(150k, 15%) no cubre la sesión que motivó el brief (~125k en ventana de 1M). | Corregido: el problema se acota a sesiones que alcanzan el umbral; la sesión motivadora queda fuera de alcance. |
| W1 | Necesidad, factibilidad | Riesgo sustentado | warning | Faltaba la compuerta de herramientas hijas. | Corregido. |
| W2 | Necesidad, factibilidad | Riesgo sustentado | warning | Los dos avisos podían coincidir con instrucciones opuestas. | Corregido: gana el backstop. |
| W3 | Factibilidad | Riesgo sustentado | warning | El brief negaba la existencia de `session_compact`. | Corregido y luego reemplazado por S5. |
| W4 | Necesidad, factibilidad | Riesgo sustentado | warning | Momento de medición, reanudación, `null` y ventana desconocida sin definir. | Corregido; el atraso de una lectura queda como brecha de evidencia registrada. |
| W5 | Necesidad | Riesgo sustentado | warning | La frase para `orchestrator` contradecía el ADR 0015. | Cerrado por S1. |
| W6 | Factibilidad | Divergencia no autorizada | warning | La tarjeta de exploración no es reutilizable. | Cerrado por S2. |
| W7 | Necesidad, factibilidad | Riesgo sustentado | warning | Falta ADR que enmiende el 0028 y entrada de glosario. | Corregido: dependencia del spec. |
| N1 | Necesidad, factibilidad | Riesgo sustentado | warning | No se definía si el aviso de exploración suprimido se consume o se difiere. | Corregido: se consume. |
| N2 | Necesidad, factibilidad | Especulativo | informative | Redacción imprecisa de la compuerta y del alcance del ADR. | Aceptado: corrección editorial. |
| S1 | Alcance | Especulativo | informative | Aplicar en `orchestrator` y con redacción por modo. | Aceptado: solo `opportunistic`, una frase. |
| S2 | Alcance | Especulativo | informative | Tarjeta propia. | Aceptado: mensaje steer plano. |
| S3 | Alcance | Especulativo | informative | Garantizar el rearme. | Aceptado: una vez por sesión garantizado; rearme como extra. |
| S4 | Alcance | Especulativo | informative | Enviar ambos avisos sin precedencia. | Rechazado: contradice W2. |
| S5 | Alcance | Especulativo | informative | Dos mecanismos de rearme. | Aceptado: solo lectura numérica bajo el umbral. |
| — | Factibilidad | Editorial | informative | `getContextUsage()` puede devolver `undefined`. | Aceptado: una lectura ausente no cambia el estado. |

## Decisions, Deviations, Accepted Risks and Justified Complexity

- Umbral min(150k, 15%) por paridad con gentle-shell: decisión de Felipe; complejidad justificada.
- Compuerta de herramientas hijas y precedencia del backstop: paridad con el aviso de exploración y una sola instrucción coherente.
- Divergencias autorizadas frente a gentle-shell: mensaje steer en lugar de anexar al tool result, sin throttle de 5 s.
- Brechas de evidencia registradas: atraso de una lectura y costo de `getContextUsage()` por tool result sin medir.
- Domain Authority Handoff ausente: brecha admisible.
