# Investigación — API de Notion y Notion como BBDD a escala (agosto 2026)

**Fecha:** 2026-08-17 · **Método:** 4 investigadores web en paralelo (documentación oficial, comunidad/foros, productos comerciales y consultoras, YouTube/podcasts) + auditoría de contraste contra el código y los ADRs de este repo. Fuentes verificadas en la web ese día; confianza anotada por hallazgo.

---

## Resumen ejecutivo

**Veredicto: el proyecto está notablemente afinado a la API de Notion.** El semáforo de concurrencia, el retry con `Retry-After`, `filter_properties` exhaustivo, el rollback compensatorio de escrituras, el freshness-check consciente del redondeo al minuto y `titleDe()` inmune a renombres son, uno por uno, los patrones que la comunidad y los productos comerciales construidos sobre Notion (Notaku, Super, Potion) han convergido como estado del arte. La arquitectura actual aguanta con holgura los 20 usuarios / 50 partes/día de octubre.

**Pero hay dos desajustes de calendario (no de diseño):**

1. **La versión de API 2022-06-28 es una bomba de relojería que activa el cliente, no el código.** Desde la versión 2025-09-03, una base de datos puede tener varias «data sources»; si alguien del cliente añade una segunda fuente a cualquiera de nuestras 6 BDs desde la UI de Notion, **todas las llamadas de la versión antigua contra esa BD rompen de golpe** (crear, query, relaciones). Zapier y n8n tardaron semanas en recuperarse del cambio. Con el historial de este workspace (renombraron el título de Empleados a cadena vacía → incidente I9), el escenario es plausible.
2. **Notion YA tiene webhooks oficiales** (GA desde ~marzo 2025, doc dice literalmente que «sustituyen al polling»), con eventos que cubren exactamente nuestro caso — incluidos **borrados/archivados**, nuestro punto ciego. La premisa «Notion no ofrece webhooks fiables» con la que se aplazó el ADR-007 **ha caducado**.

Además, **desde el 16-jun-2026 hay un límite de rate NUEVO por workspace** (compartido entre la app y los escenarios de Make — ~1.000 req/5 min según fuentes secundarias, «escalado al plan» según la oficial). Es el límite que reventará primero en la hora punta de firma de octubre, y hoy no lo distinguimos en los logs.

---

## 1. La API de Notion hoy (verificado contra developers.notion.com, 17-08-2026)

| Tema | Estado | Fuente |
|---|---|---|
| Rate limit por conexión | ~3 req/s de media, bursts tolerados; 429 con `Retry-After` (también 529) | [Request limits](https://developers.notion.com/reference/request-limits) |
| **Rate limit por workspace (NUEVO, 16-jun-2026)** | Compartido entre TODAS las conexiones del workspace (app + Make), escalado al plan; el 429 trae `additional_data.rate_limit_reason` | Request limits + changelog |
| Tamaños | 500 KB / 1.000 bloques por petición; rich_text 2.000 chars; relation 100 páginas por petición; **25 refs de relación por fetch de página** | Request limits |
| Paginación | page_size 100; **tope NUEVO de 10.000 resultados por query** (abr-2026) | Changelog 2026-04-20 |
| **Webhooks** | **GA.** `page.created/properties_updated/content_updated/moved/deleted/undeleted`, `data_source.*`, comentarios. Entrega <5 min (mayoría <1 min), agregados, at-most-once con 8 reintentos/24 h, firma HMAC-SHA256. El evento es señal, no contenido (fetch posterior). Sin restricción de plan documentada | [Webhooks](https://developers.notion.com/reference/webhooks) |
| Versiones | 2025-09-03 (data sources — **breaking para 2022-06-28 si una BD gana una 2ª fuente**) y 2026-03-11 (`in_trash` sustituye a `archived`, filtros de fecha relativos, filtros multivalor, Views API). Sin sunset planificado de versiones antiguas | [Upgrade guide](https://developers.notion.com/docs/upgrade-faqs-2025-09-03) |
| Novedades útiles | `filter_properties` también en create/update (12-ago-2026); cursores opacos estables (abr-2026); PATs con expiración; **Developer Platform 3.5 (may-2026)**: Workers alojados (de pago desde 11-ago-2026), database sync, Markdown API | [Release 2026-05-13](https://www.notion.com/releases/2026-05-13) |
| Lo que sigue SIN existir | Transacciones, bulk writes, agregaciones en la API REST, query de la papelera (issue [notion-sdk-js#524](https://github.com/makenotion/notion-sdk-js/issues/524)), tier de pago con límites superiores | verificado |

## 2. Lo que dice la experiencia real (comunidad + productos a escala)

- **El techo real no es el límite documentado sino el fan-out**: cada operación lógica se descompone en cascada de llamadas. Techo efectivo reportado ~180 req/min. El punto de ruptura reportado en la comunidad es **de throughput, no de nº de filas ni de usuarios** — nuestras 1.554 filas de empleados están lejísimos del techo práctico de UI (10-20k filas).
- **Incidente feb-2026**: 429 en automatizaciones muy por debajo del límite (1 petición cada 40-50 s), reconocido por Notion y corregido. Lección: el retry con `Retry-After` es obligatorio porque el 429 puede llegar sin haberlo provocado.
- **`last_edited_time` se redondea al minuto hacia abajo** (oficial) — nuestro freshness-check ya lo asume (TTL duro + invalidación tras escritura).
- **Consistencia eventual**: una página recién creada puede no aparecer en una query inmediata (sobre todo en `/search`).
- **Nadie sirve tráfico de usuarios en caliente contra la API**: Super y Potion cachean en CDN con stale-while-revalidate; **Notaku replica a SQL propio y sirve desde ahí** (sync horario) — tuvo que desactivar su auto-sync diario por endurecimiento de límites. Unito solo sincroniza cada 5 min; Whalesync documenta que la API de Notion es «significativamente más lenta que la mayoría». Un ingeniero de Notion (jitl, [HN 2024](https://news.ycombinator.com/item?id=40437606)) desaconseja construir sobre la API sin capa de sync/caché propia.
- **Consultoras certificadas** (Optemization, Landmark Labs): no publican metodología de «Notion como backend de app» — su terreno es Notion como sistema operativo interno. La referencia de límites prácticos es [Pushing Notion to the Limits](https://notionmastery.com/pushing-notion-to-the-limits/) (Notion Mastery, act. mar-2026): relaciones degradan hacia ~2.000 páginas relacionadas, 2,5 MB de propiedades por página.
- **No hay casos enterprise públicos de «API como backend operativo» a escala** — señal en sí misma. En vídeo tampoco: no existe la charla «Notion API at scale»; el conocimiento vive en docs, blogs de productos y foros (directorio completo de recursos al final).

## 3. Contraste con Copuno (auditoría sobre el código real)

| Práctica/límite | Copuno hoy | Veredicto |
|---|---|---|
| Cola bajo 3 req/s | Semáforo global de 5 + escrituras a 3 | ✅ patrón de consenso |
| 429/`Retry-After` | Retry único con jitter (lecturas + escrituras de detalles) | ⚠️ 1 reintento vs 6 recomendados; **el 529 no se reintenta** |
| Límite de workspace + `rate_limit_reason` | No se lee ni se loguea | 🆕 punto ciego de observabilidad |
| `filter_properties` en lecturas | Exhaustivo (PROPS_CATALOGO + golden-diff) | ✅ ejemplar |
| `filter_properties` en escrituras (ago-2026) | No usado (el POST devuelve ~60 props y leemos 1) | 🆕 micro-optimización |
| Webhooks | Polling 12/20/30 s + freshness-check | 🆕 **la mayor oportunidad** — invalida la premisa nº 1 del ADR-007 |
| Versión de API | `2022-06-28` hardcoded | ⚠️ **riesgo latente serio** (2ª data source = rotura total) |
| Redondeo de `last_edited_time` | Documentado y mitigado en el código | ✅ |
| Sin transacciones | Rollback compensatorio (`archivarDetallesConRollback`) | ✅ el máximo que la API permite |
| Relaciones masivas | El modelo las esquiva (horas en BD aparte, relaciones 1-5) | ✅ por diseño |
| Renombres de propiedades | `titleDe()` por tipo + `'title'` canónico | ✅ fix estructural post-I9 |
| Patrón industria (caché/réplica delante) | Cache servidor + freshness; réplica descrita en ADR-007 (= arquitectura Notaku) | ✅ para 8-20 usuarios |

## 4. Plan de acción recomendado (por ROI)

1. **Log de `rate_limit_reason`** en `mapNotionError` — 30 min, hacer YA. Sin él, los 429 de octubre no dirán si la cuota se la comió la app o Make (remedios opuestos).
2. **Migrar `NOTION_VERSION` a 2025-09-03+** — 1-2 días (la versión vive en un sitio; smoke de 59 casos como red; endpoints `/databases/:id/query` → `/data_sources/:id/query`). Es defensa, no mejora: elimina el único fallo catastrófico que activa el cliente. Ventana: post-demo (no tocar a 2 semanas de la congelación).
3. **Webhooks de Notion → invalidación push** — 2-3 días. Endpoint `/api/notion-webhook` (HTTPS ya lo da Vercel) + verificación HMAC + **store compartido (KV)** — ojo: el cache es por instancia lambda, un webhook solo invalidaría una; el KV es prerequisito. Correr en paralelo con el polling unos días antes de retirarlo (práctica comunitaria). Cierra además el punto ciego de borrados/archivados. Ventana: octubre.
4. **Filtros relativos de fecha y multivalor** (tras el punto 2) — horas; simplifica `?desde&hasta`.
5. **`filter_properties` en escrituras** — trivial; pedir solo `ID` en los POST de crear/rectificar.

**Enmiendas a los umbrales de reapertura del ADR-001/007** (siguen siendo correctos con tres matices): desglosar el «≥5 429/día» por `rate_limit_reason`; añadir disparador no-de-escala «detección de 2ª data source o aviso de sunset» → migración de VERSIÓN (no de motor); y anotar que la premisa «sincronizar exige polling» ha caducado — con webhooks, la réplica unidireccional del ADR-007 (patrón Notaku) cuesta una fracción de lo estimado, lo que **sube el listón para ejecutar ADR-003**: hay un escalón intermedio (webhooks + KV) antes de cambiar de motor.

## 5. Riesgo de escala concreto (octubre: 20 usuarios, 50 partes/día)

**Dónde revienta primero: el límite de workspace compartido con Make, en la hora punta de firma (~18:00).** 20 usuarios poleando + N instancias lambda (semáforo y cache son POR instancia → concurrencia real 5×N) + cada `enviar-datos` disparando decenas de llamadas de PARTES1-4, contra ~1.000 req/5 min TOTALES del workspace. No es el volumen de filas: miles de partes siguen lejos de cualquier techo. Mitigaciones ya en marcha: freshness-check (~0,4 s por tick), 304, cache local. Las siguientes: puntos 1 y 3 del plan.

**Módulo de flota**: mantiene el criterio del ADR-007 — los datos Mapon/Solred nacen en Supabase y Notion queda como capa de edición de la oficina; para entonces los webhooks deberían estar operando.

---

## Directorio de recursos

**Documentación oficial**: [Request limits](https://developers.notion.com/reference/request-limits) · [Webhooks](https://developers.notion.com/reference/webhooks) · [Eventos y entrega](https://developers.notion.com/reference/webhooks-events-delivery) · [Upgrade 2025-09-03](https://developers.notion.com/docs/upgrade-faqs-2025-09-03) · [Versioning](https://developers.notion.com/reference/versioning) · [Changelog](https://developers.notion.com/page/changelog) · [Release Notion 3.5](https://www.notion.com/releases/2026-05-13)

**Análisis y guías**: [Pushing Notion to the Limits](https://notionmastery.com/pushing-notion-to-the-limits/) (la mejor tabla de límites prácticos) · [Truto — arquitectura B2B sobre Notion API](https://truto.one/blog/how-to-integrate-with-the-notion-api-architecture-guide-for-b2b-saas/) · [Guía de webhooks (Hookdeck)](https://hookdeck.com/webhooks/platforms/guide-to-notion-webhooks-features-and-best-practices) · [Rate limits: what breaks](https://onetwothreesend.com/notion-api-rate-limits-what-breaks-how-to-route-around/) · [Novum OS — lo que reporta Reddit](https://novumos.app/learn/notion-api-rate-limit-reddit)

**Arquitecturas de referencia**: [Notaku Technology](https://notaku.so/docs/company/technology) (réplica SQL — el espejo del ADR-007) · [Super](https://docs.super.so/how-super-works) y [Potion](https://beta.potion.so/guides/publishing-syncing-content) (CDN stale-while-revalidate) · [Whalesync Notion connector](https://docs.whalesync.com/connectors/notion) · [notion2pg incremental (dlt+Dagster)](https://github.com/victoriano/notion2pg) · [notion-api-cache](https://github.com/marc7806/notion-api-cache)

**Foros clave**: [jitl (ing. de Notion) en HN](https://news.ycombinator.com/item?id=40437606) · [notion-sdk-js #114 consistencia eventual](https://github.com/makenotion/notion-sdk-js/issues/114) · [#524 papelera no consultable](https://github.com/makenotion/notion-sdk-js/issues/524) · [incidente feb-2026 en n8n](https://community.n8n.io/t/rate-limit-with-n8n-notion/269595)

**Vídeo/podcast**: [Keynote Developer Platform 3.5 (may-2026)](https://www.youtube.com/live/rpE2rzKO6L0) — el más relevante · [Make with Notion 2024 keynote](https://www.youtube.com/watch?v=k0PJHSG4yqM) · [Notion API Full Course (Thomas Frank)](https://www.youtube.com/watch?v=ec5m6t77eYM) · [Whalesync en My No Code Story](https://mynocodestory.com/pod/061-realtime-data-sync-for-nocode-wmatthew-busel) · [Potion en Indie Bites](https://podcasts.apple.com/no/podcast/$250-to-$3k-mrr-in-4-months-with-a-notion/id1530577069?i=1000537032152) · [Sequoia — Ivan Zhao](https://sequoiacap.com/podcast/notions-ivan-zhao-the-refounder) · Contexto de infra: [The Great Re-shard](https://www.notion.com/blog/the-great-re-shard)

*Nota de método: no existe a día de hoy contenido audiovisual técnico de referencia sobre «Notion API a escala en producción» — el conocimiento vive en la doc oficial, los blogs de los productos que lo hacen y los foros. Los hallazgos con confianza media/baja están señalados en el texto.*
