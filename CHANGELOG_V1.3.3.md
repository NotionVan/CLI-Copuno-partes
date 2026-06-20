# Changelog — Versión 1.3.3

**Fecha:** 20 de junio de 2026

---

## Correcciones

### Fix raíz del `\n` en Notas de partes rectificativos (cierra M4)

Los partes rectificativos guardaban en el campo Notas un salto de línea literal (`PARTE RECTIFICATIVO\n…`). Ese carácter de control (0x0A) rompía el JSON que Make serializa aguas abajo en el módulo 249 del escenario PARTES1/4, devolviendo `400 Bad control character in string literal in JSON`. El parte quedaba atascado en "Datos Enviados" sin generar PDF (caso real: parte 249 "Rectif.Parte Getares").

La mitigación previa (M2, `replace(Notas; "\n"; " ")` en el lado Make) **no era fiable**: el editor de Make interpreta `"\n"` como los caracteres `\`+`n`, no como el salto de línea real, así que no lo sustituía y el 400 reaparecía.

El fix se ha movido a la **raíz, en el servidor**: al construir las Notas del rectificativo, cualquier carácter de control (`\n`, `\r`, `\t`) se colapsa a un espacio antes de escribir en Notion. Make ya nunca recibe un carácter de control, sin depender de la plantilla del escenario.

- [src-server/services/notion.js](src-server/services/notion.js) — función `rectificar`.
- [mock/mockData.js](mock/mockData.js) — paridad en modo mock.

---

## Mejoras

### Los rectificativos referencian explícitamente al parte original

Por requisito de negocio, todo parte rectificativo deja ahora constancia en sus Notas del parte original al que rectifica:

```
PARTE RECTIFICATIVO DEL PARTE #<ID original> — <notas originales>
```

El `<ID original>` se lee del `unique_id` del parte de origen. En rectificativos en cadena (rectificativo de un rectificativo) se descarta el prefijo previo para no encadenarlos, dejando como referencia el ID del parte rectificado actual.

---

## Notas de operación

- **Parte 249 desbloqueado:** Notas saneadas vía API Notion, estado reseteado a Borrador y vaciada la cola de Incomplete Executions de PARTES1/4 (14 bundles con el JSON pre-computado roto — un "Resolve" reintenta el bundle guardado, no re-evalúa la plantilla). Tras reenviar desde la app, el parte avanzó a "Listo para firmar".
- **Pendiente no bloqueante** (registrado en [docs/DEUDA_TECNICA.md](docs/DEUDA_TECNICA.md) M4): el frontend no refresca el estado tras una respuesta `replayed: true` del store de idempotencia (muestra estado obsoleto aunque Notion ya avanzó); y queda por verificar que PARTES3/4 grabó `URL PDF` en Notion para el parte 249.
