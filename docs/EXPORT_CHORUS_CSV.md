# Exportación de partes a CSV para Chorus (cuadrantes mensuales)

**Última edición:** 2026-07-14
**Estado:** procedimiento manual validado (junio 2026). Pendiente de sistematizar.
**Script:** [`scripts/export-chorus-csv.py`](../scripts/export-chorus-csv.py)

Documenta cómo se genera el CSV que Copuno (Tomeu) carga en sus **cuadrantes
mensuales de Chorus** mediante una macro. Nace de la petición de exportar los
partes de junio de 2026 para Tomeu.

---

## 1. Objetivo

Copuno lleva las horas en un Excel por obra (`COPUNO.xlsm`) con una hoja por mes
(`YYYYMM`). Una **macro del lado de Copuno** lee un CSV plano y rellena esos
cuadrantes. Nuestro trabajo es **generar ese CSV** desde los partes de Notion.

> La macro **no está en nuestro repo ni la mantenemos nosotros**. Nosotros solo
> producimos el CSV de entrada en el formato acordado. El `COPUNO.xlsm` que nos
> pasó Javi es el *destino* (solo contiene macros de recálculo de "Resumen" con
> SUMIF, ninguna de importación).

Origen del acuerdo: reunión **"Copuno - Javi & Tomeu" (26-dic-2025)** + emails
"CSV de prueba" (27-ene-2026 y 6-feb-2026) a `borfila@copuno.com` (Tomeu) con
copia a `eiglesias@copuno.com` (Efrén).

---

## 2. Formato de salida (contrato con Tomeu)

CSV, cabeceras en la primera fila, **una fila por (obra × trabajador × día)**:

| Columna | Origen en Notion | Destino en el Excel |
|---|---|---|
| `codigo_obra` | `Obras → Código Obra` (number) | Selecciona el **cuadrante/hoja** de esa obra |
| `id_trabajador` | `Empleados → ID COPUNO` (number) | Fila del trabajador (**columna B "Número"**) |
| `horas` | `Detalle Horas → Cantidad Horas` (number) | Valor de la celda del día |
| `fecha` | `Partes de trabajo → Fecha` (dd/mm/aaaa) | Columna del día (H..AL = día 1..31) |

Ejemplo:
```csv
codigo_obra,id_trabajador,horas,fecha
20422,5452,9,01/06/2026
20486,3435,9,01/06/2026
```

**Decisiones de campo (importantes):**
- `id_trabajador` = **`ID COPUNO`**, NO `ID Trabajador`. `ID Trabajador` es el
  `unique_id` autoincremental interno de Notion (~6400) y **no** casa con Chorus.
  `ID COPUNO` es el número de empresa que se reconcilió con Chorus (ver §5).
- `codigo_obra` = **`Código Obra`**, NO `ID Obra` (este último es secuencia
  interna de Notion).
- Categoría y Precio/h existen en el Excel (columnas D y E) pero **NO van en el
  CSV**: los resuelve Copuno por el número de trabajador. Coherente con la regla
  de no exponer datos económicos por nuestro lado.

---

## 3. Estructura del destino (`COPUNO.xlsm`)

Un **libro por obra**; una **hoja por mes** llamada `YYYYMM` (ej. `202506`).
Cada hoja mensual es una **matriz trabajador × día**:

- Cabecera: `Obra`, `Cliente`, `Zona`, `Resp.`, `Mes`, `Día cierre` (Q6).
- Fila 9 = títulos. Datos desde la **fila 10**.
- Columnas: `B`=Número (id trabajador), `C`=Trabajador, `D`=Categoría,
  `E`=Precio/h, `H..AL`=horas por día (1..31), `AO`=Htot, `AP`=Importe,
  `AX/AY`=Horas/Importe 1ª quincena, `AZ/BA`=2ª quincena (split por día de cierre).

El "día de cierre" varía por mes (ej. 20/15/14). El split en quincenas y los
importes los calcula el Excel/macro; a nosotros solo nos compete la fecha real
de cada fila para que caiga en la columna del día correcto.

---

## 4. Cómo se genera

```bash
# token del cliente en .env (NUNCA el MCP de Notion — apunta al workspace de Javi)
export $(grep -E "^NOTION_TOKEN=" .env | xargs)
python3 scripts/export-chorus-csv.py 2026-06 Partes_junio_2026.csv
```

El script (Notion API directa, sin SDK):
1. Consulta `Partes de trabajo` filtrando `Fecha` dentro del mes.
2. Por cada parte recorre su relación `Detalle Horas` → `Cantidad Horas` +
   `Empleados` → `ID COPUNO`.
3. Resuelve `Obras → Código Obra` (cacheado).
4. Emite una fila por detalle, ordenado por fecha/obra/trabajador.

Rinde ~1 llamada por parte + 1 por detalle + 1 por empleado/obra (cacheadas).
Para un mes (~50 partes, ~260 detalles) tarda ~1–2 min. Si se sistematiza,
conviene paralelizar o mover la lógica a un endpoint del servidor (§6).

### Verificación junio 2026 (baseline)
- 48 partes → **262 filas**. Cobertura 100% (código obra, ID COPUNO, horas, fecha).
- Obras: Las Palmas (20486) 169 · Lentiscos (20422) 90 · Getares-Pruebas (123456) 3.
- 14 trabajadores distintos, 22 días, 2.142 horas.
- Getares (123456) es **obra de pruebas**: descartar en envíos reales si procede.

---

## 5. Dependencia crítica — sincronización de códigos Notion ↔ Chorus

La macro localiza cada fila por **coincidencia exacta de códigos**:
- `codigo_obra` (Notion `Código Obra`) debe ser el mismo que el código de obra en Chorus.
- `id_trabajador` (Notion `ID COPUNO`) debe ser el mismo que la columna **"Número"** de Chorus.

Si un trabajador u obra no aparece tras pasar la macro, es un **código
desincronizado**, no un fallo del CSV. La reconciliación de IDs de empleados se
hizo en mayo 2026 (ver `docs/revision_ids_empleados.csv` / `docs/ID.xlsx`); en
junio la cobertura de `ID COPUNO` para los trabajadores con partes fue del 100%,
pero **no está garantizado para toda la plantilla ni para todas las obras**.

Validación operativa: se envía el CSV, Tomeu corre su macro y reporta los
descuadres → se corrigen los códigos en Notion.

---

## 6. Cómo sistematizarlo (futuro)

Opciones, de menor a mayor esfuerzo:

1. **Script bajo demanda** (estado actual): `export-chorus-csv.py <mes>`.
   Suficiente para envíos mensuales manuales.
2. **Endpoint en el servidor**: `GET /api/export/chorus?mes=YYYY-MM` en
   [`server.js`](../server.js) que devuelva el CSV (reutilizando
   `src-server/services/notion.js`). Permite un botón "Exportar mes" en la app.
   Mantener la regla de saneado (este CSV **no** lleva importes).
3. **Escenario Make programado**: mensual, genera el CSV y lo deja en la carpeta
   OneDrive/Drive que vigila la macro de Copuno (encaja con el "poner las salidas
   en una carpeta" que se habló en diciembre). Es el objetivo final "sin manos".

Variantes que Tomeu podría pedir (fáciles de añadir al script):
- **Un CSV por obra** en vez de uno combinado.
- Columna `categoria` extra (si su macro no deduce la categoría por el número).
- Fecha en ISO (`aaaa-mm-dd`) en vez de `dd/mm/aaaa`.

> **Nota de scope:** convertir esto en endpoint o en escenario Make es trabajo
> nuevo; valorar con `@scope-guardian` si entra en retainer o es proyecto aparte.

---

## Historial de cambios
- **2026-07-14** — Creación. Procedimiento validado con junio 2026 (262 filas).
  Script `scripts/export-chorus-csv.py`. CSV entregado a Javi para envío a Tomeu.
