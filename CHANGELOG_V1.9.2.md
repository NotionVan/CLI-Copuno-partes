# Changelog v1.9.2 — F1: invalidación de cache, red anti-error e integridad de horas

**Fecha:** 2026-08-17
**Tipo:** patch — corrección de bugs y quick wins de UX, sin funcionalidad nueva
**Contexto:** fase 1 del plan de rendimiento/UX pre-demo ([docs/INFORME_UX_RENDIMIENTO_2026-08-17.md](docs/INFORME_UX_RENDIMIENTO_2026-08-17.md)).

## Corregido — servidor

- **BE-3 · El cache en memoria nunca se invalidaba tras una escritura** ([server.js](server.js)): tras crear/editar/rectificar un parte, enviar datos o cambiar el estado de un empleado, un GET que cayera en la misma instancia dentro del TTL de 30 s servía el listado **sin** el cambio recién hecho — la mitad intermitente de la queja «la app no actualiza». Nuevo helper `invalidateCache` (claves exactas y por prefijo) con `invalidarPartes()`/`invalidarEmpleados()` llamados en los 5 puntos de escritura (creación, edición, rectificación, las 3 transiciones de estado de enviar-datos, y estado de empleado).
- **UX-23 · Un 0 explícito de horas se grababa como 8** ([src-server/services/notion.js](src-server/services/notion.js)): `|| 8` → `?? 8` con clamp `[0,24]` en creación y edición de detalles. Un trabajador que asistió sin trabajar ya no se factura como jornada completa. El mock ya lo hacía bien (por eso el smoke no lo cazaba); **smoke nuevo** que fija el contrato (46 casos ahora).

## Corregido — interfaz

- **P1 · Esperas artificiales eliminadas** ([src/App.jsx](src/App.jsx)): guardar un parte ya no se queda 2-4 s parado «para que se lea el mensaje» (ni 2,5 s en el camino de conflicto 409) — el mensaje persiste en el banner del listado tras cerrar el modal. Guardar pasa de sentirse 4-6 s a ~1,5 s reales.
- **UX-22 · Ya se pueden teclear medias horas**: el campo de horas guarda el texto crudo mientras se escribe y aplica el límite/redondeo al salir del campo (antes «7.5» acababa siendo 24 h por el clamp en cada pulsación). Cinturón adicional: las horas se normalizan siempre antes de enviarse al servidor. Verificado tecleando «7» → «7.» → «7.5» → blur → 7,5.
- **UX-18 · Badges de estado con estilo en los 5 estados**: «Datos Enviados», «Listo para firmar» y «Procesando» salían como texto plano sin fondo (la clase no se normalizaba: espacios y tildes). Ahora usan la misma normalización que la franja de color de la tarjeta + 2 reglas CSS nuevas.
- **P4 · Error Boundary global** ([src/components/ErrorBoundary.jsx](src/components/ErrorBoundary.jsx)): cualquier excepción de render ya no deja la pantalla en blanco absoluto — aparece «Algo ha fallado…» con botón Reintentar. Es el seguro anti-«pantallazo» de cara a la demo.
- **UX-3 · Enter en los buscadores ya no crea el parte**: los 3 buscadores (empleado en creación y edición, matrícula) capturan Enter (`enterKeyHint="search"`); antes el submit implícito del formulario podía crear un parte a medias desde el teclado de la tablet.
- **UX-9 · La opción «Estado actual: X» del selector es informativa** (disabled): elegirla mandaba un valor vacío y devolvía un error 400.
- **UX-19 · Tras enviar se explica qué sigue**: «Enviado. En un par de minutos el parte pasará a "Datos Enviados" y quedará esperando la firma.»
- **UX-42 · «Notion» fuera de la interfaz**: «Cargando partes y obras…» y «Actualizar datos».
- **inputMode="decimal"** en los campos de horas (el iPad abre teclado numérico) y atributos anti-autocorrector en el buscador de matrículas (`autoCapitalize="characters"`, `autoCorrect="off"`).

## Rendimiento

- **P15 · `backdrop-filter: blur(12px)` eliminado de los filtros sticky** ([src/App.css](src/App.css)): sobre un contenedor sticky se recomponía en cada frame de scroll (tirones en iPad). Fondo casi opaco con el mismo efecto visual.
- **P14a · `react-router-dom` eliminado** (0 usos en el código; seguía en `package.json` y en los `manualChunks` de [vite.config.js](vite.config.js), donde habría roto el build al desinstalarse por separado).

## Verificación

- `npm run test:smoke` — **46/46** (nuevo caso UX-23).
- Build OK; verificación en mock con navegador: badges con fondo y clase normalizada, tecleo de «7.5» conservado tras blur.
- Sin cambios en los flujos críticos (firma, PDF/Make, sync): la invalidación solo borra cache de lectura.
