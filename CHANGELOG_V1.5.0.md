# Changelog — Versión 1.5.0

**Fecha:** 14 de julio de 2026

---

## Funcionalidad nueva

### Vehículos en el parte de obra

Petición de Efrén (reunión de cierre de junio, 3-jul-2026): a veces se factura el vehículo y la firma del encargado en el albarán lo valida. Se añade la identificación de vehículos al parte — campo de matrículas en texto libre, admite varias unidades separadas por comas (ej.: `1234-ABC, 5678-DEF`).

**Notion (BD Partes de trabajo del cliente):**
- Nueva propiedad `Vehículos` (rich_text), creada vía API el 14-jul-2026. Nombre limpio, sin espacios finales.

**Backend:**
- [src-server/services/notion.js](src-server/services/notion.js) — `mapParte` y `detalles` exponen `vehiculos`; `crear` y `actualizar` escriben la propiedad; `rectificar` copia los vehículos del parte original al rectificativo. Partes antiguos sin la propiedad devuelven `''` (vía `extractPropertyValue`, seguro con `undefined`).
- [server.js](server.js) — `POST /api/partes-trabajo` y `PUT /api/partes-trabajo/:id` aceptan `vehiculos` (opcional) en el body.
- [mock/mockData.js](mock/mockData.js) — campo soportado en modo mock (create/update/mappers).

**Frontend ([src/App.jsx](src/App.jsx)):**
- Campo "Vehículos (matrículas)" en el formulario de creación y en el modal de edición (respeta los estados que bloquean edición, sin cambios en esa lógica).
- Sección "Vehículos" en el modal de detalles del parte.

---

## Verificación

- Smoke tests: **33/33 en verde**.
- Flujo verificado end-to-end en modo mock: POST con vehículos → aparece en listado y detalles → PUT actualiza el valor.
- Sin cambios en: webhook `enviar-datos` (solo envía `page_id`; Make lee de Notion), saneado económico, lógica de estados, polling.

---

## ⚠️ Dependencia manual pendiente (Make + plantilla PDF)

Para que las matrículas **aparezcan en el PDF firmado** (el entregable real de la petición) falta el lado Make, igual que ocurrió con `Es Rectificativo`:

1. **PARTES 1/4** (Recojo cabecera): mapear la propiedad `Vehículos` al leer el parte de Notion.
2. Propagar la variable por los webhooks **PARTES 1/4 → 2/4 → 3/4**.
3. Añadir la variable de vehículos a **`Plantilla Parte.docx`**.
4. Reexportar los blueprints actualizados a [docs/Escenarios Make/](docs/Escenarios%20Make/).

Sin este paso, el campo funciona en app y Notion pero el PDF no muestra los vehículos.

---

## Contexto comercial

Desarrollo correspondiente al presupuesto "Vehículos en el parte de obra" (proyecto aparte del retainer, Opción A). Referencia en Notion: "IMD Julio 2026 (esqueleto) + Presupuesto campo vehículo — Borradores".
