# Changelog — Versión 1.2.0

**Fecha:** 28 de mayo de 2026

---

## Nuevas funcionalidades

### Partes rectificativos

Permite corregir un parte ya **firmado** sin alterar el documento original (que es la prueba firmada e inmutable).

- Nuevo endpoint `POST /api/partes-trabajo/:id/rectificar`: crea un **parte nuevo en Borrador** copiando cabecera (obra, fecha, persona autorizada, notas) y todos los `Detalle Horas` del original.
- El nuevo parte se enlaza al original mediante la relación reflexiva `Rectifica a ` (inversa `Rectificado por `) en Notion. El original **no se modifica**.
- El rectificativo reutiliza íntegro el pipeline existente: el usuario lo corrige → "Enviar datos" → Make genera PDF → nueva firma. Tiene su propio `ID` único, así que su URL de firma y su fichero OneDrive no colisionan con el original.
- **UI:** botón "Rectificar" en partes `Firmado` no rectificados → modal de confirmación → abre el rectificativo en edición. Badges "Rectificativo" / "Rectificado" en el listado.
- Solo se rectifican partes en estado `Firmado` (constante `PARTE_RECTIFICABLES`).

### Banner de actualización disponible

- Cuando el servidor despliega una versión nueva, los usuarios con la app abierta ven automáticamente un banner en la parte superior: "Hay una nueva versión disponible", con botón **Actualizar ahora** (recarga) y botón de cierre.
- Mecanismo: Vite embebe la versión de `package.json` como `__APP_VERSION__` en build. El frontend la compara con la `version` de `GET /api/health`; si difieren, muestra el banner.
- La comprobación se hace al arrancar y periódicamente en segundo plano.

---

## Archivos modificados

| Archivo | Cambios |
|---------|---------|
| `src-server/services/notion.js` | `partesTrabajo.rectificar()`, `PARTE_RECTIFICABLES`, `mapParte` con `rectificaAId`/`rectificadoPorIds`/`esRectificativo` |
| `src-server/services/data.js` | `partesTrabajo.rectificar()` (mock/live) |
| `server.js` | Endpoint `POST /api/partes-trabajo/:id/rectificar` |
| `mock/mockData.js` | `rectificarParte()` + campos rectificativos en el mapper |
| `src-server/tests/smoke/smoke.test.js` | 3 tests de rectificar (32/32 verdes) |
| `src/App.jsx` | UI rectificar + banner (`hayActualizacion`, comprobación de versión) |
| `src/services/notionService.js` | `rectificarParte()` |
| `src/App.css` | Badges + estilos del banner |
| `package.json` | Versión 1.1.0 → 1.2.0 |

---

## Dependencias manuales (fuera del código)

- **Notion:** propiedades `Rectifica a ` / `Rectificado por ` (relación reflexiva dual) y fórmula `Es Rectificativo` en la BD `Partes de trabajo`. Creadas.
- **Make:** marcar el PDF como "RECTIFICATIVO" (propagar `Es Rectificativo` por PARTES1-4→2-4→3-4 + variable en `Plantilla Parte.docx`). Pendiente — sin esto el flujo funciona pero el PDF no lleva la marca visual.

---

## Migración

No se requieren cambios en variables de entorno. El banner no requirió cambios en servidor (`/api/health` ya devolvía `version`).
