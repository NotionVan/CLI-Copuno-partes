# Caché sobre la API de Notion — mapa de la industria y diseño para Copuno

**Fecha:** 2026-08-17 · **Método:** 3 investigadores en paralelo (productos comerciales construidos sobre Notion, ecosistema open source, patrones de caché serverless/KV) + un arquitecto que contrastó el dossier con el código del repo y diseñó el siguiente escalón. Tercera pieza de la serie: [INVESTIGACION_NOTION_API_2026-08.md](INVESTIGACION_NOTION_API_2026-08.md) (límites y webhooks) y [APUNTALAMIENTO_NOTION_2026-08.md](APUNTALAMIENTO_NOTION_2026-08.md) (recursos y gobernanza).

**La conclusión en una frase**: ningún producto de la industria sirve producción con *cache en memoria por instancia* — o la capa es compartida (CDN/KV) o es réplica SQL; nuestra arquitectura actual es un «escalón 1,5» sofisticado pero en la capa equivocada, y el siguiente paso (Upstash Redis con esquema version/body, ~0-2 €/mes) está diseñado abajo listo para ejecutarse en octubre.

---


# Cache sobre la API de Notion — mapa de la industria y diseño del escalón 2 (KV compartido) para Copuno

Documento de arquitectura ejecutable. Fecha: 2026-08-17. Objetivo: plan para octubre (20 usuarios, ~50 partes/día, polling 12-30 s, función en `iad1`).

---

## 1. El mapa de la industria

| # | Patrón | Quién lo usa | Cuándo escala / cuándo se rompe | Equivalente en Copuno hoy |
|---|---|---|---|---|
| 1 | **SWR en capa compartida (CDN/edge), revalidación disparada por visita** | Super (umbral 5 s + TTL por plan 24h/4h/10min), Potion (re-check >20 min por página + full sync diario), Notaku fase 1 (HTML cacheado, ~8x), splitbee/notion-api-worker (edge ~10 s) | Escala a millones de vistas de contenido semi-estático. Se rompe con: escrituras del propio usuario que deben verse al instante, y borrados (en SWR puro solo expiran — Potion los relega al full sync diario) | **Parcial y en la capa equivocada**: SWR existe pero en el *cliente* ([src/lib/cacheLocal.js:1-11](src/lib/cacheLocal.js#L1)) y en un Map *por instancia* ([server.js:133](server.js#L133)). No hay capa compartida servidor |
| 2 | **KV compartido entre instancias + invalidación por evento** | Vercel Runtime Cache + expireTag (recomendación oficial 2026), Upstash Redis (estándar de facto post-Vercel KV), Next.js `'use cache'`+`cacheTag`+webhook→`revalidateTag` | Escala hasta que necesitas *consultar* los datos (filtros, agregaciones) y no solo servir la foto. Se rompe si el KV es eventual (Cloudflare KV, 60 s de propagación — descartado para invalidación) | **No existe. Es el hueco exacto de I2** ([docs/DEUDA_TECNICA.md:145-148](docs/DEUDA_TECNICA.md#L145)) |
| 3 | **Réplica en BD propia (SQL) alimentada por webhooks + polling** | Notaku ("los datos no se toman de la API de Notion sino de nuestra SQL"; sync diaria→~1 min al integrar webhooks oficiales), HelpKit (sirve incluso con Notion caído), Whalesync/Unito (espejo con rondas de polling), marc7806/notion-api-cache (MongoDB + cron), notion2pg. El propio Notion: SQLite como caché local (+50%) | Escala a todo; único patrón que trata bien borrados y sobrevive caídas de Notion. Coste: pipeline de sync, resolución de conflictos si es bidireccional (por eso la industria y nuestro ADR-007 recomiendan unidireccional) | **Evaluado y aplazado**: [docs/adr/ADR-007](docs/adr/ADR-007-sincronizacion-notion-supabase.md). Correcto aplazarlo: es el escalón 3, no el 2 |
| 4 | **Publicación estática por lotes** | Bullet (manual/diaria/horaria), SSG de nextjs-notion-starter-kit | Solo contenido; irrelevante para una app transaccional | N/A |
| — | **Subproblema imágenes** (URLs S3 presignadas caducan en 1 h, doc oficial) | Copia a R2/KV con clave = block ID + proxy Cache-Control ~1 año (MacArthur, snugl, Notaku), o re-pedir URL fresca (Potion) | — | No nos afecta hoy: el PDF vive en OneDrive vía Make (`URL PDF`), no servimos ficheros de Notion. Anotar por si algún día se sirve `Documento Firmado` desde la app |

**Hallazgo transversal del dossier ("qué NO hace nadie")**: ningún producto sirve producción con *cache en memoria por instancia + freshness-check por petición*. O la capa es compartida (CDN/KV) o es réplica. Y la señal de invalidación que hace viable el escalón 2 y 3 son los **webhooks oficiales de Notion, ya en GA** (`page.properties_updated`, `page.content_updated` agregado, entrega at-most-once con 8 reintentos, típicamente <1 min, pueden llegar desordenados, payload solo con IDs — el webhook es señal, no dato).

---

## 2. Dónde estamos: escalón 1,5

Nuestra combinación actual es más sofisticada que el escalón 1 crudo, pero vive en la capa equivocada:

- **Map en memoria por instancia** con TTL 30 s ([server.js:132-143](server.js#L132)), invalidación tras las 5 escrituras (BE-3, [server.js:148-168](server.js#L148), llamadas en L577, L795, L836, L864, L918, L974) — pero la invalidación **solo alcanza la instancia que ejecutó la escritura**.
- **Freshness-check** `hayCambiosDesde` (~0,4 s vs ~2,5 s, [src-server/services/notion.js:977-983](src-server/services/notion.js#L977)) con cursor `last_edited_time` de la propia foto ([server.js:512-518](server.js#L512)) y TTL duro de 5 min ([server.js:508](server.js#L508)). El dossier lo **valida como práctica de industria** (chriskirknielsen, Drexel notion-sync). Esto se conserva.
- **SWR en cliente** ([src/lib/cacheLocal.js](src/lib/cacheLocal.js)) + ETag/304 de Express. Se conserva.
- Caches auxiliares: firmantes 60 s ([server.js:267-268](server.js#L267)), estado-opciones 10 min ([server.js:445](server.js#L445)), búsquedas N4.

**Agujeros exactos respecto a la industria:**

1. **Multi-instancia (I2)**: con N lambdas hay N Maps. Una escritura invalida 1 de N; las otras N−1 sirven el listado sin el parte recién creado hasta 30 s (o hasta que su freshness-check lo pille, con la zona ciega de ~60 s del redondeo al minuto de `last_edited_time`, [notion.js:973-975](src-server/services/notion.js#L973)). Es la mitad *residual* de "la app no actualiza" que BE-3 no pudo cerrar. Además cada instancia fría paga su propia query de 2,5 s.
2. **Tres estados críticos en memoria, no solo el cache**: (a) el store de idempotencia de `enviar-datos` ([server.js:92-94, 674-700](server.js#L92)) — con dos instancias, un doble-click repartido entre ambas **burla la idempotencia del ADR-004** y puede disparar el webhook Make dos veces; (b) el rate-limit por usuario ([server.js:120-129](server.js#L120)) usa el MemoryStore de express-rate-limit — cupo real = `RATE_LIMIT_MAX × N` instancias; (c) el semáforo BE-7 ([notion.js:113-119](src-server/services/notion.js#L113)) — concurrencia real hacia Notion = 5×N, señalado en [docs/INVESTIGACION_NOTION_API_2026-08.md §5](docs/INVESTIGACION_NOTION_API_2026-08.md#L70) como el punto donde revienta octubre.
3. **Estampida**: cuando la foto expira o se invalida, cada instancia (y cada usuario poleando) puede lanzar su propia query completa a Notion en paralelo. No hay lock. La industria usa SET NX + TTL corto (dossier serverless/KV, patrón canónico).
4. **Borrados**: sin evento de archivado, un parte archivado en Notion vive hasta `PARTES_TTL_DURO_MS` (documentado en [server.js:505-507](server.js#L505)). La industria solo lo resuelve con `page.deleted` por webhook o full sync — encaja en la fase 2.

---

## 3. Diseño del escalón 2: KV compartido (Upstash Redis)

### 3.1 Proveedor: Upstash Redis en us-east-1, no Vercel Runtime Cache

Los dos finalistas del dossier, decidido por los **tres estados** que hay que compartir, no solo por el cache:

| Criterio | Upstash Redis | Vercel Runtime Cache |
|---|---|---|
| Cache con TTL + invalidación | Sí | Sí (tags + expireTag) |
| **SET NX atómico** (idempotencia ADR-004, lock anti-estampida) | Sí | **No — no tiene primitivas atómicas** |
| **INCR** (rate-limit compartido, vía `rate-limit-redis`) | Sí | No |
| Latencia desde iad1 (= AWS us-east-1) | <1 ms TCP, 5-15 ms REST (`@upstash/redis`) | Similar |
| Coste a nuestra escala | Free tier 500K comandos/mes; PAYG 0,20 $/100K | Reads 0,40 $/1M unidades de **8 KB** — un body de 357 KB ≈ 45 unidades/lectura |

Runtime Cache serviría para la foto pero no para idempotencia ni lock; acabaríamos con dos sistemas. **Un solo proveedor: Upstash Redis vía Vercel Marketplace, BD creada en us-east-1** (quien habla con Redis es la función en iad1, no el navegador — regla del dossier). SDK: `@upstash/redis` (REST; en serverless es el habitual, sin gestión de conexiones TCP).

**Números a nuestra escala.** 20 usuarios × ~3 polls/min × 8 h × 22 días ≈ **634K polls/mes**. El diseño de abajo hace que el camino caliente cueste **1 comando pequeño por poll** (GET de la clave `version`, ~150 bytes), no el body de 357 KB: ~650-900K comandos/mes, ancho de banda despreciable. Coste: **0-2 €/mes** (ligeramente por encima del free tier; PAYG ≈ 1,5 $/mes). Si se transfiriera el body en cada poll serían ~220 GB/mes — por eso el esquema version/body es obligatorio, no una optimización.

### 3.2 Esquema de claves

Prefijo `cp:v1:` (versionable; un bump de esquema invalida todo, mismo truco que `cacheLocal.js` con `__APP_VERSION__`).

| Clave | Contenido | TTL físico | Notas |
|---|---|---|---|
| `cp:v1:partes:ver` | `{ cursorIso, hash, ts }` (~150 B) | 5 min (`PARTES_TTL_DURO_MS`) | Lo que lee CADA poll. `hash` = sha1 del body; `cursorIso` = `cursorDeFoto()` actual ([server.js:512](server.js#L512)) |
| `cp:v1:partes:body` | Foto JSON (gzip → ~50-80 KB) | 5 min | Solo se lee cuando `ver.hash` ≠ hash del L1 local |
| `cp:v1:dc:ver` / `cp:v1:dc:body` | Ídem para `datos-completos` ([server.js:1020-1031](server.js#L1020)) | fresh 30 s / duro 5 min | Mismo par version/body |
| `cp:v1:cat:firmantes:<obraId>` | Firmantes por obra | 60 s (`FIRMANTES_TTL_MS`) | Valor pequeño, sin par ver/body |
| `cp:v1:cat:estado-opciones` | Opciones de estado | 10 min (`ESTADO_OPCIONES_TTL_MS`) | Ídem |
| `cp:v1:cat:buscar-q:<q>` · `buscar-id:<id>` · `emp-obra:<id>` | Búsquedas N4 / empleados por obra | 30 s | Prefijos → `SCAN`+`DEL` o mejor: no migrarlas (ver 3.6) |
| `cp:v1:idem:enviar:<idemKey>` | `{ estado: 'in-flight'\|'complete', statusCode, body }` | 10 min | Sustituye a `enviarDatosIdempotency` ([server.js:94](server.js#L94)). Adquisición con `SET NX` |
| `cp:v1:lock:partes` · `cp:v1:lock:dc` | `1` | 10 s | Lock anti-estampida, `SET NX EX 10` |
| `cp:v1:rl:<usuarioId>` | Contador | ventana 15 min | Vía `rate-limit-redis` como store del limiter fino ([server.js:120](server.js#L120)) |
| `cp:v1:wh:evt:<eventId>` | `1` | 25 h | Fase 2: dedup de webhooks (TTL ≥ ventana de reintentos de Notion, ~24 h — regla del dossier) |

TTL lógico (frescura) dentro del valor, TTL físico = ventana stale completa — el patrón `fresh_until`/`stale_until` canónico del dossier (oneuptime). Concretamente: `ver.ts` marca la frescura (30 s = `CACHE_TTL_MS`); el TTL Redis de 5 min es el techo duro que hoy pone `PARTES_TTL_DURO_MS`.

### 3.3 Camino de lectura de `GET /api/partes-trabajo` (sustituye a [server.js:519-553](server.js#L519))

```
leer(req):
  ver = redis.GET cp:v1:partes:ver            # 1 comando, ~150 B, 5-15 ms
  si ver existe:
    si L1.hash == ver.hash:                    # el Map local ya tiene ese body
      body = L1.body                           # 0 bytes transferidos
    sino:
      body = redis.GET cp:v1:partes:body       # solo al cambiar la foto
      L1 = { hash: ver.hash, body }
    si (now - ver.ts) <= 30s:  return body     # FRESCO
    # STALE: servir ya + revalidar UNA instancia
    si redis.SET cp:v1:lock:partes 1 NX EX 10: # ¿me toca a mí?
      hay = hayCambiosDesde(ver.cursorIso)     # freshness-check actual, ~0,4 s
      si !hay: redis.SET cp:v1:partes:ver {...ver, ts: now} EX 300   # extender vida
      sino:    refetchCompleto()               # query 2,5 s + SET ver+body EX 300
      redis.DEL cp:v1:lock:partes
    return body                                # el resto sirve stale sin esperar
  # FRÍO (sin foto): mismo lock; quien lo gana hace la query; los demás
  # esperan ~300 ms y reintentan el GET de ver, con fallback a query directa.
```

Puntos clave: (a) el usuario **nunca espera a Notion** salvo en frío absoluto; (b) solo **una instancia en todo el deployment** habla con Notion por ciclo de revalidación — hoy son potencialmente N×usuarios; (c) el freshness-check barato se conserva intacto, ahora amortizado globalmente; (d) el hash de `ver` alimenta además un **ETag fuerte** — el 304 al cliente sale sin serializar el body.

### 3.4 Invalidación

**Escrituras propias (hoy):** `invalidarPartes()`/`invalidarEmpleados()` ([server.js:157,168](server.js#L157)) pasan a hacer, además del `cache.delete` local, `DEL cp:v1:partes:ver cp:v1:dc:ver` (basta borrar `ver`; el body huérfano expira solo). Un `DEL` en Redis es visible por **todas** las instancias inmediatamente — consistencia fuerte, que es exactamente por lo que el dossier descarta Cloudflare KV (eventual, 60 s). Esto cierra I2 y la mitad residual de "la app no actualiza".

**Webhook de Notion (fase 2, plan ya esbozado en [docs/INVESTIGACION_NOTION_API_2026-08.md §4.3](docs/INVESTIGACION_NOTION_API_2026-08.md#L64)):** endpoint `POST /api/notion-webhook` con verificación HMAC-SHA256 (`X-Notion-Signature`), dedup con `cp:v1:wh:evt:<id>` (SET NX EX 90000), y acción = **invalidar sin repoblar** (`DEL ...:ver`). Nunca repoblar desde el webhook: gotcha documentado (vercel/commerce #1239 — el webhook puede llegar antes de que el dato sea legible en la API; nuestro freshness-check con `cursorIso` es la verificación natural en la siguiente lectura). Suscribirse a `page.properties_updated`, `page.content_updated`, `page.deleted` y `data_source.schema_updated` (este último como alarma tipo I9, solo log). Correr en paralelo con el polling unos días antes de relajar el polling del cliente (práctica Notaku). El `page.deleted` cierra el residuo de partes archivados que hoy tapa el TTL duro.

### 3.5 Migración incremental, sin big-bang (L1 = Map actual, L2 = Redis)

Regla transversal: **`REDIS_URL` ausente ⇒ todo se comporta exactamente como hoy** (mismo cinturón que `SUPABASE_URL` en auth). Cada error de Redis degrada a L1, nunca a 500. Orden de commits/deploys:

1. **`src-server/lib/kv.js`** — wrapper de `@upstash/redis` con `get/set/del/setNx`, timeout corto (250 ms) y no-op si no hay `REDIS_URL`. + smoke con Redis apagado (todo pasa igual). *Deploy: inocuo.*
2. **Idempotencia a Redis** — sustituir el store de [server.js:92-94](server.js#L92) por `SET NX` sobre `cp:v1:idem:enviar:*`, manteniendo la interfaz de `createIdempotencyStore` (misma firma `get/markInFlight/markComplete/delete`). Es el cambio más pequeño y el de mayor valor de corrección: cierra ADR-004 en multi-instancia. *Deploy: `patch`.*
3. **Par ver/body para `partes-trabajo` y `datos-completos`** — el bloque [server.js:525-552](server.js#L525) según 3.3, con `invalidarPartes()`/`invalidarEmpleados()` haciendo el `DEL` remoto. El Map queda como L1. *Deploy: `minor`. Este es el que cierra I2.*
4. **Lock anti-estampida** en los dos refetch (partes y datos-completos). *Mismo deploy que 3 o el siguiente.*
5. **Rate-limit fino a `rate-limit-redis`** — opcional, baja prioridad (tras el NAT de la central el limiter grueso por IP apenas discrimina de todas formas). *Cuando toque.*
6. **Fase 2: webhook** (3.4) — 2-3 días según §4.3 de la investigación. Ventana: octubre, nunca dentro de la congelación D-7 pre-demo.

**Qué NO cambia:** `hayCambiosDesde` y su cursor ([notion.js:977](src-server/services/notion.js#L977), [server.js:512](server.js#L512)); el cache localStorage del cliente ([src/lib/cacheLocal.js](src/lib/cacheLocal.js)); el ETag/304; el Smart Polling del cliente (12-30 s); el semáforo BE-7 por instancia (con el lock, ya solo una instancia hace queries pesadas — el problema 5×N se encoge solo); el saneado económico; el pipeline Make.

### 3.6 Qué deliberadamente NO se comparte

Las búsquedas N4 (`buscar-q:`, `buscar-id:`, `empleados-por-obra:`) se quedan en L1: valores pequeños, TTL 30 s, cardinalidad de claves alta y coste de miss bajo (una query filtrada). Compartirlas multiplicaría comandos sin ganancia perceptible. Ídem `firmantes`/`estado-opciones`: migrarlas es trivial pero solo si sobra tiempo — su miss cuesta poco y cambian casi nunca.

### 3.7 Criterios de éxito (medibles, antes/después con la telemetría de F0 y Speed Insights)

1. **Parte recién creado visible en el siguiente poll de CUALQUIER usuario**: p95 < 15 s (hoy: hasta 30 s + zona ciega de 60 s si cae en otra instancia). Verificación: crear parte en un navegador, cronometrar aparición en otro.
2. **Queries completas a Notion por hora en horario laboral**: ≤ 12/h para el listado (una por ciclo de revalidación real) — hoy es ~1 por instancia por expiración. Medir con el log existente de `notion.js`.
3. **Doble `enviar-datos` imposible cross-instancia**: test manual de doble-click rápido con 2 sesiones + revisar ejecuciones de PARTES1/4 en Make (0 duplicados).
4. **Cero regresión de latencia**: p95 del `GET /api/partes-trabajo` servido de cache ≤ hoy + 20 ms (el GET de `ver` cuesta 5-15 ms).
5. **Coste Redis** ≤ 2 €/mes en la factura de Upstash del primer mes completo.
6. **Smoke 46/46 con y sin `REDIS_URL`.**

---

## 4. Cuándo saltar al escalón 3 (réplica Supabase, ADR-007)

El escalón 2 **sube el listón** para el 3 (es la enmienda ya registrada en [INVESTIGACION §4](docs/INVESTIGACION_NOTION_API_2026-08.md#L68)): con webhooks + KV, el argumento "sincronizar exige polling" ha caducado y la latencia percibida deja de ser motivo. Señales que SÍ justificarían ejecutarlo, todas a la luz del dossier:

1. **429 con `rate_limit_reason` = workspace, persistentes tras webhook+KV** — la cuota se la come el conjunto app+Make y ya no hay lecturas que recortar (requiere el log del punto 1 del plan de la investigación). Es el criterio del ADR-001 que el dossier confirma como techo real (~2.700 llamadas/15 min).
2. **Necesidad de consultas que Notion no da**: agregaciones para informes (horas por obra/mes sobre todo el histórico), búsqueda full-text, o el histórico superando el `page_size: 100` del listado como problema funcional real. Una foto KV no es consultable; una réplica SQL sí (patrón Notaku/HelpKit).
3. **Requisito de disponibilidad**: "la app debe funcionar aunque Notion esté caído" (HelpKit) — p. ej. cuando entren Cataluña/Noruega.
4. **Módulo de flota** (Mapon/Solred): el ADR-007 ya fija que esos datos nacen en Supabase — su llegada arrastra naturalmente la infraestructura de réplica.
5. **Límites estructurales de Notion**: relaciones acercándose a ~2.000 páginas (Notion Mastery) — lejos hoy con 190 partes.

**Qué se reutiliza del escalón 2 en el 3** (nada se tira):
- El **endpoint webhook** completo (HMAC, dedup, reordenación por timestamp): cambia solo la acción, de `DEL ver` a `upsert` de la fila en Supabase. Es literalmente la evolución documentada de Notaku (cache → SQL + webhooks).
- El **freshness-check con cursor** se convierte en el mecanismo de reconciliación del sync incremental (mismo patrón que Drexel notion-sync), y el full sync periódico cubre borrados — la dicotomía Potion/HelpKit.
- Redis se queda para **idempotencia, locks y rate-limit** (eso no lo hace una réplica) y como cache de las lecturas calientes sobre la propia réplica.
- La capa `data.js` del ADR-002 es el punto de corte previsto: los endpoints no se tocan.
- La variante es la **unidireccional** (Supabase = caché de lectura, Notion = fuente de verdad de partes), como fijan ADR-007 y la recomendación unánime del dossier (Whalesync/Unito enseñan lo que cuesta la bidireccional).

**Prerequisito que sigue vigente antes de reabrir ADR-007**: agotar C2/C3 — con webhook+KV desplegados, el único criterio ADR-001 hoy activado ("listados >3 s") debería quedar desactivado. Si tras el escalón 2 sigue activado, entonces sí es volumen y no consulta, y el 3 procede.


---

## Apéndice — resúmenes del dossier


### Productos comerciales (Super, Potion, Notaku, Bullet…)

La industria que construye sobre la API de Notion converge en 3 familias de caché: (1) SWR en CDN con revalidación disparada por visita — Super (umbral 5 s + TTL por plan: Free 24 h, Personal 4 h, Pro 10 min), Potion (re-check en background si han pasado >20 min desde la última comprobación, + full sync diario) y Notaku (cache de HTML de página con stale-while-revalidate, ~8x más rápido que cachear datos); (2) réplica completa en BD propia sirviendo el 100% del tráfico — Notaku (SQL propia + Next.js SSR revalidate 10 s; sync horaria que pasó a ~1 min con webhooks oficiales de Notion), HelpKit y las herramientas de sync (Whalesync mantiene espejo interno y hace rondas de polling; Unito, espejo bidireccional con polling+webhooks); (3) publicación estática por lotes — Bullet (manual/diaria/horaria). Nadie de la industria intenta invalidar caches en memoria por instancia: o el cache vive en una capa compartida (CDN/KV) o se sirve desde réplica. El subproblema de imágenes (URLs S3 presignadas que caducan en 1 h, confirmado en docs oficiales) se resuelve universalmente copiando el binario a storage propio (Cloudflare R2/KV) con clave estable por block ID + proxy worker con Cache-Control de ~1 año, o re-pidiendo la URL fresca bajo demanda (Potion con audio/vídeo). Hallazgo transversal decisivo para la escalera memoria→KV→SQL: los webhooks oficiales de Notion están en GA (page.content_updated, page.properties_updated, data_source.content_updated, page.deleted…), entrega at-most-once con 8 reintentos y llegada típica <1 min — son la señal de invalidación/sync que usa Notaku y validan tanto el peldaño KV (webhook → purge del KV compartido, resolviendo exactamente el problema de invalidación cross-instancia) como el peldaño réplica SQL (webhook → upsert de la fila). Los borrados solo los tratan explícitamente quienes tienen réplica o publish estático (Potion: Draft/Archived solo se aplican en el siguiente full sync; snugl: el sync programado borra lo despublicado); en los SWR puros el borrado simplemente expira.


### Open source (react-notion-x, proxies, ISR, Workers, réplicas)

La industria que construye sobre la API de Notion NO resuelve el problema de invalidar caches en memoria por instancia: lo esquiva. Convergen tres familias: (1) ESTÁTICO/ISR — la más común en blogs/CMS: Next.js con revalidate ~60 s como fallback temporal + on-demand revalidation (revalidateTag/revalidatePath) disparada por webhook; con app router, 'use cache' + cacheTag + cacheLife larga y el webhook como única invalidación. (2) RÉPLICA en BD real refrescada por scheduler, no TTL por petición: marc7806/notion-api-cache vuelca las BDs Notion a MongoDB con cron configurable + endpoints manuales de refresh/clear; notion2pg de aaugustin (full copy en cada import, alpha) y el de victoriano (dlt incremental + Dagster diario 04:30) a Postgres; notion-into-sqlite y notcrawl a SQLite. El propio Notion valida esta escalera: sus apps usan SQLite como caché local (cargas 50% más rápidas) y WASM SQLite en navegador (+20-30%). (3) EDGE KV/R2 con claves inmutables: Workers con cron cada ~4 min (dentro del límite ~2.700 llamadas/15 min ≈ 3 rps) que sincronizan a KV (texto) y R2 (imágenes) usando el block ID de Notion como clave permanente — imprescindible porque las URLs S3 de Notion caducan en 1 h (problema abierto sin resolver en Nobelium #199 con ISR). El freshness-check barato comparando last_edited_time antes de refetch completo que ya usa Copuno es exactamente el patrón documentado por chriskirknielsen y Drexel notion-sync. Dato clave para la escalera memoria→KV→réplica: los webhooks OFICIALES de Notion (GA, con agregación de eventos en ventana <1 min, entrega at-most-once con hasta 8 reintentos, posible desorden) hacen viable hoy la invalidación cross-instancia: webhook → escribir versión/tombstone en KV compartido o revalidateTag — el webhook es solo señal, hay que hacer fetch de vuelta. Los borrados son el punto débil universal: solo se detectan por diff de listado completo o por evento page.deleted del webhook; ninguna réplica incremental los documenta bien.


### Serverless multi-instancia (KV, locks, invalidación, costes)

La industria resuelve el problema exacto de Copuno (cache en memoria por instancia lambda sin invalidación compartida) con una capa KV compartida y cache-aside + SWR a nivel de servidor. Dos candidatos claros en Vercel en 2026: (1) Upstash Redis vía Marketplace — el estándar de facto tras la desaparición de Vercel KV (migrado automáticamente a Upstash en dic-2024); free tier de 500K comandos/mes que probablemente cubre el caso Copuno, PAYG ~2 $/mes por 1M comandos, latencia sub-ms desde iad1 (misma región AWS us-east-1) por TCP y 5-15 ms por REST; y (2) Vercel Runtime Cache — hallazgo clave: cache regional COMPARTIDO entre instancias de función dentro de la región, framework-agnóstico (getCache() de @vercel/functions, sirve para Express, no requiere Next.js), con TTL + tags + expireTag, persistente entre deploys; como la función de Copuno corre solo en iad1, una región = cache compartido efectivo, resolviendo la invalidación cruzada sin infraestructura nueva (reads 0,40-0,64 $/1M unidades de 8KB, writes 4-6,40 $/1M). El patrón de invalidación por webhook es viable hoy porque Notion ya tiene webhooks nativos (page.properties_updated, page.content_updated agregado/batched, payload solo con IDs, verificación HMAC), con dos gotchas documentados en la industria: el webhook puede llegar antes de que el dato sea legible en la API (caso Shopify/vercel-commerce → revalidar cachea el dato viejo; mitigación: verificar last_edited_time o pequeño delay) y hay que deduplicar con claves idempotencia en Redis con TTL ≥ ventana de reintentos. Para SWR server-side anti-estampida (20 usuarios ≈ 20 instancias regenerando a la vez) el patrón canónico es: un solo valor JSON con fresh_until/stale_until (expiración lógica) + TTL físico = ventana stale + lock SET NX con TTL corto (~10 s) para que solo una instancia regenere mientras el resto sirve stale. Quien construye sobre la API de Notion (splitbee/notion-api-worker, react-notion-x, nextjs-notion-starter-kit) usa exactamente proxy-cache con SWR delante de la API lenta (Cloudflare Workers + cache edge, o Redis/Upstash). Cloudflare KV queda descartado para invalidación: consistencia eventual de hasta 60 s entre PoPs. El último peldaño (réplica SQL) tiene ecosistema maduro (Whalesync bidireccional, Skyvia, notion2pg OSS) pero la variante unidireccional como caché de lectura sigue siendo la recomendada — coherente con el ADR-007 aplazado.


## Directorio de recursos


**Productos comerciales (Super, Potion, Notaku, Bullet…)**: [Super Docs — How Super syncs with Notion](https://docs.super.so/how-super-works) · [Super FAQ — How to work with Super's performance caching](https://super.so/faqs/how-to-work-with-supers-performance-caching) · [Super FAQ — Why do Notion changes take time to sync](https://super.so/faqs/why-changes-being-delayed-after-publishing) · [Potion — Pause and sync changes from Notion](https://beta.potion.so/guides/publishing-syncing-content) · [Notaku — Technology (arquitectura)](https://notaku.so/docs/company/technology) · [Notaku Changelog](https://changelog.notaku.website/) · [Notion Developers — Webhooks: Event types & delivery](https://developers.notion.com/reference/webhooks-events-delivery) · [Notion Developers — Retrieving existing files](https://developers.notion.com/docs/retrieving-files) · [Serving Notion Presigned Images with Cloudflare Workers — Alex MacArthur](https://macarthur.me/posts/serving-notion-presigned-images-with-cloudflare/) · [Fixing Notion's 1-Hour Expiring Image Problem — snugl.dev](https://snugl.dev/archive/fixing-notions-1-hour-expiring-image-problem) · [Bullet.so — Auto Sync and Publish / Managing Images](https://bullet.so/docs/image-customization-c32ad9b9) · [Whalesync Docs — Notion connector](https://docs.whalesync.com/connectors/notion)


**Open source (react-notion-x, proxies, ISR, Workers, réplicas)**: [NotionX/react-notion-x](https://github.com/NotionX/react-notion-x) · [transitive-bullshit/nextjs-notion-starter-kit](https://github.com/transitive-bullshit/nextjs-notion-starter-kit) · [marc7806/notion-api-cache](https://github.com/marc7806/notion-api-cache) · [Using Notion and Next.js ISR to sync content (LogRocket)](https://blog.logrocket.com/using-notion-next-js-isr-sync-content/) · [Next.js — How Revalidation Works ('use cache', cacheTag)](https://nextjs.org/docs/app/guides/how-revalidation-works) · [Notion API — Webhooks: event types & delivery](https://developers.notion.com/reference/webhooks-events-delivery) · [Serving Notion Presigned Images with Cloudflare Workers (Alex MacArthur)](https://macarthur.me/posts/serving-notion-presigned-images-with-cloudflare/) · [Fixing Notion's 1-Hour Expiring Image Problem (snugl.dev)](https://snugl.dev/archive/fixing-notions-1-hour-expiring-image-problem) · [Nobelium #199 — Official Notion API image link expiry](https://github.com/craigary/nobelium/issues/199) · [aaugustin/notion2pg](https://github.com/aaugustin/notion2pg) · [victoriano/notion2pg (dlt + Dagster)](https://github.com/victoriano/notion2pg) · [FujiHaruka/notion-into-sqlite](https://github.com/FujiHaruka/notion-into-sqlite)


**Serverless multi-instancia (KV, locks, invalidación, costes)**: [Redis on Vercel (doc oficial)](https://vercel.com/docs/redis) · [Vercel Runtime Cache (doc oficial)](https://vercel.com/docs/caching/runtime-cache) · [Vercel Regional Pricing](https://vercel.com/docs/pricing/regional-pricing) · [Upstash Redis Pricing](https://upstash.com/pricing/redis) · [Notion API — Webhooks (referencia oficial)](https://developers.notion.com/reference/webhooks) · [How to Implement Stale-While-Revalidate Caching with Redis (OneUptime, mar-2026)](https://oneuptime.com/blog/post/2026-03-31-redis-stale-while-revalidate/view) · [How to Handle Cache Stampede (Thundering Herd) in Redis (OneUptime, ene-2026)](https://oneuptime.com/blog/post/2026-01-21-redis-cache-stampede/view) · [splitbee/notion-api-worker](https://github.com/splitbee/notion-api-worker) · [transitive-bullshit/nextjs-notion-starter-kit](https://github.com/transitive-bullshit/nextjs-notion-starter-kit) · [Cloudflare — How KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/) · [vercel/commerce #1239 — Shopify webhook premature trigger → stale data on revalidation](https://github.com/vercel/commerce/issues/1239) · [Webhook Reliability 2026: Idempotency & Retry Reference](https://www.digitalapplied.com/blog/webhook-reliability-idempotency-retries-engineering-reference-2026)


*55 hallazgos etiquetados por patrón y confianza en el journal del workflow; este documento recoge el diseño ejecutable y los resúmenes.*
