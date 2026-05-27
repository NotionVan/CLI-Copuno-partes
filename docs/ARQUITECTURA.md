# Arquitectura — Copuno Gestión de Partes

**Última edición:** 2026-05-27
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

Hosting: Vercel (región cdg1, plan Pro recomendado al cliente — pendiente de contratación)
```

### Capas lógicas actuales

1. **Rutas HTTP + lógica de negocio** — `server.js`: endpoints, validación inputs, reglas de estado, cache, rate limiting.
2. **Interfaz de datos neutra** — `src-server/services/data.js`: abstracción que los endpoints consumen; branching live/mock transparente.
3. **Integración Notion** — `src-server/services/notion.js`: cliente HTTP, mappers, operaciones por dominio. Ningún endpoint llama a Notion directamente.
4. **Integración Make** — webhook `axios.post` desde `server.js` (único punto de llamada external distinto de Notion).
5. **Idempotencia** — `src-server/lib/idempotency.js`: store TTL en memoria para `enviar-datos` (ADR-004).
6. **Mock** — `mock/mockData.js`: store en memoria para desarrollo sin token Notion.

La separación en archivos es **explícita desde 2026-05-27** (ver ADR-002).

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

| Fecha | Cambio | Autor |
|---|---|---|
| 2026-05-26 | Creación del documento. Establecimiento de arquitectura objetivo y 3 ADRs iniciales. | Javi Collado |
