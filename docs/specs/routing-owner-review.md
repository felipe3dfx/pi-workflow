# Revisión: dueño del routing

Paquete: el paquete de routing confirmado, con los cierres de `git`/`gh` y de las gated parent tools escritos en `docs/specs/routing-owner.md`, más su adaptación a Pi 1.0.
Handoff: `READY WITH WARNINGS`. El ADR 0008 es un registro local, no autoridad aceptada.
Veredicto: `READY WITH WARNINGS`.

## Hallazgos dispuestos

1. El spec histórico no tiene modo apagado. Disposición: `to-spec` escribe los dos modos. Aceptado.
2. El spec histórico enruta por nombre de skill. Disposición: el contrato no enruta por skill. Aceptado.
3. La elección persistente no estaba en el spec. Disposición: arranca apagada y persiste. El código que arranca en `on` no es el contrato. Aceptado.
4. `explore` no tiene shell. `git` y `gh` se quedan en el padre solo con Jev apagado. Aceptado. La reverificación cerró la clase: esas invocaciones son todos los comandos de estado del repositorio, y un rol nombrado no las mueve a un child. Confirmado en el spec.
5. El `READY` y el prototipo anteriores no cubren este cambio. Aceptado.
6. No hace falta otra revisión de autoridad. El glosario ya tiene los textos aprobados. Aceptado. La reverificación no encontró contradicción con `GLOSSARY.md`.
7. El ADR 0008 no es autoridad aceptada. Aceptado. La frase vieja con `including` sigue en ese ADR y no es un defecto de este paquete.
8. El veredicto queda atado al mensaje del usuario. Aceptado.
9. La elección va en un documento aparte, junto a los perfiles, no dentro de `pi-workflow-models.json`. Aceptado.
10. Se reutiliza el row existente de SettingsList. No hay prototipo nuevo. Aceptado.
11. Una petición explícita de child, subagent o delegation fija `leave`. Jev sigue eligiendo el Specialist. Confirmado en el spec.
12. `decide` es el tercer veredicto. El padre pregunta, espera y no lanza. Confirmado en el spec.
13. Las gated parent tools de este spec son `read`, `grep`, `find`, `ls`, `edit`, `write`, `bash`, `powershell`, y `codegraph` `query` o `explore`. Confirmado en el spec. La lista no se hereda del spec histórico.
14. Pi 1.0 trae a Jev como classifier model. Disposición: Jev se consulta con el registro de clasificadores de Pi, siempre como `typesafe/jev-latest`, sin cliente propio. Las credenciales del Jev de otro proveedor no cuentan. Aceptado.
15. "No termina normalmente" era impreciso. Disposición: Launch blocked cuando el stop reason no es `stop` (`error`, o `aborted` si el turno se cancela), o cuando falta el clasificador `typesafe/jev-latest`. Cada caso tiene prueba. Aceptado.
16. El código guarda un Launch blocked como veredicto de todo el mensaje. Disposición del Owner: Launch blocked no se guarda. La siguiente herramienta gated o el siguiente lanzamiento del mismo mensaje pregunta de nuevo. Aceptado.
17. Una llamada gated dentro de un script de `codemode` pasa por `tool_call`, pero el motivo del bloqueo llega al script. Disposición del Owner: el padre también recibe el motivo fuera del script. `codemode` en sí no es gated. Con routing apagado, una herramienta gated llamada desde `codemode` corre y Jev no se llama. El criterio queda en #123. Aceptado.
18. El modelo del padre, los virtual models en un perfil y `codemode` sin gate no tenían prueba ni dueño. Disposición: pruebas nuevas en el spec y criterios en #124. Que el child corra en el proceso del padre queda como restricción de diseño, no como comportamiento probado. Aceptado.
19. Quitar `extensions/jev-client.ts` afecta `/delegation-check`, las pruebas que inyectan `fetch`, la cancelación y el README. Disposición: entra en el alcance de #124. Aceptado.
20. El glosario no distinguía Jev routing del routing de modelo de Pi ni definía Launch blocked. Disposición: `GLOSSARY.md` actualizado. Aceptado.
21. El ADR 0007 nombraba Pi 0.99.1 y el rango `>=0.99.0`. Disposición: remite a la nota de origen de cada módulo y al rango de `package.json`. El ADR 0008, registro local, deja de hablar de fallas de transporte. Aceptado.

## Coherencia transversal

| Capacidad | Resultado |
| --- | --- |
| Jev routing | divergencia autorizada frente al spec histórico; coincide con el glosario |
| Specialist | divergencia autorizada frente al spec histórico; coincide con el glosario |
| Engineering skills | divergencia autorizada frente al spec histórico; coincide con el glosario |
| Child session | compatible |
| Model profile | compatible |

## Decisions, Deviations and Accepted Risks

- Desviación aceptada. `docs/specs/child-session-delegation.md` no es el contrato de este paquete. Este spec lo reemplaza para el routing.
- Desviación aceptada. El ADR 0008 no se cita como aceptado. El paquete confirmado y el glosario mandan.
- Riesgo aceptado. El interruptor instalado arranca en `on` y no persiste. No es el contrato.
- Desviación aceptada. La petición explícita fija `leave`. `decide` permanece.
- No hay afirmación de compatibilidad con ODD. Este cambio no tiene prototipo.
- Fuera de alcance por decisión del Owner: que un virtual model elija el modelo del padre, un virtual model o router propio para los hijos, y los hijos como proceso `pi` aparte.

## Informe

Las tres lentes de la corrida renovada devolvieron fail sobre el spec histórico. El glosario ya coincidía. El usuario aceptó el conjunto de recomendaciones. La reverificación dejó el spec histórico sin reconciliar y ese rezago quedó como desviación aceptada para esta síntesis.

La reverificación posterior leyó el spec ya cerrado. Las tres lentes confirmaron la petición explícita, `decide`, la clase `git`/`gh` y la lista de gated parent tools. No hubo blockers ni warnings nuevos.

La revisión renovada leyó la adaptación a Pi 1.0. Devolvió `BLOCKED` por un blocker: decisiones sin prueba ni dueño. También dejó siete warnings y tres notas. El Owner decidió volver a preguntar tras Launch blocked y avisar al padre cuando `codemode` bloquea. Los hallazgos 14 a 21 los disponen.

No quedan warnings sin disponer.
