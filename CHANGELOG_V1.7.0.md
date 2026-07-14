# Changelog — Versión 1.7.0

**Fecha:** 14 de julio de 2026

---

## Funcionalidad nueva

### Vehículos como relación Notion (parte ↔ flota)

Petición de Efrén/Javi: las matrículas del parte deben quedar **relacionadas** con la BD de flota, no como texto suelto. Cambio de arquitectura del campo Vehículos (v1.5.x–v1.6.x lo guardaba solo como rich_text).

**Modelo de datos (Notion):**
- `Vehiculos ` (relation, **OJO: espacio final en el nombre**) — relación bidireccional Partes de trabajo ↔ Vehículos (inversa: `Partes de trabajo`). **Fuente de verdad.** Creada manualmente por Javi el 14/07.
- `Vehiculos` (rich_text, sin espacio) — **espejo de texto** que escribe siempre el servidor (matrículas separadas por `, `, sin coma final): es lo que consume el pipeline Make → PDF, que **no cambia en absoluto**.

**Backend:**
- [src-server/services/notion.js](src-server/services/notion.js) — helper `buildVehiculosProps(texto, ids)`: normaliza el texto (sin coma final, sin caracteres de control) y escribe las dos propiedades a la vez. Usado en `crear`, `actualizar` y `rectificar` (el rectificativo copia también la relación). `mapParte` y `detalles` exponen `vehiculosIds`.
- [server.js](server.js) — POST/PUT aceptan `vehiculosIds` (saneado `sanearIdsRelacion`: solo strings con forma de UUID, máx. 50).
- [mock/mockData.js](mock/mockData.js) — paridad completa (seed, crear, actualizar, rectificar, detalles).

**Frontend ([src/App.jsx](src/App.jsx)):**
- `CampoVehiculos` rediseñado: **chips** de vehículos seleccionados (id + matrícula) con botón de quitar, buscador con debounce 300 ms debajo. Solo se pueden añadir vehículos de la flota (ya no hay texto libre).
- **Bug corregido:** la coma sobrante al final del campo (v1.6.0 concatenaba `', '` tras cada selección).
- `vehiculosDelParte(parte)` reconstruye los chips al editar zipeando `vehiculosIds` + texto espejo.
- La consulta de partes y el filtro por matrícula siguen leyendo el texto espejo — sin cambios.

**Tests:** 1 smoke nuevo (persistencia de `vehiculosIds` + saneado de IDs no-UUID) — **37/37 en verde**.

### Re-derivación del espejo antes del PDF (anti-desincronización)

El espejo `Vehiculos` (rich_text) lo escribe el servidor al crear/editar, pero si alguien edita la **relación** directamente en Notion (saltándose la app), el texto se quedaría stale. Para cubrirlo sin migrar a fórmula (evaluado y descartado: no versionable + obliga a tocar Make en producción):

- [src-server/services/notion.js](src-server/services/notion.js) — `vehiculos.matriculasPorIds({ids})` resuelve matrículas (título) por page ID preservando orden; `partesTrabajo.sincronizarEspejoVehiculos({parteData})` re-deriva el texto desde la relación y lo reescribe **solo si difiere** (idempotente); solo actúa si hay relación (no borra texto de partes antiguos sin relación).
- [server.js](server.js) — `POST /enviar-datos` llama a la re-derivación tras validar Borrador y antes de armar el payload a Make. **No bloqueante**: si falla, se usa el texto existente. Muta `parteData` en memoria para que el PDF lleve el valor correcto.
- Verificado E2E contra Notion real: parte con texto desincronizado → re-derivado a las matrículas de la relación; 2ª llamada no reescribe.

**Nota de diseño (por qué no fórmula):** una fórmula Notion sería un espejo siempre sincronizado, pero (1) no se puede crear por API → no queda versionada en el repo y falla en silencio si se autora mal, y (2) obliga a reapuntar el path de lectura en el escenario Make PARTES1/4 (de `.rich_text[].plain_text` a `.formula.string`). La re-derivación en `enviar-datos` da la garantía en el único momento que importa (al generar el PDF) sin ninguno de esos costes.

## Dependencia manual (Notion) — resuelta 14/07

En la BD Partes de trabajo conviven ahora las dos propiedades (verificado por API):
- `Vehiculos ` (relation, espacio final) — creada por Javi, bidireccional con la BD Vehículos.
- `Vehiculos` (rich_text, sin espacio) — recreada como espejo que escribe el servidor.

Verificación E2E de escritura contra Notion real ✔ (página de prueba creada con las dos propiedades y archivada). Make/PDF sin cambios: sigue leyendo `Vehiculos.rich_text`.
