# Deuda Técnica — Copuno Webapp

> **Documento de seguimiento interno.** No compartir con el cliente sin filtrar previamente.
> Cada hallazgo lleva severidad, coste estimado, ROI de no arreglar y recomendación (retainer / proyecto aparte / ignorar).

- **Última edición:** 2026-05-11
- **Última auditoría completa:** 2026-05-11 (`@senior-architect-auditor`, alcance: arquitectura general)
- **Próxima revisión sugerida:** tras cerrar bloqueantes, o trimestral.
- **Historial completo:** ver [final del documento](#historial-de-cambios).

---

## Resumen ejecutivo (estado actual)

La arquitectura cumple para el caso de uso actual pero descansa sobre **tres apuestas frágiles**: (1) no hay autenticación en `/api/*`, (2) la creación/edición de un parte hace N+1 escrituras a Notion sin transacción ni reconciliación, (3) en Vercel cada SSE abierto cuenta como serverless function corriendo hasta timeout, lo que rompe Smart Polling tal como está. El monolito de [server.js](../server.js) (~1.400 líneas) está largo pero cohesivo: **no es el problema**. Riesgo real más alto hoy: **H1 (auth) + H3 (SSE)**.

---

## Tabla resumen

Leyenda estado: ⏳ Pendiente · 🔧 En progreso · ✅ Hecho · ⏭️ Aplazado · ❌ Descartado

| ID | Sev | Título | Estado | Coste | Recomendación |
|---|---|---|---|---|---|
| [H1](#h1--ningún-endpoint-api-está-autenticado) | 🔴 | Auth en `/api/*` ausente | ⏳ | 4–8 h | Retainer **prioritario** |
| [H2](#h2--creaciónedición-de-parte-no-es-atómica) | 🔴 | Parte sin atomicidad ni reconciliación | ⏳ | 8–12 h | Retainer |
| [H3](#h3--sse-sobre-vercel-serverless-incompatible) | 🔴 | SSE incompatible con Vercel serverless | ⏳ | 4–6 h | Retainer (próximo sprint) |
| [C1](#c1--webhook-a-make-envía-payload-sin-sanear) | 🟠 | Webhook Make recibe payload sin sanear | ⏳ | 1–2 h | Retainer |
| [C2](#c2--enviar-datos-orden-make--patch-vulnerable) | 🟠 | `enviar-datos`: ventana entre Make y PATCH estado | ⏳ | 3–4 h | Retainer (cuando haya hueco) |
| [C3](#c3--n1-al-leer-empleados-de-una-obra) | 🟠 | N+1 al leer empleados de una obra | ⏳ | 2–3 h | Retainer |
| [I1](#i1--apidatos-completos-hace-http-a-sí-mismo) | 🟡 | `/api/datos-completos` hace HTTP loopback | ⏳ | 1–2 h | Retainer |
| [I2](#i2--cache-en-memoria--serverless--cache-inútil) | 🟡 | Cache en memoria inútil en serverless | ⏳ | 0 h (doc) | Ignorar / documentar |
| [I3](#i3--rate-limit-irrelevante-con-nat-compartido) | 🟡 | Rate limit revienta con NAT compartido | ⏳ | 1 h | Retainer (junto a H1) |
| [I4](#i4--sin-telemetría-útil) | 🟡 | Sin telemetría, logs Vercel se pierden | ⏳ | 3–5 h | Retainer |
| [I5](#i5--reload-de-ventana-tras-editar) | 🟡 | `window.location.reload()` tras editar | ⏳ | 2 h | Retainer (oportunista) |

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

- **Estado:** ⏳ Pendiente
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

- **Estado:** ⏳ Pendiente
- **Detectado:** 2026-05-11
- **Dónde:** [server.js:482-531](../server.js#L482-L531).
- **Qué:** Por cada empleado relacionado: 1 GET a `/pages/:id`. Obra con 30 empleados = 31 requests secuenciales. A 3 req/s de Notion → ~10 s mínimo. Sin `Promise.all`, sin cache individual.
- **Por qué importa:** Parte del "la app va lenta" subjetivo. Multiplica riesgo de 429 con varios usuarios concurrentes.
- **Coste de arreglar:** 2–3 h. Query a `EMPLEADOS` filtrando por relación con la obra, o `Promise.all` con p-limit a 3 concurrencia.
- **Recomendación:** Retainer.

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

- **Estado:** ⏳ Pendiente · **Dónde:** [src/App.jsx:977](../src/App.jsx#L977) · **Coste:** 2 h.
- `window.location.reload()` tras editar parte. Pierde estado UI, reabre todas las queries. Reemplazar por refresh del listado + cerrar modal.

---

### 🔵 Informativos

- **[server.js](../server.js) ~1.400 líneas — largo pero cohesivo.** No urge partirlo. Si se hace, partir por dominio (obras, empleados, partes, detalles, webhook), no por capa.
- **[src/App.jsx](../src/App.jsx) ~2.470 líneas — sí es un olor.** Formularios + listado + modal + polling + edición en uno. Refactor por componentes (`EdicionParte`, `DetallesParteModal`, `ListadoPartes`) es **proyecto aparte**, no entra en 20h/mes.
- **`extractPropertyValue` duplicada** en [server.js:167](../server.js#L167) y [src/services/notionService.js:69](../src/services/notionService.js#L69) con divergencias menores. Aceptable al tamaño actual.
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
