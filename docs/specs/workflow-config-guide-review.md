# Revisión: guía de `/workflow:config`

Paquete: `workflow-config-guide/definition-1`.
Handoff: `workflow-config-guide/feature-review-1`.
Especificación: [workflow-config-guide.md](workflow-config-guide.md).
Parent: [#248](https://github.com/felipe3dfx/pi-workflow/issues/248).
Veredicto: `READY`.

## Origen

La especificación sintetiza el brief y el contrato de UI aprobado v4 sin cambiar decisiones funcionales. La revisión de la definición está en [docs/features/workflow-config-guide-review.md](../features/workflow-config-guide-review.md); este reporte consolida sus hallazgos y lo que agregó la síntesis.

## Hallazgos consolidados

Los once hallazgos de `feature-review` (F1–F11) quedaron dispuestos en cuatro rondas: siete corregidos y reverificados, uno reemplazado (F2 por F6), un riesgo aceptado (F5), una restricción para la spec (F7) y correcciones editoriales (F9–F11). No hay advertencias sin disposición.

La síntesis no encontró definiciones faltantes ni contradicciones. Una verificación independiente de fidelidad detectó omisiones de síntesis (foco inicial, descripción de la acción, procedencia de las decisiones estructurales) y de traducción del brief; se corrigieron sin cambiar decisiones funcionales. Agregó estas decisiones estructurales sin cambio funcional:

- Obligatoria: el comando conserva su entrada, sus rechazos y el conjunto de efectos al confirmar; `guideSelection` sigue devolviendo la selección confirmada, Jev routing y Delegation mode, y su entrada solo crece con las descripciones del catálogo. Razón: ADR 0009 y F7.
- Obligatoria: la guía reutiliza las primitivas de `chrome-menus` y no toca los parches globales de `SettingsList`, de los que dependen los demás menús.
- Obligatoria: el seam de prueba es el handler de `/workflow:config` con un `ctx.ui.custom` falso, como hoy, pero el factory debe recibir un theme y keybindings de prueba. Razón: es el seam existente más alto, ejercita la guía junto con el conjunto de efectos que aplica el handler y ya lo usan los tests que se reescriben.
- Recomendación: construir la guía como un solo componente en `extensions/configure-guide.ts` y derivar los conjuntos de instalación y de paquetes conservados desde `planApply`.

## Relaciones

- #247 (selección guardada sin la expectativa de un companion nuevo) toca el mismo comando, pero cambia cuándo puede abrirse la guía, no su interacción. Es independiente y queda fuera de alcance.

## Decisions, Deviations and Accepted Risks

- Divergencia autorizada: la guía reemplaza `SettingsList` por un componente propio que reutiliza el marco de `chrome-menus`.
- Riesgo aceptado por el desarrollador (F5): reescribir los tests de interacción de la guía con la cobertura definida en la spec.
- Restricción (F7): el handler pasa a la guía las descripciones del catálogo que ya carga.
- Brecha admisible: no hay Domain Authority Handoff.
