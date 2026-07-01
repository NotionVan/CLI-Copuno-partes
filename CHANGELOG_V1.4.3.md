# Changelog — Versión 1.4.3

**Fecha:** 1 de julio de 2026

---

## Mejora

### Total de horas visible al crear un parte

En el formulario de creación de parte, junto al encabezado "Empleados añadidos al parte (N)" se muestra ahora en tiempo real el total de horas asignadas a todos los empleados del parte.

- Cálculo puramente cliente (`formData.empleados` + `formData.empleadosHoras`), sin cambios en backend ni en el payload enviado a Notion.
- Reutiliza la clase `total-horas` ya existente en la vista de consulta de partes.

- [src/App.jsx](src/App.jsx) — bloque "Empleados añadidos al parte" del formulario de creación.

---

## Notas de operación

- No requiere cambios en Notion ni en los escenarios Make.
