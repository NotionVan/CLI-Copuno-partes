# Changelog — Versión 1.5.1

**Fecha:** 14 de julio de 2026

---

## Ajuste

### Propiedad Notion renombrada: `Vehículos` → `Vehiculos` (sin tilde)

El editor de mapeos de Make trunca silenciosamente los paths IML con caracteres no ASCII al escribirlos/pegarlos, lo que impedía mapear la propiedad en los escenarios PARTES. Se renombra la propiedad en la BD Partes de trabajo (vía API, 14-jul) y las 6 referencias en [src-server/services/notion.js](src-server/services/notion.js).

- Las etiquetas visibles no cambian: la app sigue mostrando "Vehículos (matrículas)" y el PDF "Vehículos:". Solo cambia el nombre técnico de la propiedad.
- Regla derivada: **nombres de propiedades Notion que viajen a Make, siempre sin tildes/caracteres especiales.**
- Tests: 34/34 en verde.
