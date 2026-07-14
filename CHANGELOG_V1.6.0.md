# Changelog — Versión 1.6.0

**Fecha:** 14 de julio de 2026

---

## Funcionalidad nueva

### Autocompletado de matrículas en el campo Vehículos

Petición de Efrén: el campo Vehículos debe funcionar como el de empleados — al escribir, sugiere las matrículas coincidentes de la BD de Notion.

**Fuente de datos:** BD **"Vehículos "** del workspace de Copuno (id `fa4028b246494415aee021f3569ce8f8`, title = `Matrícula`) — la BD de flota que mantiene el propio equipo (con Tipo, Marca/Modelo, ITV, talleres, baliza…). Ya compartida con la integración.

**Backend:**
- [src-server/services/notion.js](src-server/services/notion.js) — `DATABASES.VEHICULOS`, mapper `mapVehiculo` (id, matricula, tipo, marcaModelo, estado — sin datos económicos) y `vehiculos.buscar` (filtro `Matrícula` title contains, límite 20).
- [src-server/services/data.js](src-server/services/data.js) — dominio `vehiculos` con soporte mock.
- [server.js](server.js) — `GET /api/vehiculos/buscar?q=` (mínimo 2 caracteres, cache corta N4, límite 1–50).
- [mock/mockData.js](mock/mockData.js) — `mockVehiculos` + `getVehiculos`.

**Frontend ([src/App.jsx](src/App.jsx)):**
- Componente `CampoVehiculos`: input único donde el término de búsqueda es el último segmento tras la última coma; debounce 300 ms; desplegable de sugerencias (matrícula + tipo · marca/modelo) con el mismo patrón visual que el buscador de empleados; al añadir, la matrícula se concatena al campo con `, `. Las matrículas ya incluidas no se vuelven a sugerir.
- Usado en creación y en edición del parte. **El valor guardado sigue siendo texto de matrículas** — el pipeline Make/PDF (v1.5.x) no cambia.

**Tests:** 2 smoke nuevos (búsqueda con coincidencias y umbral de 2 caracteres) — **36/36 en verde**.
