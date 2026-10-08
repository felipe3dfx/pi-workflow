# Revisión: capacidades de child session y Fleet view

Paquete: el brief `docs/features/child-session-capabilities.md` (sha256 `048b0d37…`), con `GLOSSARY.md` (`a5e8153b…`).
Handoff: revisión de autoridad de dominio renovada en cada ronda; la última es compatible con los ADR 0001 a 0013 y declara las desviaciones DV1 a DV5.
Rondas: dos rondas completas con tres lentes independientes (completitud y coherencia, simplificación y alcance, viabilidad y coherencia transversal), una segunda revisión independiente por ronda y una reverificación enfocada de las secciones editadas.
Veredicto: `READY WITH WARNINGS`.

## Hallazgos dispuestos

Las disposiciones del Owner de la ronda 1 se etiquetan O1 a O13 y las de la ronda 2, K-A a K-F. Las etiquetas R1 a R13 nombran solo los riesgos aceptados.

### Ronda 1

1. B1. El brief decía que un script de `codemode` esperaba los resultados de sus hijos sin definir cómo, ni qué pasaba con los hijos al abortarse el script. Disposición del Owner (O1): el script solo lanza; los hijos corren en segundo plano y sus resultados llegan por el ADR 0010; abortar el script no toca a los hijos lanzados. Resuelto y reverificado. La premisa de un límite de 300 s del script era incorrecta: `codemode` no tiene límite por defecto.
2. B2. Con Pi 1.0.4, una allowlist sin entrada `mcp__` dejaba sin activar las tools MCP `direct`, como context7. Corrección obligatoria: la allowlist del hijo lleva `mcp__*` y un test sobre Pi 1.0.4 verifica el conjunto invocable. Resuelto y reverificado.
3. W. Jev decidía una sola vez por mensaje, así que todos los hijos de un script recibían el mismo Specialist. Disposición del Owner (O2): Specialist por lanzamiento; un solo mensaje del gate por turno. Resuelto (DV3).
4. W. Bloqueo de rutas con secretos del explorer: incoherente con el riesgo ya aceptado y evadible por búsquedas recursivas. Disposición del Owner (O3): se retira y queda como riesgo del ADR 0014. Resuelto.
5. W. Cierre ordenado antes del timeout: no alcanza un stream colgado. Disposición del Owner (O4): se retira; el Fleet view muestra el último resultado reportado. Resuelto.
6. W. Tope de hijos por script: dejaba abiertas las llamadas directas. Disposición del Owner (O5): un único launch limit por padre. Resuelto.
7. W. File claim revisado al lanzar: no protegía nada al escribir. Disposición del Owner (O6): se retira; el reparto va en el texto de la tarea y el Fleet view muestra cruces. Término retirado del glosario. Resuelto.
8. W. Espera de MCP con fallo cerrado: más estricta que el padre. Disposición del Owner (O7): se retira. Resuelto.
9. W. Tools MCP que escriben al alcance de Specialists de solo lectura. Disposición del Owner (O8): guía en los contratos y riesgo del ADR 0014 (DV4). Aceptado.
10. W. Instrucciones del padre a un hijo en curso. Disposición del Owner (O9): solo el operador; el rechazo de `reply_child` lleva la respuesta del operador. Resuelto.
11. W. Confianza del proyecto en el hijo por defecto abierta, conexiones MCP sin cierre, instalación de `pi-web-access` vía `npm:`. Correcciones obligatorias: confianza heredada del padre, ciclo de vida de extensiones al correr y al terminar, carga solo desde la instalación local. Resueltas.
12. Invariante cache-first incorporada (O13). Resultados persistidos fuera de alcance como feature aparte (O11′, #204).

### Ronda 2

13. B (degradado a warning). En modo print o json, los hijos de un script corren en primer plano fuera de los límites. Disposición del Owner (K-A): se acepta como R8 y los escenarios se acotan a tui y rpc. Aceptado.
14. W. Cache-first prometía un conjunto de tools fijo que Pi no garantiza. Disposición del Owner (K-C): redacción honesta de D14, `description` en cada servidor del catálogo y un solo servidor `direct`; la declaración tardía queda como comportamiento heredado (R9). Aceptado.
15. W. `mcp__*` excluía las tools de recursos MCP. Corrección obligatoria: la allowlist las nombra. Resuelto.
16. W. Jev por lanzamiento podía dejar bloqueadas las tools del padre. Disposición del Owner (K-B): Jev elige solo el Specialist por lanzamiento; el destino sigue siendo uno por mensaje. Resuelto.
17. W. Launch limit impreciso. Corrección obligatoria: cuenta hijos que esperan y `continue_child`, y se revisa antes de Jev y de crear la sesión. Resuelto.
18. W. Bordes de las instrucciones al hijo y de la respuesta del operador. Correcciones obligatorias y disposición del Owner (K-D): el padre no se entera de las instrucciones (R10). Aceptado.
19. W. Ciclo de vida de extensiones en la capa equivocada y contratos sin reconciliar. Correcciones obligatorias: el ciclo de vida pasa a la capa 2 y los contratos se actualizan. Resuelto.
20. Disposiciones del Owner (K-E): `codemode` sin `models` en los hijos; el hijo lee la configuración MCP del proyecto desde el padre. Resuelto.

### Reverificación

21. W1. D14 decía que el harness fija el orden de las tools, en contradicción con R11 y con la declaración tardía. Corrección: el harness fija la allowlist con su orden. Resuelto y reverificado.
22. I1. Aclaración: en cada lanzamiento posterior a la decisión del destino, la respuesta de destino de Jev se ignora; sin respuesta válida, el lanzamiento queda Launch blocked. Resuelto.

### Síntesis de la especificación

23. B (devuelto por `to-spec`). El escenario de ruteo afirmaba que una ruta de skill o una petición explícita fijaban el destino sin Jev, lo que contradice `docs/specs/routing-owner.md` y el ADR 0008. Disposición del Owner (C1): con Jev routing apagado, el padre nombra el rol de cada lanzamiento; con Jev routing encendido, una petición explícita se responde con Jev como cualquier mensaje. Resuelto y reverificado.
24. W. DV3 cambia `docs/specs/routing-owner.md`, que no figuraba en las dependencias. Disposición del Owner (C2): se edita en la capa 3; `child-session-delegation.md` se edita en la capa 2. Resuelto y reverificado.
25. Disposiciones del Owner (C3, C4): un lanzamiento cuenta para el launch limit desde su revisión; ante un destino sin decidir, decide el primer lanzamiento que consulta a Jev; el launch limit vale 10. Decisiones de la especificación.
26. Disposiciones del Owner (C5): el Fleet view se titula `Fleet`; una instrucción pendiente se marca en la fila del hijo; el mensaje al padre por un hijo con timeout incluye su último resultado. Resuelto y reverificado sin contradicciones con el ADR 0010.
27. B (hallazgo del análisis de `badlogic/pi-subagent` y de las fuentes de Pi). El brief excluía AGENTS.md de los hijos, mientras que el valor por defecto de Pi lo carga en toda sesión. Disposición del Owner (B1): los hijos worker y verifier cargan los mismos archivos de contexto que el padre; el explorer ninguno; los skills siguen desactivados para todos. El prefijo sigue determinista por Specialist, modelo y worktree. Resuelto y reverificado, con W-1 y W-2 aplicados.
28. W. Hoy todo cierre de sesión, `/reload` incluido, descarta a todos los hijos, así que un `/reload` termina cada hijo en trabajo. Disposición del Owner (B2′): se acepta como R13 y se registra en el ADR 0014; en `session_shutdown` con motivo `reload` el harness avisa al operador cuántos hijos en trabajo terminaron y lo registra en el trace, sin afirmar nada en el Fleet view ni en la caja de hijos. V8 queda resuelta: Pi no tiene un gancho cancelable previo al reload. La supervivencia al reload corresponde a #204. Resuelto por la disposición B2′ y reverificado.
29. Disposición del Owner (W-1 a W-5): los archivos de contexto se nombran explícitamente (agent directory global, ancestros, respaldo CLAUDE.md, AGENTS.override.md y el AGENTS.md del repositorio); todo contrato declara que prevalece sobre los archivos de contexto; el Owner renovó la confirmación del brief revisado (estado CONFIRMED); se corrige el conteo a R1 a R13; la edición de `child-session-delegation.md` nombra extensiones y archivos de contexto; el ADR 0014 lista los archivos de contexto en los hijos.

## Coherencia transversal

| Capacidad | Resultado |
|---|---|
| Núcleo de child session | compatible |
| Tool gate y Jev routing | divergencia autorizada (DV3) |
| Child bash (ADR 0013) | compatible; DV5 extiende su R1 |
| Overlay a Fleet view | divergencia autorizada (DV2) |
| Catálogo de companions y doctor | divergencia autorizada (R12) |
| Catálogo MCP y exposición | compatible tras las correcciones |
| Compact rendering (ADR 0006), Chrome (ADR 0007), CodeGraph, todo | compatible |

## Decisions, Deviations and Accepted Risks

- Desviaciones DV1 a DV5, aceptadas por el Owner: extensiones curadas en los hijos; el operador responde a un hijo; Specialist por lanzamiento; tools MCP que escriben al alcance de roles de solo lectura con guía en los contratos; superficies nuevas fuera de la política de child bash.
- Riesgos R1 a R13, aceptados por el Owner y a registrar en el ADR 0014. Los riesgos R8 a R12 se aceptaron explícitamente en la disposición K-F; R13 en la disposición B2.
- Revisión requerida: el ADR 0014 y la edición de `docs/specs/child-session-delegation.md` se entregan con la capa 2.

## Pendientes para la especificación

- E2: un almacén de credenciales OAuth bajo renovación concurrente de varios hijos.
- E4: estado de módulo de `pi-web-access` compartido con el padre.
- `ask_parent` dentro de un script de un hijo; el mensaje al padre por un hijo con timeout incluye su último resultado; ubicar companions con el directorio de agente de Pi; indicador de una instrucción pendiente durante una tool larga; seating durante un fan-out; título visible del Fleet view; los términos Tool gate, contract, trace y group.
- Las descripciones del catálogo llegan al usuario cuando Configure vuelve a aplicar el catálogo.
