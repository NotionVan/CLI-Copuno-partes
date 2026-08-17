# Changelog v1.12.1 — F7 (deploy 2): «Enviar datos» responde al instante y no miente

**Fecha:** 2026-08-17
**Tipo:** patch — solo frontend + timeouts del cliente API
**Contexto:** segundo deploy de F7 (P11 + cierre definitivo de I8 + R14-R18 del análisis adversarial). Queda v1.12.2 (migración Vercel a `functions`).

## Lo que nota el usuario

- **«Enviar datos» responde al instante**: al pulsarlo, la tarjeta pasa a «Procesando» en el momento (es la verdad — el servidor marca Procesando antes de nada, C2) y a «Datos Enviados» al confirmar. Nunca se pinta «Datos Enviados» antes de la confirmación: si el webhook fallara, el servidor revierte a Borrador y el capataz NO debe irse de la obra creyendo enviado un parte que no lo está.
- **La tarjeta ya no puede mentir (I8 cerrado de raíz)**: el estado confirmado vive en un parche que se re-aplica sobre CUALQUIER foto entrante del listado — un refresh fallido o una foto stale de otra instancia ya no devuelven la tarjeta a «Borrador» con el botón reactivado. El parche se disuelve solo cuando el servidor confirma ese estado (o a los 60 s: la verdad del server siempre acaba mandando).
- **Guardar una edición cierra el formulario al confirmar el PUT** y refresca en segundo plano — antes, un fallo del refresco posterior mostraba «No se pudo actualizar el parte» con el modal abierto **aunque el guardado sí se había hecho** (la fábrica de reintentos e intercalados).
- Un doble toque en «Enviar datos» ya no puede colar dos envíos (guard síncrono por ref — dos clicks en el mismo frame leían el mismo estado); el 409 de idempotencia se muestra como «ya se está enviando», no como error rojo.
- Si el servidor avisó de empleados sin asignar (`erroresDetalles`, v1.12.0), el toast muestra ese aviso tal cual en crear y en editar.

## Técnico

- Parche de estado en el padre (`parcheEstadoRef` + `conParches` como primera línea de `aplicarPartes`): inmune al poll de 12 s con datos stale (el cache de 30 s es por instancia lambda — BE-3/I2); TTL 60 s > cache + tick.
- **Timeouts de escritura a 45 s** (R17/R18): con el global de 20 s, el cliente podía abortar con la lambda aún escribiendo → el reintento del usuario se intercalaba con la escritura original (dos wipe-and-recreate sobre el mismo parte). Gotcha descubierto por el camino: `axios.post(url, null, config)` serializa el body como la cadena `"null"` y `express.json` (strict) responde 400 — usar `undefined` para POST sin cuerpo.

## Segunda ronda (hallazgos de `@regression-checker`, corregidos y verificados)

- **El botón «Refrescar» y la reconexión ya no pisan el parche**: `cargarDatos` y `refrescarTodosDatos` hacían `setDatos` directo sin pasar por `conParches` — durante un envío en vuelo podían devolver la tarjeta a «Borrador». Ahora toda foto entrante (poll, refresh manual, reconexión, montaje) pasa por el parche.
- **El 409 «no-Borrador» corrige la tarjeta al estado REAL**: si otro usuario ya envió el parte, el error del servidor adjunta su estado (`err.estadoServidor`) y la tarjeta salta directamente a él («Datos Enviados»/«Firmado») con el mensaje correcto — antes se quedaba en «Procesando» con un «ya se está enviando» que nunca se cumplía.
- **Fix de un bug preexistente destapado por el E2E**: el listener de `online` capturaba la closure del primer render (datos vacíos) y al reconectar mostraba un **flash de skeleton** sobre un listado perfectamente pintado (`setLoading(true)` indebido). Ahora lee del ref.
- `marcarEstadoParteLocal` calcula sobre `prev` del propio `setDatos` (no sobre un ref un render por detrás) y ya no persiste estados optimistas en el cache local.

## Verificación

- E2E en navegador (mock, con retraso artificial en el server): badge «Procesando» a los 0,8 s del click; «Datos Enviados» tras el 200; **un solo POST con doble click sincrónico**; con el listado bloqueado 26 s (refresh caído + polls fallando) el badge NO revierte y el botón NO reaparece; consola limpia.
- Ronda 2: **Refrescar durante el envío** → badge estable; **evento `online` durante el envío** → badge estable y sin flash de skeleton; **409 con estado real simulado** → tarjeta corregida a «Datos Enviados» con el toast del servidor.
- `npm run test:smoke` — 59/59. Build OK. `@regression-checker` antes del merge (2 pasadas: la 2ª motivó la ronda de fixes).
