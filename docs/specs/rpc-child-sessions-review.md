# Revisión consolidada de la especificación de sesiones hijas por RPC

## Captura vigente

**Veredicto funcional preservado: READY WITH WARNINGS. Estado de síntesis: verificada de forma independiente y corregida; pendiente de la verificación final del padre.** No autoriza implementación ni adopción.

- Brief: [definición funcional](../features/rpc-child-sessions.md), SHA-256 `b5bc3981a5e4ea17937f5284ca29772421cac4f2e007d2d95710be69a3c1ea1b`.
- Informe funcional: [revisión funcional](../features/rpc-child-sessions-review.md), SHA-256 `389d7688b264862beeab90028d2d3f3dafb67d9806c8fa730739121c4e522ec7`, veredicto `READY WITH WARNINGS`.
- Especificación: [sesiones hijas por RPC](rpc-child-sessions.md), SHA-256 `01110379dbb5282be3749cdd14d348428ced4bf11ddae0dc338d536c9fca8241`.
- Prototipo de referencia (`reference-only`): rama `prototype/rpc-children`, commit `22c7c22`.

## Mapa de costuras

Un explorador independiente de solo lectura mapeó el código: la costura existente es `ChildSessionFactory` con `ChildHandle` (`extensions/child-sessions.ts:107-121`), por lo que el adaptador RPC es un segundo adaptador. Los eventos se normalizan a `onEvent`.

## Verificación independiente

| Ronda | Resultado | Hallazgos principales |
| --- | --- | --- |
| 1 | FAIL | Capacidad mal descrita; endurecimiento del canal y eliminaciones presentados como obligatorios sin fuente; decisiones de la especificación delegadas a tickets; autorización operativa y contextual sin distinguir; semántica de fallo de lanzamiento; falta el libro completo de disposiciones; escenarios sin oráculo |
| 2 | FAIL | Quedaban: exclusión de parchear o bifurcar Pi sin aprobar; plazos de aceptación sin cota medible; dos incoherencias entre secciones |
| 3 | FAIL por una frase | El validador de distribución figuraba condicional en la sección 12 pero no en la 6 |
| Cierre | Corregido | Frase corregida por el padre; todos los puntos anteriores cerrados |

Cada ronda ejecutó `npm run check` de forma independiente: 1236 pruebas, 1221 pasan, 15 omitidas, 0 fallan, con la validación de la distribución empaquetada correcta.

## Decisions, Deviations, Accepted Risks and Justified Complexity

- **Riesgo aceptado:** terminación completa del árbol de procesos en macOS sin verificar; criterio de aceptación de la implementación.
- **Desviación autorizada:** el ADR sucesor reemplaza al 0016, que arrastra la decisión en proceso del 0014; enmienda el 0010 para sobrevivir a `/reload`; sustituye D7.
- **Capacidad:** se conserva el Launch limit actual, diez hijos en trabajo y cinco en ejecución. La memoria por proceso, unos 130 a 150 MiB, queda como riesgo registrado; se recomienda arrancar el proceso solo al empezar a ejecutarse.
- **Recomendaciones con evidencia:** endurecimiento del canal, límites de 10 s, 1 s y 2 s, declaración de superficies en los parámetros de `spawn_child`, y cancelación por aborto y terminación del árbol.
- **Brechas de evidencia registradas:** no hay Domain Authority Handoff ni revisión de autoridad separada para este paquete.

## Advertencias, disposiciones y límites

El prototipo valida solo el Pi 1.4.0 instalado como binario; la implementación real y los escenarios en macOS no se ejecutaron. El rango de versiones de Pi queda como decisión de ticket.

## Entrega

Entrega a `to-tickets` tras aprobar la vista previa de publicación: especificación, este informe, el informe funcional, el issue padre #296, el prototipo y las relaciones nativas con #293, #295 y #204.
