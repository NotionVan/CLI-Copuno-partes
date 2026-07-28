# Edge cases del pipeline Make — PARTES 1/4 → 4/4

**Fecha:** 2026-07-28
**Fuente:** blueprints **vivos de producción** descargados por API desde `eu2.make.com`, org Copuno `4157465`, team `2014883`. No son los del repo (que estaban al 14-jul y no incluían el fix de hoy).
**Método:** análisis estático de los blueprints + lectura de la configuración de los webhooks vía API, buscando los patrones que ya han causado incidencias reales (DEUDA_TECNICA M2, M4, M5, M8).

> Este documento es un **análisis, no una lista de tareas cerradas**. Estado: **E2 corregido en producción el 2026-07-28** (ver su sección); el resto pendiente. Varios requieren ventana de mantenimiento porque tocan producción.

---

## Resumen

| # | Hallazgo | Severidad | ¿Ha pasado ya? |
|---|---|---|---|
| E1 | Token de Notion hardcodeado en módulos HTTP de PARTES1/4 | **Alta** | No, pero viaja en cada export |
| E2 | ✅ **CORREGIDO 28-jul** — PARTES2/4 reenviaba 9 numéricos sin `ifempty()` | **Alta** | Es el mismo mecanismo que M5 |
| E3 | ✅ **APLICADO 28-jul** (pend. E2E) — webhooks 2/4 y 3/4 sin data structure declarada | **Alta** | Sí — es la causa raíz de M8 |
| E4 | Nombre de fichero sin sanear → caracteres inválidos en OneDrive | Media | No detectado aún |
| E5 | Búsqueda en OneDrive con `limit: 50` y sin paginación | Media | Probable origen del clon inactivo |
| E6 | Sincronización por `sleep(5s)` en PARTES2/4 | Media | No confirmado |
| E7 | `Importe Total` viaja a Make pese al saneado económico de la app | Baja | Inconsistencia de política |

---

## E1 — Token de Notion hardcodeado en texto plano · **Alta**

**Dónde:** PARTES1/4, módulos `9` y `15` (`http:ActionSendData` contra `api.notion.com/v1/pages/…`). Ambos llevan la cabecera `Authorization: Bearer ntn_…` con el valor literal.

**Por qué importa:** el secreto queda embebido en el blueprint. Viaja en cada export, en cada copia de backup, y en cualquier JSON que alguien abra. Es la razón por la que `docs/Escenarios Make/` está en `.gitignore` — y por la que **no debe salir de ahí**. Concede acceso de escritura al workspace Notion del cliente.

**Fix:** sustituir los dos módulos HTTP por la **conexión nativa de Notion** que ya usan el resto de escenarios (3/4 y 4/4 la usan). Elimina el secreto del blueprint y de paso unifica el manejo de errores y rate limits.

**Coste:** bajo, pero requiere validación E2E — cambia cómo se leen Obra y Persona Autorizada.

**Nota:** rotar el token sin migrar antes **rompe producción**. El orden correcto es migrar → verificar → rotar.

---

## E2 — PARTES2/4 reenvía numéricos sin protección · **Alta**

**Dónde:** PARTES2/4, módulo `37` (el que construye el JSON a mano hacia 3/4).

Comparación directa de los dos módulos que escriben JSON a mano:

| Campo | PARTES1/4 (mod 249) | PARTES2/4 (mod 37) |
|---|---|---|
| `ID Parte` | `{{ifempty(39.\`ID Parte\`; 0)}}` | `{{8.\`ID Parte\`}}` ❌ |
| `Horas Oficial 1ª` | `ifempty(…; 0)` | crudo ❌ |
| `Horas Oficial 2ª` | `ifempty(…; 0)` | crudo ❌ |
| `Horas Capataz` | `ifempty(…; 0)` | crudo ❌ |
| `Horas Peon` | `ifempty(…; 0)` | crudo ❌ |
| `Horas Encargado` | `ifempty(…; 0)` | crudo ❌ |
| `Horas Totales` | `ifempty(…; 0)` | crudo ❌ |
| `Total Horas Oficial` | `ifempty(…; 0)` | crudo ❌ |
| `Importe Total` | `ifempty(…; 0)` | crudo ❌ |

**El fallo:** si cualquiera de esos 9 llega vacío, el body resultante es `"Horas Capataz": ,` — JSON sintácticamente inválido. El webhook de 3/4 responde **`400 Bad Request`** y el parte se queda sin PDF. Es el mismo mecanismo que la incidencia de hoy (M5), solo que disparado por un valor ausente en vez de por un salto de línea.

**Por qué no ha explotado todavía:** porque 1/4 sí aplica `ifempty()`, así que 3/4 siempre recibe al menos `0`. La protección existe **una sola vez, en el tramo anterior**. En cuanto un campo se pierda entre 1/4 y 2/4 —exactamente lo que pasó con `Vehiculos del parte` en M8— ese campo llega vacío a 2/4 y revienta el JSON.

**Es decir: E2 y E3 combinados son una bomba de relojería.** M8 no llegó a provocar un 400 solo porque el campo perdido era una cadena (`"…": ""`, JSON válido) en lugar de un número.

**Fix:** envolver los 9 en `ifempty(…; 0)` en el módulo 37, replicando lo que ya hace 1/4. Cambio mecánico, sin efectos colaterales, en un solo módulo.

**Coste:** muy bajo. Es el fix con mejor relación valor/esfuerzo de todo el informe.

**✅ ESTADO: CORREGIDO en producción el 2026-07-28.** Aplicado vía `PATCH /api/v2/scenarios/5595873` con el blueprint editado en JSON (nunca en el editor de Make — el body contiene `ª` y el editor trunca no-ASCII). Verificación: re-descarga del blueprint vivo y comparación byte a byte contra el preparado — solo cambian las 9 líneas previstas; los 5 `escapeJSON` y el array `Detalle del parte` intactos. El escenario quedó activo (`islinked: true`). **Pendiente: verificación E2E con el siguiente parte real → mirar el PDF**, no el check verde (regla M8).

---

## E3 — Los webhooks no declaran estructura de datos · **Alta**

**Dónde:** hooks `2480016` (entrada de PARTES2/4) y `2480024` (entrada de PARTES3/4). Ambos devuelven `"udt": null` por API.

**Qué significa:** ninguno tiene una *Data structure* explícita asociada. Operan con **estructura aprendida** — Make infiere los campos de los payloads que ha visto. Consecuencias:

- Un campo nuevo que el emisor manda pero el receptor no ha "aprendido" aparece como **variable desconocida y resuelve vacío en silencio**: sin error, sin ejecución incompleta, sin log. Solo se ve mirando el PDF final.
- Es **exactamente** lo que ocurrió con `Vehiculos del parte` (M8). No fue un descuido puntual: es el comportamiento por defecto de esta configuración.
- Mientras siga así, **cualquier campo que se añada al payload volverá a fallar del mismo modo**. El fix de hoy resolvió la instancia, no la causa.

**Fix:** crear una *Data structure* explícita para cada uno de los dos webhooks, con los campos del contrato y marcando como `required` los que no pueden faltar. A partir de ahí, un campo ausente produce un **error visible** en vez de un vacío silencioso.

**Coste:** medio. Hay que definir dos estructuras de ~17 campos y revalidar E2E. Pero es **el único hallazgo que cierra una clase entera de fallos** en vez de una instancia.

**Recomendación:** si solo se hace una cosa de este informe, que sea E3. Si se hacen dos, E3 + E2.

**Estado 28-jul: contrato PREPARADO** — estructuras completas, payloads canónicos de muestra y procedimiento de aplicación en [E3_CONTRATO_WEBHOOKS.md](E3_CONTRATO_WEBHOOKS.md). Evidencia adicional encontrada al prepararlo: la interfaz aprendida del hook de 3/4 (foto post-fix M8) **sigue sin conocer `Cliente`, `Horas Peon` ni `Vehiculos del parte`** — tres campos que la plantilla del PDF consume. La deriva no es teórica.

---

## E4 — Nombre de fichero sin sanear · Media

**Dónde:** PARTES3/4 módulo `11` → `fileName: "Parte {{1.Obra}}{{1.\`ID Parte\`}}"`, subido en módulo `13`. PARTES4/4 módulo `36` **reconstruye el mismo nombre** (`Parte {{1.obra}}{{1.parteId}}`) para localizar el fichero en OneDrive.

**El fallo:** el nombre de obra viene de Notion sin filtrar. OneDrive rechaza `/ \ : * ? " < > |` en nombres de fichero. Una obra llamada, por ejemplo, `Lentiscos 2/3` produce una ruta inválida y el upload falla — o peor, se interpreta como subcarpeta.

**Agravante:** el acoplamiento entre 3/4 y 4/4 es **por convención de nombre, no por identificador**. Si alguien renombra la obra en Notion entre la generación del PDF y la firma, 4/4 busca un fichero que ya no se llama así y **la firma no encuentra el parte**. No hay fallback.

**Fix:** sanear el nombre con `replace()` sobre los caracteres prohibidos, y —mejor— acoplar 3/4↔4/4 por el `AUX ID PDF Onedrive` que ya se persiste en Notion, en vez de por nombre reconstruido.

---

## E5 — Búsqueda en OneDrive limitada a 50 sin paginación · Media

**Dónde:** PARTES4/4 módulo `34` (`onedrive:searchFilesFolders`, `limit: "50"`) sobre la carpeta de partes.

**El fallo:** si la carpeta supera los 50 ficheros que la búsqueda devuelve, el parte buscado puede no estar entre ellos y la firma falla sin explicación clara. La carpeta acumula un PDF por parte, así que **crece de forma monótona**.

**Señal de que ya ha dado problemas:** existe un escenario inactivo llamado `PARTES1/4 - Recojo cabecera del parte [CLON FIX PAGINACION]` (`9407545`). Alguien ya se topó con un problema de paginación y dejó un clon a medio hacer. Conviene revisar ese clon antes de rehacer el trabajo.

**Fix:** filtrar la búsqueda por nombre en vez de listar y filtrar después, o usar el ID de OneDrive persistido (ver E4).

---

## E6 — Sincronización por `sleep` · Media

**Dónde:** PARTES2/4, módulos `59` y `47` — dos `util:FunctionSleep` de 5 s, uno antes de leer el DataStore y otro antes de reenviar a 3/4.

**El fallo:** los sleeps compensan que 1/4 escribe en el DataStore de forma asíncrona. Es una espera fija contra una latencia variable: bajo carga, 5 s pueden no bastar y 2/4 leería **registros incompletos** — un parte con menos líneas de detalle de las que tiene. Y al ser un fallo de *contenido*, no de ejecución, el escenario termina en verde.

**Fix:** sustituir la espera por una comprobación explícita (contar registros esperados vs. leídos, y reintentar). Alternativamente, elevar el sleep es un parche, no una solución.

**Nota:** no tengo evidencia de que haya ocurrido. Lo marco porque el modo de fallo —verde en Make, PDF incorrecto— es el mismo que M8, y ese sí ocurrió.

---

## E7 — `Importe Total` viaja a Make · Baja

La app sanea deliberadamente los datos económicos: **ningún endpoint `/api/*` devuelve precios ni importes**. Pero el pipeline Make sí transporta `Importe Total` de 1/4 → 2/4 → 3/4.

No llega a la plantilla del PDF (el módulo `11` no lo mapea), así que no hay fuga visible al cliente. Pero es una inconsistencia entre la política declarada y lo que realmente circula, y el dato queda en los logs de ejecución de Make.

**Fix:** si el saneado económico es una política real, eliminar el campo del payload. Si se transporta por algo, documentar por qué.

---

## Lo que este análisis NO cubre

Para no dar una falsa sensación de cobertura:

- **No he verificado el escenario `Envío del parte al cliente`** (`6534716`) ni `Limpio Archivos temporales` (`5682602`), que está **activo y no documentado** en `CLAUDE.md`.
- **No he revisado los escenarios inactivos** (`9407545`, `8558385`, `7899695`) más allá de mencionar el clon de paginación.
- **Análisis estático únicamente.** No he ejecutado nada ni mirado ejecuciones reales. Un fallo que solo aparezca con datos concretos no está aquí.
- **No he revisado la plantilla `Plantilla Parte.docx`**, que es donde se materializa el PDF y donde vive la deuda pendiente de la marca "RECTIFICATIVO".

---

## Orden recomendado

1. **E2** — 10 minutos, un módulo, riesgo casi nulo. Hazlo ya.
2. **E3** — la única corrección estructural. Cierra la clase de fallo de M8.
3. **E1** — antes de que el token se propague más.
4. E4/E5 juntos, porque comparten el fix (acoplar por ID de OneDrive).
5. E6, E7 — cuando toque.

**Sobre el scope:** E1, E2 y E3 son consecuencia directa de incidencias ya ocurridas y entran en el retainer como corrección. E4, E5 y E6 son endurecimiento preventivo de escenarios que hoy funcionan — eso es mejora, no incidencia, y conviene decidirlo con `@scope-guardian` antes de meterle horas.
