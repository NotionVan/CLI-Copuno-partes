# Changelog — Versión 1.2.1

**Fecha:** 28 de mayo de 2026

Parche sobre 1.2.0: correcciones de los partes rectificativos verificadas en producción y afinado del banner de actualización.

---

## Correcciones

### Partes rectificativos

- **Fix nombres de propiedad Notion con espacio final.** Las relaciones se crearon en Notion como `Rectifica a ` y `Rectificado por ` (con un espacio al final). El código las referenciaba sin espacio → `POST /pages` fallaba con **HTTP 500**. Corregidos los 3 usos (lectura en `mapParte`, escritura en `rectificar`). (commit `4cea407`)
- **Modal de confirmación propio** en lugar de `window.confirm` (que algunos navegadores bloquean), con botones "Cancelar" / "Crear rectificativo". (commit `dd15afe`)
- **Apertura del rectificativo en edición** usando el `id` devuelto por la API directamente, sin esperar al refresco del listado (el cache de catálogos podía devolver la lista vieja y la edición no se abría). (commit `dd15afe`)
- **Prefijo `PARTE RECTIFICATIVO` en las notas** del rectificativo (más las notas originales si las había), para identificarlo en Notion además de por la relación. (commit `9dc581d`)

### Banner de actualización

- Intervalo de comprobación reducido de **5 min → 1 min**.
- `__APP_VERSION__` expuesta en `window` para poder verificarla desde la consola del navegador.
- Eliminado el emoji del texto del banner (criterio de profesionalidad).

---

## Verificación

- Smoke tests: 32/32 verdes.
- `@regression-checker`: los 3 flujos críticos (firma, PDF, sync Notion) intactos.
- QA manual en producción (Chrome): crear rectificativo desde un parte firmado → modal → parte nuevo en Borrador con badge "RECTIFICATIVO" y notas con prefijo → original marcado "RECTIFICADO" → apertura automática en edición. Sin errores de consola ni 500.

---

## Pendiente

- **Make:** marca visual "RECTIFICATIVO" en el PDF (ver N6 en `docs/DEUDA_TECNICA.md`).
- **Make (riesgo N6):** PARTES4-4 selecciona el fichero de OneDrive sin filtro de nombre visible — revisar para evitar firmar el PDF equivocado cuando hay varios partes de la misma obra.

---

## Migración

No se requieren cambios en Notion (ya hechos en 1.2.0), variables de entorno ni datos.
