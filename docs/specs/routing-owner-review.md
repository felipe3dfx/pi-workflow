# Revisión: dueño del routing

Paquete: el paquete de routing confirmado después de la revisión renovada.
Handoff: `READY WITH WARNINGS`. El ADR 0008 es un registro local, no autoridad aceptada.
Veredicto: `READY WITH WARNINGS`.

## Hallazgos dispuestos

1. El spec histórico no tiene modo apagado. Disposición: `to-spec` escribe los dos modos. Aceptado.
2. El spec histórico enruta por nombre de skill. Disposición: el contrato no enruta por skill. Aceptado.
3. La elección persistente no estaba en el spec. Disposición: arranca apagada y persiste. El código que arranca en `on` no es el contrato. Aceptado.
4. `explore` no tiene shell. `git` y `gh` se quedan en el padre solo con Jev apagado. Aceptado.
5. El `READY` y el prototipo anteriores no cubren este cambio. Aceptado.
6. No hace falta otra revisión de autoridad. El glosario ya tiene los textos aprobados. Aceptado.
7. El ADR 0008 no es autoridad aceptada. Aceptado.
8. El veredicto queda atado al mensaje del usuario. Aceptado.
9. La elección va en un documento aparte, junto a los perfiles, no dentro de `pi-workflow-models.json`. Aceptado.
10. Se reutiliza el row existente de SettingsList. No hay prototipo nuevo. Aceptado.

## Decisions, Deviations and Accepted Risks

- Desviación aceptada. `docs/specs/child-session-delegation.md` no es el contrato de este paquete. Este spec lo reemplaza para el routing.
- Desviación aceptada. El ADR 0008 no se cita como aceptado. El paquete confirmado y el glosario mandan.
- Riesgo aceptado. El interruptor instalado arranca en `on` y no persiste. No es el contrato.
- No hay afirmación de compatibilidad con ODD. Este cambio no tiene prototipo.

## Informe

Las tres lentes de la corrida renovada devolvieron fail sobre el spec histórico. El glosario ya coincidía. El usuario aceptó el conjunto de recomendaciones. La reverificación dejó el spec histórico sin reconciliar y ese rezago quedó como desviación aceptada para esta síntesis.

No quedan warnings sin disponer.
