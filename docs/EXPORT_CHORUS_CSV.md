# Exportación de partes a CSV para Chorus (cuadrantes mensuales)

**Última edición:** 2026-07-28
**Estado:** formato validado por el cliente (15-07-2026) y **sistematizado en la app (v1.8.0, botón "Exportar CSV")**. La macro de Copuno entra en producción en agosto 2026 con las 3 obras del parte electrónico.
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

**Reglas de contenido (no negociables):**
1. **Una sola fila por `(codigo_obra, id_trabajador, fecha)`** — con las horas ya agregadas.
   El CSV es *canónico*: la macro **sustituye** el valor de la celda, no suma. Así el
   proceso es idempotente y un mes se puede reenviar corregido sin inflar el cuadrante.
2. **Excluir los partes rectificados** (los que tienen `Rectificado por ` relleno).
   Si no, sus horas se suman a las del rectificativo. Caso real: junio 2026, el
   `Parte Las Palmas234` (45 h) convivía con su `Rectif.Parte Las Palmas236` (54 h)
   y 5 trabajadores aparecían con 18 h el 1 de junio.
3. **Excluir obras de prueba** (p. ej. Getares, `Código Obra` 123456): ese código no
   existe en Chorus y solo genera "no encontrado" en la macro.

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

### 4.0 Vía principal (v1.8.0): botón "Exportar CSV" en la app

**Es la forma recomendada desde julio 2026.** En la cabecera de la app, junto a
*Refrescar*: se elige el rango (por defecto **día 1 del mes en curso → hoy**) y se
descarga `Partes_MM-AAAA.csv`. Aplica todas las reglas del §2 automáticamente y
avisa de partes sin firmar e incidencias.

Si el rango abarca **más de un mes natural**, la app pide **confirmación explícita**
antes de generar el fichero: un CSV con varios meses puede reabrir un mes ya
cerrado en Chorus.

Implementación: `GET /api/exportaciones/chorus` (paginado; el cliente itera las
páginas y compone el CSV). Detalle en [CHANGELOG_V1.8.0.md](../CHANGELOG_V1.8.0.md).

### 4.1 Vía script (respaldo)

```bash
# token del cliente en .env (NUNCA el MCP de Notion — apunta al workspace de Javi)
export $(grep -E "^NOTION_TOKEN=" .env | xargs)
python3 scripts/export-chorus-csv.py 2026-06 Partes_junio_2026.csv
```

El script (Notion API directa, sin SDK):
1. Consulta `Partes de trabajo` filtrando `Fecha` dentro del mes.
2. **Descarta los partes rectificados** (`Rectificado por ` con valor) y avisa por
   consola de cuáles ha excluido.
3. Por cada parte restante recorre su relación `Detalle Horas` → `Cantidad Horas` +
   `Empleados` → `ID COPUNO`.
4. Resuelve `Obras → Código Obra` (cacheado).
5. Emite una fila por detalle, ordenado por fecha/obra/trabajador.

> Pendiente menor: el script **no agrega todavía** por `(obra, trabajador, fecha)`.
> Hoy no hace falta (junio salió con 0 claves repetidas tras excluir el rectificado),
> pero si algún día hay dos partes legítimos del mismo trabajador, obra y día,
> llegarían dos filas. Añadir la agregación cierra la regla 1 del §2 por construcción.

Rinde ~1 llamada por parte + 1 por detalle + 1 por empleado/obra (cacheadas).
Para un mes (~50 partes, ~260 detalles) tarda ~1–2 min. Si se sistematiza,
conviene paralelizar o mover la lógica a un endpoint del servidor (§6).

### Verificación junio 2026 (baseline entregado)
Cifras finales tras aplicar las reglas del §2 (fichero `Partes_junio_2026_FINAL.csv`):
- 45 partes → **254 filas**, **2.083 h**. Cobertura 100% y **0 claves repetidas**.
- Obras: Las Palmas (20486) 164 filas / 1.363 h · Lentiscos (20422) 90 / 720 h.
- Excluidos: `Parte Las Palmas234` (rectificado, 45 h) y la obra de pruebas 123456.

> Primera entrega (14-jul) fueron 262 filas / 2.142 h **con el bug del rectificado**.
> Si Tomeu llegó a cargarla, hay que vaciar el rango del mes antes de recargar
> (o confirmar que su macro sustituye en vez de sumar — ver regla 1 del §2).

### Control de calidad recomendado antes de enviar
Además de las reglas del §2, revisar **jornadas imposibles**: un mismo trabajador
sumando >10 h entre todas sus obras en un mismo día suele delatar un parte cargado
por duplicado contra dos obras. En junio 2026 aparecieron 6 casos (5 trabajadores
con 9 h en Lentiscos **y** 9 h en Las Palmas el 01/06, más uno de 15 h el 25/06).
La macro **no lo detecta** porque van a hojas distintas, pero Chorus lo reflejará
en el resumen por trabajador.

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

1. ~~**Script bajo demanda**: `export-chorus-csv.py <mes>`.~~ Queda como respaldo (§4.1).
2. ~~**Endpoint en el servidor** + botón "Exportar mes" en la app.~~
   **HECHO en v1.8.0**: `GET /api/exportaciones/chorus` + botón en la cabecera.
   Ojo: se implementó **paginado** (una página de Notion por petición) en lugar de
   devolver el CSV entero — un mes completo no cabe en el timeout de una función
   serverless, y menos según crezca el nº de obras. El CSV sigue sin llevar importes.
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

## 7. Vía alternativa: construir el CSV desde la exportación de Notion

Cuándo usarla: cuando quien lo hace **no tiene acceso al token ni al script** (otra
persona del equipo, o Javi desde un equipo sin el repo). Es más laboriosa y más
frágil que la vía del script — leer los riesgos al final.

### 7.1 Por qué no basta con exportar "Partes de trabajo"

La exportación de `Partes de trabajo` da **una fila por parte**, con las horas ya
agregadas por categoría (Oficial 1ª, Peón…). **No trae el desglose por trabajador**,
que es justo lo que necesita el cuadrante. Ese desglose vive en `Detalle Horas`.

### 7.2 Qué exportar

Exportar **4 tablas** en CSV desde Notion (⋯ → Exportar → Markdown & CSV, **sin
subpáginas**, marcando *incluir todas las propiedades* → genera el `_all.csv`):

| Tabla | Para qué | Campos que interesan |
|---|---|---|
| **Detalle Horas** | Base del CSV — una fila por trabajador y parte | `Cantidad Horas`, `Fecha`, `Obra` (nombre), `Aux Empleado` (nombre), `Estado Parte`, `ID Parte Trabajo`, `Periodo de Cierre` |
| **Partes de trabajo** | Saber qué partes están rectificados | `ID`, `Rectificado por ` |
| **Empleados** | Traducir nombre → código Chorus | `Nombre Completo`, `ID COPUNO` |
| **Obras** | Traducir nombre → código Chorus | `Obra - Codigo` (nombre), `Código Obra` |

> ⚠️ `Detalle Horas` expone la obra y el empleado **por nombre, no por código**
> (`Obra` = "Las Palmas", `Aux Empleado` = "JUAN CARLOS CRUZ BRICIO"). Por eso hacen
> falta las exportaciones de Obras y Empleados para el cruce. Verificado por API 2026-07-15.

### 7.3 Pasos

1. **Filtrar el mes** en `Detalle Horas`: por `Periodo de Cierre` (formato `2026-06`)
   o por `Fecha`. Es la tabla base; cada fila será una fila del CSV final.
2. **Descartar rectificados**: cruzar `ID Parte Trabajo` contra la exportación de
   `Partes de trabajo` y eliminar los detalles cuyo parte tenga `Rectificado por `
   con valor. (Regla 2 del §2.)
3. **Traducir la obra**: cruzar `Obra` (nombre) con `Obras.Obra - Codigo` → tomar
   `Código Obra`. Descartar las obras de prueba.
4. **Traducir el trabajador**: cruzar `Aux Empleado` (nombre) con
   `Empleados.Nombre Completo` → tomar `ID COPUNO`.
5. **Agregar** por `(codigo_obra, id_trabajador, fecha)` sumando `Cantidad Horas`,
   para garantizar la regla 1 del §2 (una fila por combinación).
6. **Emitir** las 4 columnas en este orden y con la fecha en `dd/mm/aaaa`:
   `codigo_obra,id_trabajador,horas,fecha`
7. **Comprobar antes de enviar**: cero claves `(obra, trabajador, fecha)` repetidas,
   y ningún trabajador con más de ~10 h sumando todas las obras de un mismo día
   (eso delata partes duplicados — ver §5).

### 7.4 Riesgos de esta vía

- **El cruce por nombre es frágil.** Es exactamente lo que obligó a la reconciliación
  de mayo 2026 (`docs/revision_ids_empleados.csv`): hay nombres invertidos
  ("JUAN FRANCISCO INFANTE ALONSO" vs "INFANTES ALONSO JUAN FRANCISCO"), tildes y
  homónimos. Un cruce mal resuelto mete horas en el trabajador equivocado.
- El script (§4) **no tiene este problema**: navega las relaciones de Notion y lee
  `ID COPUNO` / `Código Obra` directamente, sin comparar texto.
- **Recomendación:** usar el script siempre que se pueda; esta vía solo como respaldo.

---

## 8. Mejora propuesta en Notion (haría trivial la vía manual)

Hoy los códigos no están accesibles desde `Detalle Horas`, y por eso hacen falta 4
exportaciones y 3 cruces. Añadiendo **rollups** en el workspace del cliente, bastaría
con **exportar una sola tabla**:

| BD | Propiedad nueva | Cómo |
|---|---|---|
| `Partes de trabajo` | `Código Obra` (rollup) | Sobre la relación `Obras` → mostrar `Código Obra` |
| `Detalle Horas` | `Código Obra` (rollup) | Sobre la relación `Partes de trabajo` → mostrar el rollup anterior |
| `Detalle Horas` | `ID COPUNO` (rollup) | Sobre la relación `Empleados` → mostrar `ID COPUNO` |
| `Detalle Horas` | `Parte rectificado` (rollup) | Sobre `Partes de trabajo` → contar `Rectificado por ` |

Con eso, el procedimiento manual se reduce a: **exportar `Detalle Horas` filtrado por
mes → descartar los marcados como rectificados → renombrar 4 columnas → agregar**.
Sin cruces por nombre y sin las otras 3 exportaciones.

> Es un cambio en el Notion del cliente: proponerlo a Efrén antes de tocarlo, y
> verificar por API que los rollups quedan con el nombre exacto esperado.

---

## Historial de cambios
- **2026-07-28** — **v1.8.0: exportación integrada en la app** (botón "Exportar CSV"
  con rango de fechas y confirmación al cruzar meses). Las reglas del §2 se aplican
  ahora en el servidor. Nuevo endpoint paginado `GET /api/exportaciones/chorus`.
  Verificado contra junio 2026: salida idéntica al CSV validado (254 filas / 2.083 h).
  Corregido de paso un fallo de fechas con hora (`AAAA-MM-DDT00:00…`) que rompía el
  formato `dd/mm/aaaa`.
- **2026-07-15** — **Formato del CSV dado por bueno por el cliente.** Añadidas las
  reglas de contenido del §2 (fila única por obra/trabajador/día + macro *sustituye*,
  exclusión de rectificados y de obras de prueba). Corregido el script para excluir
  partes con `Rectificado por `: junio pasa de 262 filas/2.142 h a 254/2.083 h.
  Documentada la vía manual desde la exportación de Notion (§7) y propuesta la mejora
  de rollups que la simplificaría (§8).
- **2026-07-14** — Creación. Procedimiento validado con junio 2026 (262 filas).
  Script `scripts/export-chorus-csv.py`. CSV entregado a Javi para envío a Tomeu.
