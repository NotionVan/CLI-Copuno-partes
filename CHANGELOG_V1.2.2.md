# Changelog — Versión 1.2.2

**Fecha:** 28 de mayo de 2026

---

## Cambios

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

- Smoke tests: 32/32 verdes.

## Migración

Sin cambios en Notion, Make ni variables de entorno.
