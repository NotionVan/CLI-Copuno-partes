# ADR-003 — Supabase como destino cuando se active la migración desde Notion

- **Fecha:** 2026-05-26
- **Estado:** Vigente (no ejecutado — decisión preparada)
- **Autor:** Javi Collado
- **Depende de:** [ADR-001](./ADR-001-notion-como-bbdd.md), [ADR-002](./ADR-002-capa-abstraccion-datos.md)

---

## Contexto

[ADR-001](./ADR-001-notion-como-bbdd.md) define los criterios bajo los cuales se ejecutaría una migración desde Notion como BBDD. Cuando esos criterios se activen, hay que decidir **a qué destino se migra**, y conviene decidirlo **ahora**, en frío, no bajo presión de un incidente.

Opciones evaluadas:

1. **Postgres "pelado"** sobre Railway / Neon / Fly / RDS.
2. **Supabase** (Postgres gestionado + BaaS encima: auth, storage, realtime, REST/GraphQL auto, dashboard).
3. **MongoDB Atlas** (documental).
4. **Firebase / Firestore** (documental + BaaS Google).

Restricciones que filtran la decisión:

- Equipo: 1 dev (sin DBA, sin DevOps).
- Modelo de datos: relacional natural (obras → partes → detalles_hora → empleados).
- Necesidades adyacentes: auth (H1 pendiente), realtime (sustituiría Smart Polling + SSE), storage (PDFs firmados, alternativa a OneDrive si algún día Make falla).
- Coste: low-budget cliente.
- Lock-in: hay que poder salir sin rewrite si el proveedor cambia precios.

## Decisión

**Supabase será el destino cuando se active la migración desde Notion.**

La decisión se ejecuta solo si se activa cualquier criterio de [ADR-001](./ADR-001-notion-como-bbdd.md). Hoy no se implementa nada de Supabase en el código — solo se deja **preparado el terreno** vía la capa de abstracción definida en [ADR-002](./ADR-002-capa-abstraccion-datos.md).

### Por qué Supabase y no las alternativas

| Criterio | Postgres pelado | **Supabase** | Mongo Atlas | Firestore |
|---|---|---|---|---|
| Modelo de datos relacional natural | ✅ | ✅ | ❌ (documental) | ❌ (documental) |
| Auth incluido (resuelve H1) | ❌ | ✅ | ❌ | ✅ |
| Realtime incluido (resuelve H3, sustituye SSE) | ❌ | ✅ | parcial | ✅ |
| Storage incluido | ❌ | ✅ | ❌ | ✅ |
| API REST auto-generada | ❌ | ✅ | ❌ | parcial |
| Row Level Security nativa | manual | ✅ | manual | ✅ |
| Vendor lock-in | bajo | **bajo** (es Postgres estándar) | medio | **alto** |
| MCP nativo en Claude Code | ❌ | ✅ | ❌ | ❌ |
| Free tier viable para Copuno | sí | **sí** (500 MB + 50k usuarios auth) | sí limitado | sí limitado |
| Coste a escala Copuno realista | ~5-15 €/mes | **~25 €/mes** | ~50 €/mes | variable |

Supabase gana en **5 de los 5 dolores actuales o futuros de Copuno** (auth, realtime, storage, modelo relacional, MCP) sin asumir lock-in real: el día que haya que salir, `pg_dump` y a cualquier Postgres en horas.

### Lo que NO se decide aquí

- **Cuándo migrar.** Lo dicta ADR-001. Hoy no procede.
- **Cómo se hace la migración** (big-bang vs gradual, sync bidireccional con Notion durante transición, etc.). Se decidirá en su propio ADR cuando se active.
- **Si Notion desaparece o se mantiene como "vista de oficina".** Depende del estado del cliente en ese momento.

## Consecuencias

### Positivas (cuando se ejecute)
- **Resuelve estructuralmente 3 hallazgos de deuda técnica:** H1 (auth), H2 (integridad transaccional), H3 (realtime).
- **Resuelve los límites de Notion:** rate limit, queries agregadas, índices, latencia.
- **Sigue siendo Postgres estándar.** Sin lock-in real.
- **MCP nativo** facilita operativa diaria (migrations, debug, queries) desde Claude Code.
- **Free tier cubre Copuno cómodamente** durante validación. Pago ~25 €/mes a escala.

### Negativas (cuando se ejecute)
- **Suma una dependencia más** al stack (Vercel + Make + Notion + Supabase). Mitigación: Supabase es Postgres exportable.
- **Coste de migración:** estimado 1-2 semanas (vs 2 meses sin la capa de ADR-002).
- **Sync bidireccional Notion ↔ Supabase** durante transición es complejo de orquestar. Probablemente vía Make.
- **Cliente debe entender el cambio** si la oficina sigue editando en Notion: ahora Notion sería "vista", no "fuente".

### Negativas hoy (decisión preparada pero no ejecutada)
- **Riesgo de bit-rot de la decisión.** Si Supabase cambia drásticamente en 18 meses, esta ADR queda obsoleta. Mitigación: revisar anualmente.
- **Tentación de "preparar de más"** para Supabase y contaminar `data.js` con asunciones específicas. Vigilar en code review.

## Criterios de revisión

Esta decisión se reevalúa si:

1. **Supabase cambia su modelo de precios** drásticamente (p.ej. elimina free tier o sube ×5 los planes pagos).
2. **El cliente exige hosting on-premise o en su propio cloud** por compliance.
3. **Aparece un proveedor superior** con encaje similar (BaaS sobre Postgres con auth + realtime + storage).
4. **El dominio cambia** y deja de ser relacional natural (poco probable en Copuno).
5. **Han pasado >18 meses sin ejecutar** y el contexto técnico ha cambiado lo suficiente como para reabrir.

## Alternativas consideradas y rechazadas

- **Postgres pelado (Neon/Railway/Fly).** Rechazado: tendríamos que montar auth + realtime + storage por nuestra cuenta. ~20-30 h extra de plomería sin ROI vs Supabase.
- **MongoDB Atlas.** Rechazado: el modelo de datos de Copuno es relacional natural (obras 1:N partes, partes 1:N detalles_hora, partes N:M empleados). Forzarlo a documental añade complejidad sin ganancia.
- **Firestore.** Rechazado: vendor lock-in alto, modelo documental forzado, sintaxis de queries propietaria. Migrar después es caro.
- **AWS RDS + Cognito + S3 + AppSync.** Rechazado: coste operativo y complejidad para 1 dev sin DevOps. Overkill.
- **PocketBase / Appwrite (alternativas BaaS).** Considerados, no rechazados duramente. Si Supabase falla en revisión futura, son los siguientes candidatos.

## Estado de preparación

Lo que está hecho hoy para habilitar esta decisión:

- ✅ [ADR-002](./ADR-002-capa-abstraccion-datos.md) — capa `data.js` que permite cambio de implementación sin tocar endpoints.

Lo que NO se hace hoy y se hará el día que se active la migración:

- Crear `src-server/services/supabase.js`.
- Diseñar schema Postgres (espejo + mejoras del modelo Notion actual).
- Definir estrategia de sync (Notion como vista o desaparece).
- Migración de datos históricos (script único).
- Migrar auth de lo que esté en producción (H1) a Supabase Auth.
- Sustituir Smart Polling + SSE por Supabase Realtime.

## Referencias

- [ADR-001](./ADR-001-notion-como-bbdd.md) — criterios que activan esta decisión.
- [ADR-002](./ADR-002-capa-abstraccion-datos.md) — capa que habilita la ejecución low-cost.
- [docs/DEUDA_TECNICA.md](../DEUDA_TECNICA.md) — hallazgos H1, H2, H3 que esta decisión resuelve estructuralmente.
- Supabase docs: https://supabase.com/docs
- Postgres standard (garantía de no-lock-in).
