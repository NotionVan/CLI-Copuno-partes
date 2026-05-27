# ADR-001 — Notion como Base de Datos

- **Fecha:** 2026-05-26
- **Estado:** Vigente
- **Autor:** Javi Collado
- **Decisión derivada en:** [ADR-002](./ADR-002-capa-abstraccion-datos.md), [ADR-003](./ADR-003-supabase-destino-migracion.md)

---

## Contexto

Copuno necesitaba una webapp para gestionar partes de trabajo diarios firmados por jefes de obra. En el momento de arrancar el proyecto, el cliente **ya operaba sobre Notion** para gestionar obras, empleados y referencias administrativas. La oficina edita activamente esos datos a diario desde el propio Notion.

Tres caminos posibles al iniciar:

1. **BBDD relacional propia (Postgres/MySQL)** desde el día 1 + ETL desde Notion.
2. **BBDD documental (Mongo/Firestore)** + ETL desde Notion.
3. **Notion como BBDD directa** vía API v1.

Restricciones reales en el momento de decidir:
- Equipo: 1 dev.
- Presupuesto: retainer mensual 20 h.
- Cliente exige seguir editando datos maestros (obras, empleados) en Notion.
- Time-to-market: app debía estar funcionando en pocas semanas, no meses.
- Coste infra: cero deseable.

## Decisión

**Usar Notion API v1 como source of truth.**

La aplicación consume Notion vía `axios` directamente (sin SDK oficial), con 5 bases de datos clave:

- `OBRAS`
- `JEFE_OBRAS` (Persona Autorizada)
- `EMPLEADOS`
- `PARTES_TRABAJO`
- `DETALLES_HORA`

La escritura desde la app pasa siempre por el backend Express (nunca cliente directo). La oficina sigue editando en paralelo desde la UI de Notion sin conflictos relevantes.

## Consecuencias

### Positivas
- **Time-to-market mínimo.** App en producción en semanas, no en meses.
- **Coste infra cero.** Notion lo paga el cliente para su operativa habitual.
- **Cliente sigue dueño de sus datos** en su herramienta de siempre.
- **Sin ETL ni sincronizaciones.** Una sola fuente, una sola verdad.
- **Cambios de schema rápidos** desde la UI de Notion sin migraciones.

### Negativas (conocidas y aceptadas)
- **Rate limit duro:** 3 req/s. Genera el problema N+1 catalogado como C3 en deuda técnica.
- **Sin transacciones.** Un parte con 15 empleados son 16 escrituras independientes; si falla la octava, queda inconsistente (H2 en deuda técnica).
- **Sin queries agregadas** (GROUP BY, JOIN, agregaciones). Cualquier reporting complejo se hace en código.
- **Paginación de 100** resultados por página → múltiples llamadas para listados grandes.
- **Latencia variable** (300 ms-2 s por query) fuera de nuestro control.
- **Sin índices configurables.** Búsquedas son full-scan dentro de la BD.
- **Dependencia operativa** de la disponibilidad de Notion (SLA Notion ≈ 99,9%).

### Riesgos no resueltos
- Si Notion cambia su API o pricing → migración forzada bajo presión.
- Si el cliente deja de editar en Notion → desaparece la justificación principal de esta decisión.
- Si el volumen crece a 10.000+ partes → degradación de performance percibida.

## Criterios de revisión

Esta decisión se reevalúa **inmediatamente** si ocurre cualquiera de:

1. **Incidente de integridad H2 con impacto operativo.** Un parte queda inconsistente en producción y el cliente lo nota o lo pierde.
2. **Volumen >5.000 partes activos.** Los listados de "partes recientes" superan los 3 segundos de carga consistente.
3. **El cliente deja de editar en Notion.** Si la oficina migra a otra herramienta o pide dashboard propio, desaparece la razón principal de mantener Notion como BBDD.
4. **Notion cambia drásticamente** sus precios, rate limits o API en un sentido incompatible.
5. **Aparecen requisitos transaccionales reales** (facturación, pagos, reservas) que exigen ACID.

Si se activa cualquier criterio → ejecutar **ADR-003** (migración a Supabase).

Mientras tanto, las consecuencias negativas se **mitigan** vía:

- **ADR-002:** capa de abstracción `services/data.js` que permite cambio de implementación sin tocar endpoints.
- Cache en memoria (TTL 5 s) para amortiguar rate limits.
- Polling adaptativo (Smart Polling) para reducir hits redundantes.
- Idempotencia en operaciones críticas (ADR-004 futuro).
- Logging estructurado para detectar inconsistencias H2 (ADR-006 futuro).

## Alternativas consideradas y rechazadas

- **Postgres propio desde día 1.** Rechazado: coste de ETL bidireccional con Notion + infra extra + tiempo dev que no había. Sin incidente real, no se justifica.
- **Mongo/Firestore.** Mismo problema. Además sin ventaja real sobre Notion para este modelo de datos.
- **Airtable.** Mismas limitaciones que Notion + el cliente no lo usa.

## Referencias

- [docs/notion-schema-detailed.md](../notion-schema-detailed.md) — esquema completo.
- [docs/DEUDA_TECNICA.md](../DEUDA_TECNICA.md) — hallazgos H2, C3.
- [CLAUDE.md](../../CLAUDE.md) — sección "Bases de datos Notion".
