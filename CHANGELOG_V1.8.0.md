# v1.8.0 — Exportación de partes a CSV desde la app (cuadrantes de Chorus)

**Fecha:** 2026-07-28

Añade un botón **"Exportar CSV"** en la cabecera que genera, con un selector de
rango de fechas, el fichero de horas que la macro de Copuno carga en los
cuadrantes mensuales de Chorus. Sustituye al proceso manual vía
`scripts/export-chorus-csv.py`.

Origen: reunión con Bartomeu (Tomeu) y Efrén del **20-07-2026** — acción
*"Añadir botón de exportación CSV a la app de partes… con selector de rango de
fechas"*. Contrato del CSV y reglas de negocio: [docs/EXPORT_CHORUS_CSV.md](docs/EXPORT_CHORUS_CSV.md).

---

## Novedades

### Botón y modal de exportación
- Botón **Exportar CSV** en `header-utility`, junto a *Refrescar*.
- Selector **Desde / Hasta**. Por defecto: **día 1 del mes en curso → hoy**
  (petición expresa de Tomeu para no mezclar meses).
- Barra de progreso mientras se leen los partes.
- Descarga directa como `Partes_MM-AAAA.csv` (si el rango cruza meses:
  `Partes_MM-AAAA_a_MM-AAAA.csv`). CSV con BOM para que Excel lo abra bien.

### Advertencia al mezclar meses
- Si el rango abarca más de un mes natural, aviso en el modal **y diálogo de
  confirmación explícito** antes de continuar ("Exportar de todos modos" /
  "Revisar fechas"). Evita reabrir un mes ya cerrado en Chorus.

### Reglas de negocio aplicadas en el servidor
- **Partes rectificados excluidos**: si un parte tiene `Rectificado por `, sus
  horas NO se exportan (manda el rectificativo). Sin esto se duplicaba la jornada
  — caso real de junio 2026: 5 trabajadores con 18 h el día 1.
- **Obras de prueba excluidas** (nombre que contiene "prueba"): su código no
  existe en Chorus.
- **Una sola fila por (obra, trabajador, día)**, con horas agregadas: el CSV es
  canónico y la macro *sustituye* el valor de la celda.
- **Incidencias reportadas**: las líneas sin `Código Obra`, sin `ID COPUNO`, sin
  horas o sin fecha no se exportan en silencio — se listan en el modal.
- **Aviso de partes sin firmar** en el rango (Borrador / Procesando / Listo para
  firmar), con la indicación de reexportar tras firmarlos.

---

## Cambios técnicos

### Nuevo endpoint — `GET /api/exportaciones/chorus`
`?desde=AAAA-MM-DD&hasta=AAAA-MM-DD[&cursor=]` → `{ filas, incidencias, descartadas, leidos, cursor, done, estados }`

**Devuelve UNA página de Notion por llamada; el cliente itera hasta `done`.**
No es un capricho: resolver un mes entero en una sola petición no cabe en una
función serverless. Atacar `Partes de trabajo` parte a parte costaba ~300
llamadas (1-2 min); incluso atacando `Detalle Horas` un mes de 3 obras eran ~11 s,
y el crecimiento previsto (de 3 a 140 obras) lo multiplica. Paginando, ninguna
petición pasa de ~3 s sea cual sea el plan de Vercel o el número de obras.

### Optimización de payload con `filter_properties`
Notion devuelve las ~60 propiedades de cada página salvo que se acoten. Pidiendo
solo las necesarias (IDs en `PROPS_EXPORT`), un mes pasa de **410 KB / 3,9 s a
37 KB / 0,6 s**. Tiempo total de un mes: **23,4 s → 8,4 s**.

### Arquitectura (ADR-002)
- `src-server/services/notion.js` → `exportaciones.contextoRango()` y
  `exportaciones.chorusPagina()` + cache de resolución de páginas (TTL 10 min).
- `src-server/services/data.js` → `exportaciones.*` (interfaz neutra, con rama mock).
- `server.js` → endpoint, validación de parámetros y cache del contexto del rango.
- `src/services/notionService.js` → `exportarChorus()` (paginación) y
  `componerCsvChorus()` (agregación + serialización).
- `src/App.jsx` → `ModalExportarCsv`.

### Corregido durante el desarrollo
- **Fechas con hora**: la fórmula `Fecha` de `Detalle Horas` puede devolver
  `AAAA-MM-DDT00:00:00.000+00:00`. El formateo a `dd/mm/aaaa` producía basura
  (`11T00:00:00.000+00:00/06/2026`). Se normaliza a `AAAA-MM-DD` en el servidor y,
  defensivamente, en el cliente. Detectado al comparar la salida contra el CSV ya
  validado por el cliente.

---

## Verificación

Ejecutada contra los datos reales de **junio 2026**:

| Comprobación | Resultado |
|---|---|
| Filas / horas | **254 filas · 2.083 h** |
| Reparto | Las Palmas (20486) 164 · Lentiscos (20422) 90 |
| Partes rectificados excluidos | 5 líneas (`Parte Las Palmas234`) |
| Obras de prueba excluidas | 1 línea (Getares, 123456) |
| Claves `(obra, trabajador, fecha)` duplicadas | **0** |
| Incidencias por datos incompletos | 0 |
| Contraste con el CSV validado por el cliente | **idéntico** |
| Tiempo total (3 páginas) | 8,4 s · máx. 3,3 s por petición |

Sintaxis de `App.jsx` / `notionService.js` validada con `@babel/parser`.

> **Pendiente de verificación visual:** `npm run build` no se pudo ejecutar en el
> equipo de desarrollo — esbuild falla al arrancar su subproceso
> (`Error: The service was stopped`) **antes de leer el código del proyecto**, ya
> con `vite.config.js`. Es un problema del entorno (binario en Google Drive /
> permisos de macOS), no de estos cambios: el mismo error se reproduce sin
> sandbox. **Hay que compilar y probar el modal en un navegador antes de desplegar.**
