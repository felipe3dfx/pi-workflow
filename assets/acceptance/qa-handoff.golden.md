# Entrega para QA — ILA-2321

## Resultado

**Estado:** Listo para QA

La publicación de QA handoff queda disponible con validación determinista.

## Evidencia de PR y build

- **PR:** [PR #42](https://github.com/example/pi-workflow/pull/42) (`pr:42`)
- **Build:** [Build qa-184](https://ci.example.test/builds/qa-184) (`build:qa-184`)

## Entorno de QA

- **Entorno:** QA
- **URL:** https://qa.example.test
- **Revisión:** `release-2026.07.21`

## Criterios de aceptación

- [ ] **AC-1:** Publica un comentario localizado sin modificar el issue.
  - Evidencia: [Prueba de publicación](https://ci.example.test/tests/qa-handoff) (`test:qa-handoff:happy-path`)
- [ ] **AC-2:** La repetición del mismo handoff es idempotente.
  - Evidencia: Prueba de idempotencia (`test:qa-handoff:idempotency`)

## Guía de pruebas

1. Verificar el comentario completo contra los criterios de aceptación.
2. Repetir la invocación y confirmar que no se crea otro comentario.

## Riesgos y restricciones

- El cambio de estado y la asignación a QA permanecen como acciones manuales.

## Fuera de alcance

- Promoción automática entre entornos.

Referencia de flujo: qa-handoff:1f40d7d7b50776fe28ddd07c9f4f29d20d299939eb8dee92d892fe4fd73f8a20
