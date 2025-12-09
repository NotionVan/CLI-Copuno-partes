# 📋 Changelog - Versión 1.0.2

**Fecha:** 9 de diciembre de 2025

---

## 🆕 Nuevas Funcionalidades

### Pantalla "Crear Nuevo Parte"

1. **Buscador de Empleados**
   - Nuevo campo de búsqueda para filtrar empleados por nombre en tiempo real
   - Botón X para limpiar la búsqueda
   - Mensaje informativo cuando no hay resultados

2. **Layout Compacto de Empleados**
   - Diseño horizontal optimizado para tablet
   - Mayor aprovechamiento del espacio vertical
   - Nombres completos visibles (sin truncamiento)
   - Eliminada duplicación del badge de estado

3. **Entrada de Horas Táctil**
   - Botones +/- táctiles para ajustar horas rápidamente
   - **8 horas por defecto** al seleccionar un empleado
   - Permite edición manual tocando el número

4. **Selector de Fecha Simplificado**
   - Eliminada la selección de hora, solo fecha

---

## 🐛 Correcciones

1. **Cálculo de Horas Totales**
   - Corregida discrepancia entre vista de lista y vista de detalles
   - Ahora se usa el valor de Notion (`RP Horas totales`) como fuente de verdad
   - Categorías no reconocidas ahora se agrupan en "Otros"

2. **Desglose por Categoría**
   - Solo se muestran categorías con horas > 0

---

## 📁 Archivos Modificados

| Archivo | Cambios |
|---------|---------|
| `src/App.jsx` | Buscador, layout compacto, botones +/-, selector de fecha, cálculo de horas |
| `src/App.css` | Estilos para buscador, layout compacto, botones táctiles |
| `server.js` | Corrección de nombre de propiedad `RP Horas totales`, añadido `horasTotales` a detalles |
| `package.json` | Versión 1.0.2 |

---

## 🔄 Migración

No se requieren cambios en la base de datos de Notion.

---

## 📋 Notas Técnicas

- La propiedad de Notion para horas totales es `RP Horas totales` (rollup)
- Los botones +/- usan incrementos de 1 hora con límites 0-24
- El layout de empleados usa CSS Grid para mejor rendimiento en tablet
