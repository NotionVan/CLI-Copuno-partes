# Changelog v1.13.0 — Catálogo completo de empleados en búsqueda libre

**Fecha:** 2026-08-18

## Contexto

Efrén reportó que «no se cargaban las listas completas» de empleados. Verificado
contra el Notion real (18-08): las listas **por obra** están completas (ninguna
de las 54 obras activas llega a 100 empleados), pero el modo **búsqueda libre**
(la casilla «Mostrar solo empleados asignados a esta obra» desmarcada) nunca
mostraba la BD entera: era un buscador con mínimo de 3 letras y tope de 20
resultados sin aviso de que había más. Con 1.533 empleados y apellidos
comunes, el empleado buscado podía quedar fuera sin ningún indicio.

## Cambios

### Servidor

- **`empleados.listarTodos`** ([src-server/services/notion.js](src-server/services/notion.js)):
  pagina la BD entera con `start_cursor` hasta `has_more=false` (~16 llamadas),
  con `filter_properties` (misma dieta de payload que el resto del catálogo).
- **`GET /api/empleados`** devuelve ahora el catálogo completo (antes: primeros
  100 de 1.533 — parte del hallazgo I-A). Cache con **TTL propio de 10 min**
  (el catálogo cuesta 16 llamadas y cambia poco); `invalidarEmpleados()` lo
  purga igualmente tras cualquier escritura.
- `setCache`/`getCache` aceptan TTL por clave (tercer parámetro opcional;
  el resto de claves siguen con `CACHE_TTL_MS`).
- `datos-completos` **no cambia**: sigue con `listar()` (100) para no engordar
  el arranque.

### Cliente

- **`getCatalogoEmpleados()`** ([src/services/notionService.js](src/services/notionService.js)):
  descarga memoizada a nivel de módulo (una vez por sesión; se olvida en fallo
  para reintentar).
- **Búsqueda libre en Crear Parte**: al desmarcar la casilla se carga el
  catálogo en background y la lista completa aparece sin teclear; el filtrado
  pasa a ser **local e instantáneo** (sin mínimo de 3 letras, por nombre o ID
  Copuno), capado a 300 en pantalla con aviso «Mostrando 300 de N — escribe
  para filtrar». Mientras el catálogo no está (cargando o fallo), el buscador
  server-side de F5 funciona exactamente como antes (fallback intacto).
- **Buscador de edición**: mismo patrón — con catálogo cargado filtra en local
  desde la primera letra (cap 50); sin él, el buscador server-side de siempre.

## Medidas (Notion real, local)

- Catálogo completo: **1.533 empleados**, 373 KB (81 KB gzip), una descarga por sesión.
- Frío: 10,5 s desde local (menos en iad1); con cache: 8 ms. La carga es en
  background: el usuario puede seguir usando el buscador mientras llega.

## Verificación

- Suite smoke **62/62** (3 casos nuevos en `catalogo.test.js`: paginación
  multi-página con orden, página única, BD vacía).
- E2E endpoint contra Notion real: 1.533 empleados, campos del DTO correctos,
  sin datos económicos.
- Verificación en navegador (mock): lista completa al desmarcar, filtrado con
  1 letra, añadir empleado de fuera de la obra, buscador de edición con
  sugerencias desde 1 letra.
- `@regression-checker` antes del merge.
