# Changelog v1.9.1 — F0: línea base y medición

**Fecha:** 2026-08-17
**Tipo:** patch — instrumentación y corrección documental, sin cambio de comportamiento
**Contexto:** fase 0 del plan de rendimiento pre-demo de septiembre (ver [docs/INFORME_UX_RENDIMIENTO_2026-08-17.md](docs/INFORME_UX_RENDIMIENTO_2026-08-17.md)).

## Cambios

- **Speed Insights activado** ([src/main.jsx](src/main.jsx)): `@vercel/speed-insights` llevaba en `package.json` desde su instalación sin importarse nunca. Montado como `<SpeedInsights />` junto al árbol de la app — empieza a medir Web Vitals reales (LCP, INP, CLS) de los usuarios de producción desde este deploy. Es la telemetría de percepción que faltaba para validar las fases F1-F7 con datos y para las puertas de decisión del ADR-007.
- **Corrección documental crítica** ([docs/DESPLIEGUE_VERCEL.md](docs/DESPLIEGUE_VERCEL.md)): el `vercel.json` de ejemplo recomendaba `"regions": ["cdg1"]`. Aplicarlo habría **empeorado** el backend ~1-1,3 s por parte creado: la función corre en `iad1` pegada a la API de Notion (us-east) y cada petición de usuario provoca 1-24 round-trips a Notion frente a uno solo hacia el usuario. Sustituido por una advertencia explícita de no fijar `regions` (hallazgo BE-16).

## Línea base medida (para comparar tras cada fase)

Queries de catálogo contra la API de Notion (curl directo, token de producción, 17-08-2026, desde España — el orden de magnitud es lo relevante, la cifra exacta varía por red y hora):

| Query | HTTP | Bytes | Tiempo |
|---|---|---|---|
| Partes de trabajo (page_size 100, sort Fecha desc) | 200 | 935.013 B | 1,94 s |
| Obras (Estado=Activa) | 200 | 400.001 B | 3,31 s |
| Empleados (page_size 100) | 200 | 652.341 B | 2,91 s |
| Jefes de obra | 200 | 5.915 B | 0,51 s |

Notas: `has_more: true` en partes (la app sigue mostrando 100 de >190); el payload de empleados ha crecido desde julio (548 KB → 652 KB) — la tendencia que motiva F2 (filter_properties) y la ventana de fechas de F3. Arranque actual de la app: 9 peticiones HTTP (3× health, 2× estado-opciones, 4 catálogos) en cascada de 3 saltos.

Pendiente de completar la línea base cuando haya datos: p50/p95 de Speed Insights tras 48 h en producción y tasa de 429 en logs de Vercel.

## Verificación

- `npm run test:smoke` — 45/45.
- `npm run build` — el bundle incluye el chunk de speed-insights (+~2 KB gzip).
- Sin cambios de API ni de UI.
