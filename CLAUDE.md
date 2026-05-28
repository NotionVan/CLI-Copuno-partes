# Copuno — Gestión de Partes

Webapp interna del cliente **Copuno** para que los jefes de obra creen y firmen partes de trabajo diarios. Backend de datos en **Notion**, generación de PDFs y firma vía **Make.com**, hosting en **Vercel**.

- **Producción:** https://partesobra.copuno.com
- **Versión actual:** [package.json](package.json) → `version`
- **Cliente:** Copuno (sector construcción, varias delegaciones)
- **Modelo comercial:** retainer mensual 20 h. Detalle y reglas de scope en [.claude/scope-rules.md](.claude/scope-rules.md).
- **Última edición:** 2026-05-26 17:30 CEST (Etapas 1 y 2 implementadas — ver [DEUDA_TECNICA.md](docs/DEUDA_TECNICA.md) sección "Etapas implementadas")

---

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | React 18 + Vite 7 (`src/`) |
| Backend | Node.js + Express 4 — **monolítico en [server.js](server.js)** (~1.400 líneas) |
| BBDD | Notion API v1 (consumida con `axios` directamente, sin SDK) |
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

Propiedades críticas en **Partes de trabajo**:
- `Estado` (status) — controla qué se puede editar.
- `URL PDF` (url) + `AUX ID PDF Onedrive` (rich_text) — PDF generado por Make en OneDrive.
- `Firmar` (formula → URL externa `copuno.com/es/notion/?parteId=...`) + `TOCAR URL PARA FIRMAR` (rich_text) — entrada a la firma.
- `Documento Firmado` (files) — PDF firmado subido tras la firma.
- `Detalle Horas` (relation) — horas por empleado.
- `Notas` (rich_text).

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
| GET | `/api/empleados/buscar` | **Etapa 2 — F5.** Server-side filter `title.contains`, mín 3 chars, máx 50 |
| GET | `/api/obras/:id/empleados` | [server.js:482](server.js#L482) — **Etapa 1 — C3:** query filtrada (sin N+1) |
| GET | `/api/obras/:id/firmantes-autorizados` | **Etapa 2 — F4.** Lee `OBRAS.Persona Autorizada` → JEFE_OBRAS, devuelve `{id, nombre, email, rol}` |
| GET | `/api/partes-trabajo` | [server.js:534](server.js#L534) |
| POST | `/api/partes-trabajo` | [server.js:580](server.js#L580) |
| GET | `/api/partes-trabajo/:id/empleados` | [server.js:755](server.js#L755) |
| GET | `/api/partes-trabajo/:id/detalles` | [server.js:795](server.js#L795) |
| GET | `/api/partes-trabajo/:id/estado` | [server.js:859](server.js#L859) |
| GET (SSE) | `/api/partes-trabajo/:id/estado/stream` | [server.js:881](server.js#L881) |
| POST | `/api/partes-trabajo/:id/enviar-datos` | [server.js:979](server.js#L979) — **dispara webhook Make** |
| PUT | `/api/partes-trabajo/:id` | [server.js:1104](server.js#L1104) |
| GET | `/api/datos-completos` | [server.js:1342](server.js#L1342) |
| GET | `/*` (catch-all SPA) | [server.js:1376](server.js#L1376) |

---

## Flujos críticos — NO ROMPER

Cualquier cambio que toque estos tres flujos requiere validación previa con `@regression-checker`.

### 1. Firma digital del jefe de obra
- Make recibe el parte → genera PDF → escribe `URL PDF` en Notion → la fórmula `Firmar` construye la URL pública → el jefe la abre, firma → Make sube el resultado a `Documento Firmado`.
- En la app, el estado del parte transita a `firmado` (estado que **bloquea edición** — ver [server.js:1104+](server.js#L1104)).

### 2. Generación + almacenamiento del PDF
- Trigger: `POST /api/partes-trabajo/:id/enviar-datos` ([server.js:979](server.js#L979)) → hace `axios.post(PARTES_DATOS_WEBHOOK_URL, payload)` con timeout `PARTES_WEBHOOK_TIMEOUT_MS`.
- Si `PARTES_DATOS_WEBHOOK_URL` no está definida, **se simula** y se loguea (modo desarrollo).
- Make persiste el PDF en OneDrive y graba `URL PDF` + `AUX ID PDF Onedrive` en Notion.

### 3. Sincronización con Notion
- Toda escritura va vía servidor (nunca desde el cliente). El cliente lee con polling adaptativo (ver más abajo).
- Estados que **bloquean edición** en PUT (lógica en [server.js:1104+](server.js#L1104)): `firmado`, `datos enviados`, `enviado`.

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
- `CACHE_TTL_MS` (env, default 5 s) gobierna el cache del servidor.

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
| `CACHE_TTL_MS` | `5000` | TTL del cache del servidor (alineado con Smart Polling). |
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
- **Versionado:** SemVer en [package.json](package.json) y `CHANGELOG_V*.md` por release.
- **Deuda técnica:** **siempre** que se añada, cierre o reclasifique un hallazgo en [docs/DEUDA_TECNICA.md](docs/DEUDA_TECNICA.md), actualizar (1) el cambio, (2) la fecha "Última edición" del bloque superior y (3) una nueva entrada en la sección "Historial de cambios" al final del documento. Sin excepciones — la cronología es la utilidad del archivo.
- **Despliegue:** trunk-based en `master`. No hay `develop`. Vercel preview en cada PR.
- **No introducir librerías nuevas sin necesidad real** — el stack es deliberadamente sencillo.

---

## Cliente — contexto rápido

- Empresa de construcción con delegaciones (Madrid base, planes de Cataluña y Noruega — fuera de scope del retainer).
- Usuarios: jefes de obra (firman partes desde móvil/tablet), oficina (consulta).
- Punto de contacto: Efrén (técnico/operativo del lado cliente).
- Cualquier ampliación grande del sistema (módulos nuevos, integraciones Chorus/OneNote/WhatsApp, portal del empleado) es **proyecto aparte**. Ver [.claude/scope-rules.md](.claude/scope-rules.md).
