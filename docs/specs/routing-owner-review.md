# Revisión: dueño del routing

Paquete: el paquete de routing confirmado, con los cierres de `git`/`gh` y de las gated parent tools escritos en `docs/specs/routing-owner.md`.
Handoff: `READY WITH WARNINGS`. El ADR 0008 es un registro local, no autoridad aceptada.
Veredicto: `READY WITH WARNINGS`.

## Hallazgos dispuestos

1. El spec histórico no tiene modo apagado. Disposición: `to-spec` escribe los dos modos. Aceptado.
2. El spec histórico enruta por nombre de skill. Disposición: el contrato no enruta por skill. Aceptado.
3. La elección persistente no estaba en el spec. Disposición: arranca apagada y persiste. El código que arranca en `on` no es el contrato. Aceptado.
4. `explore` no tiene shell. `git` y `gh` se quedan en el padre solo con Jev apagado. Aceptado. La reverificación cerró la clase: esas invocaciones son todos los comandos de estado del repositorio, y un rol nombrado no las mueve a un child. Confirmado en el spec.
5. El `READY` y el prototipo anteriores no cubren este cambio. Aceptado.
6. No hace falta otra revisión de autoridad. El glosario ya tiene los textos aprobados. Aceptado. La reverificación no encontró contradicción con `CONTEXT.md`.
7. El ADR 0008 no es autoridad aceptada. Aceptado. La frase vieja con `including` sigue en ese ADR y no es un defecto de este paquete.
8. El veredicto queda atado al mensaje del usuario. Aceptado.
9. La elección va en un documento aparte, junto a los perfiles, no dentro de `pi-workflow-models.json`. Aceptado.
10. Se reutiliza el row existente de SettingsList. No hay prototipo nuevo. Aceptado.
11. Una petición explícita de child, subagent o delegation fija `leave`. Jev sigue eligiendo el Specialist. Confirmado en el spec.
12. `decide` es el tercer veredicto. El padre pregunta, espera y no lanza. Confirmado en el spec.
13. Las gated parent tools de este spec son `read`, `grep`, `find`, `ls`, `edit`, `write`, `bash`, `powershell`, y `codegraph` `query` o `explore`. Confirmado en el spec. La lista no se hereda del spec histórico.

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

## Informe

Las tres lentes de la corrida renovada devolvieron fail sobre el spec histórico. El glosario ya coincidía. El usuario aceptó el conjunto de recomendaciones. La reverificación dejó el spec histórico sin reconciliar y ese rezago quedó como desviación aceptada para esta síntesis.

La reverificación posterior leyó el spec ya cerrado. Las tres lentes confirmaron la petición explícita, `decide`, la clase `git`/`gh` y la lista de gated parent tools. No hubo blockers ni warnings nuevos.

No quedan warnings sin disponer.
