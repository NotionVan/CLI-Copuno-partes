# Changelog — Versión 1.4.1

**Fecha:** 1 de julio de 2026

---

## Mejora

### Sugerencias por nombre al añadir empleado en edición (además de por ID)

El campo "Añadir empleado" en la edición de un parte (introducido en v1.4.0) ahora busca también por nombre/apellidos, igual que en la creación de partes:

- Búsqueda incremental con debounce (300ms) a partir de 3 caracteres.
- Si el texto son 3-6 dígitos, prueba primero por ID Copuno (`buscarEmpleadoPorId`) y si no hay resultados cae a búsqueda por nombre (`buscarEmpleados`); si no es numérico, busca directamente por nombre.
- Muestra un desplegable con los candidatos (excluyendo los ya asignados al parte) y un botón "Añadir" por cada uno, con el mismo estilo que en creación de partes.

- [src/App.jsx](src/App.jsx) — sección de edición de empleados en `ConsultaPartes`.

---

## Notas de operación

- No requiere cambios en Notion ni en los escenarios Make.
