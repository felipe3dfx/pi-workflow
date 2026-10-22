# Revisión consolidada de la especificación de autorización contextual de acciones

## Captura vigente — reconciliación de fuentes comunes

**Veredicto funcional preservado: READY WITH WARNINGS. Estado de síntesis: candidato reconciliado, pendiente de verificación del padre.** Las tres lentes independientes ya completadas permiten esta síntesis. Esta edición consolida los resultados comunicados y reconcilia únicamente el delta aprobado; no ejecuta una nueva crítica ni atribuye un nuevo PASS al verificador de síntesis histórico. No declara implementación, integración, publicación ni adopción completadas.

- Brief revisado, sin cambios tras la crítica: [definición funcional](../features/contextual-action-authorization.md), SHA-256 `8c5973fe15954da11d7a4e97427b835945ac056d67a154919b5a48f41868ecf4`.
- Informe funcional consolidado: [revisión funcional](../features/contextual-action-authorization-review.md), SHA-256 `7cfb1f2bafa78704dcdf195cc66c4b54ccfb0cd3d5fb8014af9e9672d62898d7`; sección **Crítica renovada completada — fuentes comunes y contexto local**. Las lentes revisaron el informe de entrada `acbb39cb75e562c54ddbcd19c19f42215f9abbaeb70f1a8f8820eea7869dcc5f`; su consolidación posterior no cambia los bytes del brief revisado.
- Especificación reconciliada candidata: [autorización contextual de acciones](contextual-action-authorization.md), SHA-256 `9dfa6c858507949ace183107b3c8afaa454d852cf8a5294b9343149d56a7f97a`.
- Identidades previas preservadas: especificación `e5af2209d509d1da1724704570d64930c83bbb7c98f2ae293603e86ead400a3a`, revisión técnica `a81c66a95e65a82adffd3817852f8cb6bdffdb1e739e38fa0396ef03ac57ac8f`. El bloque histórico que comienza más abajo describe exclusivamente ese paquete; sus referencias a «vigente», «final» y PASS no validan esta revisión.

**Procedencia de la revisión funcional:** el padre comunica `pass` de necesidad/coherencia (`2566cbf6`), alcance/proporcionalidad (`41a4a02c`) y viabilidad/coherencia transversal (`68dc94d5`), y consolida **READY WITH WARNINGS** sin hallazgos nuevos ni asuntos sin disposición. El informe funcional registra alcance de inspección, resultados de las quince pruebas scratch, las comprobaciones npm de las lentes que las ejecutaron y los límites de la evaluación offline. Son resultados comunicados de contextos independientes, no nuevas comprobaciones del sintetizador. La tercera lente no ejecutó la suite completa.

## Delta sintetizado, obligaciones y disposiciones actuales

El usuario es el resolver del contrato exacto transcrito en `Approved common-tool-source delta` del brief: fuentes de herramientas y configuración comunes; cada sesión instancia y ejecuta en su propio contexto; la tarea determina la autoridad. Esta aclaración/desviación material sustituye la paridad absoluta anterior, incluidas sus prohibiciones de excepciones interpretadas como reflejo automático de cualquier herramienta privada del padre. Las dinámicas propias siguen el mecanismo local; las externas requieren instanciación compatible. No se exige reflejar automáticamente herramientas creadas solo dentro del estado privado capturado del padre. No habilita exclusiones por rol, subconjuntos de fuentes por rol ni autoridad derivada de disponibilidad.

La especificación aplica el delta al objetivo, registro de decisiones, escenarios, seams, recomendaciones, pruebas, límites e invariantes. Distingue acceso público a ejecutables de reasignación segura de estado capturado; fuentes del host y cableado de la ruta de extensión; herramientas registradas/activas/invocables y disponibilidad de UI. Conserva como obligaciones de implementación la propiedad local de Todo/children-box/operador, la separación de la conexión física de UI, los hooks reales y la propagación dinámica propia, incluida cobertura MCP diferida y cancelación/hermanos. No introduce RPC, registro universal, parche del SDK, arquitectura de procesos, producto recursivo, modelo, caché o presupuesto adicional.

## Decisions, Deviations, Accepted Risks and Justified Complexity

- **Delta aprobado y criticado:** resolver: el usuario; fuente: confirmación exacta del brief comunicada por el padre tras dos aprobaciones de la dirección simple; estado: `approved delta`, crítica renovada completada. Motivo: capacidades comunes con propiedad local sin copiar estado o autoridad capturados. Impacto: sustituye la interpretación absoluta de paridad; no modifica las demás decisiones funcionales.
- **Obligaciones preservadas:** procedimientos y prerrequisitos, Jev solo como destino, prohibiciones y contenido citado sin autoridad, confirmación de acción/objetivo de alto impacto, retención sin ejecución ante incertidumbre/falla, firma, alcance y trabajo ajeno. La corrección de confirmación de alto impacto permanece reverificada; el hallazgo del segundo hermano permanece **WITHDRAWN**.
- **Advertencia aceptada solo para definición:** integración real y compatibilidad externa arbitraria siguen con `insufficient evidence`; resolver del riesgo: el usuario, con razón y fuente preservadas en el brief/informe funcional. No hay nueva aceptación de riesgo ni exención productiva. Ambos prototipos originales siguen `reference-only`; la investigación SDK permanece evidencia de referencia, no implementación adoptada.
- **Canon y evidencia:** los inventarios por rol/comando y las restricciones específicas de commits aprobadas son `authorized divergence` propuesta, no supersesión operativa. No se edita ningún ADR ni el glosario. Las dos ausencias de artefactos generados de autoridad siguen siendo brechas admisibles, no tareas administrativas nuevas. Los mecanismos locales se consideran `compatible`; no se comunica `unauthorized divergence`.

## Verificación pendiente y entrega al padre

Revisar independientemente la especificación candidata contra el brief exacto y el informe funcional consolidado anteriores: confirmar traducción fiel del delta y sustitución de toda paridad absoluta vigente; verificar que mecanismos recomendados no se conviertan en nuevas decisiones obligatorias, que los hallazgos históricos conserven su disposición y que los riesgos/evidencias no se eleven a producción. Inspeccionar las obligaciones concretas de propiedad local y el tratamiento de exposiciones/dinámicas/MCP, manteniendo #291 (consulta/reanudación), #292 (política específica de commits) y #293 (comparación/adopción). Este es el encargo pendiente, no su resultado.

Después, el padre conserva la reinspección de identidades/equivalencia, los comentarios append-only en español para #288/#290, los efectos Git/GitHub y los read-backs aplicables. Una corrección material vuelve a `feature-critic`; una verificación de síntesis sin cambio funcional no inventa otra decisión del usuario. La reconciliación de ADRs y guías operativas permanece en implementación bajo su ciclo de vida. No se ha autorizado ni ejecutado staging, commit, checkpoint o publicación en esta edición.

## Verificación independiente completada — captura reconciliada

El padre comunica **PASS** del verificador independiente de síntesis `070d39d3` sobre el brief `8c5973fe15954da11d7a4e97427b835945ac056d67a154919b5a48f41868ecf4`, el informe funcional `7cfb1f2bafa78704dcdf195cc66c4b54ccfb0cd3d5fb8014af9e9672d62898d7`, la especificación `9dfa6c858507949ace183107b3c8afaa454d852cf8a5294b9343149d56a7f97a` y el handoff técnico de entrada `4c6fd456683c1511e290fcc253aad2ef9371d0d03ccfe011f75b0f5600ca2e72`. El verificador confirmó traducción fiel del contrato de fuentes comunes/contexto local, ausencia de reflejo universal o arquitectura obligatoria nueva, preservación de §4, protecciones, límites #291–#293 e historial. El padre informa además `npm run check` satisfactorio (1072 pruebas aprobadas, 15 omitidas) y comprobaciones de hashes/alcance satisfactorias. Esta entrada atribuye esos resultados; no simula otra ejecución del sintetizador ni altera los bytes revisados de la especificación. Resuelve la verificación pendiente descrita arriba para esa captura, no acredita adopción productiva.

El padre publicó la decisión aprobada en [#288](https://github.com/felipe3dfx/pi-workflow/issues/288#issuecomment-6327927919) y [#290](https://github.com/felipe3dfx/pi-workflow/issues/290#issuecomment-6327928353), indicando que sustituye la interpretación absoluta del primer criterio, conserva todas las protecciones y reanuda la implementación sobre la definición local verificada. Los documentos locales se entregarán con el cambio: no se declaran publicados anticipadamente. La implementación, la reconciliación canónica previa a habilitar la política y sus verificaciones siguen siendo trabajo posterior; no hay nueva autorización de modelo, presupuesto o producción.

## Historial — identidad y alcance del paquete anterior

**Veredicto: READY WITH WARNINGS.** Esta consolidación documenta la síntesis técnica del paquete vigente; no representa una nueva revisión independiente de tres lentes ni una aprobación de implementación o adopción.

- Brief estable: [definición funcional](../features/contextual-action-authorization.md), SHA-256 `be690abb770e27c58e651cf85fd142d55dacd86d6e713a47fe5c36d6e11607b2`.
- Informe funcional final: [revisión funcional](../features/contextual-action-authorization-review.md), SHA-256 `289bd81c0893f8b1eeb8a2d2a32bed421ce2bfdaa3a19af5d93c8bd5ef4992f9`.
- Handoff vigente: **Captura final renovada — deltas de commits y contexto**. Las capturas anteriores son historial. El texto histórico del brief sobre una revisión pendiente queda contextualizado por este handoff renovado, sin modificar el brief.
- Especificación técnica: [autorización contextual de acciones](contextual-action-authorization.md), SHA-256 `e5af2209d509d1da1724704570d64930c83bbb7c98f2ae293603e86ead400a3a`.
- Fuente de síntesis: borrador verificado, SHA-256 `240f7287587db48cb08608178c49ab5a8d2e92ca33966c3c3a5eb288a494e623`. Prototipo de referencia: commit `54f4f01`, solo procedencia de evidencia, no base de implementación.

## Procedencia y resultado

El padre comunica **PASS** del verificador independiente de síntesis: sin desviación material respecto del brief y del handoff funcional vigente. Esta consolidación registra ese resultado comunicado; no inventa una nueva ejecución, tres revisiones técnicas independientes ni evidencia de integración real.

Las tres lentes funcionales renovadas constan en el informe funcional: necesidad/coherencia y alcance/proporcionalidad sin hallazgos nuevos; viabilidad/coherencia transversal conserva las disposiciones de los deltas aprobados. La advertencia sobre un segundo hermano de implementación quedó **WITHDRAWN** conforme a «or all when fewer exist»: hay una implementación de `child-bash` y una de `checkpoint`; el broker de fleet es un llamador compartido. No quedan hallazgos funcionales sin disposición.

La versión final solo ajusta estado editorial, referencias durables y distinción entre especificación y entrega. La precisión sobre `continue_child` limita su capacidad existente a sesiones de fondo completadas y retenidas: no acredita recuperación en primer plano ni selecciona un transporte nuevo. No cambia el comportamiento aprobado ni convierte recomendaciones estructurales en requisitos.

## Advertencias, disposiciones y límites

- **USER-ACCEPTED, solo definición:** integración completa y autorización real con `insufficient evidence`. La aceptación del usuario permite continuar la definición, no producción. Antes de adoptar: validar escalamiento completo y acciones reales, comparar alternativas con errores y latencia medidos y acordar criterios. No hay umbrales, modelo, caché ni presupuesto adicional aprobados.
- **reference-only:** ambos prototipos conservan su disposición; la integración aislada usa decisiones y ejecución simuladas. No demuestra recepción real por SDK, razonamiento del padre ni consentimiento humano real.
- **authorized divergence propuesta:** deltas aprobados de ADRs 0013/0017/0020 en su alcance exacto. Firma, alcance, protección del trabajo ajeno, confirmaciones y aislamiento cuando exista interferencia se conservan. Reconciliar ADRs 0015/0018/0020 y Contract/Checkpoint antes de implementar; el canon y las guardas actuales no cambian por publicación.
- **Brechas de evidencia admisibles:** ausencia separada del Domain Authority Handoff generado y de su revisión de autoridad de solo lectura. Las decisiones funcionales y semánticas están cerradas; no se fabrica autoridad sustitutiva.
- **Límites técnicos:** transporte correlacionado y Run state no son autorización; la cobertura de eventos no constituye sandbox universal. La recuperación en primer plano y sin UI requiere verificación de integración; una decisión material nueva debe volver al responsable y a `feature-critic`.

## Entrega

El par especificación/revisión técnica es distinto de la publicación conjunta del brief estable y su informe funcional exacto. Esta revisión no afirma `PUBLISHED`, creación de issue, read-backs completos, cambios de canon ni aprobación de implementación. El padre debe reinspeccionar equivalencias, publicar únicamente artefactos faltantes o reutilizar coincidencias exactas y verificar todos los read-backs del paquete y handoff vigentes antes de entregar a `to-tickets`.
