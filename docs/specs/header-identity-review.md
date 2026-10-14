# Revisión: header del Chrome con identidad sutil

Paquete: `header-identity/definition-1`.
Handoff: `header-identity/feature-review-1`.
Especificación: [header-identity.md](header-identity.md).
Parent: [#243](https://github.com/felipe3dfx/pi-workflow/issues/243).
Veredicto: `READY`.

## Origen

La especificación sintetiza el brief v6 sin cambiar decisiones funcionales. La revisión de la definición está en [docs/features/header-identity-review.md](../features/header-identity-review.md); este reporte consolida sus hallazgos y lo que agregó la síntesis.

## Hallazgos consolidados

Los nueve hallazgos de `feature-review` quedaron dispuestos: siete resueltos o confirmados por el desarrollador y dos registrados como divergencias autorizadas. No hay advertencias sin disposición.

La síntesis no encontró definiciones faltantes ni contradicciones. Agregó dos decisiones estructurales sin cambio funcional:

- Obligatoria: `renderHeader` conserva su interfaz y `HeaderData`, porque el brief no agrega fuentes de datos.
- Obligatoria: el header deja de usar `spread`, porque recorta la izquierda completa y cortaría la rama antes que la ruta.

## Decisions, Deviations and Accepted Risks

- Desviación autorizada: separador `·` solo en el header.
- Desviación autorizada: el header no usa `spread`.
- Riesgo aceptado por el desarrollador: ancho de `π`, `▰` y `▱` en algunas fuentes, mitigado con pruebas de `visibleWidth` y revisión visual antes de cerrar.
- Brecha admisible: no hay Domain Authority Handoff.
