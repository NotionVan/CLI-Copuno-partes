# Copuno — Gestión de Partes

Webapp interna del cliente **Copuno** para que los jefes de obra creen y firmen partes de trabajo diarios. Backend de datos en **Notion**, generación de PDFs y firma vía **Make.com**, hosting en **Vercel**.

- **Producción:** https://partesobra.copuno.com
- **Versión actual:** [package.json](package.json) → `version`
- **Cliente:** Copuno (sector construcción, varias delegaciones)
- **Modelo comercial:** retainer mensual 20 h. Detalle y reglas de scope en [.claude/scope-rules.md](.claude/scope-rules.md).
- **Última edición:** 2026-07-14 (v1.7.0 — vehículos como **relación** Notion: `Vehiculos ` (relation, espacio final, bidireccional con la BD de flota) es la fuente de verdad; `Vehiculos` (rich_text) queda como **espejo de texto que escribe el servidor** para el pipeline Make/PDF (que no cambia). UI con chips (sin texto libre, adiós bug de la coma final). ⚠️ El espejo rich_text debe existir en Notion antes de desplegar. Changelogs: [V1.5.0](CHANGELOG_V1.5.0.md) · [V1.5.1](CHANGELOG_V1.5.1.md) · [V1.6.0](CHANGELOG_V1.6.0.md) · [V1.6.1](CHANGELOG_V1.6.1.md) · [V1.7.0](CHANGELOG_V1.7.0.md))

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
- `Vehiculos` (rich_text, **SIN tilde** — v1.5.1) — **espejo de texto que escribe siempre el servidor** (matrículas `, `-separadas, sin coma final) a partir de la relación; es lo que consume Make → PDF. No editar a mano.

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

Los blueprints JSON de los escenarios Make.com están versionados en [docs/Escenarios Make/](docs/Escenarios%20Make/). Son la referencia canónica del lado Make — el escenario activo en producción debe coincidir con estos archivos.

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
| `ALLOWED_ORIGINS` | (vacío = permitir todos) | CSV. En producción configurar a `https://partesobra.copuno.com`. |
| `RATE_LIMIT_WINDOW_MS` | `900000` | 15 min. |
| `RATE_LIMIT_MAX` | `100` | Peticiones por ventana e IP. |
| `PARTES_WEBHOOK_TIMEOUT_MS` | `10000` | Timeout al webhook Make. |
| `USE_MOCK_DATA` | `false` | Modo desarrollo sin Notion. |

---

## Gotchas y cosas no obvias

- **Deuda técnica conocida documentada en [docs/DEUDA_TECNICA.md](docs/DEUDA_TECNICA.md).** Consultar antes de proponer mejoras "nuevas" — probablemente ya está catalogada con severidad y coste.
- **El servidor falla rápido sin `NOTION_TOKEN`** ([server.js:75-79](server.js#L75-L79)): `process.exit(1)` si faltan token y mock está off.
- **`vercel.json` usa `rewrites`**, no `routes` como dice [docs/DESPLIEGUE_VERCEL.md](docs/DESPLIEGUE_VERCEL.md). La doc está desfasada — el archivo manda.
- **Discrepancia de dominios en docs:** el README menciona `gestionpartes.copuno.com`, las instrucciones DNS hablan de `partesobra.copuno.com`. **El real es `partesobra.copuno.com`**.
- **Saneado económico:** los endpoints `/api/*` redactan precios/importes antes de devolver. No "arregles" esto pensando que es un bug.
- **8 h por defecto al seleccionar empleado** (v1.0.2, [src/App.jsx](src/App.jsx)). Es UX intencional.
- **El `Documento Firmado` lo sube Make, no el frontend.** Si ves que falta, mira el escenario Make.
- **Errores `invalid_grant` en Make** suelen ser token Notion expirado/rotado o conexión OAuth de Make caducada. Diagnóstico: `@notion-integration-inspector`.
- **`server.js` es un monolito de ~1.400 líneas.** No es bonito pero funciona. Refactor mayor está fuera del retainer (proyecto aparte).
- **El editor de Make trunca los paths IML con caracteres no-ASCII** (tildes, etc.) al teclear o pegar en sus campos de mapeo — el motor los soporta, el editor no. Por eso la propiedad es `Vehiculos` sin tilde (v1.5.1). Regla: **propiedades Notion que viajen a Make, siempre sin tildes ni caracteres especiales**; para ediciones masivas de escenarios usar export → editar JSON → import blueprint.
- **Nombres de propiedad Notion con espacios al final:** algunas propiedades tienen un espacio final en su nombre (`'Rectifica a '`, `'Rectificado por '`, `' Email'`, `'Horas Encargado '`, `'Horas Oficial 2ª '`). Hay que referenciarlas **exactamente** así o la lectura/escritura falla en silencio. Verificar siempre el nombre real vía API antes de usarlo.
- **Banner de actualización:** la app compara `__APP_VERSION__` (embebida en build) con `version` de `/api/health` cada **1 minuto**; si difieren, muestra el banner. Por eso **cada deploy necesita un bump de versión** en `package.json` (ver Convenciones).
- **Smart Polling en modal de detalles (v1.3.0):** usa polling adaptativo client-side (3 s/8 s/15 s) contra `GET /api/partes-trabajo/:id/estado`. El endpoint SSE ya no existe — devuelve 404 si se llama. El polling vive en `App.jsx` en el `useEffect` con `estadoPollRef`.

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
