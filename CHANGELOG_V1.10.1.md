# Changelog v1.10.1 — F4: segunda apertura instantánea y feedback siempre visible

**Fecha:** 2026-08-17
**Tipo:** patch — percepción, feedback e integridad de UX, sin cambios de API
**Contexto:** fase 4 del plan pre-demo ([docs/INFORME_UX_RENDIMIENTO_2026-08-17.md](docs/INFORME_UX_RENDIMIENTO_2026-08-17.md)) — la fase del salto percibido.

## Percepción

- **P5 · Cache local con revalidación** ([src/lib/cacheLocal.js](src/lib/cacheLocal.js)): la app guarda la última foto de los catálogos y al reabrir la pinta al instante mientras revalida en segundo plano (el icono de actualizar gira como indicador discreto). **Medido: segunda apertura con el listado lleno en 47 ms** (antes, arranque completo con spinner). Diseño: clave versionada (`copuno:datos:v<versión>` — cada deploy purga las caches locales solo, kill-switch gratis), **sin empleados** (DNI/teléfono no tocan el disco de una tablet compartida) ni datos económicos, caducidad 24 h, limpieza al cerrar sesión. Si la revalidación falla con datos ya pintados, se mantiene la foto y avisa el indicador de conexión — nunca una pantalla de error sobre datos válidos.
- **P7 · Skeletons**: la primera carga muestra tarjetas fantasma con la geometría real del listado en vez de un spinner centrado (sin salto de layout).
- **P8 · Memoización**: los agregados de filtros ya no se recalculan en cada tecla (`useMemo`); eliminado `fechasUnicas` (cómputo 100 % muerto — su consumidor llevaba meses comentado); índice `Map` para rectificativos (el `find()` dentro del `map()` era O(n²)). La extracción de `ParteCard` con `React.memo` se hará con F6 (donde el re-render por tick importa de verdad).
- **P9 · Red bajo control**: guarda de secuencia en los 3 buscadores (la respuesta lenta de «JUA» ya no pisa a la de «JUAN»), timeout de 60 s → 20 s, y `retryOperation` deja de reintentar errores 4xx (el reintento del lote era un amplificador de congestión).

## Feedback y seguridad de datos

- **UX-16 · Toast flotante único** ([src/components/Toast.jsx](src/components/Toast.jsx)): los avisos aparecen siempre a la vista (abajo-centro, sobre los modales), con `role="status"`/`alert`; éxito y aviso se autocierran a los 6 s, los errores persisten hasta cerrarlos. Sustituye los tres banners que quedaban fuera de pantalla — la causa de «pulso Enviar y no pasa nada». Resuelve de paso los mensajes eternos (UX-15) y el anuncio a lectores de pantalla (UX-34).
- **UX-1 · La confirmación de «parte creado» ya no se autodestruye**: crear un parte refresca solo el listado (sin recarga global que desmontaba la pantalla de confirmación) — adiós a la fábrica de partes duplicados.
- **UX-4 · La edición ya no puede vaciar un parte**: si la carga de detalles falla, el formulario NO se abre (antes abría con 0 empleados y guardar archivaba las horas reales — el único camino de pérdida de datos del producto). Aviso claro con instrucción de reintentar.
- **UX-10 · Un fallo de red ya no se disfraza de «no hay empleados»**: los estados de error se distinguen de los vacíos reales y ofrecen «Reintentar» (firmantes en edición y desglose del modal de detalles).
- **UX-13 · «Editar» responde al instante**: el botón muestra «Abriendo…» con spinner y se deshabilita mientras carga (antes, 1-4 s sin feedback → pulsaciones repetidas).
- **UX-2a · Confirmación al descartar**: cancelar la creación con datos metidos, o la edición con cambios sin guardar (comparación contra snapshot), pide confirmación. Guardar cierra sin preguntar.

## Táctil y legibilidad (tablet, sol, guantes)

- **UX-24**: botones de horas 36→44 px, cierre de modales 32→44 px, la «×» de los chips de vehículo con área táctil de 44 px.
- **UX-25**: texto terciario `#7c83a5`→`#5c6484` (3,7:1→~6:1) y el aviso ámbar «no editable / vuelve a Borrador» a `#7a4a00` (2,9:1→~6,4:1) — legibles a pleno sol.

## Documentación

- Versión actualizada en los dos manuales ([docs/manual/index.html](docs/manual/index.html) y [public/manual.html](public/manual.html)) a v1.10.1, con nota explícita de que las capturas corresponden a la v1.9 y se regenerarán antes de la puesta en marcha de septiembre.

## Verificación

- E2E en navegador contra mock: cache local escrito y **listado con datos en 47 ms en la segunda apertura**; toast visible en viewport tras «Enviar Datos»; confirmación al cancelar con el formulario tocado.
- `npm run test:smoke` — 46/46. Build OK. Sin cambios en los flujos críticos (firma/PDF/sync intactos).
