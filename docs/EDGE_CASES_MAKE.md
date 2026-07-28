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
| E5 | ✅ **CORREGIDO 28-jul** — firma listaba solo 50 ficheros y la carpeta ya tiene ~61 PDFs | **Alta** | Umbral superado — habría fallado en silencio |
| E8 | ✅ **MITIGADO 28-jul** — programación retirada; la limpieza ya solo corre a mano | Baja | Riesgo residual solo si se reactiva |
| E9 | Filtro del DataStore invertido: borra lo reciente, conserva lo viejo | Baja | — |
| E10 | Envío al cliente: destinatario apunta a propiedad Notion inexistente | Media | Funcionalidad **no operativa todavía** — a resolver antes de activarla |
| E6 | Sincronización por `sleep(5s)` en PARTES2/4 | Media | No confirmado |
| E7 | `Importe Total` viaja a Make pese al saneado económico de la app | Baja | Inconsistencia de política |

---

## E1 — Token de Notion hardcodeado en texto plano · **Alta**

**Dónde:** PARTES1/4, módulos `9` y `15` (`http:ActionSendData` contra `api.notion.com/v1/pages/…`). Ambos llevan la cabecera `Authorization: Bearer ntn_…` con el valor literal.

**Alcance real (ampliado 28-jul con el export saneado): 5 apariciones en 3 escenarios**, no 2 en 1 — además de PARTES1/4 (`5595847`, ×2), está en el clon inactivo `PARTES1/4 [CLON FIX PAGINACION]` (`9407545`, ×2) y en `Limpio Registros Detalle Horas sin empleados asignados` (`7899695`, ×1). Al migrar hay que cubrir los tres, o borrar los dos inactivos si ya no sirven.

**Por qué importa:** el secreto queda embebido en el blueprint. Viaja en cada export, en cada copia de backup, y en cualquier JSON que alguien abra. Es la razón por la que `docs/Escenarios Make/` está en `.gitignore` — y por la que **no debe salir de ahí**. Concede acceso de escritura al workspace Notion del cliente.

> **Consecuencia colateral RESUELTA (28-jul):** que los blueprints no pudieran versionarse dejaba los cambios hechos en la UI de Make sin historial ni diffs (el 28-jul se perdió el diff de un fix por esto). Ya no depende de E1: [`scripts/export-blueprints-make.py`](../scripts/export-blueprints-make.py) exporta desde producción, **sanea los secretos** y escribe en `docs/blueprints-make/`, que **sí se versiona**. El script aborta sin escribir nada si detecta un patrón de secreto que no sabe sanear. Sigue siendo cierto que la carpeta cruda (`docs/Escenarios Make/`, solo con `--raw`) no debe commitearse jamás.

**Fix elegido (28-jul, mejor que el original):** convertir los módulos a `http:ActionSendDataAPIKeyAuth` con una **Key del almacén de Make** (tipo `apikeyauth`: header `Authorization`). Los paths downstream (`9.data.properties…`) quedan idénticos — cero remapeos — y rotar el token pasa a ser editar la key en un solo sitio. Se descartó migrar a módulos nativos de Notion: cambia la forma del output y obliga a remapear 5 módulos.

**Intento del 28-jul — REVERTIDO:** key `210119` creada por API y blueprint migrado (verificado sin `ntn_`), pero el parte de prueba 306 falló en 1/4 con `Cannot read properties of undefined (reading 'placement')`: **los `parameters` de una key NO se pueden establecer por API** — `POST /keys` y `PATCH /keys/{id}` los aceptan con 200 y los descartan en silencio (mismo patrón que `data.udt` de hooks). Revertido a HTTP+token inline en minutos (producción restaurada) y el 306 relanzado reenviando su bundle de la DLQ al webhook de 1/4 → pipeline completo en verde.

**Cómo completarlo (pendiente):** (1) editar la key `210119` en la UI de Make (Team → Keys): valor `Bearer <token Notion>`, placement `header`, name `Authorization` — el token se copia de notion.so/my-integrations; (2) re-aplicar el blueprint E1 (preparado, un PATCH); (3) parte de prueba E2E. La key rota no molesta mientras tanto — ningún módulo la referencia tras el revert.

**Coste:** bajo; la validación E2E ya está ensayada con la obra TEST.

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

## E5 — Búsqueda en OneDrive limitada a 50 sin paginación · **Alta** (reclasificado 28-jul: el umbral ya está superado)

**Dónde:** PARTES4/4 módulo `34` (`onedrive:searchFilesFolders`, `limit: "50"`, **campo `search` vacío**) sobre `PARTES FINALES` (`/01YTENQUNABJXN5WYBCNHIQWBCNBHYGXDK`), seguido del módulo `17` con filtro de módulo `{{34.name}} contains {{36.<nombre del parte>}}`.

**El mecanismo exacto:** el módulo 34 **lista** hasta 50 ficheros de la carpeta (no busca — el campo `search` existe en el módulo pero está sin rellenar) y el filtro del 17 selecciona después el que casa por nombre. Si el `.docx` del parte no está entre esos 50, **el filtro no casa con nada, el flujo se detiene y la firma no ocurre, sin error visible**.

**Por qué ya no es teórico:** la carpeta solo se vacía de `.doc` (la limpieza filtra por `.doc`, ver E8), así que **los PDF firmados se acumulan indefinidamente**. Con **61 partes en estado `Firmado`** (recuento en Notion, 28-jul) la carpeta supera holgadamente los 50 ficheros. Que la firma siga funcionando hoy depende del orden en que OneDrive devuelva los resultados, no de ninguna garantía.

**Señales corroborantes:** el escenario inactivo `PARTES1/4 [CLON FIX PAGINACION]` (`9407545`) — alguien ya se topó con un problema de paginación y lo dejó a medias; y el escenario de limpieza, editado el 27-jul, que parece nacido para contener el crecimiento de esta misma carpeta pero solo borra Word.

**✅ CORREGIDO en producción el 2026-07-28** — `limit: "50"` → `"1000"` en el módulo 34 (`PATCH /scenarios/5682572`, verificado byte a byte; el diff versionado es de **una sola línea**). El filtro del módulo 17 se conserva intacto.

**Por qué NO se usó el campo `search`, que parecía el fix elegante:** `search` en OneDrive consulta el **índice de búsqueda de Microsoft, que es asíncrono** — un fichero recién subido puede tardar minutos en indexarse. El caso normal aquí es justo ese (3/4 sube el Word y el jefe firma poco después), así que habría cambiado un fallo latente en partes antiguos por uno **inmediato en los recientes**. Subir el límite mantiene el listado determinista, no depende de ningún índice, y es un valor ya probado en esta cuenta: el escenario de limpieza usa `limit: 1000` sobre **la misma carpeta y el mismo módulo**.

**Lo que esto NO arregla:** la carpeta sigue creciendo sin límite (los PDF firmados no se borran nunca). 1000 da margen de años al ritmo actual (~190 partes acumulados), pero la solución de fondo sigue siendo acoplar por `AUX ID PDF Onedrive` en vez de por listado + nombre (ver E4), o purgar PDFs antiguos con criterio.

---

## E8 — La limpieza borra el Word de partes aún sin firmar · Media

**Dónde:** `Limpio Archivos temporales generados del dia` (`5682602`, activo), módulos `8` + `7`.

**Qué hace realmente:** lista `PARTES FINALES` y borra los ficheros cuyo nombre contiene `.doc` — filtro de módulo `«Filtro los word»`. **Los PDF, incluidos los firmados, NO se tocan**: el `Documento Firmado` de Notion (un enlace compartido a OneDrive, `44.link.webUrl`) no corre peligro.

**El fallo:** borra **todos** los Word sin comprobar si su parte ya se firmó, y PARTES4/4 **necesita el `.docx`** para firmar (lo descarga y lo convierte a PDF). Programación: días `1, 6, 10, 15, 20, 25, 30` a las `18:27`. Un parte que quede pendiente de firma cruzando uno de esos días **pierde su documento de origen y ya no se puede firmar** — otra vez en silencio, porque el filtro del módulo 17 simplemente no casa. Hoy hay **10 partes en `Listo para firmar`**.

**✅ MITIGADO el 2026-07-28.** Javi lanza este escenario **a mano**, pero la programación seguía activa y contradecía ese uso: `isActive: true`, `nextExec: 2026-07-30T16:27Z`. Desactivado por API (`POST /scenarios/5682602/stop`) → `isActive: false`, `nextExec: null`. La configuración de días/hora queda guardada pero inerte, y el uso manual no cambia: *Run once* funciona con el escenario apagado.

**Riesgo residual:** si alguien vuelve a activar el escenario, la programación antigua (días 1/6/10/15/20/25/30 a las 18:27) revive tal cual. El fix de fondo sigue pendiente: condicionar el borrado a la antigüedad del fichero, o borrar el Word desde PARTES4/4 justo tras generar el PDF firmado.

**Fix:** añadir al filtro una condición de antigüedad (solo ficheros de más de N días), o mejor, borrar el Word desde PARTES4/4 justo tras generar el PDF firmado — el momento en que deja de hacer falta.

**Nota de método:** este escenario se analizó primero como "borra todo, incluidos los PDF" — conclusión errónea. Los filtros de Make viven en la clave `filter` del módulo, fuera de `mapper`/`parameters`, y la extracción inicial no los leía. Corregido; los filtros de módulo de todos los escenarios activos están ahora inventariados.

---

## E9 — El filtro del DataStore conserva lo viejo y borra lo reciente · Baja

**Dónde:** `Limpio Archivos temporales generados del dia`, módulos `2` → `3`.

**Qué:** el filtro es `Fecha Creación` **`greater`** `{{setHour(now; -24)}}`: selecciona los registros creados **desde ayer** — y son esos los que borra el módulo 3. Los más antiguos **nunca se borran** y se acumulan en el DataStore `82996` (el mismo que usa el pipeline). Si la intención era limpiar lo viejo, el operador está invertido (`less`).

**Riesgo adicional:** al borrar lo reciente, si el escenario coincide con un parte en vuelo puede eliminar sus registros de horas entre que 1/4 los escribe y 2/4 los lee (la ventana de los `sleep` de E6) → PDF sin líneas de detalle, con todo en verde.

---

## E10 — «Envío del parte al cliente»: el destinatario apunta a una propiedad inexistente · **Alta**

**Dónde:** `Envío del parte al cliente - botón enviar email` (`6534716`, activo), módulos `3` y `5`.

**El fallo:** el módulo 5 (`microsoft-email:createAndSendAMessage`) resuelve el destinatario con
`{{3.properties_value.\`Correo electrónico\`}}`, pero **la BD Clientes de Notion no tiene ninguna propiedad llamada `Correo electrónico`** (verificado por API el 28-jul). Las que existen son `Administración`, `Email Compras`, `Email Director/Delegado` y `Email persona Compras` — cuatro emails, ninguno con ese nombre. El campo se renombró o nunca se llamó así.

**Consecuencia:** el destinatario resuelve **vacío**. El botón "Enviar email" del parte no entrega nada — o falla en el módulo de correo, o envía a nadie. **No hay ni una sola ejecución registrada** del escenario ni entradas en su cola de errores, lo que sugiere que la funcionalidad **nunca se ha usado en producción**, no que funcione.

**Riesgo añadido al arreglarlo:** hay que **decidir a cuál de los cuatro emails** se manda (`Director/Delegado`, `Compras`, `persona Compras`, `Administración`) — es una decisión de negocio, no técnica. Y conviene confirmarlo con el cliente antes de activar un envío automático hacia fuera.

**Otros dos defectos del mismo escenario:**
- **Módulo muerto:** el `12` (`onedrive:searchFilesFolders`, `limit: 1`) busca el PDF, pero el `13` no usa su salida — vuelve a partir de `2.data.properties.\`AUX ID PDF Onedrive\``. Es una operación desperdiciada en cada envío.
- **Filtro de cliente por `contains` sobre una relación:** `Obras |&*^%$#@| relation contains {{2.data.properties.Obras.relation[].id}}`. Si el parte tuviera varias obras, el array se aplana y el `contains` puede casar con clientes que no tocan → **el parte de un cliente podría acabar en el correo de otro**. Hoy no ocurre (ninguna obra tiene más de un cliente asignado, verificado), pero el filtro no lo garantiza; lo correcto es igualdad sobre un único id.

**Aclaración de Javi (28-jul):** la funcionalidad de envío al cliente **todavía no está operativa ni en uso**, así que hoy no hay riesgo de que un parte llegue a quien no debe. Queda como **requisito a resolver antes de ponerla en marcha**, no como incidencia activa.

**Fix:** apuntar el destinatario al campo de email correcto (decisión de negocio: `Email Director/Delegado`, `Email Compras`, `Email persona Compras` o `Administración`), eliminar el módulo 12 y cambiar el filtro a igualdad. **Validar en un entorno de prueba antes de activarlo: es el único escenario que envía correo al exterior.**

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

- ~~No he verificado los escenarios activos `Envío del parte al cliente` y `Limpio Archivos temporales`~~ → **auditados el 28-jul**: de ahí salen E8, E9 y E10, y la reclasificación de E5.
- **Punto ciego corregido:** el primer barrido no leía los **filtros de módulo** (clave `filter`, fuera de `mapper`/`parameters`), lo que produjo una conclusión errónea sobre el escenario de limpieza. Ya están inventariados en los 6 escenarios activos. Cualquier análisis futuro debe incluirlos.
- **No he revisado los escenarios inactivos** (`9407545`, `8558385`, `7899695`) más allá de mencionar el clon de paginación.
- **Análisis estático únicamente.** No he ejecutado nada ni mirado ejecuciones reales. Un fallo que solo aparezca con datos concretos no está aquí.
- **No he revisado la plantilla `Plantilla Parte.docx`**, que es donde se materializa el PDF y donde vive la deuda pendiente de la marca "RECTIFICATIVO".

---

## Orden recomendado

~~1. E2~~ · ~~2. E3~~ · ~~4. E5~~ — **aplicados y verificados el 28-jul.**

Lo que queda, por orden:

1. **E1** — token Notion en 5 sitios de 3 escenarios. Bloqueado por un paso manual en la UI de Make (editar la key `210119`).
4. **E4** — acoplar 3/4↔4/4 por `AUX ID PDF Onedrive` en vez de por nombre. Cierra de raíz lo que E5 solo ha aplazado, y de paso el problema de caracteres inválidos.
5. **E9, E6, E7** — cuando toque.

**Sobre el scope:** E1, E2 y E3 son consecuencia directa de incidencias ya ocurridas y entran en el retainer como corrección. E4, E5 y E6 son endurecimiento preventivo de escenarios que hoy funcionan — eso es mejora, no incidencia, y conviene decidirlo con `@scope-guardian` antes de meterle horas.
