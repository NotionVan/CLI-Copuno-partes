# ADR-002 — Capa de abstracción de datos (`src-server/services/data.js`)

- **Fecha:** 2026-05-26
- **Estado:** En implementación
- **Autor:** Javi Collado
- **Depende de:** [ADR-001](./ADR-001-notion-como-bbdd.md)
- **Habilita:** [ADR-003](./ADR-003-supabase-destino-migracion.md)

---

## Contexto

[`server.js`](../../server.js) tiene ~1.545 líneas con llamadas `axios.post('https://api.notion.com/...')` repartidas por ~20 endpoints. Cada endpoint conoce:

- La URL de Notion.
- El formato de properties Notion (`title`, `rich_text`, `relation`, `select`, etc.).
- El mapeo de la respuesta cruda a objetos JS que consume el frontend.
- El manejo de paginación, rate limits y errores 429/5xx.

Esto tiene dos consecuencias problemáticas:

1. **Cualquier cambio de schema Notion** obliga a tocar N endpoints.
2. **Migrar de Notion a otra BBDD** (criterio definido en ADR-001) implicaría reescribir ~20 endpoints — coste estimado 60-100 h.

La decisión que hay que tomar es: ¿se asume ese coste el día que toque migrar, o se invierte hoy en una capa que lo amortigüe?

## Decisión

**Introducir una capa de servicios en `src-server/services/`** con dos archivos clave:

### `src-server/services/notion.js`
- **Responsabilidad:** toda la plomería contra la API de Notion.
- **Contiene:** llamadas axios, mapeo de properties Notion ↔ objetos JS planos, paginación, manejo de 429.
- **NO contiene:** lógica de negocio, validación de inputs, decisiones sobre qué endpoint expone qué.

### `src-server/services/data.js`
- **Responsabilidad:** interfaz neutra que consumen los endpoints.
- **API conceptual:** `data.obras.listar()`, `data.partes.crear(parte)`, `data.empleados.buscar({q, id})`, etc.
- **Hoy:** delega 100% en `notion.js`.
- **Mañana (si se activa ADR-003):** delega en `supabase.js` o en un híbrido. Los endpoints no se enteran.

### Regla de oro

> **Ningún endpoint en `server.js` llama a `axios` directamente contra Notion. Todos pasan por `data.js`.**

Los endpoints conocen `data.js`. `data.js` conoce `notion.js`. Nadie más conoce Notion.

## Implementación (incremental, no big-bang)

1. **Fase A (este sprint):** crear `services/notion.js` con las funciones más usadas (obras, empleados, jefes). Crear `services/data.js` como wrapper neutro. Refactorizar 5-6 endpoints piloto.
2. **Fase B (siguiente retainer):** migrar el resto de endpoints. Cada PR refactoriza N endpoints + añade test smoke.
3. **Fase C (cuando se active ADR-003):** crear `services/supabase.js` y conmutar `data.js` para usarlo. Endpoints intactos.

Big-bang queda descartado: refactor de 20 endpoints de golpe es ruleta rusa con los 3 flujos críticos. Incremental + tests smoke (ver ADR-007 futuro sobre testing) es la única vía sensata.

## Consecuencias

### Positivas
- **Cambio de BBDD futura cuesta semanas, no meses.** Justifica el trabajo entero.
- **Cambios de schema Notion** tocan 1 archivo (`notion.js`), no 20 endpoints.
- **Tests más fáciles:** se puede mockear `data.js` para tests unitarios de endpoints sin tocar Notion real.
- **Onboarding de devs futuros más limpio:** `data.js` es el "índice" del modelo de datos.
- **Soberanía técnica del dominio** (principio del PDF "Decisiones Arquitectónicas Clave - Parte 1"): el dominio (partes, obras, empleados) deja de conocer detalles de infraestructura (Notion).

### Negativas
- **Capa de indirección extra.** Para un dev nuevo, leer un endpoint requiere abrir `data.js` y `notion.js`. Mitigación: documentación clara + naming consistente.
- **Tentación de "leaky abstraction":** que `data.js` exponga conceptos puramente Notion (filtros `rich_text.contains` etc.). Hay que vigilarlo en code review.
- **Coste de implementación:** ~10-15 h inicial + refactor incremental durante 1-2 sprints.
- **Refactor con riesgo:** tocar `server.js` siempre puede romper algo. Mitigación: tests smoke + revisión `@regression-checker` antes de mergear.

## Criterios de revisión

Esta decisión se reevalúa si:

1. **Aparecen ≥2 fuentes de datos paralelas** (p.ej. Notion + Supabase coexistiendo durante una migración). Puede que `data.js` necesite estrategia explícita de routing.
2. **El dominio crece a >15 entidades.** `data.js` como archivo único puede no escalar; toca dividir por dominio (`data.partes.js`, `data.obras.js`, etc.).
3. **Se introduce TypeScript.** La interfaz de `data.js` se beneficia de tipos explícitos.

Si en 12 meses no se ha activado ADR-003 y `data.js` no ha aportado valor demostrable → reevaluar si fue sobreingeniería o seguro bien comprado.

## Alternativas consideradas y rechazadas

- **Mantener `axios` directo en endpoints.** Rechazado: condena cualquier migración futura a rewrite costoso.
- **Repository pattern formal con clases + interfaces.** Rechazado: JS sin TypeScript hace los contratos no enforzables. Aporta complejidad sin garantías.
- **ORM (Prisma, Sequelize).** Rechazado: Notion no encaja en modelo relacional clásico. Cuando migremos a Supabase, se reevaluará Prisma para esa fase.
- **Esperar al día de la migración** para abstraer. Rechazado: hacerlo bajo presión = peor diseño + más riesgo.

## Referencias

- [ADR-001](./ADR-001-notion-como-bbdd.md) — decisión que esta abstracción protege.
- [ADR-003](./ADR-003-supabase-destino-migracion.md) — destino habilitado por esta capa.
- [docs/ARQUITECTURA.md](../ARQUITECTURA.md) sección 5 — estructura `src-server/` objetivo.
- [docs/DEUDA_TECNICA.md](../DEUDA_TECNICA.md) — esta ADR mitiga el coste futuro de H2 y C3.
