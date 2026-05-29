# Changelog — Versión 1.3.0

**Fecha:** 29 de mayo de 2026

---

## Cambios

### H3 — SSE eliminado, polling client-side puro

El endpoint `/api/partes-trabajo/:id/estado/stream` (SSE) era incompatible con Vercel serverless: cada usuario con el modal de detalles abierto consumía una invocación facturable continua que expiraba en 60 s, causando reconexiones y huecos donde la app no actualizaba. Era la causa más probable de la queja "hay que refrescar manual".

**Solución:** el SSE se elimina del servidor y el frontend pasa a hacer polling adaptativo directo contra el endpoint `/api/partes-trabajo/:id/estado` que ya existía:

- 3 s cuando hubo cambios en los últimos 30 s (modo rápido).
- 8 s entre 30 s y 2 min sin cambios (modo normal).
- 15 s pasados 2 min sin cambios (modo lento).

El modo lento ahora se alcanza correctamente (antes nunca llegaba por las reconexiones). Sin coste extra en Vercel, sin huecos.

### I3 — Rate limit confirmado a 1000 req/15 min

`RATE_LIMIT_MAX` default confirmado en 1000 (desde Etapa 1). Cubre holgadamente el Smart Polling con varios usuarios en NAT compartido. La solución definitiva (rate limit por usuario autenticado) llegará con H1.

### N4 — Cache en búsqueda de empleados

`/api/empleados/buscar` ahora cachea resultados durante 30 s:
- Búsqueda por ID Copuno: clave `buscar-id:{N}`.
- Búsqueda por nombre: clave `buscar-q:{texto}:{limite}`.

Reduce lecturas a Notion en el flujo de registro de un empleado en varias obras el mismo día.

---

## Archivos modificados

| Archivo | Cambios |
|---------|---------|
| `server.js` | Eliminado endpoint SSE (~100 líneas). Cache en `/api/empleados/buscar`. |
| `src/App.jsx` | `estadoStreamRef` → `estadoPollRef`. Polling adaptativo client-side en lugar de `EventSource`. |
| `src/services/notionService.js` | Nueva función `getParteEstado(parteId)` |
| `package.json` | Versión 1.2.2 → 1.3.0 |

---

## Migración

Sin cambios en Notion, Make ni variables de entorno. El endpoint SSE ya no existe — cualquier cliente que lo llamara directamente recibirá 404, pero la app no lo usa.

---

## Verificación

- Smoke tests: 33/33 verdes.
