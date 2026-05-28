# ADR-004 — Idempotencia en `POST /api/partes-trabajo/:id/enviar-datos`

**Estado:** Implementado (2026-05-27)
**Autores:** Javi Collado
**Contexto relacionado:** [ADR-002](./ADR-002-capa-abstraccion-datos.md), [H2 en DEUDA_TECNICA.md](../DEUDA_TECNICA.md#h2--creaciónedición-de-parte-no-es-atómica)

---

## Problema

El endpoint `POST /api/partes-trabajo/:id/enviar-datos` dispara el webhook de Make.com, que a su vez genera el PDF y actualiza Notion. Es un efecto secundario irreversible: Make no tiene una operación de "deshacer".

Escenarios problemáticos que ocurrían sin protección:

1. **Doble clic del usuario** — el jefe de obra pulsa "Enviar" dos veces antes de que la UI bloquee el botón. Resultado: dos PDF generados, dos actualizaciones de Notion, potencial corrupción del parte.
2. **Reintento de red** — el navegador o la capa de red reintenta la petición tras un timeout (aunque el servidor ya procesó la primera). Mismo resultado que el doble clic.
3. **Réplica desde herramienta de integración** — un cliente HTTP que reintenta automáticamente en caso de `5xx`.

---

## Decisión

Implementar un **store de idempotencia en memoria** delante de la lógica de `enviar-datos`, con TTL de 10 minutos.

Implementación en [`src-server/lib/idempotency.js`](../../src-server/lib/idempotency.js), activada en `server.js`.

### Clave de idempotencia

```
Idempotency-Key: <valor>    ← cabecera opcional enviada por el cliente
```

Si el cliente no envía cabecera, se usa **`enviar-datos:<parteId>`** como clave por defecto. Esto cubre el caso de doble clic sin necesidad de cambios en el frontend.

### Estados del store

| Estado | Qué significa | Respuesta |
|--------|--------------|-----------|
| No existe | Primera llamada | Procesa normalmente |
| `in_flight` | Hay una petición activa en curso | 409 con mensaje de espera |
| `complete` | Petición anterior terminó | Replay de la respuesta original, `replayed: true` |

### Ciclo de vida

```
Primera llamada:
  markInFlight(key)
  → procesa (webhook Make + PATCH Notion)
  → respond(200, body)        ← markComplete(key, {200, body})

Segunda llamada (mismo parteId, dentro del TTL):
  get(key) → status: 'complete'
  → res.status(200).json({ ...body, replayed: true })

Error transitorio (webhook caído, Notion 5xx):
  release(key)               ← permite reintento
  → res.status(5xx).json(...)

Error permanente (parte no existe, estado incorrecto):
  respond(4xx, body)         ← markComplete, no permite reintento
```

### Clasificación de errores

| Tipo | Acción | Motivo |
|------|--------|--------|
| 404 parte no encontrado | `respond(404, ...)` → cachear | El parte no va a aparecer de repente |
| 409 estado incorrecto | `respond(409, ...)` → cachear | El estado no cambiará sin intervención |
| 502/504 webhook caído | `release()` → no cachear | Make puede recuperarse; el reintento es correcto |
| 500 PATCH Notion fallido | `respond(500, ...)` → cachear | El webhook **ya se disparó**; reintentar dispararía Make otra vez |

El caso del PATCH fallido tras webhook exitoso es deliberadamente conservador: cacheamos el error para que reintentos del cliente no disparen Make por segunda vez. La reconciliación se hace manualmente en Notion.

---

## Consecuencias

### Positivas

- Doble clic protegido sin cambios en el frontend.
- Reintentos de red seguros para el caso nominal.
- Logs claros: `replayed: true` identifica inmediatamente las llamadas duplicadas.

### Negativas / Limitaciones

- **In-memory**: en depliegues con múltiples instancias (escalado horizontal en Vercel) no hay deduplicación cross-instancia. Vercel Free/Pro enruta peticiones del mismo cliente a la misma instancia con alta probabilidad, pero no garantiza el 100%.
- **TTL fijo de 10 min**: si el cliente espera más de 10 minutos entre reintentos, la clave habrá expirado y el segundo envío procesará de nuevo. Aceptable para el caso de uso (jornada de obra).
- **No cubre `POST /api/partes-trabajo`** (crear parte): la creación sí puede duplicarse. Cubierto por H2 en DEUDA_TECNICA, pendiente de solución completa con Supabase.

---

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Redis para store compartido | Introduce dependencia de infraestructura; sobreingeniería para instancia única |
| Idempotencia a nivel de Notion (verificar estado antes de enviar) | Ya existe la validación de estado `borrador`, pero no protege la carrera entre dos peticiones simultáneas |
| Desactivar el botón en frontend tras primer clic | Necesario igualmente, pero no protege reintentos de red ni ataques directos a la API |

---

## Criterios de revisión

Este ADR se revisaría si:

1. El cliente escala a varios usuarios concurrentes activos enviando partes al mismo tiempo en la misma instancia Vercel con posibilidad real de colisión cross-instancia (hoy improbable: cada jefe de obra envía su propio parte).
2. Se migra a Supabase → la idempotencia pasaría a una tabla `idempotency_keys` en Postgres (transaccional, cross-instancia, TTL por índice).
3. Se introduce autenticación (ADR-005) → la clave podría incorporar el `userId` para mayor precisión.
