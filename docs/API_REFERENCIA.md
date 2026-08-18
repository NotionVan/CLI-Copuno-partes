# Referencia de API — Copuno Gestión de Partes

**Última edición:** 2026-07-30 (v1.9.0 en rama — autenticación JWT en todo `/api/*`)
**Base URL (producción):** `https://app.copuno.com` — activo desde 2026-08-03. `https://copuno-gestion-partes.vercel.app` sigue sirviendo lo mismo. ⚠️ La app está en la **raíz**; `/partes` da 404 (espacio de nombres de ADR-005 sin implementar).
**Base URL (local):** `http://localhost:3001`

> **Nota de seguridad:** Todas las respuestas de `/api/*` (excepto `/api/health`) aplican un saneado automático que elimina o redacta datos económicos (precios, importes, tarifas, euros). Este comportamiento es deliberado y no debe modificarse.

> **v1.12.3:** `/api/health` incluye `inst` — id aleatorio de la instancia lambda que respondió (telemetría multi-instancia; muestrear en ráfaga revela cuántas instancias conviven).


> **Autenticación (v1.9.0, ADR-006 — en rama `feature/auth-supabase`, activa cuando `SUPABASE_URL` está configurada):** todo `/api/*` salvo `/api/health` exige cabecera `Authorization: Bearer <JWT de Supabase Auth>`. Token ausente/inválido/caducado → `401 {"error": "No autenticado" | "Sesión inválida o caducada"}`. La verificación es local (JWKS cacheado, ES256), en [src-server/middleware/auth.js](../src-server/middleware/auth.js); el frontend inyecta el token vía interceptor axios. Sin `SUPABASE_URL` (desarrollo/mock y producción pre-corte) el middleware no exige nada.

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

**v1.13.0:** devuelve el catálogo **completo** (pagina la BD entera, ~1.500
empleados, ~370 KB / 81 KB gzip). Cacheado en servidor con TTL de 10 min
(invalidado tras cualquier escritura de empleados). Hasta v1.12.x devolvía
solo los primeros 100.

**v1.13.2 (P4):** cada página del paginado reintenta una vez ante 429 honrando
`Retry-After` (`conReintento429`), y el endpoint reutiliza la **promesa en vuelo**:
dos peticiones concurrentes con caché fría comparten una sola descarga en vez de
duplicar las ~16 llamadas a Notion. Un 429 que persista tras el reintento se
propaga como `503` + `Retry-After` (el frontend cae al buscador de `/buscar`).

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

> **Usado en (v1.4.0+):** además de en la creación de partes, este endpoint alimenta el campo "Añadir empleado" de la **edición** de un parte (`ConsultaPartes` en `src/App.jsx`) — búsqueda incremental con debounce que prueba primero `?id=` si el texto son 3-6 dígitos y cae a `?q=` en caso contrario o sin resultados.

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

**v1.13.3 (P5) — guard de petición en vuelo.** El listado **sin ventana de fechas**
reutiliza la promesa en curso (`partesEnVuelo`, limpiada en `finally`): N peticiones
concurrentes con caché fría comparten UNA consulta a Notion en lugar de disparar N.
Medido antes del guard: 10 concurrentes = 10 consultas completas, escalonadas por el
semáforo. Con `?desde`/`?hasta` **no aplica** — cada consulta es distinta y compartirla
daría datos incorrectos. Telemetría: camino `coalescido` en los eventos `partes_cache`.

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
  "vehiculos": "1234-ABC, 5678-DEF",
  "firmarUrl": "https://www.copuno.com/es/notion/?parteId=..."
}]
```

### Buscar vehículos (v1.6.0)

`GET /api/vehiculos/buscar?q=<texto>&limite=<1-50>`

Autocompletado del campo Vehículos. Mínimo 2 caracteres (si no, `[]`). Busca `Matrícula` (title contains) en la BD Vehículos de Notion. Cache corta (N4).

```json
[{ "id": "uuid", "matricula": "7072KLC", "tipo": "Furgoneta", "marcaModelo": "RENAULT KANGOO", "estado": "En taller" }]
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
  "vehiculos": "Opcional — matrículas separadas por comas (v1.5.0)",
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

### ~~Stream de estado (SSE)~~ — **Eliminado en v1.3.0**

El endpoint `GET /api/partes-trabajo/:parteId/estado/stream` fue eliminado por incompatibilidad con Vercel serverless (cada conexión SSE era una invocación facturable continua que expiraba en 60 s causando huecos de sincronización).

**Sustitución:** el frontend (`App.jsx`) hace polling adaptativo client-side directamente contra `GET /api/partes-trabajo/:parteId/estado`:
- Modo rápido (3 s): cambios en los últimos 30 s.
- Modo normal (8 s): entre 30 s y 2 min sin cambios.
- Modo lento (15 s): más de 2 min sin cambios.

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
  "vehiculos": "Opcional — matrículas separadas por comas (v1.5.0)",
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

> **v1.12.0:** si `erroresDetalles > 0`, el campo `mensaje` lo dice explícitamente («⚠️ N de M empleados no se pudieron asignar…») en vez de dejarlo en un contador — la UI lo muestra tal cual.
> **v1.12.0 — nuevo `500` posible:** si falla el archivado de las horas anteriores (tras reintento de 429), el endpoint **aborta antes de recrear nada**, desarchiva lo que ya hubiera archivado y responde `500` con un mensaje accionable. El parte queda exactamente como estaba: nunca con horas duplicadas ni ocultas.

### Rectificar parte (crear rectificativo)

| Método | Ruta |
|--------|------|
| POST | `/api/partes-trabajo/:parteId/rectificar` |

Crea un **parte rectificativo** a partir de uno firmado: un parte nuevo en estado `Borrador` que copia cabecera (obra, fecha, persona autorizada, notas, vehículos) y todos los `Detalle Horas` del original, enlazado a este vía la relación reflexiva `Rectifica a ` en Notion. El original queda referenciado por la relación inversa `Rectificado por ` y **se conserva intacto** (su PDF firmado no se toca).

El campo `Notas` del rectificativo lleva siempre el prefijo `PARTE RECTIFICATIVO` (más las notas originales si las había), para identificarlo en Notion.

> **Nombres de propiedad con espacio final:** `Rectifica a ` y `Rectificado por ` tienen un espacio al final tal como están creadas en Notion. El código las referencia con ese espacio exacto.

El rectificativo sigue después el flujo normal: el usuario lo corrige → `enviar-datos` → Make genera el PDF (marcado como rectificativo) → el jefe firma de nuevo.

**Reglas:**
- Solo partes en estado `Firmado` o `Datos Enviados` son rectificables → `409` en otro caso.

Respuesta `200`: página Notion del parte nuevo + `{ parteOriginalId, detallesCopiados, erroresDetalles, mensaje }`.

Errores:
- `409` — el parte no es rectificable (no está en `Firmado` ni `Datos Enviados`) (`{ error, estado }`).
- `404` — parte no encontrado.

> **Dependencia Notion (manual):** requiere la relación reflexiva `Rectifica a` / `Rectificado por` en la BD `Partes de trabajo`. Sin ella, la creación falla en live (funciona en mock). Ver [DEUDA_TECNICA.md](DEUDA_TECNICA.md).

---

## Exportaciones

### Exportar CSV para Chorus (v1.8.0)

| Método | Ruta |
|--------|------|
| GET | `/api/exportaciones/chorus` |

Genera las filas del CSV que consume la macro de los cuadrantes de Chorus. Contrato y reglas de negocio: [EXPORT_CHORUS_CSV.md](EXPORT_CHORUS_CSV.md).

**Query params:**
- `desde` (requerido) — `AAAA-MM-DD`.
- `hasta` (requerido) — `AAAA-MM-DD`. Debe ser ≥ `desde`.
- `cursor` (opcional) — cursor de paginación de la llamada anterior.

**PAGINADO:** devuelve UNA página de Notion (~100 detalles) por llamada; el cliente itera con `cursor` hasta `done: true` y compone el CSV (`exportarChorus()` + `componerCsvChorus()` en `src/services/notionService.js`). Diseño deliberado: un mes entero no cabe en el timeout de una función serverless y el volumen crece con el nº de obras.

Respuesta `200`:
```json
{
  "filas": [ { "codigo_obra": 20486, "id_trabajador": 5452, "horas": 9, "fecha": "2026-07-01" } ],
  "incidencias": [ { "obra": "…", "trabajador": "…", "fecha": "…", "falta": "ID trabajador" } ],
  "descartadas": { "rectificadas": 0, "prueba": 0 },
  "leidos": 100,
  "cursor": "…|null",
  "done": false,
  "estados": { "Firmado": 14, "Borrador": 2 }
}
```

- `estados` solo llega en la **primera** página (sin `cursor`); permite avisar de partes sin firmar antes de descargar.
- Reglas aplicadas en servidor: excluye partes **rectificados** (`Rectificado por ` relleno) y **obras de prueba**; las filas con datos incompletos van a `incidencias`, nunca se descartan en silencio.
- `fecha` sale normalizada a `AAAA-MM-DD`; el formato `dd/mm/aaaa` del CSV lo aplica el cliente al serializar.

Errores:
- `400` — fechas ausentes/mal formadas o `desde` > `hasta`.

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
