# Changelog — Versión 1.2.2

**Fecha:** 28 de mayo de 2026

---

## Cambios

### Guard de duplicados y no duplicar prefijo en notas

Incluye también los fixes del commit `5a59f90`:

- **Guard de duplicados (backend + mock):** `POST /api/partes-trabajo/:id/rectificar` devuelve `409 "Este parte ya tiene un rectificativo asociado"` si el original ya tiene `Rectificado por ` poblado. Protege contra doble click, dos pestañas simultáneas o estado de UI desactualizado. Smoke test dedicado (33/33).
- **No duplicar prefijo en notas:** si el original ya era a su vez un rectificativo (notas empezando por `PARTE RECTIFICATIVO`), el nuevo no añade el prefijo de nuevo.

### Rectificativos también desde "Datos Enviados"

- El botón "Rectificar" del listado ahora aparece en partes en estado **`Firmado`** y **`Datos Enviados`** (antes solo `Firmado`).
- Motivo: poder rectificar un parte cuyo PDF ya se generó pero que aún no se ha firmado, sin tener que esperar a la firma.
- `PARTE_RECTIFICABLES = ['firmado', 'datos enviados']` (backend + mock + condición de UI alineados).

---

## Archivos modificados

| Archivo | Cambios |
|---------|---------|
| `src-server/services/notion.js` | `PARTE_RECTIFICABLES` añade `'datos enviados'` |
| `mock/mockData.js` | Guard de `rectificarParte` acepta ambos estados |
| `src/App.jsx` | Helper `esRectificable` (sustituye `esEstadoFirmado`) en la condición del botón |
| `src-server/tests/smoke/smoke.test.js` | Wording del test 409 |
| `package.json` | Versión 1.2.1 → 1.2.2 |

---

## Verificación

- Smoke tests: 33/33 verdes (incluye test de guard de duplicados).
- QA manual en producción (Chrome) v1.2.2:
  - Parte `Datos Enviados` ("Llano Amarillo Puerto Algeciras230"): botón visible → modal → rectificativo creado en Borrador → original marcado "RECTIFICADO" → apertura en edición → notas "PARTE RECTIFICATIVO". Sin errores. ✅
  - Guard de duplicados: parte con badge "RECTIFICADO" no muestra botón "Rectificar" (solo "Ver Detalles"). ✅
  - Check B (no duplicar prefijo en cadena): pendiente de verificar cuando un rectificativo alcance estado `Firmado` o `Datos Enviados`.

## Migración

Sin cambios en Notion, Make ni variables de entorno.
