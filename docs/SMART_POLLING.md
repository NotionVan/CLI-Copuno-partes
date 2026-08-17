# Smart Polling — Sincronización del listado y del modal de detalles

**Versión**: 3.0 (v1.11.0, F6) · **Última edición**: 2026-08-17

> Historia rápida: la v1 usaba SSE (eliminado en v1.3.0 por incompatible con
> Vercel serverless). La v2 documentaba un polling client-side de 3/8/15 s que
> en realidad **llevaba muerto desde v1.3** por un ReferenceError silencioso
> (hallazgo C1 de la auditoría de julio; catalogado en DEUDA_TECNICA). La v3
> (F6, v1.11.0) lo revive con otro diseño: cadencias más lentas en el cliente
> y un **freshness-check en el servidor** que abarata los ticks sin cambios.

---

## Diseño en una frase

El cliente pregunta "¿hay algo nuevo?" cada 12-30 s; el servidor, antes de
repetir la query cara a Notion (~1,5-2,5 s), pregunta a Notion "¿se ha editado
algo desde mi foto?" con una query mínima (~0,4 s) y, si no, sirve la foto que
ya tenía.

```
Tablet (App.jsx)                    Express (server.js)              Notion
   │ GET /api/partes-trabajo            │                              │
   │──────────────────────────────────▶│ foto fresca (≤30 s)          │
   │◀───── foto de cache ──────────────│                              │
   │                                    │ foto expirada (30 s-5 min)   │
   │                                    │── hayCambiosDesde (0,4 s) ──▶│
   │                                    │◀─ "nada nuevo" ──────────────│
   │◀───── misma foto, TTL extendido ──│                              │
   │                                    │◀─ "sí hay cambios" ──────────│
   │                                    │── query completa (~2 s) ────▶│
   │◀───── foto nueva ─────────────────│                              │
```

## Cliente ([src/App.jsx](../src/App.jsx))

### Polling del listado (F6)

- **Cadencia adaptativa**: 12 s con cambios recientes (<1 min), 20 s en
  reposo corto (<5 min), 30 s en reposo largo. Es deliberadamente más lenta
  que la histórica (3/8/15): el listado es la query más cara y el
  freshness-check del servidor hace que la latencia percibida no dependa del
  tick del cliente.
- **Patrón**: guarda `cancelled` + `setTimeout` encadenado (nunca dos ticks
  solapados) — el mismo patrón del poll del modal, el único que funcionaba.
- **Hash-guard**: `id-estado-ultimaEdicion` por parte; si la foto no cambió,
  no hay `setState` ni re-render (los `useMemo` de ConsultaPartes sobreviven).
- **Pausas** (cero tráfico, el timer sigue vivo):
  - pestaña en background (`document.visibilityState === 'hidden'`);
  - **edición abierta** — ConsultaPartes lo notifica por la prop
    `onEdicionAbierta`, que App guarda en `edicionAbiertaRef` (ref, no
    estado: la closure del efecto capturaría estado stale).
- **Al volver a la pestaña**: reconcile inmediato (listado + opciones de
  estado) con hash-guard y `guardarCacheLocal`.
- **Tras cambios reales**: `guardarCacheLocal` actualiza la foto de
  localStorage (P5/F4) — la próxima apertura de la app pinta datos frescos.
- **Kill-switch**: constante `POLL_ENABLED` en App.jsx. Ponerla a `false` y
  desplegar apaga el polling del listado sin tocar nada más.
- **Errores**: 2 fallos seguidos → píldora «Sin conexión — no guardes
  todavía» (UX-53, `fallosPollRef` compartido con el poll de estado-opciones).

### Poll del modal de detalles

- Cadencia 8/12/20 s (antes 3/8/15 — con el listado revivido, el GET más
  frecuente de la app deja de competir con él). Pausado en background.
- Sigue llamando a `GET /api/partes-trabajo/:id/estado` (endpoint ligero).

### Otros ticks

- **Opciones de estado**: 10/30 s, pausado en background.
- **Chequeo de versión** (banner de actualización): 60 s, pausado en background.

## Servidor ([server.js](../server.js) + [src-server/services/notion.js](../src-server/services/notion.js))

### Freshness-check (F6)

Cuando la foto de `partes-trabajo` en el cache en memoria supera
`CACHE_TTL_MS` (30 s), antes de relanzar la query completa:

1. `partesTrabajo.hayCambiosDesde({ desdeIso })` — query a Notion con filtro
   `{ timestamp: 'last_edited_time', last_edited_time: { after: cursor } }`,
   `page_size: 1` y `filter_properties` mínimos. Filtro **a nivel timestamp**,
   inmune a renombres de propiedades (lección I9). ~0,4 s medidos.
2. Sin cambios → se extiende el TTL de la foto y se sirve tal cual.
3. Con cambios → query completa y foto nueva.

- **Cursor**: el `last_edited_time` más reciente contenido en la foto — mejor
  ancla que el reloj del servidor (inmune a drift; Notion compara contra su
  propio timestamp).
- **TTL duro** (`PARTES_TTL_DURO_MS`, 5 min): techo de vida de una foto. Cubre
  el único residuo del diseño: un parte **archivado** en Notion no aparece en
  el check (no hay evento de borrado), así que como muy tarde desaparece del
  listado en 5 min. También cubre la zona ciega del redondeo: Notion redondea
  `last_edited_time` al minuto.
- **Escrituras desde la app**: `invalidarPartes()` (BE-3) borra la foto entera
  (cursor incluido) → el siguiente GET es query completa. El freshness-check
  nunca puede ocultar un cambio hecho por la propia app en la misma instancia.
- **429 durante el check**: se sirve la foto algo vieja en vez de un 503 — la
  query completa también habría fallado.

### Cache de firmantes (I-C)

`GET /api/obras/:id/firmantes-autorizados` expande la relación en paralelo
(`Promise.all`, acotado por el semáforo global de 5) y cachea 60 s por obra
(`FIRMANTES_TTL_MS`). Sin invalidación: los firmantes solo cambian editando
`Persona Autorizada` en Notion, nunca desde la app.

## Presupuesto de peticiones (20 usuarios)

| Tick | Cadencia | Coste típico |
|---|---|---|
| Listado, cache fresco | 12-30 s | 0 llamadas a Notion (foto compartida) + posible 304 al navegador |
| Listado, foto expirada sin cambios | — | 1 query mínima (~0,4 s) |
| Listado, con cambios | — | 1 query mínima + 1 completa (~2 s) |
| Modal de detalles | 8-20 s | 1 GET de página con `filter_properties` |

La mayoría de los ticks de 20 usuarios golpean la foto compartida del
servidor; el semáforo de 5 concurrentes y el retry de 429 (F5) absorben los
picos. Compatible con el límite de ~3 req/s de Notion.

## Verificación (17-08-2026)

- Contra Notion real: query completa 1,51 s → cache 4 ms → check sin cambios
  **0,43 s** (foto extendida) → edición en Notion detectada → query completa
  1,71 s → siguiente check 0,36 s.
- E2E en navegador (mock): ticks a 9,7/21,7 s; un parte creado por «otro
  usuario» **aparece solo** en el listado; 0 ticks con la edición abierta;
  reanudación al cerrar; consola limpia.

## Resolución de problemas

- **«La lista no se actualiza»**: comprobar la píldora de la cabecera (si dice
  «Sin conexión», es la red); un parte archivado en Notion puede tardar hasta
  5 min en desaparecer (TTL duro); el botón Refrescar fuerza la foto más
  reciente.
- **Apagar el polling en emergencia**: `POLL_ENABLED = false` en App.jsx +
  deploy (bump patch). El resto de la app no cambia.
- **Ajustes por entorno**: `CACHE_TTL_MS` (30 s), `PARTES_TTL_DURO_MS`
  (5 min), `FIRMANTES_TTL_MS` (60 s).
