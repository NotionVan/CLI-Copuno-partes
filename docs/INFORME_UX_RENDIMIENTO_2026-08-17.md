# Informe de auditoría — Experiencia de usuario y rendimiento

**Fecha:** 2026-08-17 · **Base auditada:** `master` @ `3df09f6` (v1.9.0, auth fusionada y en producción) · **Método:** 6 pasadas — verificación de la auditoría del 31-07 contra el código actual, deep-dive de rendimiento frontend, deep-dive backend/datos, análisis adversarial con trazas de latencia, auditoría UX estática del código completo (`App.jsx` y `App.css` enteros) y recorrido en vivo instrumentado sobre el mock (puppeteer: targets, contrastes, atributos, flujos).
**Contexto de negocio:** demo fallida ante la central (~22-jul, error visible; Circleback 12-08), compromiso «funcional en septiembre» con Óscar/Paola/Andrés arrancando la operativa real y más obras en octubre. Usuario real: jefe de obra con tablet, sol, prisa y mala cobertura.

> Etiquetas: **[verificado]** = visto ejecutarse o medido; **[inferido]** = deducido del código. Severidades: 🔴 afecta al trabajo diario · 🟠 fricción real · 🟡 pulido. Los códigos BE-*/FE-*/UX-* referencian los tres informes de detalle de esta auditoría; C1-C6/I-* son los de [AUDITORIA_PRE_SEPTIEMBRE.md](AUDITORIA_PRE_SEPTIEMBRE.md).

---

## 1 · Resumen ejecutivo

**Estado general en tres frases.** La aplicación funciona y sus flujos críticos (firma, PDF, sync) son sólidos, pero **ninguno de los 13 hallazgos de la auditoría del 31-07 se ha corregido** y tres de ellos explican por sí solos el «se quedó colgado» de la demo: el refresco automático del listado lleva meses muerto por un `ReferenceError` silenciado, el arranque hace 9 peticiones (4 duplicadas) tras dos pantallas en blanco encadenadas, y cualquier excepción o fallo de datos sustituye la app entera por un error o un blanco absoluto (0 Error Boundaries). A eso esta auditoría añade una capa nueva, nunca revisada: **la UX de la interfaz tiene 12 defectos que afectan al trabajo diario**, incluidos tres de integridad del dato que se factura (0 horas se graban como 8; es imposible teclear 7,5 h y el error acaba en 24; una edición con fallo de carga puede vaciar las horas de un parte al guardar). La buena noticia: nada exige refactor ni migración — el plan completo son ~33 h en 8 deploys pequeños y revertibles.

**Los 5 hallazgos con más retorno:**

| # | Hallazgo | Coste | Por qué |
|---|---|---|---|
| 1 | **UX-18** — los badges de «Datos Enviados», «Listo para firmar» y «Procesando» salen sin estilo (bug de normalización de clase) | 0,5 h | El estado es lo único que el usuario busca en una lista de 40 partes |
| 2 | **UX-23 + UX-22** — 0 horas → 8 silencioso; medias horas imposibles de teclear | 2 h | Son horas que se facturan: dinero mal cobrado y discusiones con el cliente final |
| 3 | **FE-12/P1** — esperas artificiales de 2-4 s (`setTimeout`) tras guardar | 0,5 h | Guardar pasa de sentirse 4-6 s a ~1,5 s reales, con un cambio de 1 línea |
| 4 | **BE-3** — el cache del servidor no se invalida nunca tras escribir: el parte recién creado puede no aparecer | 1,5 h | Es la mitad intermitente de «la app no actualiza», y bloquea cualquier mejora de cache posterior |
| 5 | **C1/BE-9 + FE-2** — revivir el polling (con red de seguridad) y pintar el menú sin esperar a Notion | 4 h | La otra mitad de «no actualiza» + time-to-UI de 4-8 s a ~300 ms |

**Qué NO hace falta tocar** (decirlo ahorra dinero): la cabecera (el mejor código de la UI), toda la carpeta `src/auth/` salvo tres mensajes, el modal de exportación CSV (el mejor flujo del producto), la protección de doble-submit en las cinco acciones, la confirmación de rectificar y el aviso de partes duplicados, los modales que no se cierran al tocar fuera (deliberado y correcto en tablet), `prefers-reduced-motion`, el banner de nueva versión, la franja de color de las tarjetas, el bundle (144 KB gzip es correcto — el problema es cuándo se carga, no cuánto pesa), la virtualización del listado (no es el cuello) y la región de Vercel (`iad1` es la correcta; ver BE-16 — la doc que recomienda `cdg1` está corregida en este mismo pase).

---

## 2 · Contraste con lo ya diagnosticado (31-07 → 17-08)

Los 13 hallazgos de [AUDITORIA_PRE_SEPTIEMBRE.md](AUDITORIA_PRE_SEPTIEMBRE.md) fueron re-verificados contra el código actual, file:line. **Veredicto global: todos confirmados, ninguno corregido, y dos han subido de gravedad porque la auth ya está en producción.**

| Código | Hallazgo (jul) | Veredicto (17-08) | Evidencia actual |
|---|---|---|---|
| C1 | Polling del listado muerto (`ReferenceError` silenciado) | **Confirmado, VIVO** [verificado] | `App.jsx:424` usa `editandoParte`, declarada en `ConsultaPartes` (`:856`), fuera del ámbito de `App` (`:376-804`); catch noop `:446` |
| C2 | Arranque: 9 peticiones, 4 duplicadas | **Confirmado, VIVO** [verificado] | 3× health (`App.jsx:579`, `notionService.js:467`, `App.jsx:547`), 2× estado-opciones (`:509`, `:496`); `/api/datos-completos` sin referencias en `src/` |
| C3 | Sin `filter_properties` en catálogos | **Confirmado, VIVO** [verificado] | `notion.js:315-318`, `:373-375`, `:783-786`; el patrón bueno sigue solo en Chorus (`:522-533`). **Matiz nuevo (adversarial):** el servidor ya mapea a DTO, así que el ahorro es de tiempo de Notion (3,48→2,52 s), no de descarga del usuario |
| C4 | estado-opciones sin cache, poleado 10-30 s | **Confirmado, VIVO** [verificado] | `server.js:387-395` (único catálogo sin `getCache`); `App.jsx:485,497` |
| C5 | Rate limit por IP | **Confirmado, VIVO** [verificado] | `server.js:98-107` sin `keyGenerator`; además el authMiddleware está montado DESPUÉS del limiter (orden a invertir) |
| C6 | Cola de Make con incompletas | Purga verificada en julio; no re-auditada aquí (fuera de alcance de este informe) | — |
| I-A | Truncación a 100 (partes/empleados) | **Confirmado, VIVO** [verificado] | `notion.js:783-786` (190 partes reales), `:373-375` (1.554 empleados); ID Copuno «—» en `App.jsx:2170,2177` |
| I-B | Obras sin Persona Autorizada | No re-verificado por API en este pase (dato del cliente) | Sigue ⏳ en DEUDA_TECNICA (N1) |
| I-C | Firmantes N+1 sin cache | **Confirmado, VIVO** [verificado] | `notion.js:349-357`; `server.js:219-235` |
| I-D | AuthGate en blanco sin timeout | **Confirmado y AGRAVADO** [verificado] | `AuthGate.jsx:204` `return null`; `:192-195` sin `.catch()` → si la promesa rechaza, blanco permanente. En julio era teórico; **hoy la auth está en producción** |
| I-E | `getSession()` por petición; 401→signOut | **Confirmado y AGRAVADO** [verificado] | `notionService.js:18-39`, `:61-65`; mismo motivo |
| I-F | Sin retry ante 429 | **Confirmado, VIVO** [verificado] | `notion.js:91-115`: 429→Error→500; cero reintentos en servidor |
| I-G | obra→empleados sin cache (correcto) | **Confirmado como CORRECTO — mantener sin cache** [verificado] | `server.js:419-431` |

**¿Las estimaciones de esfuerzo de C1-C6 cuadran?** Sí, con dos matices: C2 (consolidar arranque) sube de 2,5 h a ~4 h porque el diseño correcto no es «todo en una llamada» sino catálogos rápidos + partes priorizadas (ver corrección adversarial §4.3), y C1 no puede desplegarse solo — exige C3+C5+BE-3 en el mismo pase (la propia auditoría de julio ya lo decía; se mantiene).

---

## 3 · Hallazgos nuevos de esta auditoría

Ficha completa solo para los que entran en el plan de fases (§5); el resto, en tabla compacta al final de cada bloque.

### 3.1 · Integridad del dato (🔴 — el bloque más serio del informe)

#### UX-23 · Cero horas se graban como ocho
- **Evidencia:** `src-server/services/notion.js:905` y `:975` (`empleadosHoras[empleadoId] || 8`), `src/App.jsx:1953` (mismo `|| 8` en la UI de edición). [verificado]
- **Impacto (para Efrén):** un trabajador apuntado con 0 horas (fue a la obra y no trabajó) se graba y se factura como jornada completa, sin aviso. La app incluso pregunta «¿crear con 0 horas?» y luego graba 8.
- **Propuesta:** `?? 8` en los tres puntos (el 8 por defecto al *seleccionar* empleado se mantiene — es UX intencional; lo que cambia es que un 0 explícito se respete). Smoke test del caso 0.
- **Esfuerzo:** 0,5 h · **Riesgo:** nulo · **Verificación:** crear parte con un empleado a 0 h → en Notion el detalle dice 0, no 8.

#### UX-22 · Imposible teclear medias horas; el error acaba en 24
- **Evidencia:** `clampRoundHoras` aplicado en cada `onChange` (`App.jsx:3190` creación, `:1554-1567` edición): «7» → 7; «.» descartado; «5» → 75 → clamp a 24. [verificado]
- **Impacto:** las medias jornadas (7,5 / 4,5) solo se consiguen con los botones +/−, y el intento de teclearlas deja 24 h que se facturan si nadie lo caza.
- **Propuesta:** estado de texto crudo mientras se edita + clamp/redondeo en `onBlur`. Unificar el control de horas de crear y editar (UX-29) en el mismo cambio.
- **Esfuerzo:** 1,5 h · **Riesgo:** bajo · **Verificación:** teclear «7.5» → queda 7,5; «99» → clamp a 24 al salir del campo.

#### UX-4 · Una edición con fallo de carga puede vaciar las horas al guardar
- **Evidencia:** el `catch` de `iniciarEdicion` abre el formulario igualmente con `empleados: []` (`App.jsx:1243-1264`); el PUT archiva TODOS los detalles y recrea solo los enviados (`notion.js:959-968`). [verificado en código; el flujo completo de fallo+guardado es [inferido] — no se reprodujo contra Notion real]
- **Impacto:** con mala cobertura, «Editar» abre diciendo «no hay empleados»; si el usuario guarda, las horas de los 15 trabajadores desaparecen de la base de datos sin aviso. Es el único camino de pérdida de datos real encontrado.
- **Propuesta:** si falla la carga de detalles, NO abrir el formulario (error + «Reintentar»); cinturón: bloquear guardado si se pasa de N>0 empleados a 0 sin acciones explícitas del usuario.
- **Esfuerzo:** 2 h · **Riesgo:** bajo · **Verificación:** simular fallo (DevTools offline) al pulsar Editar → no se abre el form; el parte conserva sus detalles.

#### UX-10 · Los errores se disfrazan de estados vacíos
- **Evidencia:** 4 `catch` que dejan lista vacía y mensaje «Esta obra no tiene empleados/firmantes asignados» / «No hay empleados asignados a este parte» (`App.jsx:1131-1136→3142`, `:1149-1154→1781/3075`, `:1604-1607→2201`, `:1243-1264`). [verificado]
- **Impacto:** sin cobertura, la app afirma que la obra no tiene gente; el usuario se lo cree y monta el parte a mano con «buscar en toda la base».
- **Propuesta:** distinguir vacío real de fallo: estado de error con texto claro y botón «Reintentar» en los 4 puntos.
- **Esfuerzo:** 2-3 h · **Riesgo:** bajo · **Verificación:** offline + seleccionar obra → mensaje de error con reintento, nunca «no tiene empleados».

### 3.2 · Confianza y feedback (🔴)

#### UX-1 · La confirmación de «parte creado» se autodestruye
- **Evidencia:** `onParteCreado={cargarDatos}` (`App.jsx:735`) → `setLoading(true)` (`:572-608`) → el ternario global (`:703`) desmonta `CrearParte` con su pantalla de confirmación; tras 3,5-8 s reaparece un formulario vacío. [verificado]
- **Impacto:** el jefe de obra no sabe si el parte se creó; lo natural es rellenarlo otra vez → partes duplicados (la confirmación de duplicados de `:2848` lo frena a veces, si la lista ya se recargó).
- **Propuesta:** `onParteCreado` → `refrescarPartes` (ya existe, `:610-619`) sin tocar `loading`; la tarjeta de confirmación persiste con el nombre del parte creado.
- **Esfuerzo:** 1,5 h · **Verificación:** crear parte → la confirmación permanece en pantalla; el listado se actualiza por detrás.

#### UX-16 · El mensaje de éxito/error sale donde el usuario no mira
- **Evidencia:** banner arriba del listado (`App.jsx:2302-2306`) mientras el botón pulsado puede estar 40 tarjetas más abajo; en el modal, banner arriba (`:1712-1716`) y botones abajo (`:2059-2084`). [verificado]
- **Impacto:** «pulso Enviar Datos y no pasa nada» → segundo intento → la queja exacta de «no sé si se ha enviado».
- **Propuesta:** toast flotante único (abajo-centro, `role="status"`, autocierre 6-8 s para éxitos, errores persistentes) que sustituye los tres puntos que hoy pintan `mensajeUI`. Resuelve de paso UX-15 (mensajes eternos) y UX-34 (aria-live).
- **Esfuerzo:** 3-4 h · **Verificación:** enviar datos desde la tarjeta 30 del listado → el aviso se ve sin scroll.

#### UX-18 · Badges de estado sin estilo en 3 de los 5 estados
- **Evidencia:** `className={'estado-badge ' + estado.toLowerCase()}` sin normalizar (`App.jsx:2463`) vs CSS `.estado-badge.datos-enviados` (`App.css:545`): «Datos Enviados» → clases `datos` + `enviados` (ninguna existe); «Listo para firmar» y «Procesando» ídem. La franja de color de la tarjeta SÍ normaliza (`:2437-2441`). [verificado]
- **Propuesta:** reutilizar el normalizador de la franja + reglas para `procesando` y `listo-para-firmar`.
- **Esfuerzo:** 0,5 h · **Verificación:** los 5 estados salen con píldora de color en el listado.

#### UX-3 · Intro en cualquier buscador crea el parte
- **Evidencia:** `<form onSubmit={handleSubmit}>` (`App.jsx:2997`) envuelve los buscadores de empleado (`:3220-3226`) y matrícula (`:104-110`); sin guarda de Enter. [verificado]
- **Propuesta:** `preventDefault` de Enter en los inputs de búsqueda + `enterKeyHint="search"`.
- **Esfuerzo:** 0,5 h · **Verificación:** Enter en el buscador → busca, no crea.

#### UX-53/54 · La app dice «Conectado» sin red, y una escritura sin red son 60 s de spinner y un error en inglés
- **Evidencia:** `connectivity` solo se recalcula en `cargarDatos`/Refrescar (`App.jsx:576-604`, `:627-643`); los polls tragan errores (`:446`, `:491-493`, `:1669`); cero `navigator.onLine` en `src/`. Timeout axios 60 s (`notionService.js:11`); el error llega como «timeout of 60000ms exceeded». [verificado]
- **Propuesta:** escucha `online/offline` + «Sin conexión» tras 2 polls fallidos + barra fija de aviso; timeout de escritura 20-25 s; «Reintentar» que reenvía los mismos datos.
- **Esfuerzo:** 4-6 h · **Verificación:** modo avión → la píldora cambia a «Sin conexión» ≤30 s; guardar sin red → error en español con reintento a los ~20 s.

### 3.3 · Rendimiento — hallazgos nuevos respecto a julio (resumen; detalle en los informes BE/FE)

| Código | Hallazgo | Sev | Coste | Estado en el plan |
|---|---|---|---|---|
| BE-3 | **Cache sin invalidación tras escritura** → parte recién creado puede no aparecer (bug funcional intermitente) | 🔴 | 1,5 h | F1 |
| FE-12/P1 | **Esperas artificiales** de 2-4 s tras guardar (`App.jsx:1451`, `:1466`) | 🔴 | 0,5 h | F1 |
| FE-5/6/P4 | **0 Error Boundaries** + fallo de datos = pantalla de error total | 🔴 | 1,5 h | F1 |
| FE-2/P2 | La pantalla de inicio (estática) espera a Notion tras el gate global | 🔴 | 1 h | F3 |
| FE-4 | `retryOperation` reintenta el lote entero: peor caso 15-20 s de spinner | 🟠 | 0,5 h | F4 (P9) |
| FE-17/P5 | **Sin caché client-side**: cada apertura parte de cero → localStorage SWR = segunda apertura sin spinner | 🔴 | 4 h | F4 |
| BE-1+ | `filter_properties` también en `GET /:id/estado` (descarga la página entera para 2 propiedades, y es el endpoint más poleado) | 🟠 | incluido F2 | F2 |
| BE-2 | `no-store` global impide hasta el 304 del navegador (934 KB por refresco aunque nada cambie) | 🟠 | 1 h | F5 |
| BE-6/7/8 | 429→500 sin retry; sin semáforo global; rate limit por IP (el NAT de la central lo agota con ~3 pestañas si revive el polling) | 🟠 | 4 h | F5 |
| Delta | **Delta polling por `last_edited_time`**: 0 resultados en ~0,4 s vs query completa de 2,5 s | 🟠 | 2 h | F6 |
| BE-10/11 | Escrituras 4+N secuenciales con `sleep(100 ms)`; espejo de vehículos en el path de enviar | 🔴 | 4,5 h | F7 |
| FE-20 | `react-router-dom` muerto pero en `manualChunks` (bomba de build); `@vercel/speed-insights` instalado y nunca importado | 🟡 | 0,5 h | F0/F1 |
| BE-16 | `docs/DESPLIEGUE_VERCEL.md:78` recomienda `regions: cdg1` — **empeoraría ~1-1,3 s por parte** (Notion está en us-east) | 🟠 | 0,1 h | F0 |

**Suelo de latencia (adversarial, [verificado] con medidas):** mientras la lectura dependa de Notion en runtime, cada miss de cache cuesta ~2,8-3 s (2,52 s de query con `filter_properties` + overhead). Por eso el salto percibido viene de tres piezas que evitan el miss: cache local (F4), 304 (F5) y delta polling (F6) — no de optimizar más la query.

### 3.4 · UX — resto de hallazgos que entran en el plan (compacto)

| Código | Hallazgo | Sev | Coste | Fase |
|---|---|---|---|---|
| UX-13 | «Editar» no da feedback durante 1-4 s (el modal abre tras el await) → multi-pulsación | 🟠 | 1 h | F4 |
| UX-2a | Sin confirmación al descartar un formulario tocado | 🔴 | 2 h | F4 |
| UX-9 | La opción «Estado actual: X» del select manda valor vacío → error 400 | 🟡 | 0,25 h | F1 |
| UX-19 | Tras enviar no se dice qué pasa después → «En un par de minutos aparecerá el botón Firmar» | 🟠 | 0,25 h | F1 |
| UX-24 | Targets <44 px: botones de horas 36 px, cierre de modal 32 px, × de chip ~14 px [verificado con medición] | 🟠 | 1,5 h | F4 |
| UX-25 | Contrastes bajo AA [medidos]: aviso naranja 2,86:1, texto terciario 3,7:1, «· rápido» 3,2:1 — con sol es invisible | 🟠 | 1 h | F4 |
| UX-36/37 | Sin `inputMode` en campos numéricos (iPad abre teclado completo); matrícula sin `autoCapitalize/autoCorrect off` | 🟠 | 0,75 h | F4 |
| UX-41 | Errores técnicos en crudo («rate limit», «Token de Notion inválido», «El servidor respondió 500») → diccionario humano | 🟠 | 2 h | F5 |
| UX-42 | «Notion» visible en la UI (spinner y tooltip) | 🟠 | 0,25 h | F1 |
| UX-47 | Login: «Email o contraseña incorrectos» también sin cobertura o con 429 de Supabase | 🟠 | 1 h | F5 |
| UX-46 | El modal de sincronización explica ingeniería (3/8/15 s) y además describe un polling que no corre | 🟡 | 1 h | F6 |
| UX-55 | Reintentos automáticos invisibles («Reintentando… 2 de 3») | 🟠 | 1 h | F5 |

**Diferidos a post-demo (bloque de septiembre, ~12 h):** UX-2b borrador local en `localStorage` (4-5 h) · UX-17 línea «qué toca ahora» por estado (2 h) · UX-27 scroll anidado del modal de edición (2 h) · UX-28 filtros sticky rotos en tablet vertical — media queries solapadas (2 h) · UX-31/32 modal accesible compartido + 19 `htmlFor` (4,5-5,5 h; el patrón bueno ya existe en `src/auth/`) · UX-39/40 fechas «02:00» y riesgo de corrimiento de día — **verificar UX-40 con un parte de prueba en Notion (15 min) antes de decidir** · UX-43 unificar «Firmante» y renombrar «Enviar Datos» → «Enviar a firmar» (1,5 h — consensuar el término con Efrén) · UX-48/49/52 pulidos de login (2,5 h) · UX-56 shell offline (3-4 h, valorar).

**Descartados deliberadamente:** virtualización del listado (no es el cuello con ≤190 filas), service worker/PWA completa (riesgo de servir build vieja en la demo), lazy de modales (riesgo de chunk 404 tras redeploy sin SW), mover `sanitizeEconomic` al mapper (se queda como cinturón del invariante «cero datos económicos»), fijar `regions` (iad1 correcto), re-diseño del PUT wipe-and-recreate (H2 se mitiga con `maxDuration` en F7; el rediseño es proyecto aparte).

---

## 4 · Correcciones de diagnóstico importantes (análisis adversarial)

1. **`filter_properties` no acelera la descarga del usuario.** El servidor ya mapea a DTO (~19 campos, `notion.js:245-279`): los 934 KB viajan Notion→lambda. El ahorro real es tiempo de Notion (3,48→2,52 s) y parseo. [verificado con medidas]
2. **El suelo con Notion en el path de lectura es ~2,8-3 s por miss.** Ninguna optimización de query baja de ahí; el salto percibido viene de evitar el miss (cache local, 304, delta polling).
3. **Consolidar el arranque en una sola llamada puede empeorar el time-to-usable** si todo espera a la query de partes (2,5 s): hoy obras/jefes llegan en ~0,6 s. Mitigado en el plan: el menú se pinta sin datos (P2) y el listado es lo único que espera a partes.
4. **KV + snapshot + delta polling sería, pieza a pieza, el caché de lectura del ADR-007 construido sobre otra base.** Por eso el plan NO lo adopta de inicio: instrumenta los umbrales del ADR (p95 >1,5 s sostenido, >100 partes en ventana, ≥5 429/día, ≥2 incidencias stale/semana) y decide en octubre con datos. Antes de reabrir el ADR: re-verificar si Notion ya ofrece webhooks de BBDD (la premisa del aplazamiento puede haber caducado; la app usa `Notion-Version: 2022-06-28`).
5. **«Crear parte <1 s» no existe sin respuesta optimista**: aun sin sleeps y con lotes de 3, son ~14 llamadas contra 3 req/s ≈ 4,7 s de suelo. F7 apunta a ≤3 s con lotes; el optimista completo (respuesta tras cabecera + completado en background) queda como evolución posterior si el negocio lo pide.

## 5 · Plan por fases

El plan operativo completo (8 deploys, inseparables marcados, verificación por fase, kill-switches, congelación D-7 y calendario contra la demo de la semana del 7-14 sep) está aprobado y en ejecución. Resumen:

| Fase | Versión | Contenido | Horas | @regression-checker |
|---|---|---|---|---|
| Informe | — | Este documento | 2 | — |
| F0 | v1.9.1 | Speed Insights + fix doc regions + línea base medida | 1,5 | no |
| F1 | v1.9.2 | Invalidación de cache (BE-3) + ErrorBoundary + esperas artificiales fuera + UX de datos (UX-23/22/18/9/3/19/42) + limpieza react-router-dom | 7 | no |
| F2 | v1.9.3 | `filter_properties` en 4 catálogos + `/estado` + caches (estado-opciones, datos-completos) | 4 | **sí** |
| F3 | v1.10.0 | Arranque consolidado con fallback + menú sin gate + app-shell + `?desde&hasta` | 4 | no |
| F4 | v1.10.1 | Cache local SWR + skeletons + memoización + AbortController + toast + UX-1/10/4/13/2a/36/37/25/24 | 12,5 | no |
| F5 | v1.10.2 | Rate limit por usuario + retry/semáforo Notion + 304 + UX conexión/errores humanos | 8 | **sí** |
| F6 | v1.11.0 | Polling delta revivido (los 4 fixes juntos) + pausas en background + UX-46 | 4 | **sí** |
| F7 | v1.11.1/v1.12.0 | builds→functions; escrituras en lotes sin sleep + espejo al guardar + enviar optimista | 4,5 | **obligatorio** |

**Quick wins <2 h cada uno, por si se quiere empezar mañana:** UX-18 (0,5 h), P1/FE-12 (0,5 h), UX-23 (0,5 h), UX-9 (0,25 h), UX-3 (0,5 h), UX-19 (0,25 h), UX-42 (0,25 h), FE-20 (0,5 h), BE-16 (0,1 h), BE-5 (0,3 h).

**Métricas objetivo:** login→menú ~300 ms · login→listado frío ≤2,5 s · segunda apertura ≤0,5 s sin spinner · guardar percibido ~1,5 s · crear con 10 empleados ≤3 s (F7) · pantallazo: nunca · sin cobertura: indicador honesto + errores en español con reintento.

## 6 · Apéndice de mediciones (reproducibles)

**Latencias Notion (curl directo con el token de `.env`, 31-07-2026, desde España):**

| Query | Tiempo | Bytes |
|---|---|---|
| Partes (page_size 100, sin filter_properties) | 3,48 s | 934 KB |
| Partes (con las 19 props del mapper) | 2,52 s | 343 KB |
| Obras (Estado=Activa) | 2,15 s | 376 KB |
| Empleados (page_size 100) | 1,70 s | 548 KB |
| Jefes de obra | 0,51 s | 6 KB |
| GET /databases (estado-opciones) | 0,39 s | 56 KB |

Cómo se obtuvo: `curl -s -o /dev/null -w "%{size_download}B %{time_total}s\n" -H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2022-06-28" -X POST https://api.notion.com/v1/databases/<id>/query -H "Content-Type: application/json" -d '{"page_size":100}'` (variando body por query). Volúmenes: 190 partes, 1.554 empleados, 56 obras activas.

**Referencia previa en producción (v1.8.0, Chorus):** 410 KB/3,9 s → 37 KB/0,6 s con `filter_properties` — la mejor evidencia de la palanca.

**Bundle (build local, 17-08-2026):** `dist/assets` = 533 KB raw / **144 KB gzip** (index 87,7 + react-vendor 44,9 + css 9,2 + lucide 2,2). Sin supabase-js (build sin `VITE_SUPABASE_*`): index baja de 87,7 a **31,8 KB gzip** → supabase-js ≈ 56 KB gzip del camino crítico. Cómo: `npm run build` y `VITE_SUPABASE_URL= VITE_SUPABASE_PUBLISHABLE_KEY= npm run build`.

**Recorrido UX instrumentado (mock `copuno-mock`, puppeteer, viewport 1080×810 @2x, 17-08-2026):**
- Targets táctiles medidos (`getBoundingClientRect`): checkboxes 22×22 px; botones de cabecera 36 px alto; botones horas 36×36 px (CSS); cierre modal 32×32 px (CSS); × de chip de vehículo ~14 px.
- Atributos: 0 inputs con `inputmode`; 0 con `autocomplete/autocorrect` en matrícula; selects/inputs sin label asociado (salvo checkboxes por envoltura).
- Contrastes (luminancia relativa WCAG calculada sobre colores computados): «· rápido» 3,2:1 @12,7 px; badge Firmado 3,3:1; «No editable - Firmado» 2,86:1; footer 3,72:1.
- Modal de detalles: sin `role="dialog"`, sin `aria-modal`, foco en `<body>` tras abrir; Escape sí cierra.
- Login (build con auth): error de credenciales «Email o contraseña incorrectos.» — claro y en español.
- Script: `ux-audit.js` (scratchpad de sesión) — mide targets, atributos, contrastes, foco y captura pantallas; reproducible contra `npm run server` con `USE_MOCK_DATA=true`.

**Arranque (código, verificado):** 9 peticiones HTTP (3× `/api/health`, 2× `/api/empleados/estado-opciones`, obras, jefes, empleados, partes), en cascada de 3 saltos antes del primer byte de datos.

**Cola de referencia pendiente de medir tras F0:** p50/p95 reales de producción vía Speed Insights + `scripts/revision-telemetria.sh` (se activa al detectar plan Pro), y tasa de 429 en logs de Vercel.

---

*Informe elaborado el 17-08-2026 sobre `master` @ `3df09f6` (v1.9.0). Los tres informes de detalle (BE-1..20, FE-1..29, UX-1..56) y el plan operativo completo obran en el histórico de la sesión de auditoría; este documento es su consolidación ejecutiva.*
