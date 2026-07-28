# Copuno — Gestión de Partes

Webapp interna del cliente **Copuno** para que los jefes de obra creen y firmen partes de trabajo diarios. Backend de datos en **Notion**, generación de PDFs y firma vía **Make.com**, hosting en **Vercel**.

El contexto de negocio y las decisiones viven en `javintnvn/SB` (segundo cerebro).

- **Producción:** https://copuno-gestion-partes.vercel.app/ — **dominio propio pendiente de alta DNS por el cliente:** `app.copuno.com/partes` (ver [ADR-005](docs/adr/ADR-005-dominio-y-espacio-de-nombres.md) e [INSTRUCCIONES_DNS_DOMINIO.md](docs/INSTRUCCIONES_DNS_DOMINIO.md)). **`partesobra.copuno.com` nunca existió** (NXDOMAIN, verificado 2026-07-28) pese a estar documentado como producción durante meses — queda descartado.
- **Versión actual:** [package.json](package.json) → `version`
- **Cliente:** Copuno (sector construcción, varias delegaciones)
- **Modelo comercial:** retainer mensual 20 h. Detalle y reglas de scope en [.claude/scope-rules.md](.claude/scope-rules.md).
- **Última edición:** 2026-07-28 (**noche — endurecimiento del pipeline Make (M9)**: auditoría de edge cases sobre los blueprints **vivos** de eu2 → [docs/EDGE_CASES_MAKE.md](docs/EDGE_CASES_MAKE.md) (E1–E7). Aplicados en producción el mismo día: **E2** (`ifempty` en los 9 numéricos del mod 37 de PARTES2/4, vía PATCH API) y **E3** (data structures explícitas `608077`/`608078` asociadas a los webhooks de 2/4 y 3/4 — desde ahora **validan en la puerta**: campo ausente/tipo malo = error visible en el emisor; contrato en [docs/E3_CONTRATO_WEBHOOKS.md](docs/E3_CONTRATO_WEBHOOKS.md)). **E2E validado con partes reales**: el 305 (sin matrículas ni notas) fue **rechazado en la puerta** — `required` en Make significa **no-vacío**, corregido a `required:false` en Vehiculos/Notas; el 306 (obra TEST, con matrícula y notas multilínea) recorrió el pipeline completo. **Blueprints ya versionados**: `scripts/export-blueprints-make.py` exporta saneando secretos a [docs/blueprints-make/](docs/blueprints-make/) — a partir de ahora hay `git diff` de lo que se toca en la UI de Make. Abiertos **E1** 🟠 (token Notion hardcodeado — resultó estar en **5 sitios de 3 escenarios**, no 2 de 1; el intento vía key de Make se revirtió porque la API descarta los `parameters` de las keys), **E4–E7** y **I8** (tras `enviar-datos`, si la recarga del listado falla la UI muestra Borrador y reactiva el botón). Acceso API a Make de producción operativo: `MAKE_TOKEN` en `.env` (org cliente `4157465`, team `2014883`; ver sección Escenarios Make). — **v1.8.0 — botón "Exportar CSV" en la app** para los cuadrantes de Chorus: modal con rango de fechas (por defecto día 1 del mes → hoy), **confirmación explícita si el rango cruza meses**, y las reglas de negocio aplicadas en servidor (excluye partes rectificados y obras de prueba, agrega por obra/trabajador/día, reporta incidencias y partes sin firmar). Nuevo endpoint **paginado** `GET /api/exportaciones/chorus` — el cliente itera páginas para que ninguna petición se acerque al timeout serverless; `filter_properties` baja un mes de 410 KB/3,9 s a 37 KB/0,6 s. Verificado contra junio 2026: **idéntico al CSV que ya validó el cliente** (254 filas / 2.083 h) + **verificación visual en navegador** (exportación real de julio y diálogo de confirmación cross-mes). Ver [CHANGELOG_V1.8.0.md](CHANGELOG_V1.8.0.md). — **incidencia Make resuelta, sin cambios de código**: `400 Bad control character in JSON` en PARTES1/4 y PARTES2/4 — los dos escenarios que construyen el body JSON a mano — por saltos de línea de `Notas`; resuelto con `escapeJSON()`. Los 5 partes afectados (269/272/276/278 Lentiscos, 293 Las Palmas) relanzados desde Notion y funcionando. En el mismo pase se detectó y cerró que `Vehiculos del parte` llegaba vacío en el webhook #8 de PARTES2/4 → el PDF salía sin matrículas. Tres gotchas nuevos en este archivo: `escapeJSON()` y su excepción, redeterminar la estructura del webhook receptor tras cambiar un payload, y que arreglar un escenario no arregla sus ejecuciones ya encoladas. Detalle en [docs/DEUDA_TECNICA.md](docs/DEUDA_TECNICA.md) → M5 y M8; quedan abiertos M6 y M7, sin impacto en cliente. — 2026-07-14: procedimiento nuevo: exportación de partes a CSV para los cuadrantes Chorus de Tomeu — ver [docs/EXPORT_CHORUS_CSV.md](docs/EXPORT_CHORUS_CSV.md) + [scripts/export-chorus-csv.py](scripts/export-chorus-csv.py). v1.7.1 — icono `Truck` junto a las matrículas en el listado. v1.7.0 — vehículos como **relación** Notion: `Vehiculos ` (relation, espacio final, bidireccional con la BD de flota) es la fuente de verdad; `Vehiculos` (rich_text) queda como **espejo de texto que escribe el servidor** para el pipeline Make/PDF (que no cambia). UI con chips (sin texto libre, adiós bug de la coma final). Ambas propiedades verificadas por API en Notion (relación + espejo rich_text). Changelogs: [V1.5.0](CHANGELOG_V1.5.0.md) · [V1.5.1](CHANGELOG_V1.5.1.md) · [V1.6.0](CHANGELOG_V1.6.0.md) · [V1.6.1](CHANGELOG_V1.6.1.md) · [V1.7.0](CHANGELOG_V1.7.0.md) · [V1.7.1](CHANGELOG_V1.7.1.md))

---

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | React 18 + Vite 7 (`src/`) |
| Backend | Node.js + Express 4 — **monolítico en [server.js](server.js)** (~830 líneas) |
| BBDD | Notion API v1 (vía `src-server/services/notion.js`, sin SDK) |
| PDF + firma | Make.com vía webhook (`PARTES_DATOS_WEBHOOK_URL`) |
| Hosting | Vercel (config en [vercel.json](vercel.json), región `cdg1`) |
| Cliente API frontend | [src/services/notionService.js](src/services/notionService.js) (axios contra `/api/*` same-origin) |

**Nota:** no hay tests automatizados en el repo. Verificación es manual.

---

## Arquitectura — Flujo de datos

```
React SPA (src/App.jsx)
     │  fetch /api/*
     ▼
Express server.js
  ├─ axios → api.notion.com/v1     (lectura/escritura BBDDs)
  └─ axios → hook.eu2.make.com/... (enviar-datos → genera PDF, firma, OneDrive)
```

El servidor sanea las respuestas: **ningún endpoint `/api/*` devuelve datos económicos** (precios/importes). Esto es deliberado y debe mantenerse.

---

## Acceso a Notion del cliente

**REGLA CRÍTICA — SIN EXCEPCIONES:** Para cualquier consulta o verificación del workspace Notion de Copuno, usar **siempre la API de Notion directamente** con el token de `.env` (`NOTION_TOKEN`). Nunca usar el MCP de Notion — apunta al workspace privado de Javi, no al del cliente.

Ejemplo de consulta:
```bash
curl -s -X POST "https://api.notion.com/v1/search" \
  -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{"filter": {"value": "database", "property": "object"}}'
```

Esto aplica a: verificar propiedades, IDs de BDs, opciones de selects, estructura de relaciones, o cualquier dato del workspace antes de implementar.

---

## Bases de datos Notion

IDs hardcoded en [server.js#L27-33](server.js#L27-L33). Esquema detallado en [docs/notion-schema-detailed.md](docs/notion-schema-detailed.md).

| Constante en código | Nombre Notion | Propósito |
|---|---|---|
| `OBRAS` | Obras | Obras/proyectos activos |
| `JEFE_OBRAS` | Persona Autorizada | Jefes que pueden firmar |
| `EMPLEADOS` | Empleados | Plantilla, con categoría y estado |
| `PARTES_TRABAJO` | Partes de trabajo | **Tabla principal**: un parte = una jornada en una obra |
| `DETALLES_HORA` | Detalle Horas | Horas por empleado dentro de un parte (relación) |
| `VEHICULOS` | Vehículos  | Flota (title = `Matrícula`) — fuente del autocompletado del campo Vehículos (v1.6.0). OJO: el nombre de la BD lleva espacio final |

Propiedades críticas en **Partes de trabajo**:
- `Estado` (status) — controla qué se puede editar.
- `URL PDF` (url) + `AUX ID PDF Onedrive` (rich_text) — PDF generado por Make en OneDrive.
- `Firmar` (formula → URL externa `copuno.com/es/notion/?parteId=...`) + `TOCAR URL PARA FIRMAR` (rich_text) — entrada a la firma.
- `Documento Firmado` (files) — PDF firmado subido tras la firma.
- `Detalle Horas` (relation) — horas por empleado.
- `Notas` (rich_text).
- `Vehiculos ` (relation, **OJO espacio final** — v1.7.0) — relación bidireccional con la BD Vehículos (inversa `Partes de trabajo`). **Fuente de verdad** del parte↔flota.
- `Vehiculos` (rich_text, **SIN tilde** — v1.5.1) — **espejo de texto que escribe siempre el servidor** (matrículas `, `-separadas, sin coma final) a partir de la relación; es lo que consume Make → PDF. No editar a mano. En `enviar-datos` (v1.7.0) se **re-deriva** desde la relación justo antes del PDF, por si la relación se editó a mano en Notion (`partesTrabajo.sincronizarEspejoVehiculos`). Se descartó usar una fórmula Notion como espejo: no es versionable (la API no la crea) y obligaría a reapuntar el path de Make a `.formula.string`.

---

## Endpoints API

Todos en [server.js](server.js), prefijo `/api/*`. Referencia completa en [docs/API_REFERENCIA.md](docs/API_REFERENCIA.md).

| Método | Ruta | Línea |
|---|---|---|
| GET | `/api/health` | [server.js:292](server.js#L292) |
| GET | `/api/obras` | [server.js:305](server.js#L305) |
| GET | `/api/jefes-obra` | [server.js:336](server.js#L336) |
| GET | `/api/empleados` | [server.js:365](server.js#L365) |
| GET | `/api/empleados/estado-opciones` | [server.js:400](server.js#L400) |
| PUT | `/api/empleados/:id/estado` | [server.js:432](server.js#L432) |
| GET | `/api/empleados/buscar` | **Etapa 2 — F5** (`?q=texto`, server-side `title.contains`) + **Etapa 3 — F2** (`?id=NNNN`, filtro `number.equals`, maneja duplicados) |
| GET | `/api/vehiculos/buscar` | **v1.6.0** (`?q=texto`, mín. 2 chars, `Matrícula` title.contains contra BD Vehículos, cache corta) |
| GET | `/api/exportaciones/chorus` | **v1.8.0** (`?desde=&hasta=&cursor=`) — **paginado**: devuelve una página de Notion por llamada, el cliente itera hasta `done`. Ver [docs/EXPORT_CHORUS_CSV.md](docs/EXPORT_CHORUS_CSV.md) |
| GET | `/api/obras/:id/empleados` | [server.js:482](server.js#L482) — **Etapa 1 — C3:** query filtrada (sin N+1) |
| GET | `/api/obras/:id/firmantes-autorizados` | **Etapa 2 — F4.** Lee `OBRAS.Persona Autorizada` → JEFE_OBRAS, devuelve `{id, nombre, email, rol}` |
| GET | `/api/partes-trabajo` | [server.js:534](server.js#L534) |
| POST | `/api/partes-trabajo` | [server.js:580](server.js#L580) |
| GET | `/api/partes-trabajo/:id/empleados` | [server.js:755](server.js#L755) |
| GET | `/api/partes-trabajo/:id/detalles` | [server.js:795](server.js#L795) |
| GET | `/api/partes-trabajo/:id/estado` | [server.js:859](server.js#L859) |
| ~~GET (SSE)~~ | ~~`/api/partes-trabajo/:id/estado/stream`~~ | **Eliminado en v1.3.0** — sustituido por polling client-side en `App.jsx` contra `/api/partes-trabajo/:id/estado`. |
| POST | `/api/partes-trabajo/:id/enviar-datos` | [server.js:979](server.js#L979) — **dispara webhook Make** |
| POST | `/api/partes-trabajo/:id/rectificar` | **Rectificativos.** Crea parte nuevo (Borrador) a partir de uno **Firmado** o **Datos Enviados**: copia cabecera + detalles, enlaza vía relación reflexiva `Rectifica a`. |
| PUT | `/api/partes-trabajo/:id` | [server.js:1104](server.js#L1104) |
| GET | `/api/datos-completos` | [server.js:1342](server.js#L1342) |
| GET | `/*` (catch-all SPA) | [server.js:1376](server.js#L1376) |

---

## Flujos críticos — NO ROMPER

Cualquier cambio que toque estos flujos requiere validación previa con `@regression-checker`.

### 1. Firma digital del jefe de obra
- Make recibe el parte → genera PDF → escribe `URL PDF` en Notion → la fórmula `Firmar` construye la URL pública → el jefe la abre, firma → Make sube el resultado a `Documento Firmado`.
- En la app, el estado del parte transita a `firmado` (estado que **bloquea edición** — ver [server.js:1104+](server.js#L1104)).

### 2. Generación + almacenamiento del PDF
- Trigger: `POST /api/partes-trabajo/:id/enviar-datos` ([server.js:979](server.js#L979)).
- Flujo (C2 cerrado 2026-05-27): (1) PATCH estado → `Procesando` (lock optimista), (2) `axios.post(PARTES_DATOS_WEBHOOK_URL, payload)`, (3) PATCH estado → `Datos Enviados`.
- Si el webhook falla, el parte queda en `Procesando` (bloqueado — no se puede reenviar accidentalmente). Reconciliación manual en Notion.
- Si `PARTES_DATOS_WEBHOOK_URL` no está definida, **se simula** y se loguea (modo desarrollo).
- Make persiste el PDF en OneDrive y graba `URL PDF` + `AUX ID PDF Onedrive` en Notion.

### 3. Sincronización con Notion
- Toda escritura va vía servidor (nunca desde el cliente). El cliente lee con polling adaptativo (ver más abajo).
- Estados que **bloquean edición** en PUT (lógica en [server.js:1104+](server.js#L1104)): `firmado`, `datos enviados`, `procesando`.

### 4. Partes rectificativos
- `POST /api/partes-trabajo/:id/rectificar` crea un **parte nuevo** (Borrador) a partir de uno **Firmado** o **Datos Enviados** (constante `PARTE_RECTIFICABLES`), copiando cabecera + `Detalle Horas`, y lo enlaza al original mediante la relación reflexiva `Rectifica a ` (inversa `Rectificado por `). El original **no se modifica**.
- El campo `Notas` del rectificativo lleva siempre el prefijo `PARTE RECTIFICATIVO` (seguido de las notas originales si las había) — sirve para identificarlo de un vistazo en Notion además de por la relación.
- El rectificativo reutiliza íntegro el pipeline existente (flujos 1 y 2): el usuario corrige → `enviar-datos` → PDF → firma. Como tiene su propio `ID` único, su URL de firma y su fichero OneDrive no colisionan con el original.
- En la UI: botón "Rectificar" en el listado, en partes `Firmado` o `Datos Enviados` no rectificados → modal de confirmación propio → al confirmar abre el rectificativo en edición. Badges "Rectificativo"/"Rectificado" en el listado.
- **Dependencia manual (Notion):** requiere las propiedades `Rectifica a ` / `Rectificado por ` (relación reflexiva dual; **OJO: ambas tienen un espacio al final del nombre** — así están creadas en Notion y así las referencia el código) y la fórmula `Es Rectificativo` en la BD `Partes de trabajo`. **Dependencia manual (Make):** marcar el PDF como "RECTIFICATIVO" propagando `Es Rectificativo` por PARTES1-4→2-4→3-4 y añadiendo la variable a `Plantilla Parte.docx`. Sin el paso de Make el flujo funciona pero el PDF no lleva la marca visual. Detalle en [docs/DEUDA_TECNICA.md](docs/DEUDA_TECNICA.md).

---

## Escenarios Make (blueprints exportados)

**Dos carpetas, y la diferencia es importante:**

| Carpeta | Git | Qué es |
|---|---|---|
| [docs/blueprints-make/](docs/blueprints-make/) | ✅ **versionada** | Blueprints **saneados** (secretos → `<NOTION_TOKEN_REDACTADO>`). Es lo que da historial y `git diff` de los cambios hechos en la UI de Make. |
| [docs/Escenarios Make/](docs/Escenarios%20Make/) | ❌ `.gitignore` | Blueprints **crudos**, con el token Notion en claro (M9/E1). **Nunca commitear.** Solo se generan con `--raw`. |

**Flujo de trabajo — ejecutar SIEMPRE antes de auditar o diagnosticar el lado Make:**

```bash
python3 scripts/export-blueprints-make.py && git diff docs/blueprints-make/
```

Descarga los 9 escenarios de producción, sanea y escribe la copia versionable; el diff dice exactamente qué cambió desde la última vez. El script **aborta sin escribir nada** si detecta un patrón de secreto que no sabe sanear (fallo en seguro). Requiere `MAKE_TOKEN` en `.env`. Añade `--raw` solo si necesitas el crudo para reimportar en Make.

**La referencia canónica del lado Make sigue siendo producción (eu2), no el repo** — la copia versionada es una foto que solo está al día si has ejecutado el script. Consulta puntual por API:

```bash
set -a && . ./.env && set +a
curl -s -H "Authorization: Token $MAKE_TOKEN" \
  "https://eu2.make.com/api/v2/scenarios/5595847/blueprint"
```

Escenarios del team `2014883` (Copuno): PARTES1/4 `5595847` · PARTES2/4 `5595873` · PARTES3/4 `5682485` · PARTES4/4 `5682572` · Envío al cliente `6534716` · Limpieza temporales `5682602` (activo, no documentado). Inactivos: `9407545` (clon fix paginación de 1/4), `8558385` (WIP CSV horas), `7899695` (limpieza detalle horas).

**Gotchas de la API de Make** (verificados 28-jul): `PATCH /scenarios/{id}` con `{blueprint}` y `PATCH /data-structures/{id}` con `{spec}` **sí funcionan**. En cambio `PATCH /hooks/{id}` (campo `data.udt`) y `POST|PATCH /keys` (campo `parameters`) **devuelven 200 y descartan el cambio en silencio** — esas dos cosas solo se configuran desde la UI. Y la API rechaza con **403** el `User-Agent` por defecto de `urllib`: hay que mandar uno propio.

| Escenario | Archivo | Función |
|---|---|---|
| PARTES 1/4 | `PARTES1-4 - Recojo cabecera del parte.blueprint.json` | Recoge cabecera del parte desde Notion |
| PARTES 2/4 | `PARTES2-4  - Recupero detalles parte.blueprint.json` | Recupera detalles (horas por empleado) |
| PARTES 3/4 | `PARTES3-4  - Recibo datos del parte para generar el pdf.blueprint.json` | Genera el PDF y lo guarda en OneDrive → escribe `URL PDF` + `AUX ID PDF Onedrive` en Notion |
| PARTES 4/4 | `PARTES4-4  - Recojo Firma.blueprint.json` | Recibe la firma del jefe de obra → sube `Documento Firmado` a Notion |
| Envío cliente | `Envío del parte al cliente - botón enviar email.blueprint.json` | Botón "Enviar email" → entrega el parte firmado al cliente |

Cuando se debuguee un fallo del lado Make (p. ej. `invalid_grant`, PDF no se genera, firma no aparece), comparar el escenario activo en Make.com contra el blueprint del repo permite detectar drift de configuración. Invocar `@notion-integration-inspector` para diagnosis cruzada Notion↔Make.

---

## Smart Polling (sincronización en tiempo cuasi-real)

Detalle completo en [docs/SMART_POLLING.md](docs/SMART_POLLING.md). Resumen:

- Tres modos adaptativos: **Rápido 3 s** (cambios recientes), **Normal 8 s** (30 s-2 min), **Lento 15 s** (>2 min sin cambios).
- Detección de cambios mediante hash `id-estado-ultimaEdicion`.
- Implementado en frontend ([src/App.jsx](src/App.jsx)) y backend (SSE en [server.js](server.js) endpoint `/api/partes-trabajo/:id/estado/stream`).
- `CACHE_TTL_MS` (env, default 30 s) gobierna el cache de catálogos del servidor.

**Queja recurrente del cliente:** "la app no actualiza, hay que refrescar manual". Si toca debugear esto, invoca `@notion-integration-inspector` antes.

---

## Cómo trabajar

```bash
npm install
npm run dev          # Vite dev server (frontend solo, requiere proxy o server aparte)
npm run server       # Express en :3001 (sirve /api/* y /dist)
npm run dev:full     # build + server (modo producción local)
npm run build        # vite build → /dist
```

**Modo mock:** `USE_MOCK_DATA=true` o `NOTION_TOKEN=mock` → no llama a Notion, usa [mock/mockData.js](mock/mockData.js). Útil para desarrollo sin token.

**Deploy:** push a `master` → Vercel autodespliega. Variables de entorno en Vercel Dashboard.

---

## Variables de entorno

Plantilla completa en [env.example](env.example). Mínimas para arrancar:

| Variable | Default | Notas |
|---|---|---|
| `NOTION_TOKEN` | — | **Requerida** (o `USE_MOCK_DATA=true`). Integración interna Notion. |
| `PARTES_DATOS_WEBHOOK_URL` | — | Webhook Make. Sin él, `enviar-datos` se simula. |
| `PORT` | `3001` | En Vercel se asigna automáticamente. |
| `CACHE_TTL_MS` | `30000` | TTL del cache de catálogos del servidor (30 s). En tests se fuerza a `0`. |
| `ALLOWED_ORIGINS` | (vacío = permitir todos) | CSV. En producción configurar a `https://app.copuno.com` cuando el dominio esté activo (ADR-005). |
| `RATE_LIMIT_WINDOW_MS` | `900000` | 15 min. |
| `RATE_LIMIT_MAX` | `100` | Peticiones por ventana e IP. |
| `PARTES_WEBHOOK_TIMEOUT_MS` | `10000` | Timeout al webhook Make. |
| `USE_MOCK_DATA` | `false` | Modo desarrollo sin Notion. |

---

## Gotchas y cosas no obvias

- **Deuda técnica conocida documentada en [docs/DEUDA_TECNICA.md](docs/DEUDA_TECNICA.md).** Consultar antes de proponer mejoras "nuevas" — probablemente ya está catalogada con severidad y coste.
- **El servidor falla rápido sin `NOTION_TOKEN`** ([server.js:75-79](server.js#L75-L79)): `process.exit(1)` si faltan token y mock está off.
- **`vercel.json` usa `rewrites`**, no `routes` como dice [docs/DESPLIEGUE_VERCEL.md](docs/DESPLIEGUE_VERCEL.md). La doc está desfasada — el archivo manda.
- **Discrepancia de dominios en docs (resuelta 2026-07-28):** durante meses convivieron tres nombres — `gestionpartes.copuno.com` (README), `partesobra.copuno.com` (CLAUDE.md, instrucciones DNS) y la URL de Vercel. **Ninguno de los dos subdominios llegó a crearse**: `partesobra.copuno.com` devuelve NXDOMAIN. La única URL viva es `https://copuno-gestion-partes.vercel.app/`. El destino acordado es **`app.copuno.com/partes`** ([ADR-005](docs/adr/ADR-005-dominio-y-espacio-de-nombres.md)). Lección: la doc declaraba una intención como si fuera un hecho — verificar con `nslookup` antes de dar un dominio por bueno.
- **Un dominio, un módulo por ruta (ADR-005).** La plataforma vive bajo `app.copuno.com` y cada módulo es una ruta de primer nivel (`/partes`, `/vehiculos`, `/almacen`). Motivo principal más allá del DNS: **Supabase Auth ligará la sesión al origen**, así que un único dominio = un único login para todos los módulos. No crear subdominios por app.
- **Mover la app de `/` a `/partes` no es un alias DNS.** Hay que tocar el `base` de Vite, el catch-all SPA de [server.js](server.js) y las rutas de assets de [vercel.json](vercel.json). Y antes del corte, revisar el flujo de firma: `Firmar` es una fórmula Notion que construye una URL externa y Make escribe sobre ella.
- **Saneado económico:** los endpoints `/api/*` redactan precios/importes antes de devolver. No "arregles" esto pensando que es un bug.
- **8 h por defecto al seleccionar empleado** (v1.0.2, [src/App.jsx](src/App.jsx)). Es UX intencional.
- **El `Documento Firmado` lo sube Make, no el frontend.** Si ves que falta, mira el escenario Make.
- **Errores `invalid_grant` en Make** suelen ser token Notion expirado/rotado o conexión OAuth de Make caducada. Diagnóstico: `@notion-integration-inspector`.
- **`server.js` es un monolito de ~1.400 líneas.** No es bonito pero funciona. Refactor mayor está fuera del retainer (proyecto aparte).
- **El editor de Make trunca los paths IML con caracteres no-ASCII** (tildes, etc.) al teclear o pegar en sus campos de mapeo — el motor los soporta, el editor no. Por eso la propiedad es `Vehiculos` sin tilde (v1.5.1). Regla: **propiedades Notion que viajen a Make, siempre sin tildes ni caracteres especiales**; para ediciones masivas de escenarios usar export → editar JSON → import blueprint.
- **JSON escrito a mano en Make → envolver SIEMPRE el texto libre en `escapeJSON()`.** Los módulos HTTP con Body `Raw` + `application/json` construyen el JSON como plantilla de texto: cualquier salto de línea real (`\n`, 0x0A) procedente de Notion (típicamente `Notas`) invalida el JSON y el webhook receptor responde `400 Bad control character in string literal in JSON at position N`. **No sirve `replace(texto; "\n"; " ")`**: el editor de Make interpreta ese `"\n"` como los dos caracteres `\`+`n`, no como el byte de control, así que no sustituye nada. Ha reincidido tres veces (DEUDA_TECNICA M2, M4, M5). En módulos nuevos, preferir **JSON → Create JSON** con Data structure, que escapa solo.
  **Excepción — no escapar nunca lo que ya es estructura JSON:** `"Detalle del parte": [{{2.text}}]` en PARTES2/4 viene del *Text aggregator* y ya es un array JSON; envolverlo en `escapeJSON()` escaparía sus corchetes y comillas y rompería el body. La regla aplica a **cadenas de texto libre**, no a fragmentos JSON pre-construidos. Tampoco a numéricos (llevan `ifempty(…; 0)`) ni a `Fecha Parte` / `ID Pag Notion Parte`.
- **Qué escenarios Make escriben JSON a mano** (los únicos expuestos al fallo anterior): **PARTES1/4** (`5595847`, módulo #249) y **PARTES2/4** (`5595873`, módulo #37). **PARTES3/4** (`5682485`) y **PARTES4/4** (`5682572`) usan mapeo nativo de campos (Drive / PDF / Notion) y no están afectados.
- **Si cambias el payload de un tramo, redetermina la estructura del webhook receptor.** Un campo nuevo que el webhook no conoce aparece como *variable desconocida* y **resuelve vacío en silencio**: sin error, sin ejecución incompleta, sin log — sólo se detecta mirando el PDF final. Pasó con `Vehiculos del parte` entre PARTES1/4 y PARTES2/4 (DEUDA_TECNICA M8): las matrículas se perdían en el tramo 2/4 y el PDF salía sin ellas, pese a que la prueba E2E de I6 había pasado semanas antes. Regla: tras tocar el payload, *Redetermine data structure* en el receptor + **validación E2E mirando el PDF**, no sólo que el escenario termine en verde. **Actualización 28-jul (E3):** los webhooks de 2/4 y 3/4 ya tienen data structure **declarada y obligatoria** (`608077`/`608078`, ver [docs/E3_CONTRATO_WEBHOOKS.md](docs/E3_CONTRATO_WEBHOOKS.md)) — el vacío silencioso pasó a ser un **400 en la puerta**. La regla operativa ahora es de orden: para añadir un campo al pipeline, **primero ampliar la Data structure del receptor, después el payload del emisor**; al revés, el emisor recibe 400 (comportamiento diseñado). La asociación estructura↔webhook solo puede hacerse en la UI (la API ignora `data.udt` en silencio).
- **Arreglar un escenario Make NO arregla sus ejecuciones ya encoladas.** Tanto las *ejecuciones incompletas* como los bundles de la IEQ guardan **una copia del blueprint vigente en el momento del fallo**: al reintentarlos se reejecuta esa copia, no la plantilla corregida, y vuelven a fallar igual. Make no ofrece "reintentar con la versión actual". Tras corregir un mapeo, la recuperación es **relanzar el origen** (webhook desde Notion, o reenviar desde la app) para que la ejecución nazca de cero, y después limpiar la cola. Confirmado en DEUDA_TECNICA M4 (IEQ) y M5 (cola de incompletas).
- **Los escenarios Make de producción viven en la org del CLIENTE**, no en la personal: `eu2.make.com`, **organization ID `4157465`**, **team ID `2014883`** (PARTES1/4 = escenario `5595847`). **OJO: `2014883` es el TEAM, no la organización** — es el número que aparece en las URLs de escenarios (`/2014883/scenarios/...`) y durante meses se documentó erróneamente como org ID; los endpoints de organización y de team esperan IDs distintos, así que usar el equivocado devuelve 403/404 sin explicar por qué. Los duplicados en la org personal *Javi & Tamara* (`eu1.make.com`, org `581441`, PARTES1/4 = `3218313`) son **backup** y pueden tener drift respecto a producción: no valen como evidencia de diagnóstico. Aplicar los fixes sobre la org del cliente y verificar en cuál se está antes de tocar nada.
- **Las zonas de Make están aisladas**: un token de `eu1` no ve absolutamente nada de `eu2` (el endpoint base es distinto, `eu1.make.com/api/v2` vs `eu2.make.com/api/v2`). No es un problema de permisos y no se arregla con scopes — hacen falta dos tokens y, en Claude Code, dos servidores MCP separados (`make-personal` / `make-copuno`) para que la elección de organización sea una elección de herramienta y no un parámetro olvidable.
- **Nombres de propiedad Notion con espacios al final:** algunas propiedades tienen un espacio final en su nombre (`'Rectifica a '`, `'Rectificado por '`, `' Email'`, `'Horas Encargado '`, `'Horas Oficial 2ª '`). Hay que referenciarlas **exactamente** así o la lectura/escritura falla en silencio. Verificar siempre el nombre real vía API antes de usarlo.
- **Banner de actualización:** la app compara `__APP_VERSION__` (embebida en build) con `version` de `/api/health` cada **1 minuto**; si difieren, muestra el banner. Por eso **cada deploy necesita un bump de versión** en `package.json` (ver Convenciones).
- **Smart Polling en modal de detalles (v1.3.0):** usa polling adaptativo client-side (3 s/8 s/15 s) contra `GET /api/partes-trabajo/:id/estado`. El endpoint SSE ya no existe — devuelve 404 si se llama. El polling vive en `App.jsx` en el `useEffect` con `estadoPollRef`.
- **Google Drive "desmaterializa" binarios de `node_modules` y macOS los mata con SIGKILL (exit 137).** El repo vive en una ruta de Google Drive File Provider; cuando Drive descarga contenido a la nube para liberar espacio, ejecutar un binario desde ahí (típicamente `@esbuild/darwin-arm64/bin/esbuild` al hacer `npm run build`) muere al instante con `Error: The service was stopped` / exit 137, **aunque la firma de código sea válida**. Diagnóstico: el mismo binario funciona copiado a `/tmp`. Arreglo: re-hidratar releyendo los ficheros (`find node_modules -type f -print0 | xargs -0 cat > /dev/null`) o marcar la carpeta "Disponible sin conexión" en Drive. El primer build tras re-hidratar tarda varios minutos; los siguientes vuelven a ser rápidos. (Detectado 2026-07-28, v1.8.0.)

---

## Subagentes disponibles

Definidos en [.claude/agents/](.claude/agents/). Invocar con `@<nombre>` cuando aplique:

| Agente | Cuándo invocarlo | Tools |
|---|---|---|
| [`@senior-architect-auditor`](.claude/agents/senior-architect-auditor.md) | Antes de refactors mayores, al planificar nuevos módulos o cuando se necesita un análisis arquitectónico estructurado con severidad + lente ROI. | Read, Grep, Glob, Bash (opus) |
| [`@notion-integration-inspector`](.claude/agents/notion-integration-inspector.md) | Antes de tocar la capa Notion: esquema, queries, sync, `invalid_grant`, "app no actualiza". | Read, Grep, Glob, Bash |
| [`@regression-checker`](.claude/agents/regression-checker.md) | **Antes de mergear cualquier cambio.** Verifica firma, PDF y sync Notion. | Read, Grep, Glob, Bash |
| [`@scope-guardian`](.claude/agents/scope-guardian.md) | Cada petición nueva del cliente Copuno: ¿retainer o proyecto aparte? | Read |

**Convención:** los tres son read-only. Para implementar, sale el agente principal con los hallazgos.

---

## Convenciones del proyecto

- **Idioma:** español en docs, comentarios, nombres de propiedades Notion y mensajes UI. Código JS estándar (camelCase, inglés en identificadores cuando ya es así).
- **`.env`** está en `.gitignore`. **Nunca** commitear tokens.
- **Versionado:** SemVer en [package.json](package.json) y `CHANGELOG_V*.md` por release. **Cada deploy debe incluir un bump de versión acorde al peso del cambio:** `patch` (X.X.+1) para fixes y ajustes menores, `minor` (X.+1.0) para funcionalidad nueva sin romper compatibilidad, `major` (+1.0.0) para cambios estructurales o breaking. El banner de actualización en la app depende de este bump — sin él, los usuarios no verán la notificación de nueva versión.
- **Deuda técnica:** **siempre** que se añada, cierre o reclasifique un hallazgo en [docs/DEUDA_TECNICA.md](docs/DEUDA_TECNICA.md), actualizar (1) el cambio, (2) la fecha "Última edición" del bloque superior y (3) una nueva entrada en la sección "Historial de cambios" al final del documento. Sin excepciones — la cronología es la utilidad del archivo.
- **Despliegue:** trunk-based en `master`. No hay `develop`. Vercel preview en cada PR.
- **No introducir librerías nuevas sin necesidad real** — el stack es deliberadamente sencillo.

---

## Cliente — contexto rápido

- Empresa de construcción con delegaciones (Madrid base, planes de Cataluña y Noruega — fuera de scope del retainer).
- Usuarios: jefes de obra (firman partes desde móvil/tablet), oficina (consulta).
- Punto de contacto: Efrén (técnico/operativo del lado cliente).
- Cualquier ampliación grande del sistema (módulos nuevos, integraciones Chorus/OneNote/WhatsApp, portal del empleado) es **proyecto aparte**. Ver [.claude/scope-rules.md](.claude/scope-rules.md).
