# Changelog v1.9.3 — F2: dieta de payload Notion + fix de nombres de empleados

**Fecha:** 2026-08-17
**Tipo:** patch — rendimiento de servidor y corrección de un bug de producción, sin cambios de contrato API
**Contexto:** fase 2 del plan pre-demo ([docs/INFORME_UX_RENDIMIENTO_2026-08-17.md](docs/INFORME_UX_RENDIMIENTO_2026-08-17.md)). Cumple la precondición 1 del [ADR-007](docs/adr/ADR-007-sincronizacion-notion-supabase.md).

## Corregido — incidente activo de producción

- **Los nombres de empleados salían vacíos y la búsqueda por nombre devolvía error** ([src-server/services/notion.js](src-server/services/notion.js)): la propiedad título de la BD Empleados fue renombrada en Notion (de `Nombre Completo` a cadena vacía) y el mapper leía por nombre → `nombre: ''` en todos los empleados, y el filtro `'Nombre Completo'` → 400 de Notion → 500 al usuario. **Verificado en vivo antes del fix** (100/100 nombres vacíos; buscar → error) y es con toda probabilidad el error que se vio en la demo ante la central. Fix estructural: nuevo helper `titleDe(page)` que localiza la propiedad título **por tipo** (inmune a futuros renombres) y búsqueda por el ID canónico `'title'`.
- **El campo `cliente` del parte siempre llegaba vacío**: el mapper leía `'AUX Cliente - texto-'` y la propiedad real es `'AUX Cliente - texto- '` (espacio final). Corregido; el golden-diff muestra el campo poblado en 99/100 partes (p. ej. «Verosa»).

## Rendimiento — `filter_properties` en todo el catálogo (BE-1/C3)

Nueva constante `PROPS_CATALOGO` (property-IDs verificados por API el 17-08) aplicada con el patrón `conProps()` ya probado en la exportación Chorus:

- `obras.listar`, `jefesObra.listar`, `empleados.listar`, `empleados.buscarPorIdCopuno`, `empleados.buscarPorNombre`, `obras.empleadosDeObra`, `partesTrabajo.listar`, el `GET /pages` de `partesTrabajo.estado` (el más poleado de la app) y el de cada firmante.
- **Medido contra Notion real**: partes 935 KB → **357 KB** (−62 %); empleados 652 KB → **171 KB** y 2,9 s → **0,7 s** (−74 %). El ahorro es Notion→lambda (el DTO al navegador no cambia): menos tiempo de query, menos parseo y menos presión sobre el límite de 3 req/s.
- Regla mantenida: la lista de IDs de cada BD = exactamente las propiedades que lee su mapper.

## Rendimiento — caches de servidor

- **BE-5/C4**: `estado-opciones` (poleado cada 10-30 s por pestaña, datos casi inmutables) ahora con cache propio de **10 min** (`ESTADO_OPCIONES_TTL_MS`).
- **BE-4a**: `/api/datos-completos` con `getCache`/`setCache` (clave ya cubierta por la invalidación tras escrituras de v1.9.2) — listo para ser el endpoint de arranque en F3.

## Verificación

- **Golden-diff contra Notion real** (server local, antes/después): `obras`, `jefes-obra` y `estado` **idénticos byte a byte**; `empleados` con los nombres recuperados; `partes-trabajo` difiere únicamente en el campo `cliente` (la corrección). Cero cambios de forma en los DTOs.
- `npm run test:smoke` — 46/46.
- `@regression-checker` sobre los 3 flujos críticos (firma / PDF / sync) antes del merge.
