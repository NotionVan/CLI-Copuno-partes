# Changelog v1.10.2 — F5: resiliencia multi-usuario y conexión honesta

**Fecha:** 2026-08-17
**Tipo:** patch — robustez de servidor y claridad ante fallos, sin funcionalidad nueva
**Contexto:** fase 5 del plan pre-demo ([docs/INFORME_UX_RENDIMIENTO_2026-08-17.md](docs/INFORME_UX_RENDIMIENTO_2026-08-17.md)). Prerrequisito de F6 (revivir el polling).

## Servidor

- **BE-8 · Rate limiting en dos capas** ([server.js](server.js)): limiter **grueso por IP** (5.000/15 min, `RATE_LIMIT_IP_MAX`) delante de la autenticación — protege la verificación JWT del martilleo anónimo — y limiter **fino por usuario autenticado** (`keyGenerator` por `req.usuario.id`, 1.000/15 min) detrás. Antes el cupo era por IP: detrás del NAT de la central, 3 pestañas agotaban el cupo de toda la oficina — el escenario exacto de la demo de septiembre.
- **BE-7 · Semáforo global hacia Notion** ([src-server/services/notion.js](src-server/services/notion.js)): máximo 5 peticiones en vuelo (cola FIFO, liberación garantizada en `finally`). Notion corta a ~3 req/s por integración y los bursts (arranque + polling concurrente) producían 429 en cascada.
- **BE-6 · Los 429 de Notion dejan de ser 500**: reintento único con `Retry-After`+jitter **solo en lecturas** (GET y `POST /query` — nunca escrituras: su idempotencia vive en capas superiores); si persiste, el servidor responde **503 + `Retry-After`** con mensaje humano («El sistema está ocupado…») en los 8 GET calientes. Un 429 ya no aparece como «error del servidor» ni el cliente lo reintenta a ciegas.
- **BE-2 · 304 habilitado** ([vercel.json](vercel.json)): `no-store` → `private, no-cache, must-revalidate`. El navegador revalida con el ETag que Express ya generaba: un refresco sin cambios pasa de descargar el payload completo a **304 con 0 bytes** (verificado en local). `private` mantiene la prohibición de caches compartidas (los datos llevan DNI/teléfono).
- **BE-15 · `express.static` al final**: cada petición `/api/*` pagaba un `stat()` de disco antes de llegar a su ruta.

## Interfaz

- **UX-53 · La app ya no miente sobre la conexión**: escucha `online`/`offline` del navegador y, además, **2 fallos seguidos del polling** ponen la píldora en «Sin conexión — no guardes todavía» aunque el sistema no haya detectado la caída. Al volver la red, revalida solo. **Verificado en vivo**: matar el servidor con la app abierta → píldora «Sin conexión» en ~25 s; los fallos transitorios ya no machacan las opciones de estado cargadas.
- **UX-41 · Errores en cristiano**: fuera «rate limit excedido», «timeout of 20000ms exceeded» o «Token de Notion inválido» — ahora: «No hay conexión ahora mismo… lo que habías rellenado sigue aquí», «El sistema está ocupado, espera unos segundos», «Avisa a oficina». El detalle técnico queda en consola.
- **UX-47 · El login distingue por qué falla**: sin cobertura («Comprueba la cobertura…») y demasiados intentos («Espera un minuto») ya no se disfrazan de «email o contraseña incorrectos» — que llevaba a restablecer contraseñas sin necesidad.

## Flecos de F4 cerrados (revisión de edge cases)

- **UX-4b · Cinturón contra el vaciado silencioso**: guardar una edición con 0 empleados cuando el parte original los tenía exige confirmación explícita («se eliminarán las horas que tenía registradas») — cubre el caso de detalles que llegan vacíos sin error (fallo estilo M8).
- Variable muerta `desdeCacheLocal` eliminada.
- Anotado sin implementar (prioridad baja): abort real de peticiones descartadas por la guarda de secuencia — el efecto UX ya está cubierto; el ahorro de red es marginal con timeout de 20 s.

## Verificación

- ETag/304 verificado en local (segunda petición → `304 0B`).
- UX-53 verificado E2E en navegador (píldora «Conectado» → «Sin conexión» tras matar el servidor).
- `npm run test:smoke` — 46/46. `@regression-checker` sobre los 3 flujos críticos antes del merge (semáforo sin deadlock, retry solo en lecturas, orden de middlewares auth/limiter, contrato 409 de la UI).
