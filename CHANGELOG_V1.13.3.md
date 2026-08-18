# Changelog v1.13.3 — P5: guard de petición en vuelo en el listado de partes

**Fecha:** 2026-08-18

## Origen: la prueba de carga que faltaba

Al preparar el informe técnico de la intervención se identificó que **nunca se había
hecho una prueba de carga**, pese a que todo el proyecto se justifica por «20 usuarios
en octubre». Al hacerla apareció un defecto real en el endpoint **más usado de la
aplicación**.

## El defecto

`GET /api/partes-trabajo` no tenía protección contra estampida de caché. Medido en
local contra Notion real:

```
10 peticiones concurrentes con caché fría → 10 consultas completas a Notion
tiempos escalonados: 1,35 · 1,36 · 1,52 · 1,63 · 1,78 · 2,58 · 2,74 · 2,85 · 2,96 · 3,10 s
```

El escalonamiento es el semáforo global sirviendo las diez consultas de tres en tres.

**Escenario real:** lunes de septiembre tras un despliegue (caché vacía), Óscar, Paola
y Andrés abren el listado casi a la vez → tres consultas completas simultáneas
consumiendo el semáforo y la cuota compartida con las automatizaciones. En octubre,
con más usuarios, peor.

Es el mismo defecto que P4 (v1.13.2) resolvió en el catálogo de empleados, pero en un
endpoint con mucho más tráfico: el listado se consulta en cada arranque, en cada
refresco manual y en cada ciclo del seguimiento automático.

## El arreglo

Reutilización de la promesa en vuelo (`partesEnVuelo`, limpiada en `finally`), aplicada
**solo al listado sin ventana de fechas** — que es el único cacheado. Con `?desde` o
`?hasta` cada consulta es distinta y compartirla daría datos incorrectos.

Telemetría: camino `coalescido` en los eventos `partes_cache`, para medir en producción
cuántas peticiones se están uniendo a consultas en curso.

## Verificación

Repetida la misma prueba tras el arreglo:

```
10 peticiones concurrentes con caché fría → 1 consulta compartida
tiempos: 1,73 · 1,73 · 1,73 · 1,73 · 1,73 · 1,73 · 1,73 · 1,74 · 1,74 · 1,74 s
```

Todas terminan en el mismo instante: firma inequívoca de descarga compartida.

- Suite **66/66** (2 casos nuevos en `smoke.test.js`).
- Prueba de carga de 20 usuarios concurrentes × 5 peticiones: 100/100 respuestas 200.

## Hueco de cobertura detectado y anotado

El mock **no implementa el filtro de fechas** del listado: devuelve el catálogo
completo con y sin ventana. La semántica de `?desde`/`?hasta` (BE-13a) solo está
verificada contra Notion real, nunca por la suite. Anotado en el propio test.
