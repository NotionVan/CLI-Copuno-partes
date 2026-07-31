---
description: Sincroniza la documentación del proyecto Copuno en sus tres capas — repo (GitHub), Notion (proyecto Copuno - Retainer) y timers de la BD Tareas — a partir del trabajo real de la sesión.
---

# /update-doc — Sincronizar documentación Copuno

Actualiza las tres capas EN ESTE ORDEN. Regla general: **no inventes contenido** — todo lo que escribas debe salir del estado real (git log, `package.json`, diffs, y lo trabajado en esta sesión). Si una capa no tiene nada que actualizar, dilo y pasa a la siguiente.

Argumentos opcionales: `$ARGUMENTS` (p. ej. `solo repo`, `solo notion`, `solo timers` para limitar el alcance).

## 1. Documentación del repo (GitHub)

1. Lee `package.json` (versión) y `git log --oneline -10` + `git status` para ver qué ha cambiado desde la última actualización de docs.
2. Verifica y actualiza SOLO lo desfasado:
   - **`CLAUDE.md`**: línea "Última edición" del bloque superior (fecha + versión + resumen de 1 línea), y cualquier endpoint, gotcha o convención nueva que haya surgido en la sesión.
   - **`CHANGELOG_V<versión>.md`**: si hay una versión publicada sin changelog, créalo siguiendo el formato de los existentes.
   - **`docs/API_REFERENCIA.md`** y **`docs/notion-schema-detailed.md`**: solo si la sesión tocó endpoints o esquema de BDs Notion del cliente.
   - **`docs/DEUDA_TECNICA.md`**: si se añadió/cerró/reclasificó deuda, aplica la convención completa sin excepciones: (1) el cambio, (2) fecha "Última edición" del bloque superior, (3) nueva entrada en "Historial de cambios" al final.
   - **`docs/Escenarios Make/`**: si la sesión tocó escenarios Make, recuerda a Javi reexportar los blueprints (no se pueden generar desde aquí).
3. Si hay cambios de docs: commit con mensaje `docs: <resumen>` (+ coautoría estándar). **Pregunta antes de hacer push** — push a `master` despliega en Vercel.

## 2. Notion (proyecto Copuno - Retainer)

Usa el conector MCP de Notion — es el workspace de Javi. (Recordatorio: para datos del workspace del CLIENTE se usa la API con `NOTION_TOKEN`, nunca este MCP.)

IDs fijos:
- Proyecto "Copuno - Retainer": página `7d4fa4e8-b09d-4f8f-9e30-a97ab15b4e2d`
- BD Referencias (data source): `1bab0084-06b8-421e-9031-6a4193345545` — al crear referencias, vincular con la propiedad `Proyectos` a la página del proyecto y poner `Quien` = `6fa08689-46a6-4a75-9c8e-c679678bd258`

Pasos:
1. **IMD del mes en curso**: localiza la referencia "Informe mensual de dedicación — <Mes> <Año>" (el informe real es su subpágina `IMD - <Mes> <Año>`). Rellena con el trabajo de la sesión: fila(s) en la tabla "Horas consumidas" (contrastar con los timers de la capa 3), estados en "Peticiones atendidas", versiones en "Cambios en la app". Si no existe el IMD del mes, créalo clonando la estructura del mes anterior.
2. **Referencias nuevas**: si la sesión generó material (presupuestos, investigaciones, delimitaciones de alcance, actas), verifica que exista como referencia en la BD Referencias vinculada al proyecto. Crea o actualiza lo que falte.
3. **Coherencia**: la versión de la app que menciona el IMD debe coincidir con `package.json` del repo.

## 3. Timers de tareas (BD Tareas de Notion)

Usa la skill `time-tracking` (args: `start <tarea>` | `stop` | `status`):
1. Ejecuta `status` para ver si hay un registro de tiempo abierto.
2. Si hay un timer corriendo de la tarea de esta sesión → `stop` (cierra el registro con la hora real).
3. Si se trabajó sin timer, avisa a Javi del hueco y ofrece: crear el registro a posteriori con las horas reales de la sesión, o crear la tarea primero (skill `crear-tarea-notion`) si no existe.
4. Contrasta el total de tiempo registrado del mes contra la tabla de horas del IMD — si no cuadran, señálalo (el IMD se factura; los timers son la fuente de verdad).

## 4. Informe de cierre

Termina SIEMPRE con un bloque resumen:
- **Repo**: archivos tocados + commit (hash) + si se hizo push o quedó pendiente.
- **Notion**: páginas creadas/actualizadas con enlaces.
- **Timers**: estado (cerrado/abierto/hueco detectado) y horas del mes acumuladas.
- **Pendientes**: lo que no se pudo actualizar y por qué.
