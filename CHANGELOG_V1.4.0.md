# Changelog — Versión 1.4.0

**Fecha:** 1 de julio de 2026

---

## Funcionalidad nueva

### Añadir trabajador por ID Copuno al editar un parte

En la edición de un parte de trabajo (`ConsultaPartes`), la sección "Empleados del Parte" incorpora un campo para incluir un empleado directamente escribiendo su ID Copuno (3-6 dígitos), sin necesidad de buscarlo por nombre entre los empleados ya vinculados a la obra.

- Reutiliza el endpoint ya existente `GET /api/empleados/buscar?id=NNNN` y el servicio `buscarEmpleadoPorId` del frontend, el mismo patrón que ya funcionaba en la creación de partes.
- Valida el formato del ID, y maneja explícitamente los casos de "no encontrado", "ID duplicado en Notion" y "empleado ya asignado al parte".
- El empleado añadido se integra en `editandoParte.empleados`/`empleadosHoras` igual que cualquier otro (8h por defecto), reutilizando `toggleEmpleado()`.
- Su nombre y categoría se resuelven correctamente en el listado aunque el empleado no esté entre los primeros 100 registros que carga `datos.empleados` al iniciar la app, gracias a una caché local (`empleadosAñadidosDetalleEdicion`) que se limpia al cerrar la edición.

- [src/App.jsx](src/App.jsx) — sección de edición de empleados en `ConsultaPartes`.

---

## Notas de operación

- No requiere cambios en Notion ni en los escenarios Make — usa infraestructura ya existente.
