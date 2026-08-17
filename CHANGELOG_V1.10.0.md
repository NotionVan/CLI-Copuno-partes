# Changelog v1.10.0 — F3: arranque consolidado y percepción inmediata

**Fecha:** 2026-08-17
**Tipo:** minor — cambia el comportamiento del arranque y añade un parámetro nuevo a la API, sin romper compatibilidad
**Contexto:** fase 3 del plan pre-demo ([docs/INFORME_UX_RENDIMIENTO_2026-08-17.md](docs/INFORME_UX_RENDIMIENTO_2026-08-17.md)).

## Cambios

- **P6/BE-4b · El arranque pasa de 9 peticiones a 3** ([src/services/notionService.js](src/services/notionService.js), [src/App.jsx](src/App.jsx)): `getDatosCompletos()` hace UNA llamada a `/api/datos-completos` (que ya tenía cache e invalidación desde v1.9.2-v1.9.3, y ejecuta las 4 queries en una sola lambda) con **fallback automático al camino antiguo de 4 llamadas** si el endpoint consolidado falla. Eliminados los dos `checkConnectivity` redundantes del camino crítico (el health queda solo en el chequeo de versión y en el botón Refrescar) y el `poll()` inmediato duplicado de estado-opciones.
- **P2 · El menú principal se pinta sin esperar a Notion** ([src/App.jsx](src/App.jsx)): `PantallaPrincipal` es estática y estaba atrapada tras el gate de carga global. Medido en navegador: **menú interactivo en ~160 ms** (antes, 4-8 s de spinner). Solo Consultar/Crear esperan datos.
- **P3/UX-51 · App-shell y fin de las pantallas en blanco** ([index.html](index.html), [src/auth/AuthGate.jsx](src/auth/AuthGate.jsx)): logo + spinner visibles desde el primer frame (antes de que cargue el JS), `preconnect` a Supabase y `preload` del logo; AuthGate pinta el mismo shell mientras verifica la sesión (antes devolvía `null` = blanco) y **con `.catch()`**: un fallo de red en `getSession()` ya no deja la pantalla en blanco para siempre — cae al login.
- **BE-13a · Ventana de fechas opcional en partes** (`GET /api/partes-trabajo?desde=AAAA-MM-DD&hasta=AAAA-MM-DD`): aditivo y validado; sin parámetros el comportamiento es idéntico (100 más recientes, con cache). Verificado contra Notion real (agosto → 1 parte). Es la base para acotar el listado por defecto en octubre, con OK del cliente.

## Verificación

- Navegador contra mock: **menú en 158 ms**; arranque con exactamente **3 peticiones** (`/api/health` del banner de versión, `/api/datos-completos`, `/api/empleados/estado-opciones`).
- Ventana de fechas contra Notion real: `?desde=2026-08-01&hasta=2026-08-17` → 1 parte (correcto); sin ventana → 100 (histórico intacto).
- `npm run test:smoke` — 46/46. Sin cambios en flujos críticos (los endpoints de escritura no se tocan).
- Incidencia encontrada y corregida durante la verificación: la primera versión llamaba a `/datos-completos` sin el prefijo `/api` (la baseURL del cliente es vacía adrede) — el catch-all de la SPA devolvía HTML y el fallback (diseñado exactamente para esto) enmascaraba el fallo. Detectado contando peticiones reales en el navegador.
