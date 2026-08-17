# Changelog v1.11.0 — F6: la lista se actualiza sola (polling revivido + freshness-check)

**Fecha:** 2026-08-17
**Tipo:** minor — funcionalidad restaurada (sincronización automática del listado) sin romper compatibilidad
**Contexto:** fase 6 y última del paquete pre-demo ([docs/INFORME_UX_RENDIMIENTO_2026-08-17.md](docs/INFORME_UX_RENDIMIENTO_2026-08-17.md)). Cierra la queja recurrente del cliente: «la app no actualiza, hay que refrescar manual».

## Lo que nota el usuario

- **La lista de partes se actualiza sola.** Si un compañero crea, edita o firma un parte, aparece en el listado en ~12-30 s sin tocar nada. Llevaba **muerto desde v1.3** por un `ReferenceError` silencioso con el catch vacío (hallazgo C1) — el listado solo se refrescaba al entrar o con el botón Refrescar.
- **Editar es seguro**: mientras hay una edición abierta el refresco automático se pausa (no puede pisar el formulario) y se reanuda al cerrar.
- **En segundo plano, silencio**: con la pestaña oculta la app no hace ninguna petición (listado, modal, opciones de estado y chequeo de versión pausados — FE-27/28); al volver, se refresca al instante.
- **El indicador de sincronización ya no miente** (UX-46): el modal explica en lenguaje de usuario que la lista se actualiza sola y muestra la hora de la última actualización; fuera los «modos de 3/8/15 segundos» que describían un sistema que no corría.

## Cómo (servidor) — freshness-check

- Nuevo `partesTrabajo.hayCambiosDesde` ([src-server/services/notion.js](src-server/services/notion.js)): cuando la foto de partes del cache expira, antes de repetir la query completa (~1,5-2,5 s) se pregunta a Notion si algo cambió desde la foto — query con filtro **a nivel timestamp** `last_edited_time` (inmune a renombres, lección I9), `page_size` 1, ~0,4 s medidos. Sin cambios → se extiende el TTL de la foto.
- **Cursor** = `last_edited_time` más reciente de la foto (inmune a drift de reloj del servidor). **TTL duro** de 5 min (`PARTES_TTL_DURO_MS`): techo que cubre los partes archivados (invisibles para el check) y el redondeo al minuto de Notion.
- Las escrituras desde la app siguen invalidando la foto entera (BE-3) — el check no puede ocultar un cambio propio. Con Notion saturado (429), se sirve la foto algo vieja en vez de un 503.
- **I-C · Firmantes**: expansión de `Persona Autorizada` en paralelo (`Promise.all` acotado por el semáforo global) + cache de 60 s por obra. Preparado para cuando el cliente pueble los firmantes de las 56 obras.

## Cómo (cliente)

- Polling reescrito con el patrón del poll del modal (el único que funcionaba): guarda `cancelled` + `setTimeout` encadenado, hash-guard (`setDatos` solo si la foto cambió — los `useMemo` de la consulta sobreviven al tick), sin tick inmediato, cadencia 12/20/30 s.
- La edición abierta viaja por ref (`onEdicionAbierta` → `edicionAbiertaRef`) — una closure con estado habría capturado valores stale (la causa raíz del C1 original).
- Kill-switch `POLL_ENABLED` (constante, apagado = 1 línea + deploy patch).
- El poll del modal de detalles baja a suelo 8 s (8/12/20) — deja de competir con el listado.
- Cache local (F4) actualizado en cada cambio real detectado y en el reconcile de visibilidad: la próxima apertura pinta la foto más fresca.
- UX-53 integrado: 2 ticks fallidos → «Sin conexión — no guardes todavía».

## Verificación

- **Contra Notion real** (server local): query completa 1,51 s → cache 4 ms → check sin cambios **0,43 s** → edición real en Notion detectada por el check → query completa 1,71 s → siguiente check 0,36 s.
- **E2E en navegador** (mock): ticks a 9,7/21,7 s (cadencia 12 s); un parte creado por «otro usuario» vía API **apareció solo** en el listado; con la edición abierta, **0 peticiones** de listado en 26 s; al cerrar, reanudación (2 ticks en 26 s); consola limpia.
- **UX-40 verificado y DESCARTADO** con evidencia: 2 ediciones consecutivas de un parte de la obra TEST reproduciendo el round-trip exacto de la UI (`new Date(dto).toISOString().slice(0,16)` → PUT → releer) dejan fecha y hora idénticas — no hay corrimiento de día. El parte de prueba y su detalle quedaron archivados.
- `npm run test:smoke` — **48/48**: suite nueva [freshness.test.js](src-server/tests/smoke/freshness.test.js) (respuesta al gap señalado por `@regression-checker`) que ejercita las 4 ramas del freshness-check con TTL real — cache fresco sin check, check sin cambios → foto extendida, check con cambios → query completa, **429 en el check → foto stale en vez de error**, TTL duro → query directa, y la exención de `?desde&hasta`.
- `@regression-checker` sobre los 3 flujos críticos: `enviar-datos` y firma sin diff, `invalidarPartes()` verificado en las 3 transiciones (el check nunca puede ocultar una escritura de la app). Sus 5 casos manuales, ejecutados: edición directa en Notion detectada por el check (query completa al siguiente GET), parte de otro usuario visible sin refresco, **StrictMode dev sin timers duplicados** (3 ticks en 40 s a cadencia exacta 12 s), background 35 s = 0 peticiones, reconcile inmediato al volver a primer plano.

## Documentación

- [docs/SMART_POLLING.md](docs/SMART_POLLING.md) reescrito entero (v3): describía SSE (eliminado en v1.3.0) y cadencias que no corrían.
