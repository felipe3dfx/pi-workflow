# GPT-5.6 Sol: 1.05M en OpenCode frente a 372K en Pi

**Investigado:** 2026-07-11. **Conclusión corta:** las cifras describen superficies distintas. OpenCode 1.17.18 hereda de models.dev los límites de la API pública (`1,050,000` total, `922,000` entrada y `128,000` salida), incluso al autenticar por Codex OAuth. Pi separa el proveedor `openai-codex` y publica `372,000` como ventana de entrada para `chatgpt.com/backend-api`. El catálogo oficial de Codex confirma `372,000`; la mejor lectura disponible es un límite de producto de `500,000` total menos `128,000` reservados para salida, no la capacidad anunciada de la API.

## Grado de evidencia

- **Evidencia primaria:** documentación o código/catálogo del propietario del servicio o cliente.
- **Reporte reproducible:** observación pública con versión, autenticación y medición, pero no confirmación oficial de política.
- **Hipótesis:** inferencia consistente con los datos, todavía no documentada expresamente por OpenAI.

## Hallazgos

### 1. De dónde obtiene cada cliente la cifra

| Superficie | Cifra | Procedencia | Estado al 2026-07-11 |
|---|---:|---|---|
| OpenAI API | 1,050,000 total; 128,000 salida | La [ficha oficial de GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol) dice literalmente “1,050,000 context window” y “128,000 max output tokens”. También aplica precio de contexto largo a prompts de más de 272K. | **Evidencia primaria.** La página es de la API, no una promesa específica para ChatGPT/Codex OAuth. |
| models.dev / OpenCode | 1,050,000 total; 922,000 entrada; 128,000 salida | El [catálogo JSON de models.dev](https://models.dev/api.json) alimenta el proveedor OpenAI. El issue [OpenCode #36247](https://github.com/anomalyco/opencode/issues/36247) documenta que OpenCode 1.17.18 hereda esos valores al activar OAuth. | **Código + issue del cliente.** El fix [PR #36248](https://github.com/anomalyco/opencode/pull/36248) seguía abierto; por eso OpenCode podía mostrar aproximadamente 1M aunque la petición usara el backend Codex. |
| Pi `openai-codex` | 372,000 entrada; 128,000 salida máxima | El catálogo generado público de Pi define `baseUrl: https://chatgpt.com/backend-api`, `contextWindow: 372000` y `maxTokens: 128000` en [`openai-codex.models.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/providers/openai-codex.models.ts). | **Evidencia primaria del cliente.** Pi representa el presupuesto de entrada como `contextWindow`; no muestra el total hipotético de 500K. |
| Codex oficial | 372,000 catálogo; 353,400 efectivo | El [`models.json` oficial](https://github.com/openai/codex/blob/main/codex-rs/models-manager/models.json) contiene para Sol `context_window: 372000`, `max_context_window: 372000` y versión mínima `0.144.0`. Codex aplica 95% como margen efectivo según el análisis con referencias de código en [openai/codex #31860](https://github.com/openai/codex/issues/31860). | **Catálogo primario;** 353,400 es el valor efectivo observado y derivado (`372,000 × 0.95`). |

OpenCode no descubrió 1M consultando el endpoint OAuth: mostró metadatos de la API reutilizados por models.dev. La separación de superficies todavía era una discusión abierta en [models.dev #3183](https://github.com/anomalyco/models.dev/issues/3183).

### 2. ¿Está 1M habilitado para la suscripción de USD 100?

No encontré evidencia primaria que lo garantice. La documentación oficial confirma simultáneamente que Sol existe en Codex/ChatGPT y que la **API** ofrece 1.05M, pero no afirma que el backend de suscripción OAuth tenga la misma ventana. En cambio, el catálogo publicado por OpenAI para Codex fija 372K y enumera planes, incluido `pro`, sin una ventana mayor por plan.

La evidencia disponible apunta a:

- **API key / endpoints públicos:** 1.05M, sujeto a disponibilidad y rate limits por tier; la ficha marca Free como no soportado y tiers 1-5 para “Long Context”.
- **ChatGPT/Codex OAuth subscription, incluido Pro de USD 100:** 372K de entrada en el catálogo servido a Codex, 353.4K efectivos para gestión de sesión.
- **Hipótesis:** la diferencia es una política/capacidad de la superficie de producto, no del modelo base. OpenAI no había documentado públicamente si era permanente o un rollout.

### 3. Por qué aparece 372K

La afirmación “400K menos reserva de salida” mezcla generaciones:

- GPT-5.5: `400,000 - 128,000 = 272,000` de entrada.
- GPT-5.6: `500,000 - 128,000 = 372,000` de entrada.

El parche propuesto para OpenCode codifica exactamente `context: 500000`, `input: 372000`, `output: 128000` ([diff de PR #36248](https://github.com/anomalyco/opencode/pull/36248.patch)). **Hipótesis fuerte:** el backend maneja 500K combinados y expone a Codex el presupuesto de entrada después de reservar la salida máxima. OpenAI no explica esa resta en documentación oficial; su catálogo solo publica 372K.

### 4. Funcionamiento o errores por encima de 400K

- **Reporte reproducible de fallo:** un usuario de ChatGPT Pro reportó que, tras forzar localmente 1.05M, desactivar Responses Lite y probar HTTP, el servidor rechazó `380,005` tokens de entrada ([comentario directo](https://github.com/openai/codex/issues/31860#issuecomment-4929020821)). Esto prueba anecdóticamente un límite servidor cercano a 372K y contradice 1M para esa cuenta/fecha; queda por debajo de 400K, por lo que no existe en ese reporte funcionamiento por encima de 400K.
- **Reporte de fallo de OpenCode:** [#36247](https://github.com/anomalyco/opencode/issues/36247) afirma que heredar 922K retrasa la compactación y deja la conversación irrecuperable al superar el presupuesto real. No incluye payload público con conteo exacto.
- **Reportes de funcionamiento:** [better-ccflare #304](https://github.com/tombii/better-ccflare/pull/304) informa HTTP 200 y streaming con OAuth/Codex 0.144.1, pero no demuestra prompts mayores de 372K. No encontré una prueba pública verificable de éxito OAuth por encima de 400K.

Por tanto, **no hay evidencia suficiente de que la suscripción permita >400K**; sí hay una medición concreta de rechazo antes de 400K. Los posts o comentarios son reportes, no confirmación de política global.

### 5. Cronología relevante

- **2026-07-09:** el commit oficial [openai/codex `3380969`](https://github.com/openai/codex/commit/3380969a29134630d56feb6218e8e8dcc5e8196d) actualiza automáticamente `models.json`; Sol requiere cliente mínimo 0.144.0 y publica 372K.
- **2026-07-09:** se abre [openai/codex #31860](https://github.com/openai/codex/issues/31860) con Codex App `26.707.30751`, CLI `0.144.0-alpha.4` y ChatGPT Pro.
- **2026-07-10:** OpenCode 1.17.18 reporta el desfase en [#36247](https://github.com/anomalyco/opencode/issues/36247); [PR #36248](https://github.com/anomalyco/opencode/pull/36248) propone el override OAuth de 500K/372K/128K y seguía sin fusionar el 2026-07-11.
- **2026-07-11:** Pi `main` ya separa `openai` y `openai-codex` y usa 372K para este último. Dado que los catálogos son generados y el rollout es reciente, estas cifras deben verificarse de nuevo por versión.

## Limitaciones

- Reddit bloqueó el acceso automatizado con verificación/HTTP 403; no fue posible citar hilos de forma fiable. Se priorizaron issues con datos reproducibles y fuentes primarias.
- No se ejecutó una prueba autenticada propia: requeriría consumir la cuenta y construir prompts de cientos de miles de tokens. Los límites de runtime se basan en catálogo oficial y reportes públicos.
- La ficha pública de API y algunos catálogos cambiaron durante el lanzamiento. Las URLs a `main` son vivas; los commits y versiones anteriores fijan la cronología.
- El catálogo generado de Pi para el proveedor API mostraba valores inconsistentes con la ficha oficial en otras entradas; este informe solo toma como autoritativa su entrada `openai-codex` para explicar lo que Pi muestra, no para establecer la capacidad de la API.
