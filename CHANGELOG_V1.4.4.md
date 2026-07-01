# Changelog — Versión 1.4.4

**Fecha:** 1 de julio de 2026

---

## Fix

### Total de horas invisible al crear un parte

En v1.4.3 el texto "Horas totales: X" añadido junto a "Empleados añadidos al parte" reutilizaba la clase CSS `.total-horas`, pensada para texto blanco sobre el fondo degradado morado de `.resumen-total` (vista de consulta). Sobre el fondo blanco del formulario de creación quedaba en blanco sobre blanco — invisible / aparentaba solaparse con la línea superior.

- [src/App.jsx](src/App.jsx) — sustituido `className="total-horas"` por un estilo propio (color de texto principal, negrita), sin tocar `.total-horas` para no afectar a la vista de consulta donde sí es correcto.

---

## Notas de operación

- No requiere cambios en Notion ni en los escenarios Make.
