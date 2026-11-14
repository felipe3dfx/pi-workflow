# Revisión consolidada: respaldo de contexto del padre

Paquete: `parent-context-backstop/definition-1`.
Identidad de especificación: `parent-context-backstop/specification-1`.
Identidad de este informe: `parent-context-backstop/spec-review-1`.
Especificación: [parent-context-backstop.md](parent-context-backstop.md).
Brief estable: [definición aprobada](../features/parent-context-backstop.md).
Revisión estable: [feature-critic](../features/parent-context-backstop-review.md).
Veredicto preservado: **READY**.
Parent: [#380](https://github.com/felipe3dfx/pi-workflow/issues/380), abierto; creación y lectura de vuelta verificadas.

## Readiness y alcance de la síntesis

El brief identifica problema, usuario, resultado, alcance, comportamiento, decisiones con resolutor, fuente y estado, capacidades compartidas, dependencias y brechas de evidencia. La revisión de feature-critic tiene las tres lentes independientes completas, dos rondas de reverificación y ningún hallazgo sin disposición. El Domain Authority Handoff está ausente, que es una brecha admisible: las decisiones funcionales y semánticas están cerradas.

La síntesis no hizo una segunda entrevista ni cambió el producto aprobado. Las restricciones obligatorias citan su fuente (ADR 0015, 0025, 0027 y 0028, y las decisiones D6, D9 y D10). El módulo `extensions/context-backstop.ts` es una recomendación sustentada en el patrón del presupuesto de exploración, no una obligación.

| Artefacto de entrada | SHA256 |
| --- | --- |
| Brief estable | `2da6067b41b9b6737124a12f21739813e2767fc053bcd181e0227dac721a85fd` |
| Revisión de feature-critic | `9a46f320bb4c7499c2264e45a223d212ee3a8a7f3610d2f19c118f2ef73b771f` |

## Cobertura

Cada comportamiento del brief tiene su fila en el contrato de estados de la especificación y una prueba en sus decisiones de testing: umbral y ventana desconocida, disparo único, rearme por lectura numérica, lecturas `null` o ausentes, compuertas de modo y herramientas hijas, precedencia sobre el aviso de exploración y opciones de entrega.

## Decisions, Deviations, Accepted Risks and Justified Complexity

- Umbral min(150k, 15%) por paridad con gentle-shell (D4); el alcance queda acotado a sesiones que lo alcanzan (D5).
- Divergencias autorizadas frente a gentle-shell: mensaje steer en lugar de anexar al tool result, sin throttle de 5 s.
- Brechas de evidencia aceptadas: atraso de una lectura y costo de `getContextUsage()` sin medir.
- Dependencias: ADR que enmienda el 0028 y entrada "Context backstop" en el glosario, a cargo de `domain-modeling`.
