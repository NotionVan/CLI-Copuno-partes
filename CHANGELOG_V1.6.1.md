# Changelog — Versión 1.6.1

**Fecha:** 14 de julio de 2026

---

## Mejora

### Vehículos en la consulta de partes + filtro por matrícula

Complemento de v1.6.0: las matrículas aparecen ahora en los datos que se muestran al consultar partes, y se puede buscar por ellas.

- **Tarjeta del listado**: fila "Vehículos" con las matrículas del parte (solo si el parte las tiene).
- **Filtro nuevo "Filtrar por Vehículo (matrícula)"** junto a los de obra/fecha/estado/persona, con chip de filtro activo y reseteo en "Limpiar filtros".
- **Matching normalizado**: ignora mayúsculas/minúsculas, guiones y espacios — `7072-klc`, `7072 KLC` y `7072KLC` encuentran lo mismo.
- **Sugerencias con aviso de estado**: si el vehículo no está operativo (p. ej. "En taller"), la sugerencia lo marca con ⚠️ para que se vea antes de añadirlo.

## Edge cases considerados

| Caso | Comportamiento |
|---|---|
| Partes antiguos sin campo Vehículos | Muestran su tarjeta sin la fila; solo quedan fuera si se filtra por matrícula |
| Formato de matrícula distinto (guiones, espacios, minúsculas) | El filtro normaliza ambos lados antes de comparar |
| Vehículo "En taller" / no operativo | Se sugiere igualmente pero marcado con ⚠️ y su estado (avisar, no bloquear — decisión operativa del usuario) |
| Matrícula que no existe en la BD de flota | Permitida como texto libre (remolques, vehículos de terceros); viaja igual al PDF |
| Matrícula repetida en el mismo parte | El desplegable no re-sugiere las ya incluidas; si se teclea a mano duplicada, se respeta (sin dedup silencioso) |
| Caracteres de control pegados en el campo | Saneados en servidor desde v1.5.0 (fix M4/I6) |
| Búsqueda con <2 caracteres | No dispara peticiones (umbral) |
| Término con coma final o espacios en el filtro | `trim()` + normalización |

Tests 36/36 · build OK.
