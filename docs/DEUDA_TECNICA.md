# Deuda Técnica — Copuno Webapp

> **Documento de seguimiento interno.** No compartir con el cliente sin filtrar previamente.
> Cada hallazgo lleva severidad, coste estimado, ROI de no arreglar y recomendación (retainer / proyecto aparte / ignorar).

- **Última edición:** 2026-05-27 (Fase B + quick wins N5+I5 + smoke tests ampliados a 29/29)
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
| [H1](#h1--ningún-endpoint-api-está-autenticado) | 🔴 | Auth en `/api/*` ausente | ⏳ | 4–8 h | Retainer **prioritario** |
| [H2](#h2--creaciónedición-de-parte-no-es-atómica) | 🔴 | Parte sin atomicidad ni reconciliación | 🔧 (mitigado parcial) | 8–12 h | Retainer |
| [H3](#h3--sse-sobre-vercel-serverless-incompatible) | 🔴 | SSE incompatible con Vercel serverless | ⏳ | 4–6 h | Retainer (próximo sprint) |
| [C1](#c1--webhook-a-make-envía-payload-sin-sanear) | 🟠 | Webhook Make recibe payload sin sanear | ⏳ | 1–2 h | Retainer |
| [C2](#c2--enviar-datos-orden-make--patch-vulnerable) | 🟠 | `enviar-datos`: ventana entre Make y PATCH estado | ⏳ | 3–4 h | Retainer (cuando haya hueco) |
| [C3](#c3--n1-al-leer-empleados-de-una-obra) | 🟠 | N+1 al leer empleados de una obra | ✅ | — | Cerrado 2026-05-27 |
| [I1](#i1--apidatos-completos-hace-http-a-sí-mismo) | 🟡 | `/api/datos-completos` hace HTTP loopback | ⏳ | 1–2 h | Retainer |
| [I2](#i2--cache-en-memoria--serverless--cache-inútil) | 🟡 | Cache en memoria inútil en serverless | ⏳ | 0 h (doc) | Ignorar / documentar |
| [I3](#i3--rate-limit-irrelevante-con-nat-compartido) | 🟡 | Rate limit revienta con NAT compartido | ⏳ | 1 h | Retainer (junto a H1) |
| [I4](#i4--sin-telemetría-útil) | 🟡 | Sin telemetría, logs Vercel se pierden | ⏳ | 3–5 h | Retainer |
| [I5](#i5--reload-de-ventana-tras-editar) | 🟡 | `window.location.reload()` tras editar | ✅ | — | Cerrado 2026-05-27 |

| [N1](#n1--persona-autorizada-mezcla-modelo-cliente-y-modelo-interno) | 🟠 | Persona Autorizada — coexistencia legacy/interno | ⏳ | 3–5 h | Retainer (esta semana) |
| [N2](#n2--asignación-libre-amplía-superficie-de-h2) | 🟠 | Asignación libre agrava H2 (creación no atómica) | ⏳ | 1–2 h (quick win) | Retainer (esta semana) |
| [N3](#n3--búsqueda-por-id-copuno-con-cobertura-incompleta) | 🟠 | ID COPUNO solo cubre el 27% de empleados | ⏳ | — | Decisión de producto |
| [N4](#n4--multiplicador-de-carga-notion-en-flujo-id-cross-obra) | 🟡 | Flujo "ID en varias obras" multiplica lecturas Notion | ⏳ | 2–4 h | Retainer (junto a C3) |
| [N5](#n5--estados-hardcoded-divergentes-del-schema-real) | 🔵 | Lista `noEditables` hardcoded incluye `'enviado'` inexistente | ✅ | — | Cerrado 2026-05-27 |

Informativos en sección [aparte](#informativos).

**Total estimado bloqueantes + críticos:** 22–35 h. No cabe en un retainer mensual de 20 h. Priorizar H1 + H3 + C3 este mes (10–17 h) y mover H2 al siguiente.

---

## Hallazgos detallados

### 🔴 Bloqueantes

#### H1 — Ningún endpoint `/api/*` está autenticado

- **Estado:** ⏳ Pendiente
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

- **Estado:** ⏳ Pendiente
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

- **Estado:** ⏳ Pendiente
- **Detectado:** 2026-05-11
- **Dónde:** [server.js:1030-1049](../server.js#L1030-L1049).
- **Qué:** `sanitizeEconomic` solo se aplica a `res.json` ([server.js:141-149](../server.js#L141-L149)). El `axios.post` al webhook envía el objeto Notion completo. Si la BD `Partes de trabajo` tiene propiedades económicas, Make las recibe.
- **Coste de arreglar:** 1–2 h. Aplicar `sanitizeEconomic(payload)` antes del `axios.post`. Verificar primero qué espera Make.
- **Coste de NO arreglar:** Inconsistencia con la promesa de saneado. Bajo si Make es cerrado/confiable; alto si en algún momento Make manda emails o expone el payload.
- **Recomendación:** Retainer. Validar primero con qué campos trabaja Make.

#### C2 — `enviar-datos`: orden Make → PATCH vulnerable

- **Estado:** ⏳ Pendiente
- **Detectado:** 2026-05-11
- **Dónde:** [server.js:1058-1094](../server.js#L1058-L1094).
- **Qué:** Flujo: (1) POST a Make → (2) PATCH estado a `Datos Enviados`. Si (1) ok y (2) falla, Make ya genera el PDF pero el parte sigue como `borrador`. Ventana vulnerable a reintento accidental → 2 PDFs, 2 entradas OneDrive, datos duplicados.
- **Coste de arreglar:** 3–4 h. Patrón: marcar parte como "Procesando" *antes* del webhook (lock optimista), webhook, marcar `Datos Enviados` después. Requiere añadir estado en Notion.
- **Coste de NO arreglar:** Incidente raro pero embarazoso.
- **Recomendación:** Retainer, no urgente.

#### C3 — N+1 al leer empleados de una obra

- **Estado:** ✅ Cerrado (2026-05-27)
- **Detectado:** 2026-05-11
- **Resuelto en:** [server.js](../server.js) endpoint `GET /api/obras/:obraId/empleados` → ahora delega en [src-server/services/notion.js](../src-server/services/notion.js) `obras.empleadosDeObra()`, que hace **una sola query** filtrada por relación inversa `EMPLEADOS.Obras contains :obraId`.
- **Validación:** test smoke en [src-server/tests/smoke/smoke.test.js](../src-server/tests/smoke/smoke.test.js) cubre el endpoint (modo mock). En live el comportamiento se verifica visualmente desde la app.
- **Nota:** ya estaba implementado en código durante la Etapa 1 (commit anterior), pero seguía marcado como pendiente por descuido documental. El refactor a `data.js` (ADR-002) lo confirma como patrón.

---

### 🟡 Importantes

#### I1 — `/api/datos-completos` hace HTTP a sí mismo

- **Estado:** ⏳ Pendiente · **Dónde:** [server.js:1352-1357](../server.js#L1352-L1357) · **Coste:** 1–2 h.
- `axios.get(\`${req.protocol}://${req.get('host')}/api/...\`)` × 4. En serverless = invocación de otras funciones × 4. Frágil ante cambios de host/protocolo. Refactor: extraer helpers `fetchObras()`, `fetchEmpleados()`, etc.

#### I2 — Cache en memoria + serverless = cache inútil

- **Estado:** ⏳ Pendiente · **Dónde:** [server.js:97-109](../server.js#L97-L109) · **Coste:** 0 h documentar.
- `CACHE_TTL_MS` asume proceso long-lived. En serverless, cada invocación arranca con `cache = new Map()` o reutiliza si lambda caliente — comportamiento impredecible y contradice [docs/SMART_POLLING.md](SMART_POLLING.md). **Recomendación: ignorar / documentar.** No invertir en Vercel KV mientras el caso de uso sea pequeño.

#### I3 — Rate limit irrelevante con NAT compartido

- **Estado:** ⏳ Pendiente · **Dónde:** [server.js:86-95](../server.js#L86-L95) · **Coste:** 1 h.
- Si los jefes están detrás del mismo NAT corporativo, todos comparten IP. 100 req/15min ≈ 6.6 req/min para *todo* el equipo. Smart Polling solo revienta el límite con 2 usuarios. Subir `RATE_LIMIT_MAX` a ~1000 o `keyGenerator` por sesión cuando se cierre [H1](#h1--ningún-endpoint-api-está-autenticado).

#### I4 — Sin telemetría útil

- **Estado:** ⏳ Pendiente · **Dónde:** todo [server.js](../server.js) · **Coste:** 3–5 h.
- Solo `console.*` + morgan. Vercel mantiene logs ~24 h (Hobby) / 3 días (Pro). Para diagnosticar "se perdieron las horas del martes pasado" ya están borrados. `req.id` se genera pero no se propaga al webhook Make ni a respuestas críticas. Integrar Sentry/Axiom/Better Stack (planes gratuitos suficientes).

#### I5 — Reload de ventana tras editar

- **Estado:** ✅ Cerrado 2026-05-27 — reemplazado por `onRefrescarPartes()` que recarga solo la lista de partes vía `getPartesTrabajo()` sin recargar la página completa.

---

### 🔵 Informativos

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

- **Estado:** ⏳ Pendiente · **Detectado:** 2026-05-26 · **Severidad:** 🟠
- **Dónde:** [server.js:580-752](../server.js#L580) (POST), [server.js:1104-1339](../server.js#L1104) (PUT).
- **Qué:** Funcionalidades 1 (asignar empleados sin asignación previa) y 3 (mismo empleado en varias obras vía ID) **aumentan el `N` del bucle N+1 de creación de `DETALLES_HORA`** y la probabilidad de que un mismo empleado aparezca en partes simultáneos del mismo día. H2 ya documenta que el bucle se traga errores y devuelve `200` con `erroresDetalles`. Con el plan, además: ¿qué pasa si dos partes del mismo día en obras distintas referencian al mismo empleado y uno falla? Hoy: nada detecta inconsistencia.
- **Por qué importa:** El cliente lo notará antes (más volumen, más probabilidad). Sin el quick win de logging, debug imposible.
- **Coste de arreglar (quick win, decisión ya tomada):** 1–2 h. Logging estructurado de "empleados pretendidos vs detalles creados OK vs fallidos" con `req.id`, en POST y PUT.
- **Coste de NO arreglar:** Reapertura del antiguo dolor "se han perdido las horas" en pleno arranque con Andrés.
- **Recomendación:** Retainer, esta semana, **antes del 1 jun**.

#### N3 — Búsqueda por ID COPUNO con cobertura incompleta

- **Estado:** ⏳ Pendiente · **Detectado:** 2026-05-26 · **Severidad:** 🟠 (producto, no técnico puro)
- **Dónde:** BD `Empleados`, propiedad `ID COPUNO` (number).
- **Qué (dato real):** De **1.331 empleados, solo 365 (27,4%) tienen `ID COPUNO`** poblado. 966 no lo tienen. De los 693 empleados en estado `ON - Disponible`, no se ha medido el corte exacto pero proporcionalmente la cobertura será similar. Todos los IDs presentes son de **4 dígitos** (rango 0–5982); ninguno de 5 dígitos todavía — la preparación para 5 dígitos es prudente pero no urgente.
- **Por qué importa:** La funcionalidad 2 (buscar por ID) y la 3 (registrar al mismo empleado en varias obras solo con su ID) **fallan o devuelven "no encontrado" para 3 de cada 4 empleados**. Esto es un problema de datos, no de código.
- **Coste de arreglar:** 0 h de código. Esfuerzo de Copuno: poblar IDs en los ~700 empleados activos sin ID. **Bloqueante operativo** que debe negociarse con Efrén antes del 1 jun.
- **Coste de NO arreglar:** funcionalidad 2 y 3 nacen rotas para la mayoría de plantilla. Andrés volverá al flujo viejo.
- **Recomendación:** **Decisión de producto inmediata.** O Copuno se compromete a poblar IDs en empleados activos antes del 1 jun, o las funcionalidades 2 y 3 se retrasan. **Si no hay compromiso por escrito antes del miércoles, no las construyas.**

#### N4 — Multiplicador de carga Notion en flujo "mismo empleado en varias obras"

- **Estado:** ⏳ Pendiente · **Detectado:** 2026-05-26 · **Severidad:** 🟡
- **Dónde:** Nuevo endpoint probable `/api/empleados/buscar?id=` + uso encadenado con `/api/obras/:id/empleados` y POST de parte.
- **Qué:** Flujo típico funcionalidad 3: usuario teclea ID → backend busca empleado (1 query a `EMPLEADOS` con filtro) → si está en otra obra activa hay que validar/mostrar el contexto → cada parte nuevo crea un `DETALLES_HORA`. Con Notion a 3 req/s y N partes en obras distintas para el mismo empleado al mismo día (escenario realista en construcción: peón rotando), el patrón secuencial actual ya saturado por C3 entra en zona de 429.
- **Por qué importa:** Refuerza la urgencia de C3 (`Promise.all` con `p-limit`) y sugiere añadir cache corta (~5 s) para `/api/empleados/buscar?id=` durante una jornada.
- **Coste de arreglar:** 2–4 h adicionales sobre C3 (cache ID→empleado + búsqueda por filtro Notion, no `pages/:id`).
- **Coste de NO arreglar:** 429 esporádicos = UX errática en horario punta (mañanas).
- **Recomendación:** Tratar conjuntamente con C3 esta semana.

#### N5 — Estados hardcoded divergentes del schema real

- **Estado:** ✅ Cerrado 2026-05-27 — eliminado `'enviado'` de `PARTE_NO_EDITABLES` en [src-server/services/notion.js](../src-server/services/notion.js). Array queda `['firmado', 'datos enviados']`, alineado con el schema real de Notion.

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
- 🟡 **CONDICIONAL** — Funcionalidades 2 y 3. **GO solo si** Efrén confirma por escrito antes del 28 may que Copuno poblará `ID COPUNO` en los ~700 empleados activos restantes antes del 1 jun. Si no, **NO-GO** y se replantean como proyecto de datos aparte.
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

- **Con `ID COPUNO`:** 365 (27,4%).
- **Sin `ID COPUNO`:** 966 (72,6%).
- Rango: 0–5982. Todos de 4 dígitos. 0 de 5 dígitos.
- No medido por activo/inactivo, pero el grueso de la plantilla activa está sin ID.

**Implicación crítica para el plan:** ver N3.

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

5. **EMPLEADOS — poblar `ID COPUNO` (acción Copuno):**
   - Necesario en los ~700 empleados activos sin ID si se quiere mantener funcionalidades 2 y 3 del plan.
   - **Es esfuerzo de Copuno, no del retainer.**

6. **OBRAS — corregir tipo de `Contacto Administración - Teléfono`** (es `email`, debería ser `phone_number` o `rich_text`). No urgente.

---

## Stoppers operativos

Bloqueos externos al código que impiden completar el ciclo de despliegue normal.

#### S1 — Sin acceso a Vercel por email notionvan@copuno.com no operativo

- **Estado:** 🔴 Bloqueante activo
- **Detectado:** 2026-05-26
- **Qué:** La cuenta de Vercel está asociada a notionvan@copuno.com (tenant O365 Copuno).
  Email no operativo actualmente, impide acceder al dashboard para reconectar la
  integración GitHub tras el traslado del repo de javintnvn → NotionVan.
- **Impacto:** Webhook GitHub↔Vercel roto. Pushes a master no disparan deploys.
  PRs no generan preview deploys. Etapa 1 implementada pero pendiente de verificar
  en preview hasta resolver.
- **Dependencia:** Copuno debe restaurar acceso a notionvan@copuno.com
  (Efrén / administrador O365 Copuno).
- **Acción cuando se resuelva:** Vercel Dashboard → Settings → Git → Disconnect →
  Connect → NotionVan/Copuno_Gestion_Partes → rama master. Verificar preview deploy
  antes de mergear PR Etapa 1.
- **Nota:** Este mismo email bloquea la configuración de Supabase para auth (H1).
  Resolverlo desbloquea dos stoppers a la vez.

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
- ✅ `Nombre Completo` es `title`, `ID COPUNO` es `number` en EMPLEADOS
- ⚠️ 0/50 obras tienen firmantes poblados — pendiente acción usuario con Efrén

Funcionalidades:

- **F4 — Selector dinámico de Persona Autorizada por obra.** Nuevo endpoint `GET /api/obras/:id/firmantes-autorizados` (lee `OBRAS.Persona Autorizada` → JEFE_OBRAS, devuelve `{id, nombre, email, rol}` con fallback `rol: 'Otros'`). Frontend con `optgroups` por rol + checkbox "Buscar en toda la base". Edge: obra sin firmantes muestra mensaje guía; firmante guardado fuera de lista filtrada se muestra con sufijo "(no asignado a esta obra)". Aplicado en creación y edición.
- **F5 — Toggle asignación previa vs búsqueda libre de empleados.** Nuevo endpoint `GET /api/empleados/buscar?q=&limite=` (server-side, `filter: { property: 'Nombre Completo', title: { contains: q } }`, mín 3 chars, máx 50). Frontend con debounce 300 ms, sin carga masiva. Edge case: empleados ya añadidos al parte sobreviven al cambio de toggle (caché local `empleadosAñadidosDetalle`). Confirmación al cambiar de obra si hay datos previos. Solo en CrearParte.
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

- **F2 — Búsqueda por ID Copuno con fallback a nombre.** Endpoint existente `/api/empleados/buscar` extendido para aceptar `?id=NNNN` además de `?q=texto`. Filtro `property: 'ID COPUNO', number: { equals }`. 400 si id inválido; 404 si no encuentra; warning log estructurado si Notion devuelve >1 match. Frontend: detección automática de texto numérico (`/^\d{3,6}$/`) en el input de búsqueda libre — si numérico, llama primero al ID, fallback a nombre si 404. Aviso UI cuando hay duplicados.
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
| 2026-05-11 | `@senior-architect-auditor` | Auditoría inicial — registrados 3 bloqueantes (H1-H3), 3 críticos (C1-C3), 5 importantes (I1-I5), 6 informativos. |
| 2026-05-26 | `@senior-architect-auditor` | Auditoría de plan semanal (arranque 1 jun con Andrés Ríos). Añadidos N1-N5. Reclasificadas prioridades de C3, H2 (quick win) e I3. Verificaciones Notion (1.331 empleados, 27% con ID COPUNO; 55 obras activas; JEFE_OBRAS con 7 entradas mayormente de prueba; estados PARTES confirmados). |
| 2026-05-26 | Javi Collado | Registrado stopper S1 (acceso Vercel bloqueado). |
| 2026-05-26 | Claude Code | Etapa 1 implementada en rama `etapa1/deuda-tecnica-c3-h2-i3` (commit `1b4893c`, PR [#2](https://github.com/NotionVan/Copuno_Gestion_Partes/pull/2)). C3 + H2 quick win + I3. Regression-checker ÁMBAR. Merge bloqueado por S1. |
| 2026-05-26 | Claude Code | Etapa 2 implementada en rama `etapa2/funcionalidades-minimo-viable-f4-f5-f6` (commit `8659f62`). F4 + F5 + F6 con edge cases. Sin PR hasta que merge de Etapa 1 desbloquee rebase sobre master. Regression-checker ÁMBAR. |
| 2026-05-26 | Claude Code | Etapa 3 implementada en rama `etapa3/funcionalidades-extendidas-f1-f2-f3` (commits `aec81c5` + `38cf339`). F2 búsqueda por ID Copuno + manejo de duplicados (5848, 5760, 5917). F1 empleados libres con logging enriquecido. F3 verificado (Notion sin constraints UNIQUE). Sin PR hasta merge de Etapa 2. Regression-checker ÁMBAR cerrado con blindaje Array.isArray. |
| 2026-05-27 | Claude Code | **Fase A consolidación arquitectónica.** Creados [docs/ARQUITECTURA.md](./ARQUITECTURA.md) + [ADR-001](./adr/ADR-001-notion-como-bbdd.md), [ADR-002](./adr/ADR-002-capa-abstraccion-datos.md), [ADR-003](./adr/ADR-003-supabase-destino-migracion.md). Introducida capa `src-server/services/{notion,data}.js` (ADR-002) — 6 endpoints piloto refactorizados (obras, jefes-obra, firmantes-autorizados, empleados, empleados/buscar, empleados/estado-opciones, obras/:id/empleados). Implementada **idempotencia** en `POST enviar-datos` ([src-server/lib/idempotency.js](../src-server/lib/idempotency.js)) — defensa frente a doble-click sin tocar frontend. Añadidos 9 **tests smoke** con supertest + `node:test` (`npm run test:smoke`, todos verdes). **C3 cerrado** (verificación + documentación), **H2 mitigado parcialmente**. |
| 2026-05-27 | Claude Code | **Fase B migración completa ADR-002.** Migrados los 11 endpoints restantes a `data.*`: `empleados/actualizarEstado`, todos los de `partesTrabajo` (listar, estado, empleados, detalles, crear, actualizar, actualizarEstado, obtenerPagina), `datos-completos` (reemplazado self-HTTP por llamadas directas). Dead code eliminado de `server.js` (`makeNotionRequest`, `DATABASES`, `getNotionHeaders`, `validateNotionResponse`, `buildEstadoUpdatePayload`, `extractPropertyValue` local). `server.js`: 1.453 → **830 líneas**. Creado [ADR-004](./adr/ADR-004-idempotencia-enviar-datos.md). Docs actualizadas: [API_REFERENCIA.md](./API_REFERENCIA.md), [ARQUITECTURA.md](./ARQUITECTURA.md), CLAUDE.md, DEUDA_TECNICA.md. 9/9 smoke tests verdes. |
| 2026-05-27 | Claude Code | **Quick wins N5 + I5.** N5: eliminado `'enviado'` de `PARTE_NO_EDITABLES` en `notion.js` — alineado con schema real Notion (`['firmado', 'datos enviados']`). I5: reemplazado `window.location.reload()` post-edición parte ([src/App.jsx](../src/App.jsx)) por `onRefrescarPartes()` — recarga solo la lista de partes sin recargar la página completa ni perder estado UI. |
| 2026-05-27 | Claude Code | **Smoke tests ampliados de 9 a 29.** Cobertura completa de todos los endpoints: catálogos (empleados, estado-opciones, datos-completos), obras/:id/empleados + firmantes-autorizados, búsqueda ?q= (hit/vacío/q<3), PUT empleados estado (ok+404), GET partes (listado, estado, detalles, empleados, 404s), PUT partes (ok, horas>24, bloqueo), enviar-datos con Idempotency-Key explícita + 404. 29/29 verdes. |
