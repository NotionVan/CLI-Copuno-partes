# Changelog v1.12.0 — F7 (deploy 1): escrituras en lotes, sin esperas artificiales

**Fecha:** 2026-08-17
**Tipo:** minor — el path de escritura (crear/editar/rectificar) se reescribe por dentro; contratos HTTP intactos
**Contexto:** primer deploy de F7 ([plan aprobado](docs/INFORME_UX_RENDIMIENTO_2026-08-17.md) + adenda del 17-08: orden invertido 7b→7a tras análisis adversarial de riesgos). Quedan v1.12.1 (UI optimista) y v1.12.2 (migración Vercel a `functions`).

## Medición (local → Notion real, mismo entorno antes/después)

| Operación | Antes | Después | Nota |
|---|---|---|---|
| Crear parte, 10 empleados | 8,5 s | **4,8 s** | −44 %; en `iad1` (menos RTT) bajará más |
| Editar parte, 10 empleados | 17,2 s | **13,1 s** | −24 %; el suelo restante es el wipe-and-recreate (20 escrituras) |
| `enviar-datos` con sync de espejo | — | **3,3 s** | incluye webhook Make real |

## Servidor ([src-server/services/notion.js](src-server/services/notion.js))

- **BE-10 · Detalles de horas en lotes de 3** (`enLotes`, mismo patrón que `resolverPaginas`: `Promise.all` por tandas con barrera, resultado en orden, fallo aislado por ítem). Los 4 `sleep(100 ms)` incrustados desaparecen. Concurrencia 3 y no 5: las escrituras comparten el semáforo global (BE-7) con las lecturas del polling de otros usuarios.
- **Retry de 429 en escrituras de detalles** (`conReintento429`): reintento único honrando `Retry-After` — condición del análisis adversarial: sin sleeps sube el ritmo y un 429 en escritura se perdía en silencio como detalle faltante.
- **Archivado transaccional en `actualizar`** (`archivarDetallesConRollback`): corta las tandas al primer fallo y **desarchiva lo ya archivado** antes de abortar — el parte queda exactamente como estaba. La primera versión del fail-fast (checar después de completar todas las tandas) la tumbó `@regression-checker` con una reproducción: podía dejar la mayoría de las horas viejas ocultas, ninguna nueva y un mensaje que decía «no se ha cambiado nada» siendo falso. Antes de F7 era aún peor («log y sigue»: detalles viejos y nuevos coexistiendo → horas duplicadas en PDF y export Chorus). Si el propio rollback fallara en algo, el mensaje lo dice y pide revisar el parte.
- **2 GET de obra eliminados** (crear y editar): solo alimentaban el campo de log `empleadosNoAsignados*` (diagnóstico F1 de julio, investigación cerrada).
- **1 GET de releer eliminado en el camino común**: el `POST /pages` de Notion ya devuelve el `unique_id` poblado (verificado contra la BD real — página 311 de prueba); el GET queda solo como fallback si algún día no viniera (nunca quitar: un «Parte Obraundefined» viajaría al PDF firmado).
- **BE-11 · `matriculasPorIds` en paralelo**: el sync del espejo de vehículos en `enviar-datos` **no se mueve** (moverlo reabriría M8 — PDF sin matrículas); se abarata por dentro (N GETs secuenciales → `Promise.all`).
- Si `erroresDetalles > 0` tras los reintentos, el `mensaje` de POST/PUT lo dice en claro («⚠️ N de M empleados no se pudieron asignar…») en vez de enterrarlo en un contador.

## Verificación

- `npm run test:smoke` — **59/59** (11 nuevos en [lotes.test.js](src-server/tests/smoke/lotes.test.js): orden, concurrencia ≤3 con barrera, aislamiento de fallo, retry 429 con `Retry-After`, unique_id con/sin fallback, `matriculasPorIds` posicional, y el **corte de tandas + rollback del archivado** — incluida la reproducción exacta del hallazgo del checker: 7 detalles, fallo en el 4º → la tanda posterior no se lanza y los 5 archivados se restauran).
- E2E contra Notion real (obra TEST): crear con 10 empleados + matrícula + notas multilínea → 10/10 detalles, nombre `…310`, espejo y multilínea intactos; editar 9→10 → sin duplicados ni huérfanos.
- **Prueba de drift del espejo** (la garantía M8): matrícula añadida A MANO a la relación en Notion → `enviar-datos` (3,3 s) → el espejo se re-derivó con AMBAS matrículas antes del webhook → PARTES1/4→2/4→3/4 en verde → docx en OneDrive y estado «Listo para firmar».
- **Hallazgo documental del E2E**: `URL PDF` y `AUX ID PDF Onedrive` los escribe **PARTES4/4 al firmar** (con el PDF firmado vía pdf-co), no 3/4 como decía la doc — verificado contra los blueprints (`VOLq`/`fB=U` en el mapper del módulo #43 de 4/4). Un parte sin firmar nunca tiene `URL PDF`: es lo esperado. CLAUDE.md corregido.
- `@regression-checker` sobre los 3 flujos críticos antes del merge (2 pasadas: la 2ª tras el fix del rollback). Partes y detalles TEST de la sesión archivados (limpieza: detalles ANTES que el parte — archivar el parte vacía la relación y los vuelve invisibles al filtro).
