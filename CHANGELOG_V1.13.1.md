# Changelog v1.13.1 — Edge cases del catálogo completo (revisión adversarial)

**Fecha:** 2026-08-18

Pasada adversarial sobre v1.13.0 a petición de Javi («¿nos hemos dejado algún
edge case?»). Seis hallazgos, todos corregidos en este parche:

1. **Falso aviso de duplicados de ID** (el más grave): en modo catálogo el
   filtro es por prefijo, así que teclear `123` matcheaba 123, 1234, 12345…
   y el aviso de F2 decía «⚠️ Hay N empleados con ID Copuno 123» sin que
   hubiera duplicado alguno. Ahora el aviso cuenta solo coincidencias
   **exactas** de ID.
2. **Sin feedback mientras baja el catálogo** (~5-10 s en frío): al desmarcar
   la casilla no se veía nada — exactamente la percepción de «lista rota» que
   originó la queja. Ahora: «Cargando la lista completa de empleados… puedes
   buscar mientras tanto», y si la descarga falla, mensaje honesto con
   instrucción de usar el buscador (antes, spinner potencialmente infinito).
3. **Acentos**: `jose` no encontraba `José`. Filtrado normalizado (NFD, sin
   diacríticos) en los tres filtros locales: catálogo en creación, catálogo en
   edición y filtro por obra (`normalizarTexto`/`coincideEmpleado`).
4. **Orden**: el catálogo llegaba en orden interno de Notion — 300 filas
   imposibles de escanear. Ahora orden alfabético (`localeCompare` es) una
   sola vez al descargar.
5. **TTL fijo vs tests**: el TTL de 10 min de la clave `empleados` ignoraba
   `CACHE_TTL_MS=0` de la suite smoke — riesgo latente de interferencia entre
   tests futuros. Con `CACHE_TTL_MS=0` el TTL largo también se anula.
6. **Cap de 50 en edición sin aviso** + **ceros a la izquierda**: la edición
   avisa ahora «Mostrando 50 de N — escribe más letras para afinar», y un ID
   tecleado como `0123` matchea el empleado 123 (comparación numérica exacta
   además del prefijo).

Descartados tras análisis (sin cambio): doble fetch por activación rápida del
toggle (la promesa memoizada lo impide), catálogo en localStorage (nunca — DNI),
timeout del cliente a 20 s con frío >20 s (el server completa y cachea igualmente;
el siguiente intento es hit), memo compartido tras logout (mismos datos de
workspace, sin fuga entre usuarios).

Verificación: suite 62/62; en navegador (mock): «gomez»→«Ana Gómez» (filtro por
obra), «lopez»→«Eva López» (catálogo), avisos y placeholder correctos.
