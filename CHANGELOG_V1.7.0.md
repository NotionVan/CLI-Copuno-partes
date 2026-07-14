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

## Dependencia manual (Notion) — ⚠️ BLOQUEANTE para deploy

La propiedad espejo `Vehiculos` (rich_text) fue **eliminada** al crear la relación y debe **recrearse** en la BD Partes de trabajo (tipo Texto, nombre exacto `Vehiculos`, sin tilde ni espacio) **antes de desplegar**: sin ella, la escritura de partes falla (validation_error de Notion) y el PDF sale sin matrículas.
