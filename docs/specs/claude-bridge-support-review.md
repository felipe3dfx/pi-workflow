# Revisión consolidada: soporte de Claude Bridge

Paquete: `claude-bridge-support/definition-1`.
Handoff: `claude-bridge-support/feature-review-1`.
Resultado funcional: **READY WITH WARNINGS**.
Estado: **revisión final**; verificación de publicación registrada en el parent.
Parent: [#238](https://github.com/felipe3dfx/pi-workflow/issues/238).

## Revisión y preparación
Las tres lentes independientes completaron la revisión del mismo brief aprobado:
completitud/coherencia (`d83428ae`), simplificación/alcance (`ac712a70`) y
viabilidad (`ebcf9f6d`, tras reverificación de F1 en `af1d6229`).
La verificación independiente de síntesis (`89673663`) concluyó pass para
la especificación en estado de trabajo, sin verificar implementación.

La intención y disposición reference-only están aprobadas por el desarrollador.
La síntesis conserva alcance, roles, rechazo del modelo no disponible antes del
lanzamiento, ausencia de fallback y exclusión de AskClaude.
Las aclaraciones editoriales hacen explícita la resolución sin instalación,
la ruta absoluta del recurso, el orden load/create/bind y el rango actual de peers.
No cambian decisiones funcionales ni requieren una nueva entrevista.

## Decisiones, desviaciones y riesgos aceptados
- Extensión oficial mediante ciclo público en los hijos. La enmienda al ADR 0014
  requerida por la decisión aceptada permanece pendiente antes de la entrega.
- F1 aceptada expresamente sin mitigación: reconstrucción del padre inactivo y
  posible coste adicional/reutilización de caché no cuantificados. La evidencia
  real conservó marcadores; no garantiza todos los contenidos ni versiones.
- Cancelación cooperativa con avisos de contexto obsoleto y llamadas abandonadas
  también observados sin Bridge; no se corrigen en esta función.
- Prototipo reference-only, contexto y barreras sintéticos, una combinación
  de modelo/versiones, y ausencia de validación completa de gestor/MCP/web.
- Caché de 256 claves con referencias heredadas; no se demostró fuga ilimitada.
- Ausencia declarada de handoff de autoridad Bridge y su revisión generada,
  por separado admisibles; GLOSSARY.md es autoridad raíz.
Todas estas disposiciones proceden del desarrollador; no hay supersesiones
ni advertencias funcionales pendientes.

## Evidencia y límites
Pruebas reales con Pi 1.1.0, Bridge 0.9.2, Claude Code 2.1.296 y Haiku 4.5-low.
La fábrica stock falla al capturar el prompt; los éxitos usan la adaptación
temporal de carga pública, no código de producción.
La prueba concurrente conserva exit2 por un umbral erróneo de espejos; la
reverificación independiente confirmó que esa única condición era incorrecta.
No se presenta el script original como aprobado.
Evidencia: `/tmp/pi-claude-bridge-prototype.YmrJ75/`.

## Calidad y preparación de publicación
El resultado histórico completo fue 823 aprobados, 31 fallidos y 1 omitido;
un intento posterior agotó 120 segundos con errores de firma de 1Password.
La validación de publicación posterior aprobó `npm run check` en 16.1 segundos:
855 tests, 854 aprobados, 0 fallidos y 1 omitido; distribución aprobada.
No hubo cambios de configuración de firma ni bypass. El gate documental
no demuestra implementación ni integración de producción.
El paquete documental candidato está preparado en estos cuatro artefactos:
- Brief de definición: [docs/features/claude-bridge-support.md](../features/claude-bridge-support.md).
- Revisión de feature-review: [docs/features/claude-bridge-support-review.md](../features/claude-bridge-support-review.md).
- Especificación: [docs/specs/claude-bridge-support.md](claude-bridge-support.md).
- Informe consolidado: [docs/specs/claude-bridge-support-review.md](claude-bridge-support-review.md).
El issue padre [#238](https://github.com/felipe3dfx/pi-workflow/issues/238)
existe y su lectura de vuelta está verificada. La verificación de publicación
remota y handoff se registra allí. El quality gate documental está aprobado.

## Handoff
La revisión permite preparar la publicación; no constituye publicación.
El paquete contiene los cuatro roles documentales enlazados arriba y está asociado
al issue padre #238. La integración de producción, cobertura de modelos/versiones,
MCP/web, enmienda ADR y quality gate siguen siendo condiciones de entrega.
