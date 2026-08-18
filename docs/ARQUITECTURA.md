# Arquitectura — Copuno Gestión de Partes

**Última edición:** 2026-08-18 (sección 3.1 nueva — mecanismos de rendimiento de agosto)
**Versión app:** ver [package.json](../package.json) → `version`
**Estado:** Documento vivo. Actualizar cuando se tomen nuevas decisiones (vía ADR).

---

## 1. Propósito de este documento

Este archivo es el **mapa arquitectónico** de la webapp Copuno. Su función no es describir el código línea a línea (para eso está [CLAUDE.md](../CLAUDE.md)) sino dejar por escrito:

1. Qué arquitectura tiene hoy el sistema y **por qué**.
2. Qué **decisiones clave** se han tomado y bajo qué criterios se revisarían (vía ADRs).
3. Hacia dónde **evolucionaría** el sistema si se activan ciertos criterios (rate limits Notion, incidentes de integridad, etc.).
4. Qué está deliberadamente **fuera del alcance** y por qué.

El lector objetivo es un desarrollador senior que necesita entender el sistema en menos de 30 minutos, o el propio autor dentro de 6-12 meses cuando el contexto se haya enfriado.

---

## 2. Contexto del proyecto

| Aspecto | Realidad |
|---|---|
| Cliente | Copuno (construcción, varias delegaciones) |
| Tipo de app | B2B interno, no public-facing |
| Usuarios | Jefes de obra (móvil/tablet, firman) + oficina (consulta) |
| Concurrencia esperada | Decenas concurrentes pico, no cientos |
| Ciclo de vida estimado | 3-5 años |
| Modelo comercial | Retainer mensual 20 h (ver [.claude/scope-rules.md](../.claude/scope-rules.md)) |
| Equipo dev | 1 dev (Javi) |
| Criticidad | Alta operacional (sin partes firmados → no se factura al cliente final), baja transaccional (no es banca ni e-commerce) |

Este contexto **manda sobre cualquier principio arquitectónico genérico**. Lo que es correcto para Stripe es sobreingeniería aquí, y lo que es suficiente aquí sería negligente en Stripe.

---

## 3. Stack actual

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend: React 18 + Vite 7 (src/)                         │
│  - SPA single-bundle                                        │
│  - Polling adaptativo (Smart Polling 3 modos)               │
│  - axios contra /api/* same-origin                          │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP /api/*
┌────────────────────────▼────────────────────────────────────┐
│  Backend: Node.js + Express 4 (server.js, ~830 líneas)      │
│  - Rutas + middlewares + lógica de negocio                  │
│  - Cache en memoria (TTL configurable, default 30 s)        │
│  - Rate limiting por IP (express-rate-limit)                │
│  - SSE en /api/partes-trabajo/:id/estado/stream             │
│  - Idempotencia en enviar-datos (ADR-004)                   │
└──────┬──────────────────────────────────────┬───────────────┘
       │ data.js → notion.js                  │ axios
       ▼                                      ▼
┌──────────────────┐                ┌────────────────────────┐
│  Notion API v1   │                │  Make.com (webhook)    │
│  (BBDD)          │                │  - Genera PDF          │
│  - 5 BDs         │                │  - Sube a OneDrive     │
│  - 3 req/s limit │                │  - Recibe firma jefe   │
└──────────────────┘                └────────────────────────┘

Hosting: Vercel — **la función corre en `iad1` (Washington)**, no en `cdg1` como decía esta línea hasta el 2026-08-03: `vercel.json` no fija `regions` y se quedó el valor por defecto. Verificado con `x-vercel-id: cdg1::iad1::…` (el primer tramo es el edge, el segundo la ejecución). Plan Pro recomendado al cliente — pendiente de contratación.

> 💡 **Y `iad1` probablemente conviene**: Notion está en EEUU y la app hace muchas llamadas a Notion por cada petición del usuario (N+1, 9 en el arranque). Desde `iad1` son domésticas; desde `cdg1` cada una cruzaría el Atlántico — se ganaría un salto hacia el usuario y se perderían N hacia Notion. **Hipótesis razonada, sin medir**: comprobarlo con la query de partes real (no con `/api/health`, que no toca Notion) antes de mover nada.
```

### Capas lógicas actuales

1. **Rutas HTTP + lógica de negocio** — `server.js`: endpoints, validación inputs, reglas de estado, cache, rate limiting.
2. **Interfaz de datos neutra** — `src-server/services/data.js`: abstracción que los endpoints consumen; branching live/mock transparente.
3. **Integración Notion** — `src-server/services/notion.js`: cliente HTTP, mappers, operaciones por dominio. Ningún endpoint llama a Notion directamente.
4. **Integración Make** — webhook `axios.post` desde `server.js` (único punto de llamada external distinto de Notion).
5. **Idempotencia** — `src-server/lib/idempotency.js`: store TTL en memoria para `enviar-datos` (ADR-004).
6. **Mock** — `mock/mockData.js`: store en memoria para desarrollo sin token Notion.

La separación en archivos es **explícita desde 2026-05-27** (ver ADR-002).

### 3.1 Mecanismos de rendimiento y sincronización (agosto 2026)

> Añadidos en la intervención v1.9.1 → v1.13.2. **Leer antes de tocar lectura,
> escritura o caché**: varios son invisibles en el flujo normal y fáciles de romper
> sin darse cuenta. Resultados medidos en
> [RESULTADOS_RENDIMIENTO_2026-08.md](RESULTADOS_RENDIMIENTO_2026-08.md).

**Lectura**

| Mecanismo | Dónde | Qué hace / qué romper evitar |
|---|---|---|
| `filter_properties` (`PROPS_CATALOGO`, `conProps()`) | `notion.js` | Cada query pide solo los campos que lee su mapper (−62/−74 % de payload). **Si añades un campo a un mapper, añade su ID a la lista o llegará `undefined` en silencio.** |
| `titleDe(page)` | `notion.js` | Localiza la propiedad título **por tipo**, no por nombre. Es la mitigación estructural del incidente I9 (renombrado manual en Notion → nombres vacíos). No sustituir por acceso literal. |
| Caché en memoria con TTL por clave | `server.js` (`setCache/getCache`) | 3er parámetro opcional de TTL; sin él, `CACHE_TTL_MS` (30 s). El catálogo de empleados usa 10 min. **Es por instancia lambda** — ver riesgo abajo. |
| `invalidateCache()` / `invalidarPartes()` / `invalidarEmpleados()` | `server.js` | Se llaman en **las 5 rutas de escritura**. Sin esto, un GET tras escribir puede servir datos viejos 30 s (hallazgo BE-3). **Toda ruta de escritura nueva debe invalidar.** |
| Freshness-check (`hayCambiosDesde`) | `notion.js` + GET partes | Al expirar la foto, query mínima `last_edited_time after cursor` (~0,43 s) antes de repetir la completa (~1,5-2,5 s). Filtro **a nivel timestamp**: inmune a renombres. TTL duro `PARTES_TTL_DURO_MS` (5 min) para cubrir archivados, que el check no ve. |
| Caché de firmantes | `notion.js` | `Promise.all` acotado + 60 s por obra (`FIRMANTES_TTL_MS`). |
| `listarTodos` + guard de petición en vuelo | `notion.js` + `server.js` | Catálogo completo de empleados (~16 páginas). Cada página reintenta ante 429; `catalogoEmpleadosEnVuelo` hace que peticiones concurrentes compartan UNA descarga. |
| Semáforo global hacia Notion | `notion.js` | Máx. 5 peticiones en vuelo. Respeta el límite de 3 req/s **compartido con Make** a nivel de workspace. |

**Escritura**

| Mecanismo | Dónde | Qué hace / qué romper evitar |
|---|---|---|
| `enLotes(items, 3, fn)` | `notion.js` | Detalles de horas en tandas de 3 con barrera, sin pausas. Concurrencia 3 deja 2 huecos del semáforo para lecturas. |
| `conReintento429(fn)` | `notion.js` | Reintento único honrando `Retry-After` en escrituras de detalles y en el paginado del catálogo. |
| `archivarDetallesConRollback` | `notion.js` | **Semántica transaccional**: corta al primer fallo y desarchiva lo ya archivado. Sin esto, una edición fallida a medias deja horas ocultas o duplicadas (llegarían al PDF y al CSV de facturación). |
| Espejo de vehículos | `notion.js` (`sincronizarEspejoVehiculos`) | Se re-deriva de la relación **justo antes** del PDF. **No moverlo fuera del camino de `enviar-datos`**: reabriría el incidente M8 (PDF sin matrículas). |

**Cliente**

| Mecanismo | Dónde | Qué hace / qué romper evitar |
|---|---|---|
| Caché local con revalidación | `src/lib/cacheLocal.js` | Clave versionada `copuno:datos:v<versión>` — cada deploy purga (interruptor gratis). **Sin empleados (DNI/teléfono) ni datos económicos en disco.** Se limpia al cerrar sesión. |
| Polling del listado | `App.jsx` | 12/20/30 s, patrón `cancelled` + `setTimeout` encadenado, hash-guard. Pausado con **edición abierta** (`edicionAbiertaRef`, ref y no estado: una closure capturaría valor stale — causa raíz del C1 original) y en segundo plano. Kill-switch `POLL_ENABLED`. |
| Parche de estado optimista | `App.jsx` (`parcheEstadoRef` + `conParches`) | Se re-aplica sobre **toda** foto entrante (poll, refresh, reconexión, montaje), TTL 60 s. Si se omite en una ruta nueva de datos, reaparece I8: la tarjeta vuelve a «Borrador» tras enviar. |
| Catálogo de empleados memoizado | `notionService.js` (`getCatalogoEmpleados`) | Una descarga por sesión, ordenada alfabéticamente; se olvida en fallo para reintentar. Los filtros locales normalizan acentos (`normalizarTexto`). |
| Rate limiting en dos capas | `server.js` | Grueso por IP **delante** de auth, fino por `req.usuario.id` **detrás**. El orden importa: invertirlo expone la verificación JWT o vuelve al cupo por IP compartido tras el NAT de la central. |

**Riesgo estructural conocido:** toda la caché, la idempotencia y el rate limiting viven
**en memoria por instancia lambda**. Con varias instancias conviven copias
independientes. Instrumentado desde v1.12.3 (`INSTANCE_ID` en `/api/health` y en los
logs); el diseño del store compartido está en
[CACHE_NOTION_INDUSTRIA_2026-08.md](CACHE_NOTION_INDUSTRIA_2026-08.md), pendiente de
decidir con los datos de telemetría.

---

## 4. Decisiones arquitectónicas clave (ADRs)

Cada decisión tiene su propio documento en [docs/adr/](./adr/). Resumen:

| ADR | Decisión | Estado | Criterio de revisión |
|---|---|---|---|
| [ADR-001](./adr/ADR-001-notion-como-bbdd.md) | Notion como BBDD (no Postgres/Mongo desde el día 1) | Vigente | Migrar si: incidente de integridad H2 ocurre / >5.000 partes / cliente deja de editar en Notion |
| [ADR-002](./adr/ADR-002-capa-abstraccion-datos.md) | Capa de abstracción de datos (`src-server/services/data.js`) | **Completo** (todos los endpoints migrados, 2026-05-27) | Reevaluar si se introducen ≥2 fuentes de datos paralelas |
| [ADR-003](./adr/ADR-003-supabase-destino-migracion.md) | Supabase como destino cuando se active el criterio de salida de Notion | Vigente (no ejecutado) | Reevaluar si Supabase cambia modelo de precios o cliente exige on-premise |
| [ADR-004](./adr/ADR-004-idempotencia-enviar-datos.md) | Idempotencia en `POST /api/partes-trabajo/:id/enviar-datos` | **Implementado** (2026-05-27) | Reevaluar al escalar horizontalmente o migrar a Supabase |

ADRs futuros previstos (no escritos aún):

- **ADR-005** — Estrategia de autenticación (a redactar al abordar H1).
- **ADR-006** — Estrategia de observabilidad (logging estructurado + SLI/SLO mínimos).
- **ADR-007** — Estrategia de testing (cobertura y criterios de qué testear).

---

## 5. Arquitectura objetivo (target state)

El objetivo **no es** reescribir el sistema. Es **prepararlo** para que la migración a Supabase, cuando llegue, no sea un rewrite.

### 5.1 Estado alcanzado (mayo 2026) ✅

```
server.js (~830 líneas — rutas + middlewares + lógica de negocio)
   │
   └─► src-server/
        ├─ services/
        │   ├─ data.js      ◄── Interfaz neutra — todos los endpoints pasan por aquí
        │   └─ notion.js    ◄── Implementación Notion (axios, mappers, operaciones dominio)
        ├─ lib/
        │   └─ idempotency.js  ◄── Store TTL en memoria (ADR-004)
        └─ tests/
            └─ smoke/        ◄── 29 tests supertest, 29/29 verdes
```

**Regla de oro cumplida:** ningún endpoint llama a `axios` directamente contra Notion. Todos pasan por `data.js` → `notion.js`. La función `makeNotionRequest` y sus helpers locales (`extractPropertyValue`, `buildEstadoUpdatePayload`, `DATABASES`) han sido eliminados de `server.js`.

### 5.2 Estado objetivo (varios sprints futuros)

```
server.js (delgado: solo wiring + middlewares globales)
   │
   └─► src-server/
        ├─ routes/          ◄── División por dominio si server.js supera ~2k líneas
        ├─ services/
        │   ├─ data.js
        │   ├─ notion.js
        │   └─ make.js      ◄── Webhook a Make + idempotencia (ADR-004 futuro)
        ├─ lib/
        │   ├─ cache.js     ◄── Cache extraído (hoy inline en server.js)
        │   └─ logger.js    ◄── Logging estructurado (ADR-006 futuro)
        └─ tests/
            ├─ smoke/
            └─ integration/  ◄── Si crece la criticidad
```

Este estado **no es un objetivo de plazo cerrado**. Es el norte: cuando una pieza encaje (más tests, más logging, etc.), tiene este sitio reservado.

### 5.3 Estado futuro si se activa migración a Supabase

```
src-server/services/
   ├─ data.js          (sin cambios — la interfaz se mantiene)
   ├─ supabase.js      ◄── Nueva implementación
   ├─ notion.js        ◄── Degradado a "sync con vista oficina"
   └─ sync.js          ◄── Bidirección Supabase ↔ Notion (vía Make o función Edge)
```

**Coste estimado de la migración cuando se active:** 1-2 semanas (vs 2 meses sin esta capa). Esto justifica todo el trabajo de abstracción actual.

---

## 6. Requisitos no funcionales (NFRs) y SLI/SLO

Los NFRs aquí son **realistas para Copuno**, no aspiracionales.

| NFR | Objetivo actual | Cómo se mide |
|---|---|---|
| **Disponibilidad** | 99% mensual (≈7 h/mes de caída tolerable) | Manual — el cliente avisa si no funciona |
| **Latencia GET endpoints** | P95 < 2 s | Manual hoy. Futuro: Vercel Analytics |
| **Latencia POST `enviar-datos`** | P95 < 5 s (incluye webhook Make) | Manual |
| **Integridad partes firmados** | 0 partes inconsistentes/mes | Inspección manual sobre Notion |
| **Tiempo firma → PDF disponible** | < 24 h (límite operativo cliente) | **SLI propuesto** — % de partes firmados <24h desde creación |

**SLO mínimo propuesto:** 95% de partes completan ciclo (creación → firma → PDF en OneDrive) en menos de 24 horas. Si baja del 95%, congelar features y atacar root cause.

Esto se mide **manualmente** hoy. Cuando se implemente logging estructurado (ADR-006) será automatizable.

---

## 7. Flujos críticos — referencia rápida

Detalle completo en [CLAUDE.md sección "Flujos críticos"](../CLAUDE.md). Aquí solo el resumen para contexto arquitectónico:

1. **Firma del jefe de obra** — Make → PDF → fórmula Notion → URL pública → firma → `Documento Firmado`.
2. **Generación PDF** — `POST /api/partes-trabajo/:id/enviar-datos` → webhook Make → OneDrive + Notion.
3. **Sync Notion** — toda escritura vía servidor + polling cliente adaptativo.

Cualquier refactor que toque estos 3 flujos **requiere pasar por `@regression-checker` antes de mergear**.

---

## 8. Lo que está deliberadamente fuera del alcance

Para evitar discusiones de "¿por qué no usamos X?" — aquí queda registrado:

| Tecnología/patrón descartado | Por qué |
|---|---|
| **Microservicios** | 1 dev, 1 dominio, 1 cliente. Coste operativo >> beneficio. |
| **Clean Architecture / Hexagonal / DDD** | 5 entidades CRUD estables. Lastre, no preparación. |
| **Event-driven (Kafka, Redis Streams)** | No hay eventos asíncronos reales. Make ya hace cola implícita. |
| **GraphQL** | REST cubre el caso. Frontend mono-cliente. |
| **TypeScript** | Migración costosa, sin ROI claro hoy. Reevaluar si entra dev nuevo. |
| **Tests E2E completos (Playwright/Cypress)** | Coste alto. Smoke tests con supertest cubren el 80% del riesgo. |
| **Circuit Breaker (Hystrix-like)** | Un solo tercero crítico (Make), ya tiene timeout. Sobreingeniería. |
| **Reescribir frontend (Next.js, RSC, etc.)** | Funciona. Cambio por cambio no aporta. |
| **Migrar de Notion preventivamente** | Sin incidente real, no compensa. ADR-001 fija el criterio. |

Si en algún momento alguno de estos cambia de estado, **se documenta vía nuevo ADR**, nunca por decisión improvisada.

---

## 9. Roadmap de evolución (orientativo)

### Sprint mayo 2026 — completado ✅
- ✅ Documentación arquitectónica (este doc + ADR-001, 002, 003, 004).
- ✅ `services/notion.js` + `services/data.js` — todos los endpoints migrados.
- ✅ Idempotencia en `enviar-datos` (ADR-004).
- ✅ Fix N+1 `/api/obras/:id/empleados` (C3 cerrado).
- ✅ Lock optimista pre-webhook con estado `Procesando` (C2 cerrado).
- ✅ Quick wins N5 + I5 (estado inexistente eliminado, reload de página eliminado).
- ✅ 29 smoke tests con supertest (cobertura completa de endpoints).

### Siguiente retainer (junio-julio 2026)
- Auth real (H1 deuda técnica) — ADR-005.
- Logging estructurado (pino) + SLI medible — ADR-006.
- Ampliar smoke tests (más endpoints cubiertos).

### Cuando se active criterio de migración (sin fecha)
- Migración a Supabase (proyecto aparte, 1-2 semanas dedicadas).
- Supabase Realtime sustituye Smart Polling + SSE.
- Auth Supabase sustituye lo que se monte en H1 (si aplica).

### Fuera de roadmap (proyectos aparte facturables)
- Portal del empleado.
- Integración Chorus / OneNote / WhatsApp.
- Multi-tenant para vender a otros clientes del sector.
- App móvil nativa.

---

## 10. Referencias

- [CLAUDE.md](../CLAUDE.md) — contexto operativo + convenciones.
- [docs/DEUDA_TECNICA.md](./DEUDA_TECNICA.md) — hallazgos catalogados con severidad.
- [docs/API_REFERENCIA.md](./API_REFERENCIA.md) — endpoints actuales.
- [docs/notion-schema-detailed.md](./notion-schema-detailed.md) — esquema Notion.
- [docs/SMART_POLLING.md](./SMART_POLLING.md) — sync tiempo cuasi-real.
- [docs/adr/](./adr/) — Architecture Decision Records.
- [.claude/scope-rules.md](../.claude/scope-rules.md) — qué entra en retainer vs proyecto aparte.

---

## Historial de cambios

### 2026-08-18
- Nueva **sección 3.1** con los mecanismos de rendimiento y sincronización añadidos en
  la intervención de agosto (v1.9.1 → v1.13.2): dieta de payload, invalidación de
  caché, freshness-check, escrituras en lotes con reversión, caché local, polling
  revivido, parche de estado optimista y rate limiting en dos capas. El documento
  describía una arquitectura anterior a todos ellos.
- Anotado el riesgo estructural de estado en memoria por instancia y su instrumentación.

| Fecha | Cambio | Autor |
|---|---|---|
| 2026-05-26 | Creación del documento. Establecimiento de arquitectura objetivo y 3 ADRs iniciales. | Javi Collado |
