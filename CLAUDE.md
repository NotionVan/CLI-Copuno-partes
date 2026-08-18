# Copuno — Gestión de Partes

Webapp interna del cliente **Copuno** para que los jefes de obra creen y firmen partes de trabajo diarios. Backend de datos en **Notion**, generación de PDFs y firma vía **Make.com**, hosting en **Vercel**.

El contexto de negocio y las decisiones viven en `javintnvn/SB` (segundo cerebro).

- **Producción:** **https://app.copuno.com/** — dominio propio **activo desde 2026-08-03** (CNAME aplicado por el administrador, dominio dado de alta en Vercel, certificado emitido; HTTP 200 verificado). `https://copuno-gestion-partes.vercel.app/` **sigue viva** y sirve lo mismo: es el dominio técnico de Vercel, no se ha retirado.
  - ⚠️ **La ruta de uso es la raíz `/`, NO `/partes`** — `app.copuno.com/partes` devuelve **404** hoy (verificado 2026-08-03). `/partes` es el destino de [ADR-005](docs/adr/ADR-005-dominio-y-espacio-de-nombres.md) y **está sin implementar**: no hay router en el frontend (`react-router-dom` se eliminó en v1.9.2 al estar sin uso). Ver "Migración a `/partes`" en [ADR-005](docs/adr/ADR-005-dominio-y-espacio-de-nombres.md).
  - **`partesobra.copuno.com` y `gestionpartes.copuno.com` nunca existieron** (NXDOMAIN) pese a estar documentados como producción durante meses — descartados ambos.
- **Versión actual:** [package.json](package.json) → `version`
- **Cliente:** Copuno (sector construcción, varias delegaciones)
- **Modelo comercial:** retainer mensual 20 h. Detalle y reglas de scope en [.claude/scope-rules.md](.claude/scope-rules.md).
- **Última edición:** 2026-08-18 tarde (**v1.13.3 + v1.13.4 — P5 y S1, hallazgos de escribir el informe**: al redactar [docs/RESULTADOS_RENDIMIENTO_2026-08.md](docs/RESULTADOS_RENDIMIENTO_2026-08.md) hubo que admitir que faltaban dos verificaciones —prueba de carga y revisión de seguridad— y al hacerlas salieron dos defectos reales. **P5**: `GET /api/partes-trabajo` no tenía guard de petición en vuelo → 10 peticiones concurrentes con caché fría = **10 queries completas** a Notion en el endpoint más usado (arranque + refresco + cada tick del poll); **llevaba activo desde siempre**, sobrevivió a la auditoría de 105 hallazgos, a 7 pasadas del regression-checker y a 16 deploys; cerrado con el patrón de P4 (`partesEnVuelo`, solo para el listado sin ventana) + telemetría `coalescido`. **S1**: `helmet` solo cubre `/api/*` porque los estáticos los sirve Vercel sin pasar por Express → el HTML que ejecuta la app **no tenía anti-clickjacking**; cerrado con 4 cabeceras en `vercel.json`. Abiertos: **S2** (sin CSP en el HTML, fuera de la congelación) y **S3** (17 vulns en deps, 9 alcanzan producción). Nuevo hueco de cobertura: **el mock no implementa el filtro de fechas**, así que BE-13a solo está verificado contra Notion real. Suite 66/66.) — 2026-08-18 mediodía (**v1.13.2 — P4 cerrado**: el paginado del catálogo de empleados reintenta ante 429 (`conReintento429`, el helper de F7) y `GET /api/empleados` reutiliza la promesa en vuelo (`catalogoEmpleadosEnVuelo`, limpiada en `finally`) — dos peticiones concurrentes con caché fría comparten UNA descarga en vez de duplicar las ~16 llamadas; escenario real: lunes de septiembre con Óscar/Paola/Andrés creando partes a la vez. Suite 64/64, E2E de concurrencia verificado contra Notion real (dos GET terminan en el mismo ms). **Limpieza de datos de prueba**: archivados los 3 partes de la obra TEST con sus detalles (191→188), detalles PRIMERO; la obra TEST se pasa a *Parada* tras el ensayo. «Persona firmante Notionvan - tests» **NO se archiva**: firma 12 partes de obras reales del piloto. **Observabilidad 1A verificada y cerrada sin cambios**: las notificaciones de fallo de Make ya estaban activas — y en la org del cliente hay 2 usuarios (Javi y Efrén), así que **los avisos de error le llegan también a Efrén** (explica los correos que veía en julio); decisión de negocio pendiente, anotada en el IMD. Sentry/logs externos siguen fuera del retainer por [OBSERVABILIDAD_CLASIFICACION.md](docs/OBSERVABILIDAD_CLASIFICACION.md).) — 2026-08-18 tarde (**v1.13.0 + v1.13.1 — catálogo completo de empleados en búsqueda libre + pasada adversarial de edge cases** (v1.13.1: falso aviso de duplicados con filtro por prefijo, indicador de carga del catálogo —sin él la lista parecía rota, justo la queja original—, filtrado insensible a acentos «jose»→«José» en los 3 filtros locales, orden alfabético, TTL respetando `CACHE_TTL_MS=0` en tests, aviso de cap en edición, ceros a la izquierda en IDs — ver CHANGELOG_V1.13.1), a raíz del reporte de Efrén «no se cargan las listas completas». Diagnóstico verificado contra Notion real: las listas POR OBRA no truncan (ninguna de las 54 obras activas llega a 100 empleados); el hueco era la búsqueda libre — mínimo 3 letras + tope invisible de 20 sobre una BD de **1.533**. Fix: `empleados.listarTodos` pagina la BD entera (~16 llamadas con `filter_properties`, 373 KB/81 KB gzip); `GET /api/empleados` lo sirve con TTL propio de 10 min (`setCache` acepta TTL por clave); el cliente lo memoiza 10 min (`getCatalogoEmpleados` en notionService) y los buscadores de crear Y edición filtran **en local al instante** (lista completa visible sin teclear, cap 300/50 en pantalla con aviso), con el buscador server-side de F5 como fallback intacto mientras carga o si falla. `datos-completos` NO cambia — el arranque no engorda. Suite 62/62 (catalogo.test.js nuevo); regression-checker 🟢; verificado E2E endpoint contra Notion real y UI en navegador.) — 2026-08-18 (**v1.12.3 en producción — telemetría multi-instancia + P2 cerrado.** `INSTANCE_ID` por lambda en `/api/health` (`inst`) y en los logs estructurados; eventos `partes_cache` (caminos del freshness-check, el hit fresco no se loguea) y `enviar_datos_entrada` (estado de idempotencia — **dos `miss` del mismo parte con `inst` distintos = la idempotencia in-memory se repartió entre instancias**, el riesgo de doble webhook a Make); `mapNotionError` propaga `rate_limit_reason` (conexión vs workspace compartido con Make). Es la medición previa al **escalón KV** diseñado en [docs/CACHE_NOTION_INDUSTRIA_2026-08.md](docs/CACHE_NOTION_INDUSTRIA_2026-08.md) (monográfico: nadie en la industria cachea en memoria por instancia — SWR en CDN, KV compartido o réplica SQL; diseño Upstash us-east-1 con esquema version/body, 0-2 €/mes, migración en 6 pasos con `REDIS_URL` como kill-switch; el endpoint webhook del escalón 2 se reutiliza entero en el 3). Lectura de la telemetría: tarea Notion (21-08, guion de filtros en las notas) + **rutina programada de Claude a las 12:37 laborables** que muestrea `/api/health` ×30 y acumula en `docs/telemetria-instancias.log` (gitignored). También de la tanda 17-18: [docs/APUNTALAMIENTO_NOTION_2026-08.md](docs/APUNTALAMIENTO_NOTION_2026-08.md) — «Can edit content» + teamspace cerrado es LA mitigación de I9/P1 (el lock de BD no lo es), webhook de esquema como alarma troceable, Academy en español para el onboarding de septiembre. Manuales en v1.12.3 (capturas v1.12.2 vigentes, regeneradas el 17-08 con [scripts/generar-capturas.mjs](scripts/generar-capturas.mjs)).) — 2026-08-17 cierre (**plan F0-F7 COMPLETO en producción (v1.12.2)** + **investigación del estado del arte de la API de Notion** → [docs/INVESTIGACION_NOTION_API_2026-08.md](docs/INVESTIGACION_NOTION_API_2026-08.md). Veredicto: la arquitectura está alineada con lo que la industria ha convergido (semáforo bajo 3 req/s, Retry-After, `filter_properties`, caché delante de la API — el mismo patrón de Notaku/Super/Potion) y el techo real reportado es de **throughput, no de filas**: 190 partes y 1.554 empleados están lejos de cualquier límite; para 20 usuarios en octubre sobra. **Tres hallazgos accionables** (catalogados P1/P2/P3 en DEUDA_TECNICA): **P1 🔴 la versión de API `2022-06-28` rompe entera contra una BD en cuanto alguien del cliente le añade una 2ª data source desde la UI de Notion** (breaking change de 2025-09-03; Zapier/n8n tardaron semanas; el disparador NO está en nuestro código) → migrar a 2025-09-03+ **post-demo**, 1-2 h; **P2 🟠 desde jun-2026 hay un límite de rate POR WORKSPACE compartido con Make** y `mapNotionError` no lee `additional_data.rate_limit_reason` → sin eso, un 429 de octubre no dirá si la cuota se la comió la app o el pipeline (remedios opuestos), 30 min; **P3 🟡 los webhooks oficiales de Notion existen y son GA** (`page.created/properties_updated/deleted/undeleted`, la doc dice que sustituyen al polling) → harían innecesario el polling de 12-30 s y cerrarían el punto ciego de los archivados, pero **requieren store compartido (KV): el cache es por instancia lambda**. Consecuencia para los ADR: **la premisa nº1 del ADR-007 («Notion no ofrece webhooks fiables») ha CADUCADO** — anotado en el propio ADR; no reabre la variante bidireccional (el eco y la doble fuente de verdad siguen) pero abarata la unidireccional y añade un escalón intermedio (webhooks + KV) antes de plantear ADR-003. Otros datos verificados: `last_edited_time` redondea al minuto (nuestro freshness ya lo asume), consistencia eventual en queries tras crear, tope nuevo de 10.000 resultados por query, `filter_properties` ya disponible también en escrituras.) — 2026-08-17 noche (**F7 en marcha: v1.12.0 y v1.12.1 EN PRODUCCIÓN — escrituras ~2× más rápidas y «Enviar datos» instantáneo.** v1.12.0: detalles de horas en **lotes de 3 sin sleeps** (`enLotes`/`crearDetallesEnLotes` en notion.js), retry único de 429 en escrituras, **archivado transaccional con rollback** (`archivarDetallesConRollback` — nunca horas ocultas ni duplicadas), 2 GET log-only y 1 GET de releer eliminados (el POST de Notion ya trae el `unique_id` — fallback conservado), `matriculasPorIds` en paralelo con el sync del espejo intacto. Medido local→Notion real: crear 10 empleados 8,5→4,8 s, editar 17,2→13,1 s. v1.12.1: **parche de estado optimista en el padre** (`parcheEstadoRef`+`conParches` en TODA foto entrante — poll, Refrescar, reconexión, montaje): «Procesando» al pulsar Enviar, estado confirmado al 200, **I8 cerrado de raíz**; 409 no-Borrador salta al estado real (`err.estadoServidor`); guardar cierra el modal al confirmar el PUT; timeouts de escritura 45 s; guard síncrono anti doble-click. Gotchas nuevos: `axios.post(url, null)` serializa body `"null"` → 400 de `express.json` strict (usar `undefined`); al limpiar partes TEST archivar los detalles ANTES que el parte (la relación se vacía y el filtro deja de verlos); **`URL PDF` la escribe PARTES4/4 al firmar, NO 3/4** (tabla de escenarios corregida). **7a COMPLETADA — v1.12.2 EN PRODUCCIÓN**: vercel.json migrado de `builds` a `functions` (wrapper [api/index.js](api/index.js) sobre server.js), `maxDuration: 60` (H2 mitigado), catch-all SPA a `/index.html`, headers para manual.html/logos. Verificado en preview con **Protection Bypass for Automation** (secret en `.env` local, `VERCEL_AUTOMATION_BYPASS_SECRET`) y re-verificado en app.copuno.com tras el merge del PR #3 (checklist 7/7: health, SPA, deep-links, 401 de la app, cabeceras). **F0-F7 COMPLETO.** Fluid Compute queda como paso posterior separado (toggle de dashboard; antes de activarlo, auditar el estado module-level — cache/rate-limit/idempotencia por instancia). Suite smoke **59/59** (lotes.test.js con reproducción del hallazgo del checker; freshness.test.js con márgenes anti-flaky).) — 2026-08-17 tarde (**F4-F6 desplegadas — el paquete pre-demo F0-F6 está COMPLETO: v1.9.1→v1.11.0, 7 deploys en el día.** **v1.11.0/F6, la pieza central**: el polling del listado (muerto desde v1.3, hallazgo C1 de julio — la causa de «la app no actualiza») **revivido** con el patrón del poll del modal (cancelled + setTimeout encadenado, hash-guard, 12/20/30 s, kill-switch `POLL_ENABLED`, pausado con edición abierta vía `edicionAbiertaRef` y en background) + **freshness-check server-side**: al expirar la foto de partes, query mínima `{timestamp:'last_edited_time', after: cursor}` (~0,4 s medidos) antes de repetir la query completa (~1,5-2,5 s); cursor = max `ultimaEdicion` de la foto; TTL duro `PARTES_TTL_DURO_MS` 5 min (cubre archivados y el redondeo al minuto de Notion); con 429 en el check se sirve la foto stale. I-C cerrado (firmantes `Promise.all` + cache 60 s). Poll del modal a 8/12/20 s; version-check y estado-opciones pausados en background. **UX-46**: el modal de sincronización dice la verdad en lenguaje de usuario. **UX-40 verificado y DESCARTADO** (round-trip de fechas estable — sin corrimiento de día). [docs/SMART_POLLING.md](docs/SMART_POLLING.md) reescrito (v3). **v1.10.1/F4**: cache local SWR ([src/lib/cacheLocal.js](src/lib/cacheLocal.js), segunda apertura 47 ms, sin DNI en disco), Toast único visible, UX-4 (la edición ya no puede vaciar un parte), targets 44 px, contrastes AA. **v1.10.2/F5**: rate limit en dos capas (IP gruesa + usuario fina), semáforo global de 5 hacia Notion, retry 429 solo en lecturas, 503+Retry-After, ETag/304 (`no-store`→`private, no-cache`), píldora de conexión honesta (UX-53), errores en cristiano (UX-41). **Fuera de código**: cola de incompletas de Make purgada por API (10/10 de julio — corta los correos de reintentos que veía Efrén); advisors de Supabase revisados para el checklist de corte (3 WARN). E2E de F6 verificado contra Notion real y en navegador (un parte creado por «otro usuario» aparece solo; 0 tráfico con edición abierta o en background). **Queda F7** (escrituras) solo si hay margen antes de la congelación D-7 (demo semana 7-14 sep); si no, post-demo.) — 2026-08-17 (**plan de rendimiento+UX pre-demo: informe consolidado + F0-F3 desplegadas** — v1.9.1→v1.10.0 en 4 deploys el mismo día. Auditoría de 6 pasadas → [docs/INFORME_UX_RENDIMIENTO_2026-08-17.md](docs/INFORME_UX_RENDIMIENTO_2026-08-17.md) (BE-1..20, FE-1..29, UX-1..56; los 13 hallazgos de julio seguían vivos). **Hitos**: **I9 detectado y cerrado** — el título de la BD Empleados fue renombrado en Notion a cadena vacía y producción servía nombres de empleado VACÍOS + búsqueda por nombre rota (400→500); con toda probabilidad el error de la demo ante la central; fix estructural `titleDe()` por tipo, inmune a renombres. **BE-3**: el cache en memoria no se invalidaba tras NINGUNA escritura (parte recién creado podía no aparecer 30 s — mitad intermitente de «la app no actualiza»); `invalidateCache()` en los 5 puntos de escritura. **UX-23**: un 0 de horas se grababa como 8 (`|| 8`→`?? 8`, smoke nuevo — 46 casos). `filter_properties` en TODO el catálogo (`PROPS_CATALOGO`; partes 935→357 KB, empleados 652→171 KB/0,7 s) + golden-diff repetible ([scripts/golden-diff-catalogo.sh](scripts/golden-diff-catalogo.sh)). **Arranque 9→3 peticiones y menú en ~160 ms** (datos-completos consolidado con fallback + app-shell + AuthGate sin pantalla en blanco). Esperas artificiales de 2-4 s eliminadas; ErrorBoundary global; badges de estado arreglados; medias horas tecleables; ventana `?desde&hasta` en partes. Speed Insights activo. `react-router-dom` eliminado. ADR-008 commiteado. **Quedan F4-F7** (cache local/toast, resiliencia multi-usuario, polling delta, escrituras) — plan en el informe. **Congelación D-7 antes de la demo de la semana del 7-14 sep.**) — 2026-08-03 (**v1.9.0 FUSIONADA a `master` y en producción** con login activo en app.copuno.com; 5 usuarios dados de alta; Vercel de pago ~20 €/mes) — 2026-07-31 (**web de documentación del proyecto**: [docs/manual/index.html](docs/manual/index.html) — un único HTML autocontenido (1,4 MB, funciona offline) con el manual de usuario (7 capturas reales de la app en modo mock), la documentación técnica (3 diagramas SVG: arquitectura, ciclo de vida del parte, pipeline Make) y una sección interna claramente marcada (deuda técnica, edge cases Make, observabilidad) pensada para retirarse antes de compartir con el cliente. Capturas generadas con puppeteer-core contra la config nueva `copuno-mock` de [.claude/launch.json](.claude/launch.json) (server en mock sin auth). **Convención nueva: mantener este manual al día cuando proceda** — ver "Convenciones del proyecto". Commit `04a0fd0` en la rama.) — 2026-07-30 (**v1.9.0** — desarrollada en rama `feature/auth-supabase`, fusionada a `master` el 03-08. Autenticación de plataforma completa (ADR-006, resuelve H1): Supabase Auth del cliente (org Grupo Copuno, proyecto "Partes de Obra" `cuwtneprjbvumfjycnmn`, `eu-west-1` — decisión cerrada, no mover), login email+password con reset autoservicio, middleware JWT verificado en local con el `crypto` de Node (**sin `jose`: es ESM puro y tumbaba el server CJS en Vercel**), interceptores axios (401 → refresh antes de signOut), menú de cuenta (cambiar contraseña / cerrar sesión), migraciones SQL versionadas en [supabase/migrations/](supabase/migrations/) y aplicadas (`perfiles` + `accesos_modulo` + RLS). **E2E validado** con usuario real (`javi@notionvan.com`, invitados también `eiglesias@`; pendientes `notionvan@copuno.com` y `osanchez@` hasta luz verde). Suite smoke **reparada y ampliada** (45/45; ver sección Tests). Cinturón `AUTH_OBLIGATORIA=true` para el corte. **Cabecera rediseñada** con el logo oficial (componente [src/components/Cabecera.jsx](src/components/Cabecera.jsx) + `cabecera.css`; `--header-offset` medido por ResizeObserver — arregla los filtros sticky tapados en tablet; modal de contraseña por portal — el `backdrop-filter` lo atrapaba). Gotchas nuevos: enlaces de invitación/reset de Supabase son de **un solo uso y caducan en 1 h** (subir a 24 h antes del despliegue; el SMTP de Free limita ~2-4 emails/h); la protección de deployments de Vercel exige sesión Vercel en los previews (Hobby: todo o nada). Checklist de merge en [CHANGELOG_V1.9.0.md](CHANGELOG_V1.9.0.md); clasificación de observabilidad para el QBR en [docs/OBSERVABILIDAD_CLASIFICACION.md](docs/OBSERVABILIDAD_CLASIFICACION.md).) — 2026-07-28 (**noche — endurecimiento del pipeline Make (M9)**: auditoría de edge cases sobre los blueprints **vivos** de eu2 → [docs/EDGE_CASES_MAKE.md](docs/EDGE_CASES_MAKE.md) (E1–E7). Aplicados en producción el mismo día: **E2** (`ifempty` en los 9 numéricos del mod 37 de PARTES2/4, vía PATCH API) y **E3** (data structures explícitas `608077`/`608078` asociadas a los webhooks de 2/4 y 3/4 — desde ahora **validan en la puerta**: campo ausente/tipo malo = error visible en el emisor; contrato en [docs/E3_CONTRATO_WEBHOOKS.md](docs/E3_CONTRATO_WEBHOOKS.md)). **E2E validado con partes reales**: el 305 (sin matrículas ni notas) fue **rechazado en la puerta** — `required` en Make significa **no-vacío**, corregido a `required:false` en Vehiculos/Notas; el 306 (obra TEST, con matrícula y notas multilínea) recorrió el pipeline completo. **Blueprints ya versionados**: `scripts/export-blueprints-make.py` exporta saneando secretos a [docs/blueprints-make/](docs/blueprints-make/) — a partir de ahora hay `git diff` de lo que se toca en la UI de Make. **E5 corregido** (PARTES4/4 listaba solo 50 ficheros de OneDrive para localizar el parte a firmar y la carpeta ya acumula ~61 PDFs → `limit` 50→1000; se descartó el campo `search` porque depende del índice asíncrono de OneDrive). **E8 mitigado** (el escenario de limpieza `5682602` tenía programación activa pese a lanzarse a mano → desactivado; solo borra `.doc`, nunca PDFs). Auditados **todos** los escenarios activos. Abiertos **E1** 🟠 (token Notion hardcodeado — resultó estar en **5 sitios de 3 escenarios**, no 2 de 1; el intento vía key de Make se revirtió porque la API descarta los `parameters` de las keys), **E4**, **E10** (el envío al cliente apunta a una propiedad Notion inexistente; funcionalidad aún no operativa), **E6/E7/E9** y **I8** (tras `enviar-datos`, si la recarga del listado falla la UI muestra Borrador y reactiva el botón). Acceso API a Make de producción operativo: `MAKE_TOKEN` en `.env` (org cliente `4157465`, team `2014883`; ver sección Escenarios Make). — **v1.8.0 — botón "Exportar CSV" en la app** para los cuadrantes de Chorus: modal con rango de fechas (por defecto día 1 del mes → hoy), **confirmación explícita si el rango cruza meses**, y las reglas de negocio aplicadas en servidor (excluye partes rectificados y obras de prueba, agrega por obra/trabajador/día, reporta incidencias y partes sin firmar). Nuevo endpoint **paginado** `GET /api/exportaciones/chorus` — el cliente itera páginas para que ninguna petición se acerque al timeout serverless; `filter_properties` baja un mes de 410 KB/3,9 s a 37 KB/0,6 s. Verificado contra junio 2026: **idéntico al CSV que ya validó el cliente** (254 filas / 2.083 h) + **verificación visual en navegador** (exportación real de julio y diálogo de confirmación cross-mes). Ver [CHANGELOG_V1.8.0.md](CHANGELOG_V1.8.0.md). — **incidencia Make resuelta, sin cambios de código**: `400 Bad control character in JSON` en PARTES1/4 y PARTES2/4 — los dos escenarios que construyen el body JSON a mano — por saltos de línea de `Notas`; resuelto con `escapeJSON()`. Los 5 partes afectados (269/272/276/278 Lentiscos, 293 Las Palmas) relanzados desde Notion y funcionando. En el mismo pase se detectó y cerró que `Vehiculos del parte` llegaba vacío en el webhook #8 de PARTES2/4 → el PDF salía sin matrículas. Tres gotchas nuevos en este archivo: `escapeJSON()` y su excepción, redeterminar la estructura del webhook receptor tras cambiar un payload, y que arreglar un escenario no arregla sus ejecuciones ya encoladas. Detalle en [docs/DEUDA_TECNICA.md](docs/DEUDA_TECNICA.md) → M5 y M8; quedan abiertos M6 y M7, sin impacto en cliente. — 2026-07-14: procedimiento nuevo: exportación de partes a CSV para los cuadrantes Chorus de Tomeu — ver [docs/EXPORT_CHORUS_CSV.md](docs/EXPORT_CHORUS_CSV.md) + [scripts/export-chorus-csv.py](scripts/export-chorus-csv.py). v1.7.1 — icono `Truck` junto a las matrículas en el listado. v1.7.0 — vehículos como **relación** Notion: `Vehiculos ` (relation, espacio final, bidireccional con la BD de flota) es la fuente de verdad; `Vehiculos` (rich_text) queda como **espejo de texto que escribe el servidor** para el pipeline Make/PDF (que no cambia). UI con chips (sin texto libre, adiós bug de la coma final). Ambas propiedades verificadas por API en Notion (relación + espejo rich_text). Changelogs: [V1.5.0](CHANGELOG_V1.5.0.md) · [V1.5.1](CHANGELOG_V1.5.1.md) · [V1.6.0](CHANGELOG_V1.6.0.md) · [V1.6.1](CHANGELOG_V1.6.1.md) · [V1.7.0](CHANGELOG_V1.7.0.md) · [V1.7.1](CHANGELOG_V1.7.1.md))

---

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | React 18 + Vite 7 (`src/`) |
| Backend | Node.js + Express 4 — **monolítico en [server.js](server.js)** (~830 líneas) |
| BBDD | Notion API v1 (vía `src-server/services/notion.js`, sin SDK) |
| PDF + firma | Make.com vía webhook (`PARTES_DATOS_WEBHOOK_URL`) |
| Hosting | Vercel (config en [vercel.json](vercel.json), **la función se ejecuta en `iad1`** — verificado 2026-08-03 con `x-vercel-id: cdg1::iad1::…`; el `cdg1` que se leía es el edge que recibe la petición, no donde corre el código. `vercel.json` **no fija `regions`**) |
| Cliente API frontend | [src/services/notionService.js](src/services/notionService.js) (axios contra `/api/*` same-origin) |

**Tests:** `npm run test:smoke` — suite de humo con `node:test` (46 casos: flujos críticos + idempotencia en `src-server/tests/smoke/smoke.test.js`, middleware JWT en `auth.test.js`). Corre contra el mock, sin tocar Notion/Make. **Ejecutarla antes de cualquier merge.** Gotchas: `smoke.test.js` neutraliza `SUPABASE_URL` a propósito (con ella definida todo daría 401); `auth.test.js` fija el entorno **antes** del `require` porque `auth.js` captura la variable al cargarse. Sin `SUPABASE_URL`, el middleware NO autentica (modo desarrollo) — en producción el día del corte se añade `AUTH_OBLIGATORIA=true` para que esa ausencia sea un abort y no una API pública silenciosa. La verificación de frontend sigue siendo manual.

---

## Arquitectura — Flujo de datos

```
React SPA (src/App.jsx)
     │  fetch /api/*
     ▼
Express server.js
  ├─ axios → api.notion.com/v1     (lectura/escritura BBDDs)
  └─ axios → hook.eu2.make.com/... (enviar-datos → genera PDF, firma, OneDrive)
```

El servidor sanea las respuestas: **ningún endpoint `/api/*` devuelve datos económicos** (precios/importes). Esto es deliberado y debe mantenerse.

---

## Acceso a Notion del cliente

**REGLA CRÍTICA — SIN EXCEPCIONES:** Para cualquier consulta o verificación del workspace Notion de Copuno, usar **siempre la API de Notion directamente** con el token de `.env` (`NOTION_TOKEN`). Nunca usar el MCP de Notion — apunta al workspace privado de Javi, no al del cliente.

Ejemplo de consulta:
```bash
curl -s -X POST "https://api.notion.com/v1/search" \
  -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{"filter": {"value": "database", "property": "object"}}'
```

Esto aplica a: verificar propiedades, IDs de BDs, opciones de selects, estructura de relaciones, o cualquier dato del workspace antes de implementar.

---

## Bases de datos Notion

IDs hardcoded en [server.js#L27-33](server.js#L27-L33). Esquema detallado en [docs/notion-schema-detailed.md](docs/notion-schema-detailed.md).

| Constante en código | Nombre Notion | Propósito |
|---|---|---|
| `OBRAS` | Obras | Obras/proyectos activos |
| `JEFE_OBRAS` | Persona Autorizada | Jefes que pueden firmar |
| `EMPLEADOS` | Empleados | Plantilla, con categoría y estado |
| `PARTES_TRABAJO` | Partes de trabajo | **Tabla principal**: un parte = una jornada en una obra |
| `DETALLES_HORA` | Detalle Horas | Horas por empleado dentro de un parte (relación) |
| `VEHICULOS` | Vehículos  | Flota (title = `Matrícula`) — fuente del autocompletado del campo Vehículos (v1.6.0). OJO: el nombre de la BD lleva espacio final |

Propiedades críticas en **Partes de trabajo**:
- `Estado` (status) — controla qué se puede editar.
- `URL PDF` (url) + `AUX ID PDF Onedrive` (rich_text) — PDF generado por Make en OneDrive.
- `Firmar` (formula → URL externa `copuno.com/es/notion/?parteId=...`) + `TOCAR URL PARA FIRMAR` (rich_text) — entrada a la firma.
- `Documento Firmado` (files) — PDF firmado subido tras la firma.
- `Detalle Horas` (relation) — horas por empleado.
- `Notas` (rich_text).
- `Vehiculos ` (relation, **OJO espacio final** — v1.7.0) — relación bidireccional con la BD Vehículos (inversa `Partes de trabajo`). **Fuente de verdad** del parte↔flota.
- `Vehiculos` (rich_text, **SIN tilde** — v1.5.1) — **espejo de texto que escribe siempre el servidor** (matrículas `, `-separadas, sin coma final) a partir de la relación; es lo que consume Make → PDF. No editar a mano. En `enviar-datos` (v1.7.0) se **re-deriva** desde la relación justo antes del PDF, por si la relación se editó a mano en Notion (`partesTrabajo.sincronizarEspejoVehiculos`). Se descartó usar una fórmula Notion como espejo: no es versionable (la API no la crea) y obligaría a reapuntar el path de Make a `.formula.string`.

---

## Endpoints API

Todos en [server.js](server.js), prefijo `/api/*`. Referencia completa en [docs/API_REFERENCIA.md](docs/API_REFERENCIA.md).

| Método | Ruta | Línea |
|---|---|---|
| GET | `/api/health` | [server.js:292](server.js#L292) |
| GET | `/api/obras` | [server.js:305](server.js#L305) |
| GET | `/api/jefes-obra` | [server.js:336](server.js#L336) |
| GET | `/api/empleados` | [server.js:365](server.js#L365) |
| GET | `/api/empleados/estado-opciones` | [server.js:400](server.js#L400) |
| PUT | `/api/empleados/:id/estado` | [server.js:432](server.js#L432) |
| GET | `/api/empleados/buscar` | **Etapa 2 — F5** (`?q=texto`, server-side `title.contains`) + **Etapa 3 — F2** (`?id=NNNN`, filtro `number.equals`, maneja duplicados) |
| GET | `/api/vehiculos/buscar` | **v1.6.0** (`?q=texto`, mín. 2 chars, `Matrícula` title.contains contra BD Vehículos, cache corta) |
| GET | `/api/exportaciones/chorus` | **v1.8.0** (`?desde=&hasta=&cursor=`) — **paginado**: devuelve una página de Notion por llamada, el cliente itera hasta `done`. Ver [docs/EXPORT_CHORUS_CSV.md](docs/EXPORT_CHORUS_CSV.md) |
| GET | `/api/obras/:id/empleados` | [server.js:482](server.js#L482) — **Etapa 1 — C3:** query filtrada (sin N+1) |
| GET | `/api/obras/:id/firmantes-autorizados` | **Etapa 2 — F4.** Lee `OBRAS.Persona Autorizada` → JEFE_OBRAS, devuelve `{id, nombre, email, rol}` |
| GET | `/api/partes-trabajo` | [server.js:534](server.js#L534) |
| POST | `/api/partes-trabajo` | [server.js:580](server.js#L580) |
| GET | `/api/partes-trabajo/:id/empleados` | [server.js:755](server.js#L755) |
| GET | `/api/partes-trabajo/:id/detalles` | [server.js:795](server.js#L795) |
| GET | `/api/partes-trabajo/:id/estado` | [server.js:859](server.js#L859) |
| ~~GET (SSE)~~ | ~~`/api/partes-trabajo/:id/estado/stream`~~ | **Eliminado en v1.3.0** — sustituido por polling client-side en `App.jsx` contra `/api/partes-trabajo/:id/estado`. |
| POST | `/api/partes-trabajo/:id/enviar-datos` | [server.js:979](server.js#L979) — **dispara webhook Make** |
| POST | `/api/partes-trabajo/:id/rectificar` | **Rectificativos.** Crea parte nuevo (Borrador) a partir de uno **Firmado** o **Datos Enviados**: copia cabecera + detalles, enlaza vía relación reflexiva `Rectifica a`. |
| PUT | `/api/partes-trabajo/:id` | [server.js:1104](server.js#L1104) |
| GET | `/api/datos-completos` | [server.js:1342](server.js#L1342) |
| GET | `/*` (catch-all SPA) | [server.js:1376](server.js#L1376) |

---

## Flujos críticos — NO ROMPER

Cualquier cambio que toque estos flujos requiere validación previa con `@regression-checker`.

### 1. Firma digital del jefe de obra
- Make recibe el parte → genera PDF → escribe `URL PDF` en Notion → la fórmula `Firmar` construye la URL pública → el jefe la abre, firma → Make sube el resultado a `Documento Firmado`.
- En la app, el estado del parte transita a `firmado` (estado que **bloquea edición** — ver [server.js:1104+](server.js#L1104)).

### 2. Generación + almacenamiento del PDF
- Trigger: `POST /api/partes-trabajo/:id/enviar-datos` ([server.js:979](server.js#L979)).
- Flujo (C2 cerrado 2026-05-27): (1) PATCH estado → `Procesando` (lock optimista), (2) `axios.post(PARTES_DATOS_WEBHOOK_URL, payload)`, (3) PATCH estado → `Datos Enviados`.
- Si el webhook falla, el parte queda en `Procesando` (bloqueado — no se puede reenviar accidentalmente). Reconciliación manual en Notion.
- Si `PARTES_DATOS_WEBHOOK_URL` no está definida, **se simula** y se loguea (modo desarrollo).
- Make persiste el PDF en OneDrive y graba `URL PDF` + `AUX ID PDF Onedrive` en Notion.

### 3. Sincronización con Notion
- Toda escritura va vía servidor (nunca desde el cliente). El cliente lee con polling adaptativo (ver más abajo).
- Estados que **bloquean edición** en PUT (lógica en [server.js:1104+](server.js#L1104)): `firmado`, `datos enviados`, `procesando`.

### 4. Partes rectificativos
- `POST /api/partes-trabajo/:id/rectificar` crea un **parte nuevo** (Borrador) a partir de uno **Firmado** o **Datos Enviados** (constante `PARTE_RECTIFICABLES`), copiando cabecera + `Detalle Horas`, y lo enlaza al original mediante la relación reflexiva `Rectifica a ` (inversa `Rectificado por `). El original **no se modifica**.
- El campo `Notas` del rectificativo lleva siempre el prefijo `PARTE RECTIFICATIVO` (seguido de las notas originales si las había) — sirve para identificarlo de un vistazo en Notion además de por la relación.
- El rectificativo reutiliza íntegro el pipeline existente (flujos 1 y 2): el usuario corrige → `enviar-datos` → PDF → firma. Como tiene su propio `ID` único, su URL de firma y su fichero OneDrive no colisionan con el original.
- En la UI: botón "Rectificar" en el listado, en partes `Firmado` o `Datos Enviados` no rectificados → modal de confirmación propio → al confirmar abre el rectificativo en edición. Badges "Rectificativo"/"Rectificado" en el listado.
- **Dependencia manual (Notion):** requiere las propiedades `Rectifica a ` / `Rectificado por ` (relación reflexiva dual; **OJO: ambas tienen un espacio al final del nombre** — así están creadas en Notion y así las referencia el código) y la fórmula `Es Rectificativo` en la BD `Partes de trabajo`. **Dependencia manual (Make):** marcar el PDF como "RECTIFICATIVO" propagando `Es Rectificativo` por PARTES1-4→2-4→3-4 y añadiendo la variable a `Plantilla Parte.docx`. Sin el paso de Make el flujo funciona pero el PDF no lleva la marca visual. Detalle en [docs/DEUDA_TECNICA.md](docs/DEUDA_TECNICA.md).

---

## Escenarios Make (blueprints exportados)

**Dos carpetas, y la diferencia es importante:**

| Carpeta | Git | Qué es |
|---|---|---|
| [docs/blueprints-make/](docs/blueprints-make/) | ✅ **versionada** | Blueprints **saneados** (secretos → `<NOTION_TOKEN_REDACTADO>`). Es lo que da historial y `git diff` de los cambios hechos en la UI de Make. |
| [docs/Escenarios Make/](docs/Escenarios%20Make/) | ❌ `.gitignore` | Blueprints **crudos**, con el token Notion en claro (M9/E1). **Nunca commitear.** Solo se generan con `--raw`. |

**Flujo de trabajo — ejecutar SIEMPRE antes de auditar o diagnosticar el lado Make:**

```bash
python3 scripts/export-blueprints-make.py && git diff docs/blueprints-make/
```

Descarga los 9 escenarios de producción, sanea y escribe la copia versionable; el diff dice exactamente qué cambió desde la última vez. El script **aborta sin escribir nada** si detecta un patrón de secreto que no sabe sanear (fallo en seguro). Requiere `MAKE_TOKEN` en `.env`. Añade `--raw` solo si necesitas el crudo para reimportar en Make.

**La referencia canónica del lado Make sigue siendo producción (eu2), no el repo** — la copia versionada es una foto que solo está al día si has ejecutado el script. Consulta puntual por API:

```bash
set -a && . ./.env && set +a
curl -s -H "Authorization: Token $MAKE_TOKEN" \
  "https://eu2.make.com/api/v2/scenarios/5595847/blueprint"
```

Escenarios del team `2014883` (Copuno): PARTES1/4 `5595847` · PARTES2/4 `5595873` · PARTES3/4 `5682485` · PARTES4/4 `5682572` · Envío al cliente `6534716` · Limpieza temporales `5682602` (activo, no documentado). Inactivos: `9407545` (clon fix paginación de 1/4), `8558385` (WIP CSV horas), `7899695` (limpieza detalle horas).

**Gotchas de la API de Make** (verificados 28-jul): `PATCH /scenarios/{id}` con `{blueprint}` y `PATCH /data-structures/{id}` con `{spec}` **sí funcionan**. En cambio `PATCH /hooks/{id}` (campo `data.udt`) y `POST|PATCH /keys` (campo `parameters`) **devuelven 200 y descartan el cambio en silencio** — esas dos cosas solo se configuran desde la UI. Y la API rechaza con **403** el `User-Agent` por defecto de `urllib`: hay que mandar uno propio.

| Escenario | Archivo | Función |
|---|---|---|
| PARTES 1/4 | `PARTES1-4 - Recojo cabecera del parte.blueprint.json` | Recoge cabecera del parte desde Notion |
| PARTES 2/4 | `PARTES2-4  - Recupero detalles parte.blueprint.json` | Recupera detalles (horas por empleado) |
| PARTES 3/4 | `PARTES3-4  - Recibo datos del parte para generar el pdf.blueprint.json` | Rellena la plantilla .docx, la sube a OneDrive y pone el estado «Listo para firmar». **NO escribe `URL PDF`** (verificado contra el blueprint el 17-08 — la doc decía lo contrario durante meses) |
| PARTES 4/4 | `PARTES4-4  - Recojo Firma.blueprint.json` | Recibe la firma → convierte a PDF (pdf-co), lo sube a OneDrive y escribe `URL PDF` + `AUX ID PDF Onedrive` + `Estado: Firmado`. Un parte sin firmar NUNCA tiene `URL PDF` — es lo esperado, no un fallo del pipeline |
| Envío cliente | `Envío del parte al cliente - botón enviar email.blueprint.json` | Botón "Enviar email" → entrega el parte firmado al cliente |

Cuando se debuguee un fallo del lado Make (p. ej. `invalid_grant`, PDF no se genera, firma no aparece), comparar el escenario activo en Make.com contra el blueprint del repo permite detectar drift de configuración. Invocar `@notion-integration-inspector` para diagnosis cruzada Notion↔Make.

---

## Smart Polling (sincronización en tiempo cuasi-real)

Detalle completo en [docs/SMART_POLLING.md](docs/SMART_POLLING.md). Resumen:

- **v1.11.0 (F6)** — diseño vigente: el cliente pollea el listado a **12/20/30 s** (patrón cancelled + setTimeout encadenado, hash `id-estado-ultimaEdicion`, pausado con edición abierta y en background, kill-switch `POLL_ENABLED` en App.jsx) y el servidor hace **freshness-check** al expirar la foto: query mínima `last_edited_time after cursor` (~0,4 s) antes de repetir la query completa; TTL duro 5 min (`PARTES_TTL_DURO_MS`) cubre partes archivados. Poll del modal de detalles: 8/12/20 s.
- `CACHE_TTL_MS` (30 s) gobierna la foto fresca; `FIRMANTES_TTL_MS` (60 s) el cache de firmantes.
- El SSE no existe desde v1.3.0; el polling client-side estuvo MUERTO desde v1.3 hasta v1.11.0 (hallazgo C1 de la auditoría de julio).

**Queja histórica del cliente:** "la app no actualiza, hay que refrescar manual" — cerrada en v1.11.0 (C1 + BE-3). Si reaparece, invoca `@notion-integration-inspector` antes.

---

## Cómo trabajar

```bash
npm install
npm run dev          # Vite dev server (frontend solo, requiere proxy o server aparte)
npm run server       # Express en :3001 (sirve /api/* y /dist)
npm run dev:full     # build + server (modo producción local)
npm run build        # vite build → /dist
```

**Modo mock:** `USE_MOCK_DATA=true` o `NOTION_TOKEN=mock` → no llama a Notion, usa [mock/mockData.js](mock/mockData.js). Útil para desarrollo sin token.

**Deploy:** push a `master` → Vercel autodespliega. Variables de entorno en Vercel Dashboard.

---

## Variables de entorno

Plantilla completa en [env.example](env.example). Mínimas para arrancar:

| Variable | Default | Notas |
|---|---|---|
| `NOTION_TOKEN` | — | **Requerida** (o `USE_MOCK_DATA=true`). Integración interna Notion. |
| `PARTES_DATOS_WEBHOOK_URL` | — | Webhook Make. Sin él, `enviar-datos` se simula. |
| `PORT` | `3001` | En Vercel se asigna automáticamente. |
| `CACHE_TTL_MS` | `30000` | TTL del cache de catálogos del servidor (30 s). En tests se fuerza a `0`. |
| `PARTES_TTL_DURO_MS` | `300000` | F6: techo de vida de la foto de partes con freshness-check (5 min). |
| `FIRMANTES_TTL_MS` | `60000` | F6: cache por obra de firmantes autorizados (60 s). |
| `ALLOWED_ORIGINS` | (vacío = permitir todos) | CSV. **Configurada en producción (verificado 2026-08-17)**: `access-control-allow-origin` solo se emite para `https://app.copuno.com`; a orígenes ajenos no se les concede CORS. |
| `RATE_LIMIT_WINDOW_MS` | `900000` | 15 min. |
| `RATE_LIMIT_MAX` | `100` | Peticiones por ventana e IP. |
| `PARTES_WEBHOOK_TIMEOUT_MS` | `10000` | Timeout al webhook Make. |
| `USE_MOCK_DATA` | `false` | Modo desarrollo sin Notion. |

---

## Gotchas y cosas no obvias

- **Deuda técnica conocida documentada en [docs/DEUDA_TECNICA.md](docs/DEUDA_TECNICA.md).** Consultar antes de proponer mejoras "nuevas" — probablemente ya está catalogada con severidad y coste.
- **El servidor falla rápido sin `NOTION_TOKEN`** ([server.js:75-79](server.js#L75-L79)): `process.exit(1)` si faltan token y mock está off.
- **`vercel.json` usa `rewrites`**, no `routes` como dice [docs/DESPLIEGUE_VERCEL.md](docs/DESPLIEGUE_VERCEL.md). La doc está desfasada — el archivo manda.
- **Discrepancia de dominios en docs (abierta 2026-07-28, cerrada 2026-08-03):** durante meses convivieron tres nombres — `gestionpartes.copuno.com` (README), `partesobra.copuno.com` (CLAUDE.md, instrucciones DNS) y la URL de Vercel. **Ninguno de los dos subdominios llegó a crearse** (NXDOMAIN). Hoy el dominio real es **`app.copuno.com`**, activo y con certificado. Lección: la doc declaraba una intención como si fuera un hecho — verificar con `nslookup`/`curl` antes de dar un dominio por bueno.
  - ⚠️ **La misma trampa sigue viva con la RUTA**: la doc decía "`app.copuno.com/partes`" y esa ruta **da 404**. Que el dominio ya exista no significa que la ruta exista. Al citar una URL, citar la que responde.
- **Un dominio, un módulo por ruta (ADR-005).** La plataforma vive bajo `app.copuno.com` y cada módulo será una ruta de primer nivel (`/partes`, `/vehiculos`, `/almacen`). Motivo principal más allá del DNS: **Supabase Auth liga la sesión al origen**, así que un único dominio = un único login para todos los módulos. No crear subdominios por app.
  - **Estado 2026-08-03**: el dominio existe, **el espacio de nombres no**. Partes se sirve en `/` y es el único módulo. La migración a `/partes` + portal en `/` está descrita en ADR-005 y no se ha hecho: mientras haya un solo módulo no aporta nada al usuario, y hacerla tiene coste (rutas, enlaces guardados por los usuarios, `firma-parte.html`).
- **Mover la app de `/` a `/partes` no es un alias DNS.** Hay que tocar el `base` de Vite, el catch-all SPA de [server.js](server.js) y las rutas de assets de [vercel.json](vercel.json). Y antes del corte, revisar el flujo de firma: `Firmar` es una fórmula Notion que construye una URL externa y Make escribe sobre ella.
- **Saneado económico:** los endpoints `/api/*` redactan precios/importes antes de devolver. No "arregles" esto pensando que es un bug.
- **8 h por defecto al seleccionar empleado** (v1.0.2, [src/App.jsx](src/App.jsx)). Es UX intencional.
- **El `Documento Firmado` lo sube Make, no el frontend.** Si ves que falta, mira el escenario Make.
- **Errores `invalid_grant` en Make** suelen ser token Notion expirado/rotado o conexión OAuth de Make caducada. Diagnóstico: `@notion-integration-inspector`.
- **`server.js` es un monolito de ~1.400 líneas.** No es bonito pero funciona. Refactor mayor está fuera del retainer (proyecto aparte).
- **El editor de Make trunca los paths IML con caracteres no-ASCII** (tildes, etc.) al teclear o pegar en sus campos de mapeo — el motor los soporta, el editor no. Por eso la propiedad es `Vehiculos` sin tilde (v1.5.1). Regla: **propiedades Notion que viajen a Make, siempre sin tildes ni caracteres especiales**; para ediciones masivas de escenarios usar export → editar JSON → import blueprint.
- **JSON escrito a mano en Make → envolver SIEMPRE el texto libre en `escapeJSON()`.** Los módulos HTTP con Body `Raw` + `application/json` construyen el JSON como plantilla de texto: cualquier salto de línea real (`\n`, 0x0A) procedente de Notion (típicamente `Notas`) invalida el JSON y el webhook receptor responde `400 Bad control character in string literal in JSON at position N`. **No sirve `replace(texto; "\n"; " ")`**: el editor de Make interpreta ese `"\n"` como los dos caracteres `\`+`n`, no como el byte de control, así que no sustituye nada. Ha reincidido tres veces (DEUDA_TECNICA M2, M4, M5). En módulos nuevos, preferir **JSON → Create JSON** con Data structure, que escapa solo.
  **Excepción — no escapar nunca lo que ya es estructura JSON:** `"Detalle del parte": [{{2.text}}]` en PARTES2/4 viene del *Text aggregator* y ya es un array JSON; envolverlo en `escapeJSON()` escaparía sus corchetes y comillas y rompería el body. La regla aplica a **cadenas de texto libre**, no a fragmentos JSON pre-construidos. Tampoco a numéricos (llevan `ifempty(…; 0)`) ni a `Fecha Parte` / `ID Pag Notion Parte`.
- **Qué escenarios Make escriben JSON a mano** (los únicos expuestos al fallo anterior): **PARTES1/4** (`5595847`, módulo #249) y **PARTES2/4** (`5595873`, módulo #37). **PARTES3/4** (`5682485`) y **PARTES4/4** (`5682572`) usan mapeo nativo de campos (Drive / PDF / Notion) y no están afectados.
- **Si cambias el payload de un tramo, redetermina la estructura del webhook receptor.** Un campo nuevo que el webhook no conoce aparece como *variable desconocida* y **resuelve vacío en silencio**: sin error, sin ejecución incompleta, sin log — sólo se detecta mirando el PDF final. Pasó con `Vehiculos del parte` entre PARTES1/4 y PARTES2/4 (DEUDA_TECNICA M8): las matrículas se perdían en el tramo 2/4 y el PDF salía sin ellas, pese a que la prueba E2E de I6 había pasado semanas antes. Regla: tras tocar el payload, *Redetermine data structure* en el receptor + **validación E2E mirando el PDF**, no sólo que el escenario termine en verde. **Actualización 28-jul (E3):** los webhooks de 2/4 y 3/4 ya tienen data structure **declarada y obligatoria** (`608077`/`608078`, ver [docs/E3_CONTRATO_WEBHOOKS.md](docs/E3_CONTRATO_WEBHOOKS.md)) — el vacío silencioso pasó a ser un **400 en la puerta**. La regla operativa ahora es de orden: para añadir un campo al pipeline, **primero ampliar la Data structure del receptor, después el payload del emisor**; al revés, el emisor recibe 400 (comportamiento diseñado). La asociación estructura↔webhook solo puede hacerse en la UI (la API ignora `data.udt` en silencio).
- **Arreglar un escenario Make NO arregla sus ejecuciones ya encoladas.** Tanto las *ejecuciones incompletas* como los bundles de la IEQ guardan **una copia del blueprint vigente en el momento del fallo**: al reintentarlos se reejecuta esa copia, no la plantilla corregida, y vuelven a fallar igual. Make no ofrece "reintentar con la versión actual". Tras corregir un mapeo, la recuperación es **relanzar el origen** (webhook desde Notion, o reenviar desde la app) para que la ejecución nazca de cero, y después limpiar la cola. Confirmado en DEUDA_TECNICA M4 (IEQ) y M5 (cola de incompletas).
- **Los escenarios Make de producción viven en la org del CLIENTE**, no en la personal: `eu2.make.com`, **organization ID `4157465`**, **team ID `2014883`** (PARTES1/4 = escenario `5595847`). **OJO: `2014883` es el TEAM, no la organización** — es el número que aparece en las URLs de escenarios (`/2014883/scenarios/...`) y durante meses se documentó erróneamente como org ID; los endpoints de organización y de team esperan IDs distintos, así que usar el equivocado devuelve 403/404 sin explicar por qué. Los duplicados en la org personal *Javi & Tamara* (`eu1.make.com`, org `581441`, PARTES1/4 = `3218313`) son **backup** y pueden tener drift respecto a producción: no valen como evidencia de diagnóstico. Aplicar los fixes sobre la org del cliente y verificar en cuál se está antes de tocar nada.
- **Las zonas de Make están aisladas**: un token de `eu1` no ve absolutamente nada de `eu2` (el endpoint base es distinto, `eu1.make.com/api/v2` vs `eu2.make.com/api/v2`). No es un problema de permisos y no se arregla con scopes — hacen falta dos tokens y, en Claude Code, dos servidores MCP separados (`make-personal` / `make-copuno`) para que la elección de organización sea una elección de herramienta y no un parámetro olvidable.
- **Nombres de propiedad Notion con espacios al final:** algunas propiedades tienen un espacio final en su nombre (`'Rectifica a '`, `'Rectificado por '`, `' Email'`, `'Horas Encargado '`, `'Horas Oficial 2ª '`). Hay que referenciarlas **exactamente** así o la lectura/escritura falla en silencio. Verificar siempre el nombre real vía API antes de usarlo.
- **Banner de actualización:** la app compara `__APP_VERSION__` (embebida en build) con `version` de `/api/health` cada **1 minuto**; si difieren, muestra el banner. Por eso **cada deploy necesita un bump de versión** en `package.json` (ver Convenciones).
- **Smart Polling en modal de detalles (v1.3.0):** usa polling adaptativo client-side (3 s/8 s/15 s) contra `GET /api/partes-trabajo/:id/estado`. El endpoint SSE ya no existe — devuelve 404 si se llama. El polling vive en `App.jsx` en el `useEffect` con `estadoPollRef`.
- **Google Drive "desmaterializa" binarios de `node_modules` y macOS los mata con SIGKILL (exit 137).** El repo vive en una ruta de Google Drive File Provider; cuando Drive descarga contenido a la nube para liberar espacio, ejecutar un binario desde ahí (típicamente `@esbuild/darwin-arm64/bin/esbuild` al hacer `npm run build`) muere al instante con `Error: The service was stopped` / exit 137, **aunque la firma de código sea válida**. Diagnóstico: el mismo binario funciona copiado a `/tmp`. Arreglo: re-hidratar releyendo los ficheros (`find node_modules -type f -print0 | xargs -0 cat > /dev/null`) o marcar la carpeta "Disponible sin conexión" en Drive. El primer build tras re-hidratar tarda varios minutos; los siguientes vuelven a ser rápidos. (Detectado 2026-07-28, v1.8.0.)

---

## Documentación técnica de referencia

| Documento | Cuándo consultarlo |
|---|---|
| [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) | **Antes de tocar lectura, escritura o caché.** La sección 3.1 lista los mecanismos de rendimiento vigentes (freshness-check, invalidación, lotes con rollback, parche optimista, caché local) y qué se rompe al alterarlos |
| [docs/RESULTADOS_RENDIMIENTO_2026-08.md](docs/RESULTADOS_RENDIMIENTO_2026-08.md) | Qué se hizo en agosto y qué se consiguió, con antes/después medido. Es el documento que se enseña (QBR, cliente, terceros) |
| [docs/INFORME_UX_RENDIMIENTO_2026-08-17.md](docs/INFORME_UX_RENDIMIENTO_2026-08-17.md) | Diagnóstico y línea base del 17-08. **Foto del ANTES** — no describe el estado actual |
| [docs/DEUDA_TECNICA.md](docs/DEUDA_TECNICA.md) | Antes de proponer cualquier mejora: probablemente ya está catalogada con severidad y coste |

## Decisiones de arquitectura (ADR)

Viven en [docs/adr/](docs/adr/). Antes de proponer un cambio estructural, **leer el ADR que le
corresponda**: varias de estas preguntas ya se han evaluado y descartado con su motivo.

| ADR | Qué decide | Estado |
|---|---|---|
| [001](docs/adr/ADR-001-notion-como-bbdd.md) | Notion como BBDD, y los **5 criterios** que activarían migrar | Vigente |
| [002](docs/adr/ADR-002-capa-abstraccion-datos.md) | Capa `data.js` que permite cambiar de motor sin tocar endpoints | Implementado |
| [003](docs/adr/ADR-003-supabase-destino-migracion.md) | Supabase como destino **cuando** se active la migración | Vigente, no ejecutado |
| [004](docs/adr/ADR-004-idempotencia-enviar-datos.md) | Idempotencia de `enviar-datos` | Implementado |
| [005](docs/adr/ADR-005-dominio-y-espacio-de-nombres.md) | `app.copuno.com`, un módulo por ruta | Dominio ✅ / rutas ⬜ |
| [006](docs/adr/ADR-006-autenticacion-unica-autorizacion-por-modulo.md) | Auth única de plataforma + autorización por módulo | Desarrollado, sin activar |
| [007](docs/adr/ADR-007-sincronizacion-notion-supabase.md) | Sincronización Notion ↔ Supabase | 🟡 **Borrador — evaluado y APLAZADO** |

⚠️ **Sobre el 007**: la idea de "la app lee y escribe en Supabase y se sincroniza con Notion" ya se
evaluó (3-ago-2026) y se aplazó. Antes de retomarla hay que hacer **C2 y C3** de la auditoría: hoy
el único criterio activado del ADR-001 es "listados >3 s", y se cumple por el N+1 y por traer 934 KB
sin `filter_properties` — con **190 partes**, no por volumen. Migrar ahora sería cambiar de base de
datos para no optimizar una consulta. Y si algún día se ejecuta, la variante por defecto es
**unidireccional** (Supabase como caché de lectura): la bidireccional exige polling contra Notion,
que es justo el límite que se quería esquivar.

## Subagentes disponibles

Definidos en [.claude/agents/](.claude/agents/). Invocar con `@<nombre>` cuando aplique:

| Agente | Cuándo invocarlo | Tools |
|---|---|---|
| [`@senior-architect-auditor`](.claude/agents/senior-architect-auditor.md) | Antes de refactors mayores, al planificar nuevos módulos o cuando se necesita un análisis arquitectónico estructurado con severidad + lente ROI. | Read, Grep, Glob, Bash (opus) |
| [`@notion-integration-inspector`](.claude/agents/notion-integration-inspector.md) | Antes de tocar la capa Notion: esquema, queries, sync, `invalid_grant`, "app no actualiza". | Read, Grep, Glob, Bash |
| [`@regression-checker`](.claude/agents/regression-checker.md) | **Antes de mergear cualquier cambio.** Verifica firma, PDF y sync Notion. | Read, Grep, Glob, Bash |
| [`@scope-guardian`](.claude/agents/scope-guardian.md) | Cada petición nueva del cliente Copuno: ¿retainer o proyecto aparte? | Read |

**Convención:** los tres son read-only. Para implementar, sale el agente principal con los hallazgos.

---

## Convenciones del proyecto

- **Idioma:** español en docs, comentarios, nombres de propiedades Notion y mensajes UI. Código JS estándar (camelCase, inglés en identificadores cuando ya es así).
- **`.env`** está en `.gitignore`. **Nunca** commitear tokens.
- **Versionado:** SemVer en [package.json](package.json) y `CHANGELOG_V*.md` por release. **Cada deploy debe incluir un bump de versión acorde al peso del cambio:** `patch` (X.X.+1) para fixes y ajustes menores, `minor` (X.+1.0) para funcionalidad nueva sin romper compatibilidad, `major` (+1.0.0) para cambios estructurales o breaking. El banner de actualización en la app depende de este bump — sin él, los usuarios no verán la notificación de nueva versión.
- **Deuda técnica:** **siempre** que se añada, cierre o reclasifique un hallazgo en [docs/DEUDA_TECNICA.md](docs/DEUDA_TECNICA.md), actualizar (1) el cambio, (2) la fecha "Última edición" del bloque superior y (3) una nueva entrada en la sección "Historial de cambios" al final del documento. Sin excepciones — la cronología es la utilidad del archivo.
- **Manual/web de documentación:** [docs/manual/index.html](docs/manual/index.html) es un artefacto **derivado** (la fuente de verdad siguen siendo este archivo y `docs/*`) y hay que **actualizarlo cuando proceda**: cambios de UI o de flujo de usuario (pantallas, botones, estados), endpoints añadidos/retirados, cambios del pipeline Make, releases con impacto visible o hitos de deuda técnica. Para regenerar capturas: **`node scripts/generar-capturas.mjs`** (versionado desde el 17-08; orquesta los DOS builds — el login exige build CON `VITE_SUPABASE_*`, el resto build sin ellas + server mock — y embebe los base64 localizando cada `<figure>` por su `alt`); después `python3 docs/manual-cliente/generar.py` deriva `public/manual.html` (revisar antes `VERSION`/`FECHA_DOC`/`CAPTURAS` de ese script: el orden de la lista es el ORDEN DE APARICIÓN en el HTML) y por último `npm run build` normal para dejar `dist/` correcto. La sección interna (§22-25) debe retirarse si el documento se comparte con el cliente.
- **Despliegue:** trunk-based en `master`. No hay `develop`. Vercel preview en cada PR.
- **No introducir librerías nuevas sin necesidad real** — el stack es deliberadamente sencillo.

---

## Cliente — contexto rápido

- Empresa de construcción con delegaciones (Madrid base, planes de Cataluña y Noruega — fuera de scope del retainer).
- Usuarios: jefes de obra (firman partes desde móvil/tablet), oficina (consulta).
- Punto de contacto: Efrén (técnico/operativo del lado cliente).
- Cualquier ampliación grande del sistema (módulos nuevos, integraciones Chorus/OneNote/WhatsApp, portal del empleado) es **proyecto aparte**. Ver [.claude/scope-rules.md](.claude/scope-rules.md).
