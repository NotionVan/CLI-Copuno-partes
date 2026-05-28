# Referencia de API — Copuno Gestión de Partes

**Última edición:** 2026-05-27
**Base URL (producción):** `https://partesobra.copuno.com`
**Base URL (local):** `http://localhost:3001`

> **Nota de seguridad:** Todas las respuestas de `/api/*` (excepto `/api/health`) aplican un saneado automático que elimina o redacta datos económicos (precios, importes, tarifas, euros). Este comportamiento es deliberado y no debe modificarse.

---

## Health

| Método | Ruta |
|--------|------|
| GET | `/api/health` |

Respuesta `200`:
```json
{ "status": "ok", "timestamp": "2026-05-27T10:00:00.000Z", "notionToken": "configured", "mode": "live" }
```

---

## Obras

### Listar obras

| Método | Ruta |
|--------|------|
| GET | `/api/obras` |

Respuesta `200` (array):
```json
[{ "id": "uuid", "nombre": "Reforma Sede Central", "provincia": "Madrid", "estado": "En curso" }]
```

### Empleados de una obra

| Método | Ruta |
|--------|------|
| GET | `/api/obras/:obraId/empleados` |

Respuesta `200` (array de empleados asignados a esa obra — misma forma que `/api/empleados`).

### Firmantes autorizados de una obra (Etapa 2 — F4)

| Método | Ruta |
|--------|------|
| GET | `/api/obras/:obraId/firmantes-autorizados` |

Devuelve las personas autorizadas a firmar para esa obra concreta (relación `Persona Autorizada` en Notion).

Respuesta `200` (array):
```json
[{ "id": "uuid", "nombre": "Luis Pérez", "email": "luis@ejemplo.com", "rol": "Jefe de Obra" }]
```

Errores:
- `404` — obra no encontrada en Notion.

---

## Empleados

### Listar empleados

| Método | Ruta |
|--------|------|
| GET | `/api/empleados` |

Respuesta `200` (array):
```json
[{
  "id": "uuid",
  "idCopuno": 123,
  "nombre": "Ana Gómez",
  "categoria": "Oficial 1ª",
  "provincia": "Madrid",
  "localidad": "Madrid",
  "telefono": "600000001",
  "dni": "12345678A",
  "estado": "Activo",
  "delegado": "Delegado Centro"
}]
```

### Buscar empleados (Etapa 2 — F5 + Etapa 3 — F2)

| Método | Ruta |
|--------|------|
| GET | `/api/empleados/buscar` |

Parámetros de query (mutuamente excluyentes; si ambos presentes, prevalece `id`):

| Param | Tipo | Descripción |
|-------|------|-------------|
| `id` | entero positivo | Busca por ID Copuno (`ID COPUNO` en Notion). Búsqueda exacta. |
| `q` | string (min 3 chars) | Busca por substring en nombre (`title.contains` en Notion). |
| `limite` | entero [1-50] | Máximo de resultados. Default `20`. |

Respuestas:

- `GET /api/empleados/buscar?id=42` → `200` array de empleados (puede ser >1 si hay duplicados de ID) o `404 { "error": "Empleado no encontrado", "idCopuno": 42 }`.
- `GET /api/empleados/buscar?q=ana` → `200` array (vacío si `q` < 3 chars).
- `GET /api/empleados/buscar?id=abc` → `400 { "error": "ID Copuno inválido" }`.

> Si existen múltiples empleados con el mismo `idCopuno`, se loguea un warning y se devuelven todos. El frontend debe decidir cuál usar.

### Opciones de estado de empleados

| Método | Ruta |
|--------|------|
| GET | `/api/empleados/estado-opciones` |

Devuelve las opciones válidas de la propiedad `Estado` detectando dinámicamente el tipo en Notion (`status`, `select` o `checkbox`).

Respuesta `200`:
```json
{ "type": "status", "options": [{ "name": "Activo", "color": "green" }] }
```

### Actualizar estado de un empleado

| Método | Ruta |
|--------|------|
| PUT | `/api/empleados/:empleadoId/estado` |

Body: `{ "estado": "Activo" }`

Respuesta `200`: `{ "ok": true, "empleadoId": "uuid", "estado": "Activo" }`

Errores: `400` (parámetro inválido o tipo de propiedad no soportado), `404` (empleado no encontrado).

---

## Partes de Trabajo

### Listar partes

| Método | Ruta |
|--------|------|
| GET | `/api/partes-trabajo` |

Respuesta `200` (array, ordenado por fecha descendente):
```json
[{
  "id": "uuid",
  "nombre": "Parte Reforma Sede Central",
  "fecha": "2026-05-27",
  "ultimaEdicion": "2026-05-27T10:00:00.000Z",
  "estado": "Borrador",
  "obra": "Reforma Sede Central",
  "personaAutorizada": "Luis Pérez",
  "rpHorasTotales": 16,
  "horasOficial1": 8,
  "horasOficial2": 4,
  "horasCapataz": 2,
  "horasEncargado": 2,
  "urlPDF": "",
  "enviadoCliente": false,
  "notas": "",
  "firmarUrl": "https://www.copuno.com/es/notion/?parteId=..."
}]
```

### Crear parte

| Método | Ruta |
|--------|------|
| POST | `/api/partes-trabajo` |

Body:
```json
{
  "obra": "Reforma Sede Central",
  "obraId": "uuid-obra",
  "fecha": "2026-05-27",
  "jefeObraId": "uuid-jefe",
  "notas": "Opcional",
  "empleados": ["uuid-emp-1", "uuid-emp-2"],
  "empleadosHoras": { "uuid-emp-1": 8, "uuid-emp-2": 6 }
}
```

Campos requeridos: `obra`, `obraId`, `fecha`, `jefeObraId`.

Proceso: (1) crea página en Notion con nombre temporal, (2) lee el ID único generado, (3) actualiza nombre definitivo `Parte <obra><ID>`, (4) crea un registro `Detalle Horas` por cada empleado.

Respuesta `200`: página Notion creada + metadatos `{ empleadosCreados, detallesCreados, erroresDetalles, mensaje }`.

Errores: `400` (campos requeridos faltantes).

> Los horas por empleado no especificadas en `empleadosHoras` se asignan a `8` por defecto (comportamiento UX intencional).

### Obtener detalles de un parte

| Método | Ruta |
|--------|------|
| GET | `/api/partes-trabajo/:parteId/detalles` |

Respuesta `200`:
```json
{
  "parte": {
    "id": "uuid",
    "nombre": "Parte Reforma...",
    "fecha": "2026-05-27",
    "obra": "Reforma Sede Central",
    "estado": "Borrador",
    "ultimaEdicion": "2026-05-27T10:00:00.000Z",
    "notas": "",
    "personaAutorizada": "Luis Pérez",
    "firmarUrl": "https://...",
    "horasTotales": 16
  },
  "empleados": [{
    "id": "uuid-detalle",
    "empleadoId": "uuid-emp",
    "empleadoNombre": "Ana Gómez",
    "categoria": "Oficial 1ª",
    "horas": 8,
    "fecha": "2026-05-27",
    "detalle": "Detalle Horas"
  }]
}
```

Errores: `404` (parte no encontrado).

### Obtener empleados/horas de un parte

| Método | Ruta |
|--------|------|
| GET | `/api/partes-trabajo/:parteId/empleados` |

Respuesta `200` (array de detalles de horas — mismo formato que `empleados` en `/detalles`).

### Obtener estado de un parte

| Método | Ruta |
|--------|------|
| GET | `/api/partes-trabajo/:parteId/estado` |

Respuesta `200`: `{ "estado": "Borrador", "ultimaEdicion": "2026-05-27T10:00:00.000Z" }`

Errores: `404` (parte no encontrado).

### Stream de estado (SSE)

| Método | Ruta |
|--------|------|
| GET | `/api/partes-trabajo/:parteId/estado/stream` |

Abre una conexión Server-Sent Events. Emite un evento cada vez que `estado` o `ultimaEdicion` cambian. Entre emisiones envía latidos (`: heartbeat`).

**Smart Polling adaptativo:**
- Modo rápido (3 s): cuando hubo cambios en los últimos 30 s.
- Modo normal (8 s): entre 30 s y 2 min sin cambios.
- Modo lento (15 s): más de 2 min sin cambios.

Evento de datos: `data: { "estado": "Datos Enviados", "ultimaEdicion": "..." }`

Evento de error: `event: error\ndata: { "message": "..." }`

### Enviar datos (disparar Make)

| Método | Ruta |
|--------|------|
| POST | `/api/partes-trabajo/:parteId/enviar-datos` |

Cabecera opcional:
```
Idempotency-Key: <string>
```
Si no se envía, se usa `enviar-datos:<parteId>` como clave por defecto (protege doble clic sin cambios en frontend). Ver [ADR-004](./adr/ADR-004-idempotencia-enviar-datos.md).

**Flujo:**
1. Verifica que el parte esté en estado `Borrador`.
2. Envía el payload completo al webhook Make (`PARTES_DATOS_WEBHOOK_URL`).
3. Actualiza el estado del parte a `Datos Enviados` en Notion.

Respuesta `200` (primera llamada):
```json
{ "status": "ok", "parteId": "uuid", "nuevoEstado": "Datos Enviados", "modo": "webhook" }
```

Respuesta `200` (llamada duplicada dentro del TTL de 10 min):
```json
{ "status": "ok", "parteId": "uuid", "nuevoEstado": "Datos Enviados", "modo": "webhook", "replayed": true, "idempotencyKey": "enviar-datos:uuid" }
```

Errores:
- `409` — petición en curso (`in_flight`) o parte no está en estado `Borrador`.
- `404` — parte no encontrado.
- `502/504` — webhook Make no disponible (transitorio, puede reintentarse).
- `500` — el webhook se disparó pero falló el PATCH de estado en Notion (requiere reconciliación manual).

### Actualizar parte

| Método | Ruta |
|--------|------|
| PUT | `/api/partes-trabajo/:parteId` |

Body:
```json
{
  "obraId": "uuid-obra",
  "fecha": "2026-05-27",
  "personaAutorizadaId": "uuid-jefe",
  "notas": "Opcional",
  "empleados": ["uuid-emp-1"],
  "empleadosHoras": { "uuid-emp-1": 8 }
}
```

Campos requeridos: `obraId`, `fecha`, `personaAutorizadaId`.

Reglas:
- No editable si el estado es `firmado`, `datos enviados` o `enviado` → `409`.
- Si el estado es `Listo para firmar`, se cambia automáticamente a `Borrador` y se avisa en la respuesta (`estadoCambiado: true`).
- Las horas deben estar en `[0, 24]` → `400` si se incumple.

Proceso: archiva los `Detalle Horas` existentes (marcados `archived: true`) y crea los nuevos.

Respuesta `200`: página Notion actualizada + `{ empleadosActualizados, detallesCreados, erroresDetalles, estadoCambiado, estadoAnterior, estadoNuevo, mensaje }`.

### Rectificar parte (crear rectificativo)

| Método | Ruta |
|--------|------|
| POST | `/api/partes-trabajo/:parteId/rectificar` |

Crea un **parte rectificativo** a partir de uno firmado: un parte nuevo en estado `Borrador` que copia cabecera (obra, fecha, persona autorizada, notas) y todos los `Detalle Horas` del original, enlazado a este vía la relación reflexiva `Rectifica a` en Notion. El original queda referenciado por la relación inversa `Rectificado por` y **se conserva intacto** (su PDF firmado no se toca).

El rectificativo sigue después el flujo normal: el usuario lo corrige → `enviar-datos` → Make genera el PDF (marcado como rectificativo) → el jefe firma de nuevo.

**Reglas:**
- Solo partes en estado `Firmado` son rectificables → `409` en otro caso.

Respuesta `200`: página Notion del parte nuevo + `{ parteOriginalId, detallesCopiados, erroresDetalles, mensaje }`.

Errores:
- `409` — el parte no está firmado (`{ error, estado }`).
- `404` — parte no encontrado.

> **Dependencia Notion (manual):** requiere la relación reflexiva `Rectifica a` / `Rectificado por` en la BD `Partes de trabajo`. Sin ella, la creación falla en live (funciona en mock). Ver [DEUDA_TECNICA.md](DEUDA_TECNICA.md).

---

## Datos completos

| Método | Ruta |
|--------|------|
| GET | `/api/datos-completos` |

Devuelve obras, jefes de obra, empleados y partes en una sola llamada paralela. Útil para precarga inicial.

Respuesta `200`:
```json
{ "obras": [...], "jefesObra": [...], "empleados": [...], "partesTrabajo": [...] }
```

---

## Jefes de obra

| Método | Ruta |
|--------|------|
| GET | `/api/jefes-obra` |

Respuesta `200` (array):
```json
[{ "id": "uuid", "nombre": "Luis Pérez", "email": "luis@ejemplo.com" }]
```

---

## Errores — formato general

| Código | Significado |
|--------|-------------|
| `400` | Validación de inputs (campos requeridos, horas inválidas, ID inválido). |
| `401` | Token Notion inválido o expirado. |
| `403` | Sin permisos para acceder a la base de datos Notion. |
| `404` | Recurso no encontrado (parte, obra, empleado). |
| `409` | Conflicto: edición bloqueada por estado actual, o petición en curso (idempotencia). |
| `429` | Rate limit de Notion excedido. |
| `500` | Error de servidor; el campo `details` contiene más información. |
| `502/504` | Webhook Make no disponible (transitorio). |

Formato de error estándar: `{ "error": "mensaje", "details": "detalle opcional" }`
