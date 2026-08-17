# Deuda Técnica — Copuno Webapp

> **Documento de seguimiento interno.** No compartir con el cliente sin filtrar previamente.
> Cada hallazgo lleva severidad, coste estimado, ROI de no arreglar y recomendación (retainer / proyecto aparte / ignorar).

- **Última edición:** 2026-08-17 (**I9 detectado y CERRADO el mismo día**: la propiedad título de EMPLEADOS fue renombrada en Notion ('Nombre Completo' → cadena vacía) y desde entonces producción servía todos los nombres de empleado vacíos y la búsqueda por nombre devolvía 400→500 — incidente activo silencioso, con toda probabilidad el error de la demo ante la central de ~finales de julio. Fix estructural en v1.9.3: `titleDe()` lee el título por TIPO (inmune a renombres) y la búsqueda filtra por el ID canónico `'title'`. De la misma tanda: F0-F2 del plan pre-demo — invalidación del cache tras escrituras (BE-3, la mitad intermitente de «la app no actualiza»), `?? 8` (un 0 de horas ya no se graba como 8), `filter_properties` en todo el catálogo (payload Notion −62/−74 %), caches de estado-opciones y datos-completos. Ver [INFORME_UX_RENDIMIENTO_2026-08-17.md](INFORME_UX_RENDIMIENTO_2026-08-17.md) y CHANGELOG V1.9.1-V1.9.3.) — 2026-07-30 (**H1 resuelto técnicamente** en la rama `feature/auth-supabase` con Supabase Auth — ver H1 e historial; pendiente únicamente del corte a producción coordinado con Efrén) — 2026-07-28 (noche, 2ª tanda — **M9: 3 fixes en producción (E2, E3, E5) + E8 mitigado**; auditados ya TODOS los escenarios activos, con E8/E9/E10 nuevos. Blueprints **ya versionados** en `docs/blueprints-make/` vía `scripts/export-blueprints-make.py`, que sanea secretos → por fin hay `git diff` de lo que se toca en Make. Abiertos E1, E4, E10 y menores. — **M9 registrado: auditoría preventiva de edge cases del pipeline Make** ([EDGE_CASES_MAKE.md](EDGE_CASES_MAKE.md), E1–E7 sobre blueprints vivos de eu2) con **dos fixes aplicados en producción el mismo día**: E2 (`ifempty` en los 9 numéricos del mod 37 de PARTES2/4, vía PATCH API) y E3 (data structures explícitas `608077`/`608078` asociadas a los webhooks de 2/4 y 3/4 — cierra la clase de fallo de M8), pendiente E2E con el primer parte. **M6 CERRADO**: los 5 blueprints re-descargados desde producción vía API; además se corrigió la premisa — la referencia canónica es producción, no el repo (blueprints en `.gitignore` a propósito: contienen token Notion en claro → E1). Quedan abiertos M7 🔵 y, de M9: E1 🟠, E4–E7)
- **Última auditoría completa:** 2026-05-11 (`@senior-architect-auditor`, alcance: arquitectura general)
- **Próxima revisión sugerida:** tras cerrar bloqueantes, o trimestral.
- **Historial completo:** ver [final del documento](#historial-de-cambios).

---

## Resumen ejecutivo (estado actual)

La arquitectura cumple para el caso de uso actual pero descansa sobre **tres apuestas frágiles**: (1) no hay autenticación en `/api/*`, (2) la creación/edición de un parte hace N+1 escrituras a Notion sin transacción ni reconciliación, (3) en Vercel cada SSE abierto cuenta como serverless function corriendo hasta timeout, lo que rompe Smart Polling tal como está. El monolito de [server.js](../server.js) (~830 líneas tras la migración ADR-002) está cohesivo: **no es el problema**. Riesgo real más alto hoy: **H1 (auth) + H3 (SSE)**.

---

## Tabla resumen

Leyenda estado: ⏳ Pendiente · 🔧 En progreso · ✅ Hecho · ⏭️ Aplazado · ❌ Descartado

| ID | Sev | Título | Estado | Coste | Recomendación |
|---|---|---|---|---|---|
| [H1](#h1--ningún-endpoint-api-está-autenticado) | 🔴 | Auth en `/api/*` ausente | 🔧 en rama, pendiente corte | — | Coordinar corte con Efrén |
| [H2](#h2--creaciónedición-de-parte-no-es-atómica) | 🔴 | Parte sin atomicidad ni reconciliación | 🔧 (mitigado parcial) | 8–12 h | Retainer |
| [H3](#h3--sse-sobre-vercel-serverless-incompatible) | 🔴 | SSE incompatible con Vercel serverless | ✅ | — | Cerrado 2026-05-29 |
| [C1](#c1--webhook-a-make-envía-payload-sin-sanear) | 🟠 | Webhook Make recibe payload sin sanear | ❌ | — | Descartado — plantilla Make filtra el output |
| [C2](#c2--enviar-datos-orden-make--patch-vulnerable) | 🟠 | `enviar-datos`: ventana entre Make y PATCH estado | ✅ | — | Cerrado 2026-05-27 |
| [C3](#c3--n1-al-leer-empleados-de-una-obra) | 🟠 | N+1 al leer empleados de una obra | ✅ | — | Cerrado 2026-05-27 |
| [I1](#i1--apidatos-completos-hace-http-a-sí-mismo) | 🟡 | `/api/datos-completos` hace HTTP loopback | ✅ | — | Cerrado — Fase B, llamadas directas a `data.*` |
| [I2](#i2--cache-en-memoria--serverless--cache-inútil) | 🟡 | Cache en memoria inútil en serverless | ⏭️ | — | Aplazado — comportamiento documentado, sin ROI arreglarlo |
| [I3](#i3--rate-limit-irrelevante-con-nat-compartido) | 🟡 | Rate limit revienta con NAT compartido | ✅ | — | Cerrado 2026-05-29 |
| [I4](#i4--sin-telemetría-útil) | 🟡 | Sin telemetría, logs Vercel se pierden | ⏳ | 3–5 h | Retainer |
| [I5](#i5--reload-de-ventana-tras-editar) | 🟡 | `window.location.reload()` tras editar | ✅ | — | Cerrado 2026-05-27 |
| [I6](#i6--tests-unitarios-de-funciones-puras-notionjs) | 🔵 | Tests unitarios de funciones puras (notion.js) | ⏭️ | 2–3 h | Retainer — después de H1 y H2 |
| [I7](#i7--quick-wins-de-rendimiento-cache) | 🔵 | Quick wins rendimiento: cache firmantes + TTL catálogos | ⏭️ | ~20 min | Retainer — bajo riesgo, hacer cuando haya hueco |
| [I8](#i8--tras-enviar-datos-la-recarga-del-listado-puede-fallar-en-silencio) | 🟡 | Tras enviar-datos, si la recarga del listado da 500 la UI muestra Borrador y reactiva el botón (riesgo de doble envío percibido) | ⏳ | 1–2 h | Retainer |

| [N1](#n1--persona-autorizada-mezcla-modelo-cliente-y-modelo-interno) | 🟠 | Persona Autorizada — coexistencia legacy/interno | ⏳ | 3–5 h | Retainer (esta semana) |
| [N2](#n2--asignación-libre-amplía-superficie-de-h2) | 🟠 | Asignación libre agrava H2 (creación no atómica) | ✅ | — | Cerrado — logging ya presente en server.js |
| [N3](#n3--búsqueda-por-id-copuno-con-cobertura-incompleta) | 🟠 | ID COPUNO cubre el 50% de empleados (657 pendientes) | 🔧 (migración parcial) | — | CSV enviado a Efrén para completar |
| [N4](#n4--multiplicador-de-carga-notion-en-flujo-id-cross-obra) | 🟡 | Flujo "ID en varias obras" multiplica lecturas Notion | ✅ | — | Cerrado 2026-05-29 |
| [N5](#n5--estados-hardcoded-divergentes-del-schema-real) | 🔵 | Lista `noEditables` hardcoded incluye `'enviado'` inexistente | ✅ | — | Cerrado 2026-05-27 |
| [M1](#m1--paginación-make-partes14-módulos-9-y-15-sin-paginar) | 🔴 | Paginación Make: módulos 9 y 15 de PARTES1/4 sin paginar | ✅ | — | Cerrado 2026-06-18 |
| [M2](#m2--body-módulo-249-frágil-campos-numéricos-sin-fallback) | 🔵 | Body módulo 249: campos numéricos sin fallback + \n en Notas | ✅ | — | Cerrado 2026-06-20 |
| [M3](#m3--webhook-partes44-eliminado--página-de-firma-rota) | 🔴 | Webhook PARTES4/4 eliminado → página firma devolvía 410 | ✅ | — | Cerrado 2026-06-18 |
| [M4](#m4--n-en-notas-de-rectificativos-rompe-el-json-de-make--fix-raíz-en-servidor) | 🟠 | `\n` en Notas de rectificativos rompe JSON de Make (fix raíz en servidor) | ✅ | — | Cerrado 2026-06-20 |
| [M5](#m5--reincidencia-del-400-bad-control-character-en-partes14-notas-multilínea-de-partes-normales) | 🟠 | Reincidencia 400 `Bad control character`: Notas multilínea de partes **normales** (M4 solo cubría rectificativos) | ✅ | — | Cerrado 2026-07-28 vía `escapeJSON()` en Make |
| [M8](#m8--vehiculos-del-parte-llega-vacío-en-partes24-estructura-de-datos-del-webhook-8-sin-redeterminar) | 🟠 | `Vehiculos del parte` vacío en PARTES2/4 → PDF sin matrículas | ✅ | — | Cerrado 2026-07-28 (webhook #8 redeterminado) |
| [M6](#m6--blueprint-partes14-del-repo-desactualizado-respecto-a-producción) | 🟡 | Blueprint PARTES1/4 del repo desactualizado (aún tiene el `replace` roto) | ✅ | — | Cerrado 2026-07-28 — blueprints re-descargados de producción vía API |
| [M7](#m7--el-saneado-de-notas-en-servidor-solo-cubre-la-ruta-rectificar) | 🔵 | Saneado de Notas en servidor solo cubre `rectificar`; crear/editar escriben crudo | ❌ | 0,5–1 h | Decidir: innecesario tras M5, o defensa en profundidad |
| [M9](#m9--auditoría-de-edge-cases-del-pipeline-make-e1e7) | 🟠 | Auditoría edge cases pipeline Make (E1–E10): **E2, E3, E5 corregidos y E8 mitigado**; abiertos E1, E4, E10 y menores | 🔧 | ver doc | E1/E4 retainer; E10 decisión de negocio |

Informativos en sección [aparte](#informativos).

**Total estimado bloqueantes + críticos:** 22–35 h. No cabe en un retainer mensual de 20 h. Priorizar H1 + H3 + C3 este mes (10–17 h) y mover H2 al siguiente.

---

## Hallazgos detallados

### 🔴 Bloqueantes

#### H1 — Ningún endpoint `/api/*` está autenticado

- **Estado:** 🔧 Resuelto técnicamente 2026-07-30 (rama `feature/auth-supabase`, v1.9.0) · **pendiente del corte a producción**
- **Resolución 2026-07-30:** implementado con Supabase Auth de la plataforma (ADR-006), no con `X-API-Key`: middleware JWT en [src-server/middleware/auth.js](../src-server/middleware/auth.js) sobre todo `/api/*` salvo `/api/health` (verificación ES256 en local vía JWKS cacheado, con el `crypto` de Node), login en la SPA con reset de contraseña autoservicio, e inyección del token en el cliente axios. Validado E2E en preview con usuario real y cubierto por `auth.test.js` (8 casos). **Producción sigue abierta a propósito** hasta coordinar el corte con Efrén: las variables `SUPABASE_*` + `AUTH_OBLIGATORIA=true` solo están en el entorno Preview de Vercel. Checklist del corte en [CHANGELOG_V1.9.0.md](../CHANGELOG_V1.9.0.md). H1 se cierra del todo el día del corte.
- **Detectado:** 2026-05-11
- **Dónde:** [server.js:289-1378](../server.js#L289) (todas las rutas), [server.js:43-49](../server.js#L43-L49) (CORS).
- **Qué:** No hay middleware de auth. Cualquiera con la URL puede listar plantilla (DNI, teléfonos, categorías), partes con horas, jefes con email. Puede **crear, editar y disparar webhooks Make**. El "saneado económico" oculta importes pero no PII. CORS sin `ALLOWED_ORIGINS` = `Access-Control-Allow-Origin: *`.
- **Por qué importa:** DNI + nombre + obra + teléfono es dato personal bajo RGPD. Fuga no teórica: buscar dominio en Shodan/Censys + curl. Alguien podría disparar el webhook Make en bucle (cuesta operaciones a Copuno + PDFs basura en OneDrive).
- **Coste de arreglar:** 4–8 h. Token compartido por `X-API-Key` validado en middleware, o auth básica con usuario/pass por jefe de obra. Sin tocar UI más allá de inyectar el header.
- **Coste de NO arreglar:** Brecha RGPD inminente. Plazo de explosión: meses, no años.
- **Recomendación:** Retainer **prioritario**. Antes de cualquier feature nueva. Comprobar si Vercel/Cloudflare Access tapa esto sin código.

#### H2 — Creación/edición de parte no es atómica

- **Estado:** 🔧 Mitigado parcialmente (2026-05-27) · pendiente solución estructural
- **Mitigación 2026-05-27:** Idempotencia en `POST enviar-datos` ([src-server/lib/idempotency.js](../src-server/lib/idempotency.js)). Doble-click o reintentos del cliente ya no disparan Make dos veces ni causan PDFs duplicados. **No resuelve H2** (no garantiza atomicidad de las N escrituras de detalles), pero elimina la causa más frecuente de inconsistencias adyacentes. Test smoke verifica el replay.
- **Lo que sigue pendiente:** los bucles `for empleados` en POST `/api/partes-trabajo` y PUT `/api/partes-trabajo/:id` siguen sin transacción ni reconciliación. Si Notion devuelve 5xx en mitad del bucle, el parte queda inconsistente. Solución estructural llega con la migración a Supabase (ADR-003) — Postgres da ACID gratis.
- **Detectado:** 2026-05-11
- **Dónde:** [server.js:580-752](../server.js#L580) (POST), [server.js:1104-1339](../server.js#L1104) (PUT). Bucle `for (const empleadoId of empleados)` con `await` secuencial y `try/catch` que **se traga errores y sigue**.
- **Qué:** POST crea cabecera → PATCH nombre → N escrituras en `DETALLES_HORA`. Si la 3ª escritura falla por 429/red, el parte queda con 2 detalles y los otros desaparecen. Cliente recibe `200 OK` con `erroresDetalles.length > 0` pero **sin status code de error**. PUT es peor: **archiva** todos los detalles existentes antes de crear los nuevos — si Notion devuelve 5xx tras archivar, el parte queda **sin detalles**.
- **Por qué importa:** Es el escenario que el cliente describe cuando dice "se han perdido horas" / "el parte sale mal en el PDF". No hay forma de detectar y reconciliar.
- **Coste de arreglar:** 8–12 h. Opciones: (a) compensación/rollback si falla, (b) marcar parte como "incompleto" en Notion + endpoint "reintentar detalles fallidos" (más robusta y barata). Idempotencia con `requestId` en body como plus.
- **Coste de NO arreglar:** Pérdida silenciosa de datos cada vez que Notion tiene 5xx (mensualmente). Erosión de confianza.
- **Recomendación:** Retainer. Quick win previo: loguear estructuradamente "pretendido vs creado" con `req.id` para reconstruir manualmente cuando pase.

#### H3 — SSE sobre Vercel serverless incompatible

- **Estado:** ✅ Cerrado 2026-05-29 (v1.3.0)
- **Detectado:** 2026-05-11
- **Dónde:** [server.js:881-978](../server.js#L881), [vercel.json:11-15](../vercel.json#L11-L15).
- **Qué:** El endpoint `/estado/stream` instala `setInterval(pollLoop, ...)` y se queda colgado. En Vercel Node serverless, cada request es función con timeout máx 10 s (Hobby) / 60 s (Pro) / 900 s (Pro Edge explícito). Cada usuario con modal abierto consume **una invocación facturable continua**. Tras timeout, SSE reabre, `lastChangeTime` se resetea → patrón: poll 3s durante 60s, reconectar, otra vez → **modo lento nunca se alcanza en producción**.
- **Por qué importa:** (a) Bill shock potencial Vercel; (b) la queja "la app no actualiza" probablemente viene de los huecos entre reconexiones; (c) los cálculos de [docs/SMART_POLLING.md](SMART_POLLING.md) asumen proceso long-lived, no serverless.
- **Coste de arreglar:** 4–6 h. Sustituir SSE por **polling client-side puro** contra `/api/partes-trabajo/:id/estado` ([server.js:859-878](../server.js#L859-L878), ya existe). Eliminar endpoint stream. Smart polling se queda en el front, donde ya está.
- **Coste de NO arreglar:** Coste Vercel creciente, latencia inconsistente, refactor más caro si crece la carga.
- **Recomendación:** Retainer, próximo sprint. Bajo riesgo de regresión: lógica de polling adaptativo ya en [App.jsx:38-95](../src/App.jsx#L38-L95).

---

### 🟠 Críticos

#### C1 — Webhook a Make envía payload sin sanear

- **Estado:** ❌ Descartado (2026-05-27)
- **Detectado:** 2026-05-11
- **Dónde:** [server.js:1030-1049](../server.js#L1030-L1049).
- **Qué:** `sanitizeEconomic` solo se aplica a `res.json`. El `axios.post` al webhook envía el objeto Notion completo con todas sus propiedades.
- **Por qué se descarta:** La plantilla Make controla qué campos se renderizan en el PDF — solo muestra datos horarios, no económicos. El payload llega completo a Make pero nunca se expone al jefe de obra ni sale por ningún canal visible. Riesgo real: nulo en la configuración actual. Si Make cambia (email con payload raw, nuevo escenario), reevaluar.

#### C2 — `enviar-datos`: orden Make → PATCH vulnerable

- **Estado:** ✅ Cerrado 2026-05-27
- **Solución:** Añadido estado `Procesando` (amarillo) en Notion. El flujo ahora es: (1) PATCH `Procesando` → (2) webhook Make → (3) PATCH `Datos Enviados`. Si (2) o (3) fallan, el parte queda en `Procesando` — bloqueado para edición y reenvío. La oficina reconcilia manualmente cambiando el estado en Notion. `PARTE_NO_EDITABLES` actualizado para incluir `'procesando'` en `notion.js` y `mockData.js`.

#### C3 — N+1 al leer empleados de una obra

- **Estado:** ✅ Cerrado (2026-05-27)
- **Detectado:** 2026-05-11
- **Resuelto en:** [server.js](../server.js) endpoint `GET /api/obras/:obraId/empleados` → ahora delega en [src-server/services/notion.js](../src-server/services/notion.js) `obras.empleadosDeObra()`, que hace **una sola query** filtrada por relación inversa `EMPLEADOS.Obras contains :obraId`.
- **Validación:** test smoke en [src-server/tests/smoke/smoke.test.js](../src-server/tests/smoke/smoke.test.js) cubre el endpoint (modo mock). En live el comportamiento se verifica visualmente desde la app.
- **Nota:** ya estaba implementado en código durante la Etapa 1 (commit anterior), pero seguía marcado como pendiente por descuido documental. El refactor a `data.js` (ADR-002) lo confirma como patrón.

---

### 🟡 Importantes

#### I6 — Vehículos (v1.5.x): el PDF muestra las matrículas — ✅ CERRADO

- **Estado:** ✅ Cerrado (2026-07-14 noche). Prueba E2E verificada: parte con matrícula `7072KLC` → el `.docx` generado en OneDrive muestra "Vehículos: 7072KLC" bajo Total Horas. Caso borde (parte sin matrícula) → pipeline completa sin atascarse.
- **Hecho:** plantilla `Plantilla Parte.docx` con la fila `Vehículos: {{Vehiculos}}` bajo Total Horas (14-jul, OneDrive, mismo archivo/id); variable `Vehiculos` guardada en el módulo 39 de PARTES 1/4; blueprints editados y verificados en `~/Downloads/LISTO-IMPORTAR-PARTES{1,2,3}-4.blueprint.json` (incluyen la clave `Vehiculos del parte` en los saltos 1→2→3, la entrada `Vehiculos` en docx-templater, y reparan el `replace` de Notas del módulo 249 que perdió el espacio del 3er argumento durante la edición UI).
- **Hecho (14-jul noche, vía Claude Chrome):** importados los 3 blueprints; verificados los mapeos (variable `Vehiculos` en módulo 39, `Vehiculos del parte` en los saltos 1→2→3, entrada `Vehiculos` en docx-templater); **revertido el scheduling** de los 3 a "Immediately as data arrives" (el import lo había cambiado a "Every 15 minutes" — habría retrasado el PDF hasta ~45 min); blueprints reexportados a [docs/Escenarios Make/](./Escenarios%20Make/).
- **Aprendizaje adicional:** importar un blueprint sobre un escenario existente RESETEA su scheduling — tras cada import de un escenario con trigger webhook, verificar y devolver a "Immediately as data arrives".
- **Aprendizaje:** el editor de Make trunca paths IML con caracteres no-ASCII al teclear/pegar — propiedad renombrada a `Vehiculos` sin tilde (v1.5.1); las ediciones masivas de escenarios, siempre por import de blueprint.

#### I1 — `/api/datos-completos` hace HTTP a sí mismo

- **Estado:** ✅ Cerrado (Fase B, 2026-05-27) — reemplazado por `Promise.all([data.obras.listar(), data.jefesObra.listar(), data.empleados.listar(), data.partesTrabajo.listar()])`. Sin HTTP loopback, sin fragilidad de host/protocolo, funciona en mock y live.

#### I2 — Cache en memoria + serverless = cache inútil

- **Estado:** ⏭️ Aplazado — comportamiento documentado, sin ROI arreglarlo ahora.
- `CACHE_TTL_MS` asume proceso long-lived. En serverless, cada invocación puede arrancar con `cache = new Map()` vacío si la lambda está fría. El comportamiento es impredecible pero el impacto es bajo: en el peor caso simplemente no cachea nada y hace más llamadas a Notion. No invertir en Vercel KV mientras el volumen sea pequeño. Reevaluar si se detectan 429s frecuentes en producción.

#### I3 — Rate limit irrelevante con NAT compartido

- **Estado:** ✅ Cerrado 2026-05-29 — `RATE_LIMIT_MAX` default subido de 100 → 1000 en código (commit Etapa 1, confirmado en producción). **Solución definitiva** pendiente de H1: `keyGenerator` por usuario autenticado. · **Dónde:** [server.js:86-95](../server.js#L86-L95)
- Con Smart Polling (3 s/req en modo rápido), un solo usuario hace 300 req/15min — el triple del límite actual (100). Con varios usuarios en el mismo NAT corporativo, revienta con uso normal. Vercel Pro no resuelve esto — el rate limit sigue siendo por IP independientemente del plan.
- **Solución temporal:** subir `RATE_LIMIT_MAX` a ~1000 en Vercel Dashboard en cuanto haya acceso. **Solución definitiva:** `keyGenerator` por usuario autenticado cuando se cierre [H1](#h1--ningún-endpoint-api-está-autenticado) — H1 lo resuelve del todo.

#### I4 — Sin telemetría útil

- **Estado:** ⏳ Pendiente · **Dónde:** todo [server.js](../server.js) · **Coste:** 3–5 h.
- Solo `console.*` + morgan. Vercel mantiene logs 3 días (Pro). Para diagnosticar "se perdieron las horas del martes pasado" ya están borrados. `req.id` se genera pero no se propaga al webhook Make ni a respuestas de error al cliente — sin forma de correlacionar log del servidor con log de Make.
- **Herramienta decidida: Better Stack** (logging pino + retención 30 días + alertas, plan free suficiente). Doble beneficio: instalar Better Stack = instalar pino, que es el logger del ADR-006 pendiente.
- **Bloqueante:** alta en Better Stack pendiente de desbloquear email `javi@notionvan.com`. Una vez desbloqueado: crear cuenta, obtener token, instalar `pino` + transport Better Stack, propagar `req.id` a webhook Make y respuestas de error.

#### I5 — Reload de ventana tras editar

- **Estado:** ✅ Cerrado 2026-05-27 — reemplazado por `onRefrescarPartes()` que recarga solo la lista de partes vía `getPartesTrabajo()` sin recargar la página completa.

---

### 🔵 Informativos

#### I6 — Tests unitarios de funciones puras (notion.js)

- **Estado:** ⏭️ Aplazado — hacer cuando H1 y H2 estén cerrados.
- **Detectado:** 2026-05-29 · **Severidad:** 🔵
- **Qué:** Las funciones `extractPropertyValue`, `buildEstadoUpdatePayload`, `sanitizeEconomic` y los mappers (`mapParte`, `mapEmpleado`, etc.) en `src-server/services/notion.js` son funciones puras sin dependencias externas — candidatas ideales para tests unitarios con Vitest. Hoy no tienen cobertura unitaria formal (los smoke tests prueban los endpoints completos en mock, no las funciones individualmente).
- **Por qué aplazar:** el riesgo real activo del proyecto es H1 (auth, RGPD) y H2 (atomicidad). Los unitarios protegen contra regresiones en funciones puras, que históricamente no han sido el punto de fallo en este proyecto. Las 2-3 h tienen mayor ROI cerrando H1/H2 primero.
- **Coste cuando se haga:** 2-3 h. Instalar Vitest (compatible con el stack actual), escribir tests para `extractPropertyValue` (15+ tipos de propiedad Notion), `sanitizeEconomic` (regla RGPD), y los mappers principales. Integrar con `npm run test` junto a los smoke tests existentes.
- **Valor cuando se haga:** red de seguridad para refactors de `notion.js` (usada en 20+ sitios), documentación viva del contrato de cada tipo de propiedad Notion, práctica de TDD sobre código real.
- **Recomendación:** retainer, después de H1 y H2.

#### I7 — Quick wins de rendimiento: cache firmantes + TTL catálogos

- **Estado:** ⏭️ Aplazado · **Detectado:** 2026-05-29 · **Severidad:** 🔵
- **Contexto:** el cuello de botella real es la latencia de Notion API (~300-800 ms/request desde Vercel EU). El código ya tiene cache de 30 s en obras, jefes, empleados y partes, y `Promise.all` en `datos-completos`. Lo que falta son dos mejoras de coste mínimo:
  1. **Cache en `/api/obras/:id/firmantes-autorizados`** — se llama cada vez que el usuario selecciona una obra al crear/editar un parte. Sin cache: si el usuario cambia de obra N veces, son N llamadas a Notion. Fix: clave `firmantes:${obraId}` con TTL 30 s (mismo patrón que el resto). ~15 min.
  2. **Subir TTL de catálogos de 30 s → 5 min** — obras, jefes y empleados cambian raramente durante la jornada. 30 s es muy conservador. Con 5 min se reduce ~90% de las llamadas a Notion para catálogos sin impacto en consistencia. ~5 min (cambiar un número en `CACHE_TTL_MS` default o por variable de entorno).
- **Lo que NO tiene ROI:** migración a Supabase (proyecto aparte), paginación de partes (134 partes, no es el problema), compresión (ya activa).
- **Coste total:** ~20 min.
- **Recomendación:** retainer, hacer cuando haya hueco entre tareas más prioritarias.

- **[server.js](../server.js) ~830 líneas — refactorizado (Fase B, 2026-05-27).** No urge partirlo. Si se hace, partir por dominio (obras, empleados, partes, detalles, webhook), no por capa.
- **[src/App.jsx](../src/App.jsx) ~2.470 líneas — sí es un olor.** Formularios + listado + modal + polling + edición en uno. Refactor por componentes (`EdicionParte`, `DetallesParteModal`, `ListadoPartes`) es **proyecto aparte**, no entra en 20h/mes.
- **`extractPropertyValue`** vive en [src-server/services/notion.js](../src-server/services/notion.js) y se importa en `server.js`. La copia de [src/services/notionService.js:69](../src/services/notionService.js#L69) (frontend) diverge ligeramente — aceptable al tamaño actual.
- **Versiones:** React 18, Vite 7, Express 4. Todo soportado y al día. Helmet/compression/morgan correctos.
- **Catch-all `/^(?!\/api\/).*/`** ([server.js:1376](../server.js#L1376)) es correcto, evita el bug clásico de capturar /api con regex laxas.
- **IDs de BBDD Notion hardcoded** en [server.js:27-33](../server.js#L27-L33). Aceptable para 4 BBDDs estables; mover a env si se duplica en staging.

---

## Pendiente de validar (no se ha podido confirmar en código)

- **Comportamiento real de SSE en Vercel:** confirmar revisando logs de invocaciones de `/api/partes-trabajo/*/estado/stream` un día normal. Si la duración media es >30 s, [H3](#h3--sse-sobre-vercel-serverless-incompatible) está confirmado.
- **Si Make recibe importes hoy:** depende del esquema real de la BD `Partes de trabajo`. Si tiene propiedad "Importe" en uso, [C1](#c1--webhook-a-make-envía-payload-sin-sanear) está confirmado. Revisar también el PDF que firma el jefe.
- **Concurrencia real bajo carga:** la lógica "no editable si firmado" hace lectura previa (TOCTOU clásico). Riesgo real pero baja probabilidad con < 10 usuarios. Para confirmar, probar dos clientes simultáneos.
- **Carga real:** ¿cuántos jefes de obra activos? Si 3–5, varios hallazgos son teóricos. Si 20+, [H3](#h3--sse-sobre-vercel-serverless-incompatible) e [I3](#i3--rate-limit-irrelevante-con-nat-compartido) suben de prioridad.

---

## Mensaje recomendado al cliente

Tres mensajes a Copuno cuando proceda:

1. **Seguridad (H1, ya):** "Antes de seguir añadiendo cosas, hay que poner una capa de autenticación en la app. Hoy cualquiera que conozca la URL podría leer datos de empleados. Lo cubro dentro del retainer este mes; necesito decidir contigo si autenticamos con un usuario por jefe de obra o con un código compartido."
2. **Integridad (H2):** "He detectado que en momentos de mala conexión es posible que un parte se guarde a medias sin que la app os avise. Lo mitigo este mes (logging + bloqueo de duplicados); el arreglo definitivo (reintentos automáticos) lo planteamos como mejora del próximo trimestre."
3. **Resto:** entra en retainer normal. **No** mencionar refactor de [src/App.jsx](../src/App.jsx) ni el monolito — son problemas internos, no del cliente.

Cualquier petición tipo "queremos que vaya más rápido la sincronización" se canaliza a [H3](#h3--sse-sobre-vercel-serverless-incompatible) y se presenta al cliente como mejora de rendimiento, no como bug fix.

---

## Auditoría 26 may 2026 — evaluación del plan semanal

> **Alcance:** evaluar el plan de funcionalidades de la semana (arranque 1 jun con Andrés Ríos) contra los hallazgos de la auditoría del 11 may. No re-auditoría completa. Inspección de Notion vía API REST (solo lectura).

### (a) Hallazgos existentes que cambian de prioridad por el plan

| ID | Cambio | Justificación |
|---|---|---|
| **C3** | Sube de "Retainer" a **primer ítem de la semana** (ya estaba acordado). | El plan introduce dos nuevas vistas que dependen de `/api/obras/:id/empleados` (selector previo + lista de empleados con ID/categoría) y dos endpoints nuevos derivados del mismo patrón. Si no se arregla el N+1 antes, todo lo nuevo hereda los 10 s/30 empleados y aumenta la probabilidad de 429. |
| **H2** | Se mantiene en próximo sprint **pero** el quick win (logging "pretendido vs creado" con `req.id`) pasa a ser **obligatorio antes del 1 jun**. | Permitir asignar empleados sin asignación previa a la obra (funcionalidad 1) e ingresar al mismo empleado en varias obras el mismo día (funcionalidad 3) **multiplica el número de escrituras `DETALLES_HORA` por parte y la probabilidad de fallo silencioso**. Sin el log estructurado, los partes "a medias" en producción serán indetectables. |
| **C1** | Sin cambio. | El payload a Make no se toca en el plan. |
| **C2** | Sin cambio. | El flujo `enviar-datos` no cambia. |
| **I3** (rate limit) | Sube a **revisar antes del 1 jun**. | Andrés Ríos como nuevo usuario operativo + búsqueda por ID + filtrado de firmantes por obra = más peticiones por jornada. Con NAT corporativo y `RATE_LIMIT_MAX=100/15min`, dos usuarios concurrentes ya rozan el límite. Subir a 1000 ahora (1 h) evita un incidente bobo en la primera semana. |
| **H1** | Sin cambio (bloqueado por Supabase). | Decisión ya tomada. |
| **H3** | Sin cambio (Vercel Pro mitiga). | Decisión ya tomada. |

### (b) Riesgos NUEVOS

#### N1 — Persona Autorizada mezcla modelo cliente y modelo interno

- **Estado:** ⏳ Pendiente · **Detectado:** 2026-05-26 · **Severidad:** 🟠
- **Dónde:** BD `Persona Autorizada` (Notion) + [server.js:336-363](../server.js#L336) (`/api/jefes-obra`) + [server.js:580-752](../server.js#L580) (POST parte, asigna `Persona Autorizada` relation).
- **Qué:** El modelo A introduce `Rol` en JEFE_OBRAS y `Firmantes Autorizados` en OBRAS. Las **7 entradas actuales** de la BD son una mezcla heterogénea: hay un `rfayos@copuno.com` (interno, lo que se busca), pero también `p@ntnvn.com`, `javi@notionvan.com`, `javiercollado@mee.com`, `javiercollado@me.com`, `javi@pasteleriaparatodos.com` y una entrada `MELENDEZ` **sin email**. Es decir: lo que hoy hay es *de pruebas/legacy*, no representa el modelo "representante del cliente" puro que asumía el plan. Tras la migración convivirán:
  1. Entradas legacy sin `Rol` (NULL).
  2. Entradas nuevas con `Rol` ∈ {Jefe de Obra, Jefe de Producción, Encargado, Otros}.
  3. Entradas legacy que ya no aplican a ninguna obra pero siguen apareciendo en `/api/jefes-obra` (toggle "búsqueda libre").
- **Por qué importa:** (1) Partes históricos referencian estas entradas — si se borran rompes la trazabilidad. (2) El selector "filtrado por obra" devolverá vacío en obras sin `Firmantes Autorizados` poblado (las 124 obras existentes). (3) El toggle "búsqueda libre" enseña la mezcla completa al usuario, incluyendo entradas claramente de prueba (`@me.com`, `@notionvan.com`). (4) Sin validación de `Rol` en el backend al crear/editar parte, se pueden colar entradas sin rol asignado.
- **Coste de arreglar:** 3–5 h. Incluye: (i) migración manual de las 7 entradas (revisar cuáles son reales, cuáles borrar/archivar); (ii) poblar `Firmantes Autorizados` en las 55 obras activas (decisión: ¿se hace en Notion a mano o se programa una pasada?); (iii) decidir comportamiento del endpoint cuando una obra no tiene firmantes asignados (fallback al toggle libre vs error claro al usuario).
- **Coste de NO arreglar:** Selector vacío en producción el 1 jun = bloqueo operativo de Andrés. UX degradada y necesidad de hotfix.
- **Recomendación:** Retainer, **esta semana**. Es la dependencia más infravalorada del plan.

#### N2 — Asignación libre + multi-obra amplían superficie de H2

- **Estado:** ✅ Cerrado (verificado 2026-05-27) — logging estructurado ya presente en `server.js`.
- Los eventos `parte_creado` y `detalles_actualizados` incluyen `reqId`, `pretendidos`, `creados`, `errores` y `empleadosNoAsignadosIds`. Cruzable con logs de Vercel para reconstruir cualquier pérdida de horas. No requería código adicional.

#### N3 — Búsqueda por ID COPUNO con cobertura incompleta

- **Estado:** 🔧 Migración parcial · **Detectado:** 2026-05-26 · **Actualizado:** 2026-05-28 · **Severidad:** 🟠 (producto, no técnico puro)
- **Dónde:** BD `Empleados`, propiedad `ID COPUNO` (number).
- **Qué (dato actual):** De **1.330 empleados, 673 (50,6%) tienen `ID COPUNO`** poblado. 657 siguen sin él.
  - **Carga automática 2026-05-28:** cruce del Excel `docs/ID.xlsx` (867 entradas) con Notion vía normalización + rotación de tokens. **306 empleados actualizados** (305 + 1 reintento por reset de conexión). Cobertura subió del 27% al 50% sin intervención manual.
  - **Pendientes (657):** exportados a `docs/revision_ids_empleados.csv` con dos grupos:
    - **Grupo A (61 casos):** fuzzy match ≥50% de tokens — sugerencia de ID incluida en CSV, Efrén solo confirma SÍ/NO.
    - **Grupo B (595 casos):** sin candidato en el Excel — puede ser alta reciente, baja definitiva, o nombre con divergencia grande.
  - Rango de IDs: 0–5957. Todos de 4 dígitos. 0 de 5 dígitos todavía.
- **Por qué importa:** La funcionalidad 2 (buscar por ID) y la 3 (registrar al mismo empleado en varias obras solo con su ID) funcionan ya para la mitad de la plantilla. El 50% restante sigue devolviendo "no encontrado".
- **Coste de arreglar el resto:** 0 h de código. Esfuerzo de Copuno: revisar `docs/revision_ids_empleados.csv` y devolver completo.
- **Recomendación:** Enviar CSV a Efrén. Al recibirlo, ejecutar script de volcado idéntico al usado hoy (máx 1 h).

#### N4 — Multiplicador de carga Notion en flujo "mismo empleado en varias obras"

- **Estado:** ✅ Cerrado 2026-05-29 (v1.3.0) — cache de 30 s añadida a `/api/empleados/buscar` tanto para búsqueda por ID (`buscar-id:N`) como por nombre (`buscar-q:texto:limite`). Patrón reutilizado del cache existente en `server.js`. · **Detectado:** 2026-05-26 · **Severidad:** 🟡
- **Dónde:** Nuevo endpoint probable `/api/empleados/buscar?id=` + uso encadenado con `/api/obras/:id/empleados` y POST de parte.
- **Qué:** Flujo típico funcionalidad 3: usuario teclea ID → backend busca empleado (1 query a `EMPLEADOS` con filtro) → si está en otra obra activa hay que validar/mostrar el contexto → cada parte nuevo crea un `DETALLES_HORA`. Con Notion a 3 req/s y N partes en obras distintas para el mismo empleado al mismo día (escenario realista en construcción: peón rotando), el patrón secuencial actual ya saturado por C3 entra en zona de 429.
- **Por qué importa:** Refuerza la urgencia de C3 (`Promise.all` con `p-limit`) y sugiere añadir cache corta (~5 s) para `/api/empleados/buscar?id=` durante una jornada.
- **Coste de arreglar:** 2–4 h adicionales sobre C3 (cache ID→empleado + búsqueda por filtro Notion, no `pages/:id`).
- **Coste de NO arreglar:** 429 esporádicos = UX errática en horario punta (mañanas).
- **Recomendación:** Tratar conjuntamente con C3 esta semana.

#### N5 — Estados hardcoded divergentes del schema real

- **Estado:** ✅ Cerrado 2026-05-27 — eliminado `'enviado'` de `PARTE_NO_EDITABLES` en [src-server/services/notion.js](../src-server/services/notion.js). Array queda `['firmado', 'datos enviados']`, alineado con el schema real de Notion.

#### N6 — Partes rectificativos: dependencias manuales Notion/Make + riesgo de fichero en PARTES4-4

- **Estado:** 🔧 En progreso · **Detectado:** 2026-05-28 · **Severidad:** 🟠
- **Contexto:** implementada la feature de partes rectificativos (endpoint `POST /api/partes-trabajo/:id/rectificar`, mock, UI). Modelo: parte nuevo en Borrador enlazado al firmado vía relación reflexiva; reutiliza el pipeline existente para PDF + nueva firma.
- **Dependencias manuales para live:**
  1. **Notion:** ✅ Cerrado 2026-05-28 — `Rectifica a ` / `Rectificado por ` (relación reflexiva dual) y `Es Rectificativo` (fórmula) creadas en la BD `Partes de trabajo`. **OJO:** las dos propiedades de relación se crearon con un **espacio al final del nombre**; el código las referencia con ese espacio exacto (fix commit `4cea407` — antes fallaba con 500 "is not a function" / propiedad desconocida). Verificado en producción con `@regression-checker` y QA Chrome (crea rectificativo, marca original, abre edición, sin errores).
  2. **Make:** ⏳ Pendiente — pasos exactos (decisión 2026-05-29: queda en deuda técnica para hacer manualmente):

     **Paso 1 — `Plantilla Parte.docx`** (OneDrive, carpeta `INFRA`):
     Abrir el .docx y añadir bloque condicional donde sea visible (p.ej. bajo el título):
     `{#Rectificativo}PARTE RECTIFICATIVO{/Rectificativo}`
     Guardar y subir con el mismo nombre.

     **Paso 2 — PARTES1-4, módulo 39** (`util:SetVariables`):
     Añadir variable `Rectificativo` = `{{2.data.properties["Es Rectificativo"].formula.boolean}}`

     **Paso 3 — PARTES1-4, módulo 249** (POST a PARTES2-4):
     Añadir campo al body JSON: `"Rectificativo": "{{39.Rectificativo}}"`

     **Paso 4 — PARTES2-4, módulo 37** (POST a PARTES3-4):
     Añadir campo al body JSON: `"Rectificativo": "{{1.Rectificativo}}"` (confirmar nº módulo webhook receptor en el escenario real).

     **Paso 5 — PARTES3-4, módulo 11** (`docx-templater:FillDocument`):
     Añadir variable al mapper: `Rectificativo` = `{{1.Rectificativo}}`

     **Paso 6 — Verificación**: tomar un parte rectificativo en Borrador, pulsar "Enviar datos" y comprobar que el PDF generado incluye la marca visual.

     **OJO:** no añadir sufijo al nombre del fichero en el módulo 13 (upload OneDrive) hasta resolver el riesgo de PARTES4-4 (ver abajo).

- **Riesgo latente confirmado (inspector):** PARTES4-4 módulo 34 lista la carpeta OneDrive `PARTES FINALES` (hasta 50 ficheros) sin filtro de nombre visible en el mapper antes de descargar `{{34.id}}`. Con rectificativos (más ficheros de la misma obra) aumenta la probabilidad de descargar el PDF equivocado al firmar. Verificar si hay filtro condicional entre módulo 34 y 17; si no, es un bug a corregir en Make antes de activar sufijos en el nombre del fichero.
- **Recomendación:** el botón ya es seguro en producción (Notion listo, mitigación por Notas). Hacer los pasos Make cuando haya acceso — no requiere código. Tratar el riesgo de PARTES4-4 primero si se van a usar sufijos en nombres de fichero.

### (c) Orden de implementación recomendado para la semana

Asume ~16 h efectivas (resto del retainer del mes; algo se va en revisión, deploy y QA).

| # | Ítem | Coste | Bloquea a | Justificación |
|---|---|---|---|---|
| 1 | **N1 (parcial)** — decisión + migración manual de JEFE_OBRAS + poblar `Firmantes Autorizados` en obras activas (en Notion, manual de Efrén con tu guía). | 1–2 h tu tiempo + esfuerzo cliente | 4, 5 | Sin datos limpios no se puede construir el selector filtrado. |
| 2 | **N3 — decisión de producto sobre cobertura `ID COPUNO`.** | 30 min reunión | 5, 6, 8 | Si no hay compromiso, se cancelan funcionalidades 2 y 3. |
| 3 | **C3 + N4** — query a `EMPLEADOS` por relación con obra + cache 5 s. | 3–4 h | 5, 6, 7 | Base de las nuevas vistas. |
| 4 | **N2 (quick win H2)** — logging estructurado pretendido vs creado en POST/PUT partes. | 1–2 h | — | Red de seguridad para el resto. |
| 5 | **Plan func. 6** — vista empleados del parte (ID + nombre + apellidos + categoría). | 1–2 h | — | Bajo riesgo, solo lectura. |
| 6 | **Plan func. 5 + 1** — toggle "asignación previa / búsqueda libre" + asignar empleados no preasignados. | 2–3 h | — | Depende de C3 (paso 3) y del log (paso 4). |
| 7 | **Plan func. 4** — selector firmantes filtrado por obra + toggle libre. Nuevo endpoint `/api/obras/:id/firmantes-autorizados`. | 2–3 h | — | Depende de N1 (paso 1). |
| 8 | **Plan func. 2 + 3** — búsqueda por ID + registro multi-obra con ID. | 3–4 h | — | **Solo si N3 (paso 2) sale "go".** |
| 9 | **I3 (subir RATE_LIMIT_MAX a 1000)** + N5 (limpieza estados). | 30 min | — | Higiene previa al go-live. |

### (d) Go / No-go

- 🟢 **GO** — Funcionalidades 5, 6, 1 y 4. Riesgo controlado si paso 1 y paso 3 se cierran.
- 🟡 **CONDICIONAL → PARCIALMENTE DESBLOQUEADO** — Funcionalidades 2 y 3. Cobertura actual 50% tras carga automática 2026-05-28. Operativas para la mitad de la plantilla. Cobertura completa condicionada a revisión del CSV por parte de Efrén.
- 🔴 **NO-GO si** se intenta arrancar el 1 jun sin: (i) `Firmantes Autorizados` poblado en obras activas, (ii) quick win de H2 desplegado, (iii) C3 resuelto. Cualquiera de los tres ausente = arranque expuesto a incidente visible.

### (e) Verificaciones en Notion

> Datos extraídos vía API REST (solo lectura), 2026-05-26.

#### E1. Drift de schema vs `docs/notion-schema-detailed.md`

Hay drift significativo. Lo más relevante:

- **OBRAS:** la doc lista 17 propiedades; la BD real tiene **~40**. Nuevas (no en doc): `Place`, `Teléfono JO`, `Encargado COPUNO` (select, antes `Encargado`), `ABRIL`/`MAYO`/`ENERO` (checkboxes de cierre mensual), `Fecha de cierre`, `Próximo cierre (auto)` (formula), `Día cierre`, `Importe pendiente cierre`, `Próximo cierre` (date), `Responsable PRL (Obra)`, `Encargado cliente (Teléfono)` (people), `Importe total de la obra` (rollup), `Vivienda`, `Contacto Administración - Nombre/Teléfono` (este último tipo `email`, sospechoso), `Jefe Obra` (rich_text), `Jefe Obra@` (email), `Código Obra` (number), `Gastos`, `Pendiente cierre`, `Oferta aceptada` (files), `Vehículos`, `Vehiculo trasiego` (number). La doc también renombra: `Encargado` → en realidad es `Encargado COPUNO`.
- **JEFE_OBRAS:** schema en doc OK (3 props). **No tiene `Rol` ni nada parecido todavía.**
- **EMPLEADOS:** la doc menciona 23 propiedades; la real tiene **~30**. Nuevas: `🚦 Semáforo fin baja` (formula), `Dolencia / síntoma`, `🚦 Semáforo IT (duración)`, `Inicio baja`, `Género`, `Asignaciones de vehículo`, `🚚 Vehículos`, `Fin baja paternidad`, `Fin excedencia`, `🚦 Semáforo excedencia`, `Situación` (formula), **`ID COPUNO` (number) ya existe**, `Inicio excedencia`, `Skills` (select 43 opciones), `Próxima revisión baja`. La doc dice `Categoría` tiene 48 opciones; la BD real tiene **44**.
- **PARTES_TRABAJO:** schema en doc razonablemente alineado. Estados reales del status: `['Borrador', 'Listo para firmar', 'Datos Enviados', 'Firmado']` (confirma E7).
- **DETALLES_HORA:** la doc lista 15 propiedades; la real tiene **~22**. Nuevas: `AUX Cliente`, `Fecha` (formula), `Periodo de Cierre`, `F_Cliente`, `Es Periodo Actual`, `Obra` (rollup), `AUX Obra del parte`.

**Acción:** la doc está desfasada. No urgente para el plan (el código no la consume), pero rebajar su autoridad — el código manda. Considerar regenerarla (script que ya parece existir, dado el formato).

#### E2. Propiedades nuevas del plan — ¿existen?

| Propiedad | BD | ¿Existe hoy? | Configuración requerida |
|---|---|---|---|
| `Rol` | JEFE_OBRAS | **No** | `select` con opciones: `Jefe de Obra`, `Jefe de Producción`, `Encargado`, `Otros`. |
| `Firmantes Autorizados` | OBRAS | **No** | `relation` → JEFE_OBRAS (`20882593a25781b4a3b9e0ff5589ea4e`), tipo `dual_property` (sincronizada) recomendado para poder filtrar inversamente. |

#### E3. Volumen real

- **EMPLEADOS:** 1.331 total; **693 activos (`ON - Disponible`)**; 546 sin estado (probable inactivo histórico); 14 `X - No está en la empresa`; resto en estados transitorios (IT, VA, CO, etc.).
- **OBRAS:** 124 total; **55 activas**; 43 finalizadas; 13 pendiente cierre proforma; 11 paradas; 2 sin empezar.
- **Empleados/obra activa:** mediana **4**, media **6,1**, máximo **25**, mínimo 0. Notion a 3 req/s + N+1 secuencial: obra mediana ~1,5 s, obra grande ~8,5 s. C3 es real.
- **PARTES_TRABAJO:** 134 total leídos. Detalles/parte: mediana **0** (muchos partes borrador vacíos), media **1,4**, máximo **23**. El pico de 23 detalles confirma que H2 puede afectar a partes "gordos".
- **Distribución de estados de partes:** Borrador 104 · Firmado 23 · Listo para firmar 2 · Datos Enviados 5.

#### E4. Categorías reales en EMPLEADOS

Hay **44 opciones** en el select `Categoría`. Los 4 roles del plan **no aparecen como tal**; el catálogo está orientado a convenio de construcción (`08- OF. 1ª ALBAÑIL`, `09- PEON ESPECIALISTA`, `04- ENCARGADO`, `04- CAPATAZ`, etc.). **El plan habla de roles de la BD JEFE_OBRAS (`Jefe de Obra`, `Jefe de Producción`, `Encargado`, `Otros`), que son distintos de las categorías laborales de EMPLEADOS** — no confundir. Confirmar con Efrén que esa distinción está clara.

Higiene aparte: hay duplicados con espacios/inconsistencias en `Categoría` (`09- PEON ESPECIALISTA` vs `09- PEON ESPECIALISTA ` con espacio final, varias variantes de "OFICIAL 1ª ENCOFRADOR"). No es del scope de esta semana, pero merece nota.

#### E5. Estado actual JEFE_OBRAS

Solo **7 entradas**. Dominios de email:
- `copuno.com`: 1 (Raul Fayos)
- `ntnvn.com`, `notionvan.com`, `mee.com`, `me.com`, `pasteleriaparatodos.com`: 1 cada uno (entradas claramente de prueba / personales tuyas).
- 1 entrada sin email (`MELENDEZ`).

Muestra completa:
```
- 'MELENDEZ'              (sin email)
- 'Raul Fayos Martinez'   rfayos@copuno.com
- 'Paco Pérez'            p@ntnvn.com
- 'Javier Lopez '         javiercollado@mee.com
- 'Adolfo Montes'         javi@notionvan.com
- 'Javier Veiga'          javi@pasteleriaparatodos.com
- 'Francisco Ruiz '       javiercollado@me.com
```

**Diagnóstico:** la BD está en estado pre-productivo. La mayoría son entradas de testing. **Antes de añadir `Rol`, decide qué entradas archivar y cuáles representan personas reales de Copuno.** Los 23 partes firmados existentes referencian a estas entradas — verificar a quién apuntan antes de borrar.

#### E6. Cobertura `ID COPUNO` en EMPLEADOS

- **Con `ID COPUNO`:** 673 (50,6%) — actualizado 2026-05-28 tras carga automática de 306 IDs.
- **Sin `ID COPUNO`:** 657 (49,4%) — CSV de revisión en `docs/revision_ids_empleados.csv`.
- Rango: 0–5957. Todos de 4 dígitos. 0 de 5 dígitos.

**Implicación para el plan:** ver N3. Funcionalidades 2 y 3 operativas para la mitad de la plantilla desde hoy.

#### E7. Estados PARTES_TRABAJO

Status real: `['Borrador', 'Listo para firmar', 'Datos Enviados', 'Firmado']`. La comprobación en `server.js:1149` (`['firmado', 'datos enviados', 'enviado']` en lowercase) cubre `Firmado` y `Datos Enviados`. **`'enviado'` no existe como estado** — ver N5.

#### E8. Hallazgos adicionales

- **`Contacto Administración - Teléfono`** en OBRAS es de tipo `email`. Casi seguro un error de configuración. No es del scope semanal pero merece reportarlo a Efrén.
- **Propiedades duplicadas/similares** en EMPLEADOS: `Categoría` (select 44 opciones) y `Skills` (select 43 opciones, casi idénticas). Confusión potencial. No tocar esta semana.
- **`Estado` en EMPLEADOS** tiene una opción `On` además de `ON - Disponible` — un empleado mal clasificado. Limpieza menor.
- **`Persona Autorizada` en PARTES_TRABAJO** es `relation` (no `multi_select`). Implica que **un parte solo tiene un firmante a la vez**, lo cual encaja con el plan, pero confirma que el modelo de "varios firmantes posibles por obra" se gestiona en OBRAS (`Firmantes Autorizados`), no en el parte.

### (f) Cambios pendientes en Notion (manual, por el usuario)

> **No hacer ninguno desde código.** Aplicar en la UI de Notion con el usuario admin.

1. **OBRAS — añadir propiedad `Firmantes Autorizados`:**
   - Tipo: `Relation`.
   - Destino: BD `Persona Autorizada` (`20882593a25781b4a3b9e0ff5589ea4e`).
   - Modo: `Sincronizada (dual property)` — recomendado para poder navegar y filtrar inversamente desde JEFE_OBRAS.
   - Sin limitar el número de relaciones.

2. **JEFE_OBRAS — añadir propiedad `Rol`:**
   - Tipo: `Select`.
   - Opciones (exactas, en este orden): `Jefe de Obra`, `Jefe de Producción`, `Encargado`, `Otros`.

3. **JEFE_OBRAS — limpieza previa:**
   - Revisar las 7 entradas existentes con Efrén.
   - Identificar cuáles son personas reales de Copuno y cuáles son testing/legacy.
   - Para testing/legacy: **NO borrar** si tienen partes asociados (los 23 firmados referencian aquí); archivar la página o dejar marcada como `Rol = Otros`.
   - Para reales: asignar `Rol` correcto.
   - Añadir las personas internas Copuno que faltan (Andrés Ríos, Adrián De los Reyes, Jesús Meléndez, Pedro Garcia, Oscar Roman, Francisco de Asis, Luis Julian Plata — los nombres aparecen ya en el select `Encargado COPUNO` de OBRAS, lo cual ayuda).

4. **OBRAS — poblar `Firmantes Autorizados` en las 55 obras activas.**
   - Decisión a tomar con Efrén: ¿se hace a mano (≈ 30–60 min) o programando una pasada one-off con el script de migración?
   - Mínimo: cada obra activa debe tener al menos 1 firmante (típicamente el `Encargado COPUNO` actual + posibles jefes de obra/producción asignados).

5. **EMPLEADOS — completar `ID COPUNO` (acción Copuno):**
   - Carga automática 2026-05-28: 306 IDs inyectados. Cobertura actual: 50%.
   - Pendientes: 657 empleados en `docs/revision_ids_empleados.csv` (61 con sugerencia fuzzy, 595 sin candidato).
   - **Acción:** Enviar CSV a Efrén para revisión. Al recibirlo, volcado ≤1 h.

6. **OBRAS — corregir tipo de `Contacto Administración - Teléfono`** (es `email`, debería ser `phone_number` o `rich_text`). No urgente.

---

## Stoppers operativos

Bloqueos externos al código que impiden completar el ciclo de despliegue normal.

#### S1 — Sin acceso a Vercel por email notionvan@copuno.com no operativo

- **Estado:** ✅ Resuelto — Vercel autodespliega correctamente desde master (verificado en producción desde v1.1.0).

#### S2 — Sin acceso a OneDrive (Make bloqueado)

- **Estado:** 🔴 Bloqueante activo
- **Detectado:** 2026-05-29
- **Qué:** Se ha perdido el acceso a la cuenta OneDrive donde Make almacena los PDFs generados (`PARTES FINALES`) y la plantilla Word (`INFRA/Plantilla Parte.docx`). Make no puede descargar la plantilla ni subir los PDFs firmados.
- **Impacto:** El flujo de generación de PDF (PARTES3-4) y el de firma (PARTES4-4) están **bloqueados en producción**. Los partes pueden crearse y editarse con normalidad, pero no se puede generar el PDF ni firmar.
- **Dependencia:** Copuno debe restaurar el acceso a la cuenta OneDrive vinculada a Make (Efrén / administrador O365 Copuno).
- **Acción cuando se resuelva:** verificar en Make que las conexiones de OneDrive en PARTES3-4 y PARTES4-4 siguen activas (no han expirado) y lanzar un parte de prueba completo (crear → enviar datos → verificar PDF → firmar).
- **Nota:** Este bloqueo también impide ejecutar el protocolo N6 (marca "RECTIFICATIVO" en PDF) hasta que se restaure el acceso.

---

## Etapas implementadas (pendientes de merge)

### Etapa 1 — Deuda técnica (2026-05-26)

- **Rama:** `etapa1/deuda-tecnica-c3-h2-i3`
- **PR:** [#2](https://github.com/NotionVan/Copuno_Gestion_Partes/pull/2) — abierto, sin mergear (bloqueado por S1)
- **Commit:** `1b4893c`
- **Veredicto regression-checker:** ÁMBAR (H2 e I3 seguros; C3 requiere verificación manual en preview)

Hallazgos abordados:

- **C3** — N+1 al leer empleados de una obra. Reemplazado `GET /pages/:obraId` + bucle N × `GET /pages/:empleadoId` por una sola `POST /databases/EMPLEADOS/query` con `filter: { property: "Obras", relation: { contains: obraId } }`. Validado contra API Notion real (`@notion-integration-inspector`). De 1+N (hasta 26) peticiones secuenciales a exactamente 1.
- **H2** — Logging estructurado JSON con `req.id` en POST y PUT de `/api/partes-trabajo`. Quick win del plan, no resuelve el problema de atomicidad pero permite correlación en logs Vercel.
- **I3** — `RATE_LIMIT_MAX` default 100 → 1000 req/15 min (NAT compartido de oficina de obra). Configurable via env.

Criterios PENDIENTE_PREVIEW (verificación manual al desbloquear S1):

- [ ] Comparar lista de empleados por obra en app vs Notion para ≥2 obras activas
- [ ] Editar parte en estado `firmado` → confirmar bloqueo 409
- [ ] Crear parte + enviar datos → verificar `URL PDF` en Notion

---

### Etapa 2 — Funcionalidades mínimo viable F4 + F5 + F6 (2026-05-26)

- **Rama:** `etapa2/funcionalidades-minimo-viable-f4-f5-f6` (basada en `etapa1/...`, NO en master)
- **PR:** no creado todavía — se creará tras rebase sobre master post-merge de Etapa 1
- **Commit:** `8659f62` (+524 / −167 líneas en 3 archivos)
- **Veredicto regression-checker:** ÁMBAR (flujos 1 y 2 verdes; flujo 3 con degradaciones visuales aceptables)

Prerrequisitos Notion verificados con `@notion-integration-inspector` (API directa, no MCP):

- ✅ `Rol` (select 4 opciones: Encargado, Jefe de Obra, Jefe de Producción, Otros) en JEFE_OBRAS
- ✅ `Persona Autorizada` (relation dual_property → JEFE_OBRAS) en OBRAS — *NOTA: se borró por error durante la sesión y fue restaurada manualmente por el usuario.*
- ⚠️ El título de EMPLEADOS **ya no se llama `Nombre Completo`** (renombrado en Notion a cadena vacía, detectado 2026-08-17 → incidente I9, cerrado). Desde v1.9.3 el código lee el título **por tipo** (`titleDe()`) y no depende del nombre. `ID COPUNO` sigue siendo `number`.
- ⚠️ 0/50 obras tienen firmantes poblados — pendiente acción usuario con Efrén

Funcionalidades:

- **F4 — Selector dinámico de Persona Autorizada por obra.** Nuevo endpoint `GET /api/obras/:id/firmantes-autorizados` (lee `OBRAS.Persona Autorizada` → JEFE_OBRAS, devuelve `{id, nombre, email, rol}` con fallback `rol: 'Otros'`). Frontend con `optgroups` por rol + checkbox "Buscar en toda la base". Edge: obra sin firmantes muestra mensaje guía; firmante guardado fuera de lista filtrada se muestra con sufijo "(no asignado a esta obra)". Aplicado en creación y edición.
- **F5 — Toggle asignación previa vs búsqueda libre de empleados.** Nuevo endpoint `GET /api/empleados/buscar?q=&limite=` (server-side, `filter: { property: 'Nombre Completo', title: { contains: q } }`, mín 3 chars, máx 50). Frontend con debounce 300 ms, sin carga masiva. Edge case: empleados ya añadidos al parte sobreviven al cambio de toggle (caché local `empleadosAñadidosDetalle`). Confirmación al cambiar de obra si hay datos previos. Originalmente solo en CrearParte; **extendido a la edición de partes en v1.4.0/v1.4.1** (ver más abajo, "v1.4.0/v1.4.1 — Añadir empleado por ID/nombre en edición").
- **F6 — Vista empleados con ID Copuno + nombre + categoría.** Campo `idCopuno: page.properties['ID COPUNO']?.number ?? null` añadido a 3 endpoints existentes. Frontend formato `{ID} · {nombre}` con `—` si null, aplicado en 4 zonas (selector candidatos, bloque añadidos, listas asignados/disponibles edición, vista detalles del parte).

Riesgos documentados (regression-checker):

1. **`datos.empleados` aún no cargado al ver detalles** → muestra `—` en ID en lugar del valor real. Degradación visual, no crash. Aceptable en producción (carga rápida).
2. **N+1 leve** en `/api/obras/:id/firmantes-autorizados` (`GET /pages/:obraId` + N × `GET /pages/:firmanteId`). Tolerable: pocos firmantes por obra. Si crece, considerar refactor análogo a C3.
3. **0 firmantes poblados** en obras → todas las obras disparan mensaje guía hasta que el usuario asigne firmantes en Notion. Caso edge ya manejado.

Criterios PENDIENTE_PREVIEW (verificación manual al desbloquear S1):

- [ ] Crear parte → seleccionar obra con firmantes → ver agrupación por rol → guardar correctamente en Notion
- [ ] Cambiar obra con datos previos → confirmar prompt aparece y respeta cancelar/aceptar
- [ ] Editar parte en estado `firmado` → PUT 409 + UI lo comunica
- [ ] Vista detalles parte → empleados con `ID COPUNO` muestran número, otros muestran `—`
- [ ] Búsqueda libre `Garc` (3+ chars) → resultados en <1 s, máx 20
- [ ] Poblar 1-2 obras con firmantes en Notion → verificar agrupación real por rol

---

### Etapa 3 — Funcionalidades extendidas F1 + F2 + F3 (2026-05-26)

- **Rama:** `etapa3/funcionalidades-extendidas-f1-f2-f3` (basada en `etapa2/...`, NO en master)
- **PR:** no creado todavía — se creará tras rebase sobre master post-merge de Etapas 1 y 2
- **Commits:** `aec81c5` (implementación) + `38cf339` (blindaje `Array.isArray`)
- **Veredicto regression-checker:** ÁMBAR (flujos 1 y 2 verdes; flujo 3 ámbar inicial cerrado con commit `38cf339`)

Prerrequisitos Notion verificados con `@notion-integration-inspector` (API directa, no MCP):

- ✅ `ID COPUNO` en EMPLEADOS: tipo `number`, filtro `number.equals` operativo
- ⚠️ **Duplicados confirmados en producción:** IDs `5848` (2 empleados), `5760` (2), `5917` (2). Endpoint maneja el caso devolviendo todos los matches; frontend muestra aviso para que el usuario elija. Limpieza de datos por parte del cliente (Efrén) recomendada pero no bloqueante.
- ✅ DETALLES_HORA: **no tiene restricción UNIQUE** (Notion no las soporta). Propiedades: `Empleados` (relation), `Fecha` (formula), `Partes de trabajo` (relation), `Cantidad Horas` (number), `ID` (unique_id autoincremental, no constraint). F3 sale gratis.

Funcionalidades:

- **F2 — Búsqueda por ID Copuno con fallback a nombre.** Endpoint existente `/api/empleados/buscar` extendido para aceptar `?id=NNNN` además de `?q=texto`. Filtro `property: 'ID COPUNO', number: { equals }`. 400 si id inválido; 404 si no encuentra; warning log estructurado si Notion devuelve >1 match. Frontend: detección automática de texto numérico (`/^\d{3,6}$/`) en el input de búsqueda libre — si numérico, llama primero al ID, fallback a nombre si 404. Aviso UI cuando hay duplicados. Mismo patrón reutilizado en edición de partes desde v1.4.0/v1.4.1.
- **F1 — Asignación de empleados sin asignación previa.** Verificado que el backend POST/PUT no tenía validación que rechace empleados fuera de la relación `OBRAS.Empleados`. Logging H2 (Etapa 1) ampliado: añadidos `empleadosNoAsignadosObra` (count) y `empleadosNoAsignadosIds` (lista) calculados precargando la relación de la obra una vez (+1 petición, no N+1). Blindado con `Array.isArray()` tras feedback de regression-checker. **No toca la relación permanente OBRAS↔EMPLEADOS** — el empleado opera en la obra ese día sin que su asignación cambie.
- **F3 — Mismo empleado en varias obras el mismo día.** Verificación de schema, no cambios de código. La combinación `Empleados+Fecha+Partes de trabajo` se puede repetir en DETALLES_HORA porque Notion no impone constraints únicos. F1+F2 habilitan el caso de uso desde la UI.

Riesgos identificados:

1. **Duplicados de ID Copuno en datos legacy** (3 casos): manejados en código (devuelve todos + aviso UI), pero merece limpieza con el cliente.
2. **Empleados `Estado=Inactivo`** sí aparecen en búsqueda por ID/nombre. Spec no lo prohibe → comportamiento aceptable. Si el cliente quiere filtrarlos, es decisión de producto futura.

Criterios PENDIENTE_PREVIEW (verificación manual al desbloquear S1):

- [ ] Buscar empleado por ID válido existente → muestra empleado correcto
- [ ] Buscar ID duplicado (5848, 5760 o 5917) → aviso UI + lista de 2 empleados
- [ ] Buscar ID inexistente → fallback a búsqueda por nombre
- [ ] Buscar empleado por nombre directamente → comportamiento Etapa 2 inalterado
- [ ] Crear parte con empleado NO asignado a la obra → guarda correctamente, log Vercel muestra `empleadosNoAsignadosObra > 0`
- [ ] Crear parte para mismo empleado en 2 obras distintas el mismo día → ambos partes se crean sin conflicto
- [ ] Editar parte de obra sin empleados asignados → no devuelve 500 (blindaje `Array.isArray`)

---

## Cómo mantener este documento

Cada modificación de este archivo lleva tres pasos obligatorios:

1. **Actualizar el cambio en sí** (cerrar/añadir/reclasificar hallazgo).
2. **Actualizar la fecha "Última edición"** del bloque superior.
3. **Añadir entrada en [Historial de cambios](#historial-de-cambios)** con fecha + qué se hizo.

Reglas por tipo de cambio:

- **Al cerrar un hallazgo:** cambiar estado a ✅ + añadir línea `**Cerrado:** YYYY-MM-DD · commit/PR: <hash>` debajo del estado.
- **Al detectar nueva deuda:** añadir entrada con ID nuevo (H4, C4, I6...), severidad, dónde, qué, costes, recomendación, fecha de detección. Actualizar tabla resumen.
- **Auditoría periódica:** re-lanzar [`@senior-architect-auditor`](../.claude/agents/senior-architect-auditor.md) cuando haya cambios estructurales significativos o cada trimestre. Comparar hallazgos nuevos con esta lista — no duplicar.
- **Si un hallazgo se aplaza repetidamente** (⏭️ dos veces), considerar si en realidad debe descartarse (❌) con justificación, o reclasificarse como proyecto aparte.

---

## Historial de cambios

| Fecha | Quién | Cambio |
|---|---|---|
| 2026-07-30 | Claude Code + Javi Collado | **H1 resuelto técnicamente (rama `feature/auth-supabase`, v1.9.0) — pendiente solo del corte a producción.** Implementado con Supabase Auth (ADR-006) en vez del `X-API-Key` previsto: middleware JWT local (JWKS/ES256, `crypto` de Node — `jose` descartada por ser ESM puro y tumbar el server CJS en Vercel), login + reset autoservicio en la SPA, menú de cuenta, migraciones SQL aplicadas (`perfiles`/`accesos_modulo`/RLS). E2E validado con usuario real en preview. La suite smoke, **que esta rama había roto en silencio (36/37 en 401)**, reparada y ampliada con `auth.test.js` (45/45). Cinturón `AUTH_OBLIGATORIA=true` contra el escenario "variable borrada = API pública sin síntoma". El día del corte (coordinado con Efrén): variables a Production + reapuntar Site URL + merge → H1 pasa a ✅. De propina, C1 parcialmente encarrilado: `req.usuario` queda disponible para el `keyGenerator` por usuario del rate limit. |
| 2026-07-28 | Claude Code + Javi Collado | **Auditoría de los escenarios activos restantes + E5 corregido + E8 mitigado (noche, 3ª tanda).** Corregido un punto ciego del método: los **filtros de módulo** de Make viven en la clave `filter`, fuera de `mapper`/`parameters`; sin leerlos se concluyó erróneamente que el escenario de limpieza borraba los PDF firmados (no: filtra por `.doc`). Con los filtros ya inventariados en los 6 escenarios activos: **E5 reclasificado a Alta y corregido** — PARTES4/4 listaba solo 50 ficheros (`search` vacío) para localizar el parte a firmar, y la carpeta `PARTES FINALES` ya acumula ~61 PDFs de partes firmados porque la limpieza solo borra Word → la firma habría empezado a fallar **en silencio**; `limit` 50→1000 (se descartó rellenar `search`: consulta el índice asíncrono de OneDrive y habría roto los partes recién generados, que son el caso normal). **E8 mitigado**: el escenario de limpieza tenía programación activa (`nextExec` 30-jul 16:27Z) pese a que Javi lo lanza a mano; desactivado por API. **E9** y **E10** registrados (ver EDGE_CASES_MAKE.md). Además: **blueprints ya versionados** en `docs/blueprints-make/` mediante `scripts/export-blueprints-make.py` (sanea secretos, aborta si encuentra un patrón desconocido) — el fix de E5 se revisó como un diff de una línea, que era justo lo que faltaba esta mañana. Borrada la key huérfana `210119`. |
| 2026-07-28 | Claude Code + Javi Collado | **E2E del pipeline validado con partes reales 305/306; E1 intentado y revertido; I8 registrado (noche, 2ª tanda).** Parte 305 (real, sin matrículas/notas) rechazado por el contrato E3 → aprendizaje: `required` en Make = **no-vacío**; `required:false` en Vehiculos/Notas y reintento DLQ OK (fix del lado webhook → el gotcha de copias congeladas no aplica a validación de entrega). Parte de prueba 306 (obra TEST, matrícula + notas multilínea) validó el camino feliz completo. **E1 revertido**: los `parameters` de las keys de Make no se pueden establecer por API (200 + descarte silencioso); el 306 se recuperó reenviando su bundle DLQ al webhook. Pendiente E1 vía UI (key `210119`) + re-PATCH del blueprint preparado. **I8** nuevo: recarga del listado post-envío falla en silencio y reactiva el botón. Obra de pruebas renombrada a "Obra TEST - Pruebas NotionVan". |
| 2026-07-28 | Claude Code + Javi Collado | **M9 registrado + E2/E3 aplicados en producción + M6 cerrado (noche).** Auditoría preventiva de edge cases sobre los blueprints vivos de eu2 (acceso API nuevo con token `MAKE_TOKEN` en `.env` — org cliente `4157465`, team `2014883`): 7 hallazgos en [EDGE_CASES_MAKE.md](EDGE_CASES_MAKE.md). Aplicados el mismo día: **E2** (`ifempty` en los 9 numéricos del mod 37 de PARTES2/4 — el espejo del M2 de junio, que solo blindó 1/4 — vía PATCH API con verificación byte a byte) y **E3** (data structures `608077`/`608078` con todos los campos `required`, asociadas a los hooks de 2/4 y 3/4 — cierra la **clase** de fallo de M8: los campos perdidos ahora fallan en la puerta en vez de resolver vacío). **M6 cerrado**: los 5 blueprints re-descargados desde producción vía API; doctrina corregida en CLAUDE.md — la referencia canónica es producción, el repo es una foto y **no debe versionarse** (los blueprints contienen el token Notion de E1 en claro; el `.gitignore` era deliberado). Contrato completo de webhooks en [E3_CONTRATO_WEBHOOKS.md](E3_CONTRATO_WEBHOOKS.md), con payloads canónicos y formato verificado de `Detalle del parte`. Pendiente: E2E con el primer parte tras el cambio. |
| 2026-05-11 | `@senior-architect-auditor` | Auditoría inicial — registrados 3 bloqueantes (H1-H3), 3 críticos (C1-C3), 5 importantes (I1-I5), 6 informativos. |
| 2026-05-26 | `@senior-architect-auditor` | Auditoría de plan semanal (arranque 1 jun con Andrés Ríos). Añadidos N1-N5. Reclasificadas prioridades de C3, H2 (quick win) e I3. Verificaciones Notion (1.331 empleados, 27% con ID COPUNO; 55 obras activas; JEFE_OBRAS con 7 entradas mayormente de prueba; estados PARTES confirmados). |
| 2026-05-26 | Javi Collado | Registrado stopper S1 (acceso Vercel bloqueado). |
| 2026-05-26 | Claude Code | Etapa 1 implementada en rama `etapa1/deuda-tecnica-c3-h2-i3` (commit `1b4893c`, PR [#2](https://github.com/NotionVan/Copuno_Gestion_Partes/pull/2)). C3 + H2 quick win + I3. Regression-checker ÁMBAR. Merge bloqueado por S1. |
| 2026-05-26 | Claude Code | Etapa 2 implementada en rama `etapa2/funcionalidades-minimo-viable-f4-f5-f6` (commit `8659f62`). F4 + F5 + F6 con edge cases. Sin PR hasta que merge de Etapa 1 desbloquee rebase sobre master. Regression-checker ÁMBAR. |
| 2026-05-26 | Claude Code | Etapa 3 implementada en rama `etapa3/funcionalidades-extendidas-f1-f2-f3` (commits `aec81c5` + `38cf339`). F2 búsqueda por ID Copuno + manejo de duplicados (5848, 5760, 5917). F1 empleados libres con logging enriquecido. F3 verificado (Notion sin constraints UNIQUE). Sin PR hasta merge de Etapa 2. Regression-checker ÁMBAR cerrado con blindaje Array.isArray. |
| 2026-05-27 | Claude Code | **Fase A consolidación arquitectónica.** Creados [docs/ARQUITECTURA.md](./ARQUITECTURA.md) + [ADR-001](./adr/ADR-001-notion-como-bbdd.md), [ADR-002](./adr/ADR-002-capa-abstraccion-datos.md), [ADR-003](./adr/ADR-003-supabase-destino-migracion.md). Introducida capa `src-server/services/{notion,data}.js` (ADR-002) — 6 endpoints piloto refactorizados (obras, jefes-obra, firmantes-autorizados, empleados, empleados/buscar, empleados/estado-opciones, obras/:id/empleados). Implementada **idempotencia** en `POST enviar-datos` ([src-server/lib/idempotency.js](../src-server/lib/idempotency.js)) — defensa frente a doble-click sin tocar frontend. Añadidos 9 **tests smoke** con supertest + `node:test` (`npm run test:smoke`, todos verdes). **C3 cerrado** (verificación + documentación), **H2 mitigado parcialmente**. |
| 2026-07-14 | Claude Code | **I6 CERRADO (noche).** 3 blueprints importados en Make (variable Vehiculos en pipeline 1→2→3 + docx-templater), scheduling revertido a instant (el import lo cambió a 15 min). Prueba E2E: PDF de parte con `7072KLC` muestra "Vehículos: 7072KLC" bajo Total Horas; caso borde sin matrícula OK. Blueprints reexportados al repo. |
| 2026-07-14 | Claude Code | **v1.5.1–v1.6.1 (tarde).** Propiedad renombrada `Vehiculos` sin tilde (editor Make trunca no-ASCII). v1.6.0: autocompletado de matrículas desde BD Vehículos (`fa4028b2…`, GET /api/vehiculos/buscar). v1.6.1: matrículas en consulta de partes + filtro normalizado. Plantilla Word hecha; I6 actualizado (solo faltan 3 imports Make). Todo desplegado y verificado en producción. |
| 2026-07-14 | Claude Code | **v1.5.0 campo Vehículos en el parte** (proyecto aparte, petición Efrén 3-jul). Propiedad `Vehículos` (rich_text) creada en BD Partes vía API. Código: notion.js (mapParte/detalles/crear/actualizar/rectificar), server.js (POST/PUT), mockData.js, App.jsx (creación/edición/detalle). 33/33 smoke verdes + verificación mock E2E. Registrado I6 (dependencia manual Make/plantilla PDF). |
| 2026-05-27 | Claude Code | **Fase B migración completa ADR-002.** Migrados los 11 endpoints restantes a `data.*`: `empleados/actualizarEstado`, todos los de `partesTrabajo` (listar, estado, empleados, detalles, crear, actualizar, actualizarEstado, obtenerPagina), `datos-completos` (reemplazado self-HTTP por llamadas directas). Dead code eliminado de `server.js` (`makeNotionRequest`, `DATABASES`, `getNotionHeaders`, `validateNotionResponse`, `buildEstadoUpdatePayload`, `extractPropertyValue` local). `server.js`: 1.453 → **830 líneas**. Creado [ADR-004](./adr/ADR-004-idempotencia-enviar-datos.md). Docs actualizadas: [API_REFERENCIA.md](./API_REFERENCIA.md), [ARQUITECTURA.md](./ARQUITECTURA.md), CLAUDE.md, DEUDA_TECNICA.md. 9/9 smoke tests verdes. |
| 2026-05-27 | Claude Code | **Quick wins N5 + I5.** N5: eliminado `'enviado'` de `PARTE_NO_EDITABLES` en `notion.js` — alineado con schema real Notion (`['firmado', 'datos enviados']`). I5: reemplazado `window.location.reload()` post-edición parte ([src/App.jsx](../src/App.jsx)) por `onRefrescarPartes()` — recarga solo la lista de partes sin recargar la página completa ni perder estado UI. |
| 2026-05-27 | Claude Code | **Smoke tests ampliados de 9 a 29.** Cobertura completa de todos los endpoints: catálogos (empleados, estado-opciones, datos-completos), obras/:id/empleados + firmantes-autorizados, búsqueda ?q= (hit/vacío/q<3), PUT empleados estado (ok+404), GET partes (listado, estado, detalles, empleados, 404s), PUT partes (ok, horas>24, bloqueo), enviar-datos con Idempotency-Key explícita + 404. 29/29 verdes. |
| 2026-05-27 | Claude Code | **Cierre de hallazgos verificados.** C2 cerrado: lock optimista pre-webhook con estado `Procesando` — flujo `PATCH Procesando → webhook Make → PATCH Datos Enviados`. C1 descartado: plantilla Make filtra output. N2 verificado cerrado: logging `parte_creado`/`detalles_actualizados` ya presente con `reqId`. I1 cerrado: `datos-completos` ya usa `data.*` directamente (Fase B). I2 aplazado: documentado como comportamiento aceptable sin ROI de arreglar. |
| 2026-05-28 | Claude Code | **Deploy v1.1.0 a producción.** Merge de Etapas 1+2+3 + Fase A+B en `master`. Bump versión 1.0.2 → 1.1.0. Fixes post-QA: crash `ReferenceError: Cannot access 'K' before initialization` (inicialización circular `candidatosVisibles`/`empleadosFiltrados` en `CrearParte`), `ReferenceError: estadoStreamRef is not defined` (referencia fuera de scope en cleanup del componente padre), versión expuesta en `GET /api/health` y footer leído de `package.json` vía `__APP_VERSION__`. QA 16 checks: 12 ✅, 4 ⚠️ (funcionales, sin bloqueo operativo), 0 ❌. Mejora UX: categoría del empleado visible inline junto al nombre en formulario de creación. |
| 2026-05-28 | Claude Code | **Feature partes rectificativos.** Nuevo endpoint `POST /api/partes-trabajo/:id/rectificar`: crea parte nuevo (Borrador) a partir de uno `Firmado`, copia cabecera + `Detalle Horas`, enlaza vía relación reflexiva `Rectifica a`. Backend (`notion.js` `rectificar` + `mapParte` con `rectificaAId`/`rectificadoPorIds`/`esRectificativo`; `data.js`; `server.js`), mock (`rectificarParte`) y UI (botón "Rectificar" en partes firmados + badges Rectificativo/Rectificado + auto-apertura en edición). 3 smoke tests nuevos (32/32 verdes). Registrado riesgo **N6** (dependencias manuales Notion/Make + riesgo fichero PARTES4-4). |
| 2026-05-28 | Javi Collado | **N6 — Dependencias Notion cerradas.** Creadas en BD `Partes de trabajo`: relación reflexiva dual `Rectifica a` / `Rectificado por` + fórmula `Es Rectificativo`. Botón "Rectificar" operativo en producción. Pendiente: marcado PDF en Make. |
| 2026-05-28 | Claude Code | **v1.2.2 — edge cases rectificativos + estados ampliados.** (1) Guard duplicados: `409` si el original ya tiene `Rectificado por ` poblado — protege contra doble click/dos pestañas. Smoke test dedicado (33/33). (2) No duplicar prefijo "PARTE RECTIFICATIVO" en notas en cadena. (3) `PARTE_RECTIFICABLES = ['firmado','datos enviados']`. QA Chrome: botón ausente en partes ya rectificados ✅; flujo desde `Datos Enviados` ✅; prefijo en cadena pendiente de verificar en producción. Changelog `CHANGELOG_V1.2.2.md`. |
| 2026-05-28 | Claude Code | **v1.2.1 — rectificativos en producción + banner.** Fix nombres de propiedad Notion con espacio final (`Rectifica a `/`Rectificado por `) que causaban 500 (commit `4cea407`). Modal de confirmación propio en vez de `window.confirm` + apertura del rectificativo en edición sin esperar al cache (`dd15afe`). Prefijo `PARTE RECTIFICATIVO` en notas del rectificativo (`9dc581d`). Banner de actualización: intervalo 5 min → 1 min, `__APP_VERSION__` expuesta en `window`, emoji eliminado. Verificado en producción con `@regression-checker` + QA Chrome. Changelogs `CHANGELOG_V1.2.0.md` (rectificativos + banner) y `CHANGELOG_V1.2.1.md`. |
| 2026-05-29 | Javi Collado | **I7 registrado — quick wins rendimiento aplazados.** Cache en firmantes-autorizados + subir TTL catálogos de 30 s a 5 min. ~20 min de trabajo, aplazado por prioridad. |
| 2026-05-29 | Claude Code | **v1.3.2 — fix obras en desplegable.** `/api/obras` devolvía solo las primeras 100 obras (BD tiene >100). Obras nuevas como "Getares - Pruebas NotionVan" quedaban fuera del desplegable. Solución: filtro `Estado=Activa` → 56 obras activas, caben en una página, desplegable limpio. |
| 2026-05-29 | Javi Collado | **I6 registrado — tests unitarios notion.js aplazados.** Valorado el coste/beneficio de añadir Vitest + tests unitarios para `extractPropertyValue`, `sanitizeEconomic` y mappers. Decisión: aplazar hasta cerrar H1 y H2 — mayor ROI en auth e integridad de datos primero. |
| 2026-05-29 | Claude Code | **v1.3.1 — fix residual SSE.** `cerrarDetalles()` referenciaba `estadoStreamRef` (eliminado en v1.3.0) → `ReferenceError` en consola al abrir modal de detalles. Sustituida por `estadoPollRef` + `clearInterval`. QA Chrome: modal limpio 8+ s, sin errores. |
| 2026-05-29 | Claude Code | **v1.3.0 — H3 + I3 + N4 cerrados.** H3: eliminado endpoint SSE `/api/partes-trabajo/:id/estado/stream`; sustituido por polling client-side puro en `App.jsx` con Smart Polling adaptativo (3s/8s/15s), eliminando el problema de invocaciones serverless continuas y los huecos de reconexión. I3: `RATE_LIMIT_MAX=1000` confirmado en código (default). N4: cache 30 s en `/api/empleados/buscar` para búsquedas por ID y por nombre. 33/33 smoke. Bump 1.2.2 → 1.3.0. |
| 2026-05-28 | Claude Code | **Carga masiva ID COPUNO (N3).** Cruce de `docs/ID.xlsx` (867 entradas) con BD Empleados (1.330 registros) vía normalización + rotación de tokens + Jaccard. **306 IDs inyectados en Notion** (3 rondas: exacto ×2, rotación ×272, tokens ×32). Cobertura sube del 27% → **50,6%**. Generado `docs/revision_ids_empleados.csv` con los 657 pendientes: Grupo A (61 sugerencias fuzzy ≥50%) + Grupo B (595 huérfanos sin candidato). N3 pasa a estado 🔧 (migración parcial). |
| 2026-06-20 | Claude Code + Javi Collado | **M2 cerrado — body módulo 249 blindado.** Parte rectificativo 249 (Getares) quedó en IEQ con 400 "Bad control character" por `\n` literal en Notas. Fix: `replace(Notas; "\n"; " ")` + `ifempty(...; 0)` en 9 campos numéricos. Bundle resuelto desde IEQ. S2 (OneDrive) confirmado resuelto por Copuno. |
| 2026-06-20 | Claude Code + Javi Collado | **M4 cerrado + v1.3.3 — fix raíz `\n` en servidor + referencia al parte original.** La mitigación M2 (`replace` en Make) no era fiable (el editor de Make no sustituía el 0x0A real; 400 reincidente en parte 249 posición 378). Fix raíz movido al servidor: `notion.js`/`mockData.js` colapsan `[\n\r\t]` a espacio antes de escribir Notas. Nuevo requisito de negocio: todo rectificativo referencia al original → `PARTE RECTIFICATIVO DEL PARTE #<ID> — <notas>`. Parte 249 desbloqueado (Notas saneadas + IEQ vaciada, 14 bundles) → "Listo para firmar". Pendiente no bloqueante: refresco UI tras `replayed:true` + verificar `URL PDF` del 249. |
| 2026-06-18 | Claude Code + Javi Collado | **M3 cerrado — webhook PARTES4/4 eliminado.** Webhook `cgh4ss6k73d5...` devolvía 410 Gone → página de firma rota (CORS + "Failed to fetch"). Creado nuevo webhook en Make (`qx6gv2yuia61...`), actualizado HTML de firma en WordPress. Código versionado en `docs/firma-parte.html`. |
| 2026-06-18 | Claude Code + Javi Collado | **M1 cerrado — bug paginación Make PARTES1/4.** Módulos 9 y 15 del escenario "PARTES 1/4" convertidos de `POST .../query` (sin paginar, límite 100) a `GET /v1/pages/{id}` directo. BD de Obras tenía 133 registros → obras en posición >100 nunca llegaban al iterador → módulo 249 nunca se ejecutaba → escenario 2 sin datos → sin PDF ni firma. Verificado en producción con dos obras (Las Palmas pos.130, Lentiscos): 200 OK en módulo 249, escenario 2 recibe datos. Operaciones: 137 → 12 por ejecución. **M2 registrado** como deuda baja: body módulo 249 con campos numéricos sin fallback (no falla con partes reales, pero frágil). Blueprint del repo pendiente de actualizar con los cambios de producción. |
| 2026-07-28 | Claude Code + Javi Collado | **M5 cerrado — reincidencia del 400 `Bad control character` en PARTES1/4 (org cliente `eu2`/`2014883`, escenario `5595847`).** 5 ejecuciones incompletas el 27/07/2026 (23:48–23:56), 3 reintentos agotados y `ExecutionInterruptedError` acumulando cola; partes 269, 272, 276 y otros dos, obra Lentiscos. Causa: JSON escrito a mano en el módulo HTTP con `{{replace(39.Notas; "\n"; " ")}}` — patrón que **no captura el 0x0A real** (mismo fallo que M2 y M4, tercera reincidencia). Fix: `escapeJSON()` en los 5 campos de texto libre (Obra, Cliente, Jefe de obra, Vehiculos, Notas); los saltos de línea ahora se conservan escapados en vez de perderse. **Hallazgo de causa:** el fix raíz de M4 solo cubría la ruta `rectificar` — `crear`/`actualizar` escriben `notas` crudas (`sanearTextoPlano` se aplica a `vehiculos`, no a `notas`) → por eso reincidió con partes ordinarios. Abiertos dos hallazgos derivados: **M6** (blueprint PARTES1/4 del repo aún contiene el `replace` roto → reimportarlo reintroduciría el bug) y **M7** (decidir si el saneado en servidor sigue teniendo sentido tras `escapeJSON`, o si conviene dejar de mutilar los saltos de línea del usuario). **Alcance ampliado (28/07 tarde):** el fallo afectaba también a **PARTES2/4** (id `5595873`, módulo #37 "Envío a automatización 3"), el otro escenario de la cadena que escribe JSON a mano; PARTES3/4 (`5682485`) y PARTES4/4 (`5682572`) quedan fuera porque usan mapeo nativo. `escapeJSON()` aplicado en ambos. **Excepción registrada:** `"Detalle del parte": [{{2.text}}]` de PARTES2/4 **no** se escapa — es estructura JSON del Text aggregator y escaparla rompería el body. Corregido también un dato: el parte **293 es de la obra Las Palmas**, no Lentiscos. **M8 🟠 detectado y cerrado el mismo día:** al tocar PARTES2/4 se vio que `Vehiculos del parte` figuraba como variable desconocida en el webhook #8 y resolvía vacío → el PDF salía sin matrículas, justo la funcionalidad de v1.6.0/v1.7.0 que I6 dio por verificada el 14/07. Redeterminada la estructura del webhook #8 y remapeado el campo; confirmado funcionando. **Aprendizaje:** un cambio de payload aguas arriba deja el webhook receptor con la estructura vieja y el campo nuevo resuelve vacío **en silencio** (sin error ni ejecución incompleta); tras tocar el payload de cualquier tramo hay que redeterminar el webhook receptor y validar E2E. **Confirmado el 28/07 11:10:** los reintentos desde la cola **no aplican el arreglo** — cada ejecución incompleta guarda copia del blueprint vigente al fallar; el reintento de `ffe9fc8569d94b1d9cc9d8ab1b99acb4` volvió a dar el mismo error, y Make no ofrece "reintentar con la versión actual". **Recuperación completada el 28/07:** los 5 partes (269, 272, 276, 278 de Lentiscos y 293 de Las Palmas) fueron relanzados desde Notion y funcionan correctamente; queda validada la vía de recuperación frente al reintento desde cola. |
| 2026-07-01 | Claude Code | **v1.4.0/v1.4.1 — Añadir empleado por ID/nombre en edición de partes.** Extiende F2/F5 (Etapa 2/3, antes solo en `CrearParte`) a la edición (`ConsultaPartes`): campo de búsqueda con debounce 300 ms que detecta ID Copuno (3-6 dígitos, `buscarEmpleadoPorId`) o nombre (`buscarEmpleados`), muestra sugerencias con botón "Añadir" y reutiliza `toggleEmpleado()` sin tocar el payload de `guardarCambios()`. Caché local `empleadosAñadidosDetalleEdicion` resuelve nombre/categoría aunque el empleado no esté en los primeros 100 de `datos.empleados`. Sin cambios en server.js/notion.js/Make. Regression-checker: 🟡 GO con cautela — señala que, igual que en creación, no hay validación que impida añadir por ID a un empleado de otra obra (no es regresión nueva, es paridad con el comportamiento ya existente en `CrearParte`); pendiente decidir con Efrén si debe bloquearse. Solicitado fuera de scope del retainer según `scope-guardian` (`.claude/scope-rules.md` ya lo tenía presupuestado en 18h/1.800€); implementado igualmente a petición explícita de Javi Collado. Bump 1.3.3 → 1.4.0 → 1.4.1. Changelogs: [CHANGELOG_V1.4.0.md](../CHANGELOG_V1.4.0.md), [CHANGELOG_V1.4.1.md](../CHANGELOG_V1.4.1.md). |

---

## Hallazgos Make (escenarios)

#### M1 — Paginación Make PARTES1/4: módulos 9 y 15 sin paginar

- **Estado:** ✅ Cerrado 2026-06-18
- **Detectado:** 2026-06-18
- **Dónde:** Escenario Make "PARTES 1/4 – Recojo cabecera del parte", módulos **9** (query BD Obras) y **15** (query BD Persona Autorizada/Jefes de obra).
- **Qué:** Ambos módulos hacían `POST /databases/{id}/query` con body `{}` (sin filtro ni paginación). Notion limita a 100 resultados por página. La BD de Obras tenía 133 registros → obras en posición >100 (como "Las Palmas", posición 130) nunca aparecían en el iterador → el filtro del módulo 33 las rechazaba → el flujo no llegaba al módulo 249 ("Envía Datos a automat. 2") → el escenario 2 no recibía el parte → no se generaba PDF ni se activaba la firma. El mismo defecto existía en el bloque de jefes de obra (módulo 15), latente porque solo hay 7 jefes.
- **Solución aplicada:** módulos 9 y 15 convertidos de `POST .../query` a **`GET /v1/pages/{{ID Obra}}`** y **`GET /v1/pages/{{ID Persona Autorizada}}`** respectivamente (page-ids ya disponibles en el módulo 39). Iteradores 31 y 25 actualizados para iterar directamente sobre la página devuelta. Filtros de igualdad de los módulos 33 y 26 eliminados (ya no son necesarios). Aplicado en producción (escenario ID 5595847).
- **Verificación:** dos partes procesados en producción con obras en posición >100 (Las Palmas pos.130, Lentiscos): módulo 249 devuelve `200 Accepted`, escenario 2 recibe datos. Operaciones por ejecución: 137 → **12**.
- **Riesgo latente resuelto:** el bloque de jefes (módulo 15) tenía el mismo defecto pero no fallaba porque hay solo 7 jefes. La solución lo cierra de raíz para ambos bloques.
- **Blueprint en repo:** pendiente de actualizar [docs/Escenarios Make/PARTES1-4 - Recojo cabecera del parte.blueprint.json](Escenarios%20Make/PARTES1-4%20-%20Recojo%20cabecera%20del%20parte.blueprint.json) — el escenario en producción difiere del blueprint versionado.

#### M3 — Webhook PARTES4/4 eliminado → página de firma rota

- **Estado:** ✅ Cerrado 2026-06-18
- **Detectado:** 2026-06-18
- **Dónde:** Página de firma pública `copuno.com/es/notion/` (HTML externo, fuera del repo de la webapp) + escenario Make **PARTES4/4 - Recojo Firma**.
- **Qué:** El webhook `cgh4ss6k73d5hh6rp7uond9h6pkxipxq` referenciado en la constante `MAKE_WEBHOOK_URL` del HTML de firma había sido eliminado de Make (devolvía **410 Gone**). Al pulsar "Enviar Firma", el navegador recibía CORS error + 410 y mostraba "Error de red: Failed to fetch". El jefe de obra no podía firmar ningún parte.
- **Solución:** (1) Creado nuevo webhook en Make para PARTES4/4 → URL `https://hook.eu2.make.com/qx6gv2yuia61k1o7o7c895imcqyvrmob`. (2) Actualizada la constante `MAKE_WEBHOOK_URL` en el HTML de la página de firma en WordPress. (3) Código fuente versionado en [docs/firma-parte.html](firma-parte.html) para referencia futura.
- **Lección:** el HTML de firma vive en WordPress (fuera del repo) y referencia una URL de webhook Make hardcodeada. Si el webhook se regenera en Make (por borrado accidental o recreación del escenario), hay que actualizar también este HTML. Considerar documentar este punto en el onboarding técnico.

#### M2 — Body módulo 249 frágil: campos numéricos sin comillas ni fallback

- **Estado:** ✅ Cerrado 2026-06-20
- **Detectado:** 2026-06-18
- **Severidad:** 🔵
- **Dónde:** Escenario Make "PARTES 1/4", módulo **249** ("Envía Datos a automat. 2"), body JSON.
- **Qué:** Dos problemas en el body JSON del módulo 249: (1) campos numéricos sin comillas ni fallback → JSON inválido si llegaban vacíos; (2) campo `Notas del parte` con salto de línea literal (`\n` no escapado) → `400 Bad control character in string literal` al procesar un parte rectificativo cuyas notas tenían texto multilínea (`"PARTE RECTIFICATIVO\nPruebas "`).
- **Cómo se manifestó:** parte 249 ("Rectif.Parte Getares") quedó atascado en `Datos Enviados` sin generar PDF. El módulo 249 devolvía 400 y el bundle iba a la IEQ.
- **Solución aplicada (2026-06-20):** (1) 9 campos numéricos envueltos con `{{ifempty(39.\`campo\`; 0)}}`. (2) Notas cambiado a `{{replace(39.Notas; "\n"; " ")}}`. Bundle del parte 249 resuelto manualmente desde la IEQ.
- **Nota:** la mitigación del `\n` quedó en el lado Make (`replace`), pero **resultó no fiable** — el `replace(...; "\n"; ...)` del editor de Make no atrapaba el salto de línea real (0x0A) de forma consistente y el 400 reaparecía en la misma posición. El fix definitivo se movió al servidor → ver **M4**.

---

#### M4 — `\n` en Notas de rectificativos rompe el JSON de Make → fix raíz en servidor

- **Estado:** ✅ Cerrado 2026-06-20 (v1.3.3)
- **Detectado:** 2026-06-20
- **Severidad:** 🟠
- **Dónde:** [src-server/services/notion.js](../src-server/services/notion.js) (función `rectificar`) + [mock/mockData.js](../mock/mockData.js). Origen del dato que aguas abajo rompía el módulo 249 de Make (ver [M2](#m2--body-módulo-249-frágil-campos-numéricos-sin-comillas-ni-fallback)).
- **Qué:** El endpoint `/rectificar` construía las Notas del rectificativo con un salto de línea literal: `` `PARTE RECTIFICATIVO\n${notasOriginal}` ``. Ese `\n` (0x0A) llegaba a Notion y, al serializar Make el parte como JSON en el módulo 249, producía `400 Bad control character in string literal in JSON at position N`. El parte rectificativo quedaba atascado en `Datos Enviados` sin generar PDF. La mitigación M2 (`replace` en Make) no era fiable: el `replace(...; "\n"; " ")` del editor de Make interpreta `"\n"` como los dos caracteres `\`+`n`, no como el byte de control real → no lo sustituía y el 400 reaparecía (parte 249, posición 378 reincidente).
- **Causa raíz:** introducir un carácter de control en el origen (Notion) y depender de Make para sanearlo. Mal sitio para el fix.
- **Solución aplicada (2026-06-20):**
  1. **Fix raíz en el servidor:** el prefijo del rectificativo pasa a una sola línea y cualquier carácter de control (`\n`, `\r`, `\t`) en las notas se colapsa a espacio antes de escribir en Notion (`.replace(/[\n\r\t]+/g, ' ')`). Así el JSON de Make nunca recibe un carácter de control, sin depender de la plantilla Make.
  2. **Requisito de negocio:** todo rectificativo referencia ahora explícitamente al parte original en sus Notas → prefijo `PARTE RECTIFICATIVO DEL PARTE #<ID original> — <notas originales>` (ID leído de `original.properties['ID'].unique_id.number`). En cadena (rectificativo de rectificativo) se descarta el prefijo previo para no encadenarlos, dejando como referencia el ID del parte rectificado actual.
  3. Paridad aplicada en `mock/mockData.js`.
- **Desbloqueo del parte 249:** Notas saneadas vía API Notion (`\n` → ` `), estado reseteado a Borrador, IEQ de PARTES1/4 vaciada (14 bundles con JSON pre-computado roto eliminados — un "Resolve" reintenta el bundle guardado, no re-evalúa la plantilla). Reenvío desde la app → parte avanzó a "Listo para firmar".
- **Pendiente (no bloqueante):** (a) el frontend no refresca el estado tras una respuesta `replayed: true` del store de idempotencia → muestra estado obsoleto (Borrador) aunque Notion ya avanzó; registrado como observación, fix aparte. (b) verificar que PARTES3/4 grabó `URL PDF` en Notion para el 249 (estaba vacío en la última lectura).
- **Reincidió:** ver [M5](#m5--reincidencia-del-400-bad-control-character-en-partes14-notas-multilínea-de-partes-normales) (2026-07-28). El fix de M4 solo cubría la ruta `rectificar`; las Notas de partes normales seguían llegando crudas a Notion.

---

#### M5 — Reincidencia del 400 `Bad control character` en PARTES1/4: Notas multilínea de partes normales

- **Estado:** ✅ Cerrado 2026-07-28
- **Detectado:** 2026-07-28 (mañana, al revisar la cola de incompletas de la noche anterior)
- **Severidad:** 🟠
- **Dónde:** Make, **org del cliente** (`eu2.make.com`, org `2014883`). Afecta a **los dos escenarios de la cadena que construyen el body JSON a mano**:
  - **PARTES1/4 – Recojo cabecera del parte** (id `5595847`) → módulo **#249** *"Envía Datos a automat. 2"* (HTTP legacy, POST a `hook.eu2.make.com/nsk6ov…`)
  - **PARTES2/4 – Recupero detalles parte** (id `5595873`) → módulo **#37** *"Envío a automatización 3"*

  **NO afectados:** PARTES3/4 (id `5682485`) y PARTES4/4 (id `5682572`) — usan mapeo nativo de campos (Drive / PDF / Notion), no JSON escrito a mano.
  > Nota de entorno: los escenarios duplicados en la org personal *Javi & Tamara* (`eu1.make.com`, org `581441`; PARTES1/4 = id `3218313`) son **backup**, no producción. El fix se aplicó sobre la org del cliente.
- **Síntoma:** 5 ejecuciones incompletas el 27/07/2026 entre 23:48 y 23:56, todas con los 3 reintentos agotados y el mismo error en el módulo HTTP:
  - `Error: 400 Bad Request`
  - `Bad control character in string literal in JSON at position N` (líneas **16 | 19 | 20 | 21**, columna 23 — la línea varía según el escenario y el campo que rompe)
  - `Code: DataError`

  Agotados los reintentos, el manejador *Flow Control → Retry* devolvía `ExecutionInterruptedError` ("Not allowed to create another incomplete execution unless the issue is solved"), por lo que las ejecuciones se acumulaban en la cola de incompletas. Partes implicados: **269**, **272**, **276** y **278** (obra Lentiscos) y **293** (obra **Las Palmas**) — todos del cliente COPUNO. Tabla completa en el *Pendiente* de abajo.
- **Causa raíz:** el cuerpo de la petición se construye como **JSON escrito a mano** (Body type: Raw, Content-type: `application/json`). El campo `"Notas del parte"` (línea 16) se alimenta de `39.Notas`, texto libre procedente de Notion que contiene saltos de línea reales (`\n` / `\r`). Un carácter de control sin escapar dentro de una cadena invalida el JSON y el webhook receptor responde 400.

  El saneado que había previsto, `replace(39.Notas; "\n"; " ")`, **no funcionaba**: en Make ese `"\n"` se interpreta como el texto literal barra-invertida + `n`, no como el byte 0x0A, así que el `replace` nunca encontraba nada que sustituir. Es exactamente el mismo fallo ya diagnosticado en [M2](#m2--body-módulo-249-frágil-campos-numéricos-sin-fallback) y [M4](#m4--n-en-notas-de-rectificativos-rompe-el-json-de-make--fix-raíz-en-servidor). Por eso solo fallaban los partes con notas de varias líneas; los de nota en una sola línea pasaban sin problema.
- **Por qué reincidió pese a M4:** el fix raíz de M4 (2026-06-20) sanea las Notas **únicamente en la ruta `rectificar`** ([notion.js](../src-server/services/notion.js) función `rectificar`) y en `mock/mockData.js`. Las rutas de **creación** ([notion.js](../src-server/services/notion.js) `crear`) y **edición** (`actualizar`) escriben `notas` **tal cual llegan del cliente**: en [server.js](../server.js) el helper `sanearTextoPlano` se aplica a `vehiculos`, **no a `notas`**. Conclusión: M4 tapó el caso rectificativo y dejó abierto el caso general — que es el que ha estallado ahora con partes ordinarios de Lentiscos.
- **Solución aplicada (2026-07-28):** se sustituye el saneado manual por la función nativa `escapeJSON()`, que escapa comillas, barras invertidas y caracteres de control conforme a JSON, aplicada a **todos** los campos de texto libre del cuerpo:

  | Campo | Antes | Después |
  |---|---|---|
  | `Obra` | `{{32.Obra}}` | `{{escapeJSON(32.Obra)}}` |
  | `Cliente` | `{{39.Cliente}}` | `{{escapeJSON(39.Cliente)}}` |
  | `Jefe de obra` | `{{26.Este es el Jefe de obra}}` | `{{escapeJSON(26.Este es el Jefe de obra)}}` |
  | `Vehiculos del parte` | `{{39.Vehiculos}}` | `{{escapeJSON(39.Vehiculos)}}` |
  | `Notas del parte` | `{{replace(39.Notas; "\n"; " ")}}` | `{{escapeJSON(39.Notas)}}` |

  **Qué NO se escapa (importante):**
  - Campos **numéricos** → mantienen `ifempty(…; 0)`.
  - `Fecha Parte` e `ID Pag Notion Parte` → formato controlado, no es texto libre.
  - `"Detalle del parte": [{{2.text}}]` en PARTES2/4 → **es estructura JSON generada por el Text aggregator, no una cadena**. Envolverlo en `escapeJSON()` escaparía los corchetes y comillas del propio array y **rompería el body**.

  **Mejora colateral:** las notas conservan ahora sus saltos de línea, correctamente escapados como `\n` dentro del JSON, en lugar de perderse — a diferencia del saneado de M4, que los colapsaba a espacio.
- **Regla para el futuro:** todo valor de **texto libre** que se inserte en un JSON escrito a mano en Make debe ir envuelto en `escapeJSON()`. Alternativa preferible en módulos nuevos: construir el cuerpo con el módulo **JSON → Create JSON** (con Data structure), que escapa automáticamente. **No usar `replace(texto; "\n"; " ")` como saneado** — no captura saltos de línea reales (tercera vez que este patrón falla: M2, M4, M5).
- **⚠️ Los reintentos desde la cola NO aplican el arreglo (confirmado empíricamente):** cada ejecución incompleta de Make guarda **una copia congelada del blueprint vigente en el momento del fallo**. Reintentarla desde la cola reejecuta esa copia, con el mapeo antiguo `replace(39.Notas; "\n"; " ")` — no la plantilla corregida. Verificado el **28/07/2026 11:10** reintentando la ejecución `ffe9fc8569d94b1d9cc9d8ab1b99acb4`: falló con el mismo error. **Make no ofrece ninguna opción de "reintentar con la versión actual" en la UI**, y además **cada intento consume una operación** del plan. Es el mismo comportamiento ya observado en M4 con la IEQ (14 bundles con JSON pre-computado roto), ahora confirmado también para la cola de incompletas.
- **✅ Recuperación completada (2026-07-28):** los **5 partes fueron relanzados desde Notion y funcionan correctamente**. Se confirma así la vía de recuperación: borrar/resolver las entradas de la cola de incompletas y **volver a disparar el webhook desde Notion**, de modo que la ejecución nazca de cero con el blueprint corregido (reintentar desde la cola nunca habría funcionado — ver punto anterior).

  | Parte | Fecha | Obra | ID página Notion |
  |---|---|---|---|
  | 269 | 11-06-2026 | Lentiscos | `39282593-a257-8102-8522-ec82f2105ed5` |
  | 272 | 16-06-2026 | Lentiscos | `39282593-a257-81ef-8dcd-c16e603d3c7b` |
  | 276 | 22-06-2026 | Lentiscos | `39282593-a257-8153-a571-ea062e40587e` |
  | 278 | 24-06-2026 | Lentiscos | `39282593-a257-810d-ae03-ddeb2e603889` |
  | 293 | 07-07-2026 | **Las Palmas** | `39e82593-a257-813a-a5eb-f2b223ca2ab0` |

---

#### M8 — `Vehiculos del parte` llega vacío en PARTES2/4: estructura de datos del webhook #8 sin redeterminar

- **Estado:** ✅ Cerrado 2026-07-28
- **Detectado:** 2026-07-28 (al aplicar el fix de [M5](#m5--reincidencia-del-400-bad-control-character-en-partes14-notas-multilínea-de-partes-normales) sobre PARTES2/4)
- **Severidad:** 🟠
- **Dónde:** Make, org del cliente, **PARTES2/4 – Recupero detalles parte** (id `5595873`), **webhook #8**.
- **Qué:** el campo `Vehiculos del parte` aparece en el mapeo como **variable desconocida** y **resuelve vacío**. La estructura de datos del webhook no se ha redeterminado tras los cambios de payload, así que Make no reconoce el campo que le llega.
- **Impacto:** las matrículas viajan por la cadena pero **se pierden en el tramo 2/4**. Aguas abajo, PARTES3/4 monta el PDF con el dato vacío → **el parte se genera sin vehículos**. Es justo la funcionalidad que se entregó en v1.6.0/v1.7.0 (relación `Vehiculos ` + espejo de texto) y que I6 dio por verificada el 14/07 con una prueba E2E en la que *"el PDF muestra la matrícula"*. Conviene comprobar si esto es una regresión posterior o si afecta solo a ciertos partes.
- **Solución (2026-07-28):** redeterminada la estructura de datos del webhook #8 y remapeado `Vehiculos del parte`. **Confirmado funcionando por Javi Collado** el mismo día. Ventana de exposición corta: detectado y resuelto en la misma jornada, en el marco del fix de M5.
- **Aprendizaje:** un cambio de payload aguas arriba deja el webhook receptor con la estructura antigua y el campo nuevo resuelve **vacío en silencio** — sin error, sin ejecución incompleta, sin log. Es un fallo mudo: sólo se ve mirando el PDF final. Tras tocar el payload de cualquier escenario de la cadena, **redeterminar la estructura del webhook receptor y validar E2E** antes de dar el cambio por bueno. La prueba E2E de I6 (14/07) pasó, así que esto se introdujo después: los cambios de payload posteriores no revalidaron el tramo 2/4.

---

#### M6 — Blueprint PARTES1/4 del repo desactualizado respecto a producción

- **Estado:** ✅ Cerrado 2026-07-28 — los 5 blueprints (PARTES1/4–4/4 + Envío al cliente) re-descargados desde producción (`eu2`, org `4157465`) vía `GET /scenarios/{id}/blueprint` con el token de API del `.env` (`MAKE_TOKEN`). El del repo ya contiene `escapeJSON()`. **Cambio de doctrina asociado (CLAUDE.md):** la referencia canónica pasa a ser **producción**, no el repo — los blueprints locales son una foto, están en `.gitignore` a propósito (contienen el token Notion de E1 en claro y las URLs de webhook) y hay que re-descargarlos antes de cualquier auditoría.
- **Detectado:** 2026-07-28 (durante la documentación de [M5](#m5--reincidencia-del-400-bad-control-character-en-partes14-notas-multilínea-de-partes-normales))
- **Severidad:** 🟡
- **Coste estimado:** 0,5 h
- **Dónde:** [docs/Escenarios Make/PARTES1-4 - Recojo cabecera del parte.blueprint.json](Escenarios%20Make/PARTES1-4%20-%20Recojo%20cabecera%20del%20parte.blueprint.json)
- **Qué:** el blueprint versionado en el repo **todavía contiene `{{replace(39.Notas; …)}}`**, el saneado roto que causó M5. No refleja el `escapeJSON()` aplicado en producción. El `CLAUDE.md` declara que estos blueprints son "la referencia canónica del lado Make" y que "el escenario activo en producción debe coincidir con estos archivos" — hoy no coinciden.
- **Riesgo:** si alguien reimporta el blueprint del repo para restaurar o clonar el escenario, **reintroduce el bug de M5**. Es un rastrillo esperando a que lo pisen.
- **Recomendación:** reexportar PARTES1/4 desde la org del cliente (`eu2`, org `2014883`) y sustituir el archivo. Aprovechar para verificar si M1 (paginación, cerrado 2026-06-18) sí está reflejado, ya que aquel cierre dejó anotado "blueprint del repo pendiente de actualizar" — indicio de que el drift viene de antes.

---

#### M7 — El saneado de Notas en servidor solo cubre la ruta `rectificar`

- **Estado:** ❌ Abierto (decisión pendiente)
- **Detectado:** 2026-07-28 (análisis de causa de [M5](#m5--reincidencia-del-400-bad-control-character-en-partes14-notas-multilínea-de-partes-normales))
- **Severidad:** 🔵
- **Coste estimado:** 0,5–1 h
- **Dónde:** [server.js](../server.js) (`sanearTextoPlano`, aplicado a `vehiculos` en las líneas de `crear` y `actualizar`) + [src-server/services/notion.js](../src-server/services/notion.js) (`crear` / `actualizar` escriben `'Notas': notas || ''`).
- **Qué:** asimetría de saneado. `vehiculos` pasa por `sanearTextoPlano`; `notas` no. Solo la ruta `rectificar` limpia caracteres de control.
- **Decisión a tomar:** con `escapeJSON()` ya en Make (M5), **el saneado en servidor deja de ser necesario** para evitar el 400 — y de hecho es *peor*, porque destruye los saltos de línea que el usuario escribió a propósito. Dos caminos:
  1. **Recomendado — no tocar nada y dejarlo documentado:** Make ya escapa correctamente; el servidor no debe mutilar el texto del usuario. Se cierra M7 como "no aplica".
  2. **Defensa en profundidad:** aplicar saneado también en crear/editar, aceptando la pérdida de saltos de línea, por si algún otro consumidor construye JSON a mano.

  Nota: si se elige (1), conviene además **revisar el colapso `[\n\r\t] → ' '` que M4 dejó en `rectificar`**, que hoy sigue destruyendo saltos de línea sin necesidad.
- **Recomendación:** opción (1). Registrar y cerrar en la próxima revisión.

---

#### Bug corregido — Obras no aparecían en desplegable (>100 obras en BD)

- **Estado:** ✅ Cerrado 2026-05-29 (v1.3.2)
- **Qué:** `/api/obras` hacía `query` sin filtro con `page_size: 100`. La BD tiene >100 obras, Notion devuelve las primeras 100 por orden de creación. Obras nuevas (p.ej. "Getares - Pruebas NotionVan") quedaban fuera del desplegable.
- **Solución:** añadido `filter: { Estado: Activa }` → 56 obras activas, caben en una página, desplegable limpio sin obras finalizadas/paradas.

#### I8 — Tras enviar-datos, la recarga del listado puede fallar en silencio

- **Estado:** ⏳ Pendiente
- **Detectado:** 2026-07-28 (QA en navegador durante el parte de prueba 306)
- **Severidad:** 🟡
- **Coste estimado:** 1–2 h
- **Dónde:** [src/App.jsx](../src/App.jsx) — flujo post `POST /api/partes-trabajo/:id/enviar-datos`.
- **Qué:** el POST devolvió 200 pero el GET de recarga del listado devolvió 500; la app no mostró ningún error, la tarjeta siguió en BORRADOR y el botón "Enviar Datos" se reactivó. El usuario cree que el envío falló (riesgo de doble click; el servidor lo tolera por idempotencia + estados, pero la percepción es de fallo) hasta que pulsa "Refrescar" y aparece el estado real.
- **Fix propuesto:** tras 200 del POST, actualizar el estado local del parte de forma optimista (a `Procesando`/`Datos Enviados`) sin depender de la recarga; y si la recarga falla, toast de error + reintento, nunca fallo silencioso.

#### M9 — Auditoría de edge cases del pipeline Make (E1–E7)

- **Estado:** 🔧 En progreso — E2 y E3 cerrados el mismo día; E1 abierto; E4–E7 a valorar
- **Detectado:** 2026-07-28 (auditoría preventiva a raíz de M5/M8, sobre los blueprints **vivos** de producción)
- **Severidad:** 🟠 (por E1; el resto media/baja)
- **Dónde:** informe completo con severidades, evidencia y fixes en [EDGE_CASES_MAKE.md](EDGE_CASES_MAKE.md); contrato de webhooks en [E3_CONTRATO_WEBHOOKS.md](E3_CONTRATO_WEBHOOKS.md)
- **Qué:** 7 hallazgos estructurales del pipeline PARTES1/4→4/4. Los tres graves: **E1** token de integración Notion (`ntn_…`) hardcodeado en los módulos HTTP 9/15 de PARTES1/4 (viaja en cada export de blueprint — es el motivo real del `.gitignore` de `docs/Escenarios Make/`); **E2** los 9 numéricos del mod 37 de PARTES2/4 sin `ifempty()` (mismo mecanismo que M5, disparado por ausencia en vez de por `\n` — el M2 de junio solo blindó 1/4); **E3** webhooks de 2/4 y 3/4 sin data structure declarada (`udt: null`, estructura aprendida → causa raíz de M8; la interfaz aprendida de 3/4 seguía sin conocer `Cliente`, `Horas Peon` ni `Vehiculos del parte` incluso después del fix de M8). Menores: E4 nombre de fichero OneDrive sin sanear + acoplamiento 3/4↔4/4 por nombre, E5 búsqueda OneDrive `limit:50` sin paginación (ver clon inactivo `9407545`), E6 sincronización por `sleep(5s)` en 2/4, E7 `Importe Total` viaja a Make pese al saneado económico de la app.
- **Aplicado el 2026-07-28:** **E2** vía `PATCH /api/v2/scenarios/5595873` con blueprint editado en JSON (verificado byte a byte re-descargando). **E3**: data structures `608077` (2/4, 16 campos `required`) y `608078` (3/4, +`Detalle del parte`) creadas vía API (`POST /data-structures`) y asociadas a los hooks `2480016`/`2480024` por UI (la asociación no es posible por API: `PATCH /hooks/{id}` ignora `data.udt` en silencio). Desde entonces los webhooks **validan en la puerta**: campo ausente o tipo equivocado = error visible en el emisor, no vacío silencioso.
- **E2E validado el 2026-07-28 (con incidente y recuperación en 15 min):** el primer parte real tras E3 (parte **305**, 16:38, sin matrículas ni notas — legítimo) fue **rechazado en la puerta**: `required` en Make significa **no-vacío**, no "clave presente". DLQ de 1/4 con `Validation failed for 2 parameter(s)` a los 2 s. Fix: `required: false` en `Vehiculos del parte` y `Notas del parte` en ambas estructuras (`PATCH /data-structures` — posible por API) + **reintento desde la DLQ, que SÍ funcionó** (el fix era del webhook receptor, no del blueprint congelado — el gotcha M5 no aplica a validación de entrega). Pipeline completo OK: 2/4 y 3/4 en verde, parte 305 en `Listo para firmar`. Saldo: el fallo fue visible, diagnosticable y reversible en minutos — el comportamiento que E3 compra.
- **Pendiente:** ojo humano al PDF del parte 305 en OneDrive (contenido) cuando se firme.
- **Segunda tanda (28-jul noche) — auditoría de los escenarios activos restantes.** Corrigiendo un punto ciego del método (los **filtros de módulo** de Make viven en la clave `filter`, fuera de `mapper`/`parameters`, y no se estaban leyendo): **E5 subió a Alta y se corrigió** (PARTES4/4 listaba solo 50 ficheros para localizar el parte y la carpeta ya acumula ~61 PDFs de firmados → la firma habría empezado a fallar en silencio; `limit` 50→1000, se descartó el campo `search` porque depende del índice asíncrono de OneDrive y habría roto los partes recientes). Nuevos: **E8** (la limpieza borra el Word de partes aún sin firmar — **mitigado** retirando la programación, que contradecía el uso manual real), **E9** (filtro del DataStore invertido: borra lo reciente, conserva lo viejo) y **E10** (el envío al cliente apunta a la propiedad `Correo electrónico`, inexistente en la BD Clientes — la funcionalidad no está operativa, queda como requisito previo a activarla, con decisión de negocio sobre cuál de los 4 emails usar). **E1**: migrar módulos 9/15 a conexión nativa Notion y **solo después** rotar el token (el orden inverso tumba PARTES1/4). E4–E6: endurecimiento preventivo, pasar por `@scope-guardian`. E7: decidir política.
- **Regla nueva derivada de E3:** para añadir un campo al pipeline, el orden es **actualizar la Data structure del receptor primero**, luego el payload del emisor. Al revés, el emisor recibirá 400 — comportamiento diseñado, no bug.
- **E1 intentado y REVERTIDO el 28-jul (noche):** la vía key de Make (`http:ActionSendDataAPIKeyAuth` + key `210119`) falló porque **los `parameters` de las keys no se pueden establecer por API** (200 + descarte silencioso, igual que `data.udt` de hooks). El parte de prueba 306 quedó bloqueado en 1/4 (`reading 'placement'`); revert por PATCH en minutos y 306 relanzado reenviando su bundle de la DLQ al webhook (pipeline verde, `Listo para firmar`). E1 queda pendiente de: editar la key en la UI → re-aplicar el blueprint E1 preparado → E2E con obra TEST. **Gotcha API Make acumulado:** hooks (`data.udt`), keys (`parameters`) y estructuras↔hooks se configuran **solo desde la UI**; `PATCH /data-structures` (spec) y `PATCH /scenarios` (blueprint) sí funcionan.
- **Consecuencia de E1 RESUELTA sin esperar a E1 (28-jul noche):** los blueprints ya se versionan. `scripts/export-blueprints-make.py` los descarga de producción, **sanea los secretos** (aborta si encuentra un patrón que no sabe sanear) y escribe en `docs/blueprints-make/`, versionada en git; la carpeta cruda `docs/Escenarios Make/` sigue en `.gitignore`. A partir de ahora **hay historial y `git diff` de los cambios hechos en la UI de Make**. Al exportar apareció que el token de E1 está en **5 sitios de 3 escenarios** (PARTES1/4 ×2, clon `9407545` ×2, `Limpio Registros Detalle Horas` `7899695` ×1), no en 2 como se documentó. Borrada también la key huérfana `210119`.
- **E2E completo validado con los partes 305 y 306 (28-jul):** 305 = rechazo visible del contrato (required mal calibrado, corregido); 306 = camino feliz con matrícula y notas multilínea. Obra de pruebas actual: **"Obra TEST - Pruebas NotionVan"** (la antigua "Getares - Pruebas NotionVan" fue renombrada).

### 2026-08-17 — I9 (incidente title de EMPLEADOS) + fase F0-F2 del plan de rendimiento pre-demo

- **I9 🔴 detectado y CERRADO:** el título de la BD EMPLEADOS fue renombrado en Notion (probablemente durante alguna limpieza manual) de `Nombre Completo` a **cadena vacía**. Efecto en producción, verificado en vivo antes del fix: `mapEmpleado` devolvía `nombre: ''` para el 100 % de los empleados y `buscarPorNombre` (filtro por `'Nombre Completo'`) recibía 400 de Notion → 500 al usuario. **Es con toda probabilidad el error de la demo ante Tomeu/Esther (~22-jul)**. Fix en v1.9.3: helper `titleDe(page)` que localiza la propiedad título por tipo + filtro por el ID canónico `'title'` — inmune a futuros renombres. Golden-diff contra Notion real: nombres recuperados, resto de campos idéntico. De propina, `mapParte` leía `'AUX Cliente - texto-'` sin el espacio final real → campo `cliente` siempre vacío; corregido.
- **F0-F2 del plan pre-demo** ([INFORME_UX_RENDIMIENTO_2026-08-17.md](INFORME_UX_RENDIMIENTO_2026-08-17.md)): v1.9.1 Speed Insights + fix doc regions; v1.9.2 invalidación del cache tras las 5 escrituras (**BE-3**, cierra la mitad intermitente de «la app no actualiza»), ErrorBoundary global, fuera esperas artificiales de 2-4 s, `?? 8` (UX-23, con smoke test nuevo — 46 casos), medias horas tecleables, badges de estado; v1.9.3 `filter_properties` en todo el catálogo (**C3 al fin ejecutado**: partes 935→357 KB, empleados 652→171 KB y 2,9→0,7 s) + caches de `estado-opciones` (10 min) y `datos-completos`. Con esto quedan **cumplidas las precondiciones del ADR-007** (medir tras F3 y decidir con datos).
- **Verificación F2:** golden-diff completo contra Notion real (6 endpoints, cero cambios de forma), smoke 46/46, `@regression-checker` 🟡 (mergear con cautela: sin test automatizado posible contra Notion real — el golden-diff queda como chequeo repetible en `scripts/golden-diff-catalogo.sh`).
