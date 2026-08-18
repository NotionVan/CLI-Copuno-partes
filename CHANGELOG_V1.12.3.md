# Changelog v1.12.3 — Telemetría multi-instancia + rate_limit_reason (P2)

**Fecha:** 2026-08-18
**Tipo:** patch — solo observabilidad, cero cambio funcional
**Contexto:** paso previo barato al «escalón 2» del [monográfico de caché](docs/CACHE_NOTION_INDUSTRIA_2026-08.md): medir cuántas instancias lambda conviven realmente y con qué frecuencia se pisan, antes de invertir los 2-3 días del KV compartido.

## Qué se instrumenta

- **`INSTANCE_ID`** (8 hex aleatorios por instancia): visible en `/api/health` (`inst`) y en todos los logs estructurados. Muestrear el health en ráfaga o contar `inst` distintos por franja en los logs de Vercel dice cuántas instancias hay vivas.
- **`partes_cache`**: evento por cada camino no-trivial del freshness-check del listado (`frio` / `check-sin-cambios` / `check-con-cambios` / `stale-por-429` / `ttl-duro` / `check-fallido`). El hit fresco no se loguea (saturaría). La frecuencia de `frio` + `query-completa` por `inst` mide el solapamiento multi-instancia.
- **`enviar_datos_entrada`**: `{inst, parteId, idem: miss|in_flight|complete}` al entrar al endpoint. **Dos `miss` del mismo parte con `inst` distintos en segundos = la idempotencia in-memory se repartió entre instancias** (el riesgo de doble webhook a Make que el escalón KV cierra).
- **P2 · `rate_limit_reason`** ([notion.js](src-server/services/notion.js) `mapNotionError`): los 429 de Notion ahora dicen si se excedió la cuota de la CONEXIÓN o la del WORKSPACE (compartida con Make) — en el log, en el mensaje y como `err.rateLimitReason`.

## Cómo leerlo (tras 2-3 días de uso real)

Vercel → Logs → filtrar `partes_cache` o `enviar_datos_entrada`. Preguntas que responde: ¿cuántos `inst` distintos por hora laboral? ¿cuántas queries completas a Notion por hora? ¿algún `enviar_datos_entrada` duplicado cross-instancia? Con eso se decide si el escalón KV es urgente para septiembre o va en octubre.

## Verificación

Local (mock): `inst` en health, `partes_cache` con caminos `frio`/`check-con-cambios`, `enviar_datos_entrada` con `miss`→`complete` en el replay. Smoke 59/59.
