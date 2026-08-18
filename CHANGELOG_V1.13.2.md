# Changelog v1.13.2 — P4: resiliencia del catálogo de empleados

**Fecha:** 2026-08-18

Cierra **P4** (hallazgo del `@regression-checker` en la verificación post-despliegue
de v1.13.1). Sin cambios visibles para el usuario: es un seguro para el arranque
multi-usuario de septiembre.

## Cambios

- **Retry de 429 en el paginado del catálogo** ([notion.js](src-server/services/notion.js)):
  cada página de `listarTodos` pasa por `conReintento429` (el helper de F7 —
  reintento único honrando `Retry-After`, cap 5 s + jitter). Antes, un 429 en la
  página 9 de 16 tiraba el catálogo entero.
- **Guard de petición en vuelo** ([server.js](server.js)): dos `GET /api/empleados`
  concurrentes con caché fría comparten UNA descarga en lugar de duplicar las
  ~16 llamadas (32→16). El guard se limpia en `finally` — un fallo no lo deja pegado.

## Verificación

- Suite smoke **64/64** (2 casos nuevos: reintento de página con 429 + propagación
  si el 429 persiste).
- E2E contra Notion real: dos GET concurrentes en frío terminan en el mismo
  milisegundo (10,50 s — descarga compartida); tercera petición 7 ms (cache).
