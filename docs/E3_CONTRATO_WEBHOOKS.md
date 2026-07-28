# E3 — Contrato de datos de los webhooks internos del pipeline PARTES

**Fecha:** 2026-07-28 · **Estado: PREPARADO, NO APLICADO** · Hallazgo origen: [EDGE_CASES_MAKE.md](EDGE_CASES_MAKE.md) → E3
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

**16 campos. Todos `required`** — el emisor construye el body como plantilla fija y siempre emite las 16 claves; la ausencia de cualquiera significa deriva del template y debe fallar ruidosamente.

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
| `Vehiculos del parte` | text | matrículas `, `-separadas; puede ser `""` pero debe estar |
| `Notas del parte` | text | `escapeJSON()`; puede ser `""` |
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
    { "empleado": "0042 - Nombre Apellido - Oficial 1ª - 8h" },
    { "empleado": "0107 - Nombre Apellido - Peón - 8h" }
  ]
}
```
*(el formato exacto del string `empleado` lo compone PARTES1/4 al grabar en el DataStore; verificar contra un registro real antes de aplicar)*

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
