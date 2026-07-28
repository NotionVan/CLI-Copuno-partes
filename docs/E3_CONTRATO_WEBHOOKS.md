# E3 — Contrato de datos de los webhooks internos del pipeline PARTES

**Fecha:** 2026-07-28 · **Estado: APLICADO — pendiente solo la validación E2E con un parte** · Hallazgo origen: [EDGE_CASES_MAKE.md](EDGE_CASES_MAKE.md) → E3

> **Aplicado el 28-jul en producción:**
> - Data structures creadas vía API: `608077` = "PARTES2-4 entrada (contrato E3)" ·
>   `608078` = "PARTES3-4 entrada (contrato E3)". Todos los campos `required`, sin `strict`
>   (rechazo de extras no cubre ningún fallo nuestro y añade riesgo).
> - **La asociación estructura↔hook no es posible por API** (`PATCH /hooks/{id}` solo actualiza `name`
>   y descarta `data.udt` en silencio — verificado). Se hizo por UI (Claude en Chrome, solo desplegable):
>   webhook de 2/4 → 608077, webhook de 3/4 → 608078. Guardado y persistencia confirmados tras recarga.
> - Verificado por API: `GET /hooks/2480016` → `udt: 608077` ✓ · `GET /hooks/2480024` → `udt: 608078` ✓.
>   Ambos hooks `enabled`, cola 0, escenarios ON.
> - **Pendiente: E2E con el primer parte** (de prueba o real). Desde ahora el webhook valida en la puerta:
>   un payload con campo ausente o tipo equivocado se rechaza con error visible en el emisor, en vez de
>   entrar y resolver vacío. El primer envío es el momento de mirar ejecuciones y PDF.
>
> Limpieza opcional: las estructuras huérfanas `378120` ("Detalle del parte") y `449748` ("EmpleadoArray"),
> ambas de un solo campo y sin ningún uso, parecen un intento anterior abandonado de esto mismo — borrables.
**Objetivo:** que los webhooks de PARTES2/4 y PARTES3/4 dejen de operar con estructura *aprendida* (`udt: null`) y pasen a un contrato explícito, para que un campo ausente produzca un **error visible** en vez de un vacío silencioso (causa raíz de M8).

---

## Evidencia de la deriva (por qué esto no puede esperar indefinidamente)

La interfaz aprendida que el webhook de 3/4 tiene guardada (visible en `metadata.interface` de su blueprint, foto del 28-jul **posterior** al fix de M8) contiene 14 campos. Al payload real que le envía 2/4 le faltan **tres**:

- `Cliente` — la plantilla del PDF lo consume (`{{1.Cliente}}` en el módulo 11)
- `Horas Peon` — ídem (`{{1.`Horas Peon`}}`)
- `Vehiculos del parte` — ídem, y es exactamente el campo de M8

Que funcionen hoy es porque el runtime resuelve contra el bundle real; pero la estructura aprendida va por detrás del payload y **nadie se entera cuando dejan de coincidir**. Ese es el mecanismo que produjo PDFs sin matrículas con todos los checks en verde.

---

## Contrato — Hook `2480016` (entrada de PARTES2/4; emisor: PARTES1/4, módulo 249)

**16 campos, 14 `required`.** ⚠️ **Semántica de `required` en Make (aprendida con sangre el 28-jul): significa NO-VACÍO, no "la clave debe existir".** Un campo de texto legítimamente vacío (`""`) con `required: true` hace que el webhook rechace el payload entero con `400 Validation failed`. Por eso `Vehiculos del parte` y `Notas del parte` van en `required: false` — son los dos únicos campos del contrato que pueden estar vacíos en un parte real.

**Incidente E2E del 28-jul (validación en producción):** el primer parte real tras activar E3 (parte **305**, 16:38, sin matrículas ni notas) fue rechazado en la puerta — DLQ de PARTES1/4 con `Validation failed for 2 parameter(s)` en 2 segundos. Diagnóstico por API, `required: false` aplicado a esos dos campos en ambas estructuras (`PATCH /data-structures/{id}` — esto **sí** es posible por API, a diferencia de la asociación), y reintento desde la DLQ → pipeline completo OK, parte en `Listo para firmar`. **El reintento desde cola funcionó porque el fix era del lado del webhook receptor, no del blueprint** — la copia congelada del blueprint que guarda la DLQ (gotcha M5) no afecta a la validación de entrega. Dos lecciones: (1) el rechazo fue visible e inmediato con causa exacta — el comportamiento que E3 compra; (2) `required` solo para campos que jamás pueden ir vacíos.

| Campo | Tipo | Notas |
|---|---|---|
| `Fecha Parte` | text | fecha en texto, la formatea el emisor |
| `ID Parte` | number | `ifempty(…; 0)` en origen |
| `Obra` | text | `escapeJSON()` en origen |
| `Cliente` | text | `escapeJSON()` |
| `Jefe de obra` | text | `escapeJSON()` |
| `Horas Oficial 1ª` | number | ⚠️ nombre con `ª` |
| `Horas Oficial 2ª` | number | ⚠️ nombre con `ª` |
| `Horas Capataz` | number | |
| `Horas Peon` | number | sin tilde, así viaja |
| `Horas Encargado` | number | |
| `Horas Totales` | number | |
| `Total Horas Oficial` | number | |
| `Importe Total` | number | ver E7 — candidato a eliminarse del payload |
| `Vehiculos del parte` | text | matrículas `, `-separadas — **`required: false`** (ver incidente 28-jul abajo) |
| `Notas del parte` | text | `escapeJSON()` — **`required: false`** (ídem) |
| `ID Pag Notion Parte` | text | UUID de la página Notion — crítico |

## Contrato — Hook `2480024` (entrada de PARTES3/4; emisor: PARTES2/4, módulo 37)

**Los mismos 16 campos anteriores** (desde E2, los 9 numéricos llevan `ifempty(…; 0)` también en este tramo) **más:**

| Campo | Tipo | Notas |
|---|---|---|
| `Detalle del parte` | array de collection | cada elemento: `{ "empleado": text }` — lo genera el Text aggregator (mod 2) desde el DataStore `82996`, leyendo `Registro Horas` |

> El array llega pre-construido (`[{{2.text}}]`). Recordatorio del gotcha M5: **jamás** envolver ese fragmento en `escapeJSON()`.

---

## Payloads canónicos (para "generate from sample" y para pruebas)

### Hook 2480016
```json
{
  "Fecha Parte": "28/07/2026",
  "ID Parte": 293,
  "Obra": "Las Palmas",
  "Cliente": "Cliente Ejemplo SL",
  "Jefe de obra": "Nombre Apellido",
  "Horas Oficial 1ª": 8,
  "Horas Oficial 2ª": 0,
  "Horas Capataz": 0,
  "Horas Peon": 16,
  "Horas Encargado": 8,
  "Horas Totales": 32,
  "Total Horas Oficial": 8,
  "Importe Total": 0,
  "Vehiculos del parte": "1234ABC, 5678DEF",
  "Notas del parte": "Notas de ejemplo sin saltos de linea",
  "ID Pag Notion Parte": "20882593-a257-8125-8595-000000000000"
}
```

### Hook 2480024
El mismo objeto anterior más:
```json
{
  "Detalle del parte": [
    { "empleado": "Nombre Apellido - Oficial 1ª - 8 horas" },
    { "empleado": "Nombre Apellido - Peón - 8 horas" }
  ]
}
```
*Formato verificado contra el blueprint (28-jul): lo compone el feeder 225 de PARTES1/4 como `{{Aux Empleado.title}} - {{AUX_Categoria}} - {{Cantidad Horas}} horas`, se graba en `Registro Horas` del DataStore `82996` (módulo 253) y 2/4 lo envuelve en `{"empleado": "..."}` (Text aggregator, separador `,`).*

---

## Cómo aplicarlo (cuando haya ventana)

1. **Crear las dos Data structures** en Make (team Copuno). Vía recomendada: en la configuración del webhook → *Data structure* → **Generate** pegando el payload canónico de arriba — evita teclear los nombres con `ª` a mano (gotcha del editor con no-ASCII). Repasar tras generar que los tipos number/text/array quedaron bien y marcar todos los campos como obligatorios.
2. **Asociar** cada estructura a su hook (`2480016` y `2480024`) en la configuración del webhook, con validación estricta activada.
3. **Prueba negativa** (opcional pero recomendada): `curl` al webhook con un payload al que se le quita un campo → debe responder **400**, no encolar ejecución. ⚠️ Si la validación pasa, la ejecución SÍ corre y genera un PDF de prueba — hacerlo solo en ventana controlada y con un `ID Parte` inexistente o de prueba.
4. **Prueba positiva E2E:** enviar un parte real/de prueba desde la app → PDF correcto con matrículas y detalle (regla M8: se valida el PDF, no el check verde).
5. Re-exportar los blueprints y actualizar la foto en `docs/Escenarios Make/`.

**Vía API alternativa:** requiere `udts:write` + `hooks:write` temporales en el token (mismo patrón que E2: añadir → aplicar → verificar → retirar). La mecánica exacta del endpoint de asociación estructura↔hook se confirma en el momento; si resulta frágil, la vía UI de arriba es corta y no toca campos de mapeo.

## Efectos colaterales a vigilar

- Con validación estricta, **un fallo de contrato para el pipeline en el tramo emisor** (el módulo HTTP del emisor recibe 400 y el escenario marca error). Eso es lo deseado — error visible y reintentable — pero implica que tras aplicar E3, un despiste en un payload ya no "pasa de largo": bloquea. Avisar antes de tocar payloads.
- Si en el futuro se añade un campo al pipeline, el orden es: **actualizar la Data structure del receptor primero**, luego el payload del emisor. Al revés, el emisor empezará a recibir 400 (con estructura estricta) — que es el comportamiento diseñado, no un bug.
- E7: si se decide sacar `Importe Total` del payload, hay que quitarlo de **ambas** estructuras y de ambos emisores en el mismo cambio.
