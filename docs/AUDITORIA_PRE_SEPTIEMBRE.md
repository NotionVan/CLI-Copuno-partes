# Auditoría — Rendimiento percibido, flujo obra→empleados e impacto de v1.9.0 (pre-demo septiembre)

**Fecha:** 2026-07-31 · **Autor:** `@senior-architect-auditor` (solo lectura) · **Disparador:** feedback de Efrén por WhatsApp el 31-07 («se nos quedaba un poco colgado» en la presentación en la central; segunda demo en septiembre con la app «depurada»; Paola y Óscar mantendrán el personal asignado por obra cada semana; «correos de Make haciendo cosas»).

> Los hallazgos de este informe están pendientes de catalogar en [DEUDA_TECNICA.md](DEUDA_TECNICA.md). Los códigos C1–C6, I-A–I-G son propios de este informe, no de la deuda técnica.

## Resumen ejecutivo

El "se nos quedaba colgado" tiene tres causas concretas y verificadas, ninguna de ellas arquitectónica: (1) el Smart Polling del listado **está muerto desde hace meses** por un `ReferenceError` silenciado en `App.jsx:424` — la queja recurrente "la app no actualiza" es un bug, no una percepción; (2) el arranque dispara **9 peticiones HTTP, 4 de ellas duplicadas**, tras una pantalla en blanco (AuthGate) y una pantalla bloqueante ("Cargando datos desde Notion…") que dura lo que tarde la query más lenta — medida hoy contra el workspace real: **3,5 s solo para partes, 934 KB de JSON**; (3) el listado sólo trae **100 de los 190 partes reales** y el índice de empleados **100 de 1.554**, sin paginar y sin avisar. Ninguno de los tres necesita refactor: son entre 6 y 10 horas bien dirigidas.

El mayor riesgo para septiembre no es lo que hay hoy, es **arreglar el polling sin tocar nada más**: revivirlo tal cual pone 20 req/min por pestaña contra un endpoint que cuesta 3,5 s de Notion, revienta el rate limit propio (1.000/15 min por IP, NAT de la central: se satura con 3 usuarios) y el de Notion (3 req/s). Los dos cambios van juntos o no van.

Mayor oportunidad: `filter_properties` ya está resuelto y probado en el código para la exportación Chorus (`notion.js:516-533`) y no se ha aplicado a las tres queries de catálogo, que son el 100% del coste de arranque.

---

## Hallazgos

### 🔴 Bloqueantes (0)

Nada cumple el criterio (pérdida de datos, brecha de seguridad, caída bajo carga normal) en el alcance auditado. H2 (atomicidad de detalles) sigue abierto en `DEUDA_TECNICA.md` y sigue siendo 🔴, pero no cambia con este feedback y no se re-audita aquí.

---

### 🟠 Críticos (6)

#### C1 — El Smart Polling del listado nunca ha funcionado: `ReferenceError` silenciado

- **Dónde:** `src/App.jsx:424` (uso) vs `:856` (declaración), `catch` que lo traga en `:446`.
- **Qué:** dentro de `App()`, la función `poll` empieza con `if (editandoParte) return`. `editandoParte` **no existe en el ámbito de `App`** — está declarada en `ConsultaPartes` (`:856`). Acceder a un identificador no declarado lanza `ReferenceError`, y el `try/catch { /* noop */ }` de `:446` se lo traga. Resultado: **cada tick de 3 s entra, lanza y sale sin hacer nada**. Introducido en el commit `a0682a7` ("Skip list refresh while editing").
- **Consecuencias verificables:** el listado sólo se refresca al montar (`:508`), al volver a la pestaña (`:519`), con el botón manual y tras una acción. `getSmartPollInterval()` nunca se ejecuta → el indicador de sincronización se queda en "rápido" para siempre aunque no esté sincronizando nada.
- **Por qué importa:** es la explicación exacta de "la app no actualiza, hay que refrescar manual", documentada como queja recurrente en `CLAUDE.md`. En una demo, alguien firma desde el móvil y la pantalla proyectada no cambia: eso es "colgado" para quien mira.
- **Trampa:** arreglarlo *solo* multiplica la carga. Con 20 usuarios a 1 req/3 s son 6,7 req/s contra un endpoint que cuesta 2,5-3,5 s de Notion (límite Notion: ~3 req/s). Además `:433-437` hace `setDatos` en **cada** poll aunque el hash no cambie → nueva identidad de array → re-render completo del listado cada 3 s.
- **Coste de arreglar:** 1,5-2,5 h (fix + intervalo base realista 10-15 s + no re-setear estado si el hash no cambió).
- **Coste de NO arreglar:** la queja se repite en la demo de septiembre delante de la central.
- **Recomendación:** retainer, **primer ítem**. Nunca sin C3 y C5 en el mismo pase.

#### C2 — Arranque: 9 peticiones, 4 duplicadas, todo detrás de una pantalla bloqueante

- **Dónde:** `src/App.jsx:507-531` (efecto de montaje), `:572-608` (`cargarDatos`), `src/services/notionService.js:464-489` (`getDatosCompletos`), `src/App.jsx:703-708` (pantalla bloqueante).
- **Qué:** al montar se disparan, en este orden: `checkConnectivity()` → `/api/health` (`App.jsx:579`); luego `getDatosCompletos()` que **vuelve a llamar a `/api/health`** (`notionService.js:467`) antes de sus 4 llamadas; `cargarOpcionesEstado()` → `/api/empleados/estado-opciones`; `startEstadoPolling()` que ejecuta `poll()` inmediato → **la misma llamada otra vez** (`App.jsx:496`); y el chequeo de versión → `/api/health` **por tercera vez** (`:558`). Total: 3× health, 2× estado-opciones, obras, jefes, empleados, partes.
- **Medido el 31-07 contra el workspace real de Copuno** (curl directo, token de `.env`):

  | Query | Tiempo | Bytes |
  |---|---|---|
  | Partes (page_size 100) | **3,48 s** | 934 KB |
  | Obras (Estado=Activa) | 2,15 s | 376 KB |
  | Empleados (page_size 100) | 1,70 s | 548 KB |
  | Jefes de obra | 0,51 s | 6 KB |
  | `GET /databases` (estado-opciones) | 0,39 s | 56 KB |

- **Por qué importa:** el usuario ve primero **blanco** (AuthGate devuelve `null`, ver I-D) y luego un spinner a pantalla completa de 4-8 s. En Vercel las 4 llamadas paralelas caen probablemente en **4 instancias lambda distintas**, cada una con su `cache = new Map()` vacío (I2 de la deuda) y su cold start. Y 6 peticiones simultáneas a Notion rozan el límite de 3 req/s; si una devuelve 429 el servidor responde 500 (sin retry en `notion.js:91-115`) y `retryOperation` (`App.jsx:590`) **repite el lote entero hasta 3 veces**.
- **Coste de arreglar:** 2-3 h. Dirección: usar `/api/datos-completos` — **ya existe, ya hace `Promise.all` en servidor y ya está cubierto por smoke** (`server.js:895-911`) — y el frontend hoy no lo usa; eliminar el health duplicado; no lanzar `poll()` inmediato en `startEstadoPolling`. De 9 peticiones a 3.
- **Recomendación:** retainer.

#### C3 — Las tres queries de catálogo traen ~60 propiedades por página sin `filter_properties`

- **Dónde:** `src-server/services/notion.js:312-320` (obras), `:372-377` (empleados), `:782-788` (partes). El patrón correcto ya existe en el mismo archivo: `PROPS_EXPORT` + `conProps()` en `:516-533`.
- **Qué:** Notion devuelve **todas** las propiedades salvo que se acoten (59 en Partes, 54 en Empleados, 49 en Obras). Los mappers usan ~19, ~9 y ~3 respectivamente. Medido sobre Partes con las 19 propiedades reales del mapper: **934 KB → 343 KB y 3,48 s → 2,52 s**. En Empleados el recorte es mucho mayor (9 de 54).
- **Por qué importa:** mismo ahorro ya validado en v1.8.0 (410 KB/3,9 s → 37 KB/0,6 s), sin propagar al resto. Es el único cambio que baja la latencia de Notion sin tocar comportamiento.
- **Coste:** 1,5-2 h (IDs por API, congelarlos como constantes, smoke). Retainer, en el mismo pase que C1.

#### C4 — `/api/empleados/estado-opciones` sin cache y poleado cada 10-30 s por pestaña

- **Dónde:** `server.js:387-395` (único endpoint de catálogo **sin** `getCache`), `src/App.jsx:469-498` (polling).
- **Qué:** cada tick hace un `GET /databases/{EMPLEADOS}` (0,4 s, 56 KB) para leer opciones de select que no cambian nunca. Primer minuto a 10 s, después a 30 s, por pestaña, indefinidamente. Con 20 usuarios, hasta 2 req/s del presupuesto de 3 req/s de Notion gastados en datos inmutables.
- **Coste:** 15-20 min (añadir cache como el resto + subir a 5 min o cargar una vez). Retainer, quick win.

#### C5 — Rate limit propio: 3 usuarios en la central lo saturan en cuanto se arregle el polling

- **Dónde:** `server.js:98-107` (`RATE_LIMIT_MAX` default 1.000 / 15 min, **por IP**). I3 se cerró con "keyGenerator por usuario pendiente de H1" — H1 ya está resuelto en esta rama, el bloqueo desapareció y nadie lo ha retomado.
- **Qué:** con el polling vivo, una pestaña hace ~25 req/min ≈ 375 por ventana de 15 min. Detrás del NAT de la central, **2,6 pestañas agotan el límite**. El 429 propio no está tratado de forma específica en `notionService.js:143-168`.
- **Por qué importa:** es el escenario exacto de la demo de septiembre — varias personas abriendo la app a la vez desde la misma oficina.
- **Coste:** 1 h — `keyGenerator` por `req.usuario.id` (ya disponible en `src-server/middleware/auth.js:118`) con fallback a IP. Obligatorio si se toca C1.

#### C6 — 10 ejecuciones incompletas sin resolver en la cola de Make (origen probable de "los correos de Make")

- **Verificado por API contra producción eu2** (team `2014883`, 31-jul):
  - PARTES1/4 (`5595847`): 7 en cola, **6 sin resolver** — 5 con `Bad control character in string literal in JSON` (27-jul, incidente M5) y 1 `Cannot read properties of undefined (reading 'placement')` (28-jul), con `attempts` entre 4 y 7.
  - PARTES2/4 (`5595873`): **4 sin resolver**, mismo error, 28-jul.
  - PARTES3/4, 4/4 y Envío al cliente: cola limpia.
- **Qué:** Make reintenta las incompletas y **cada reintento reejecuta la copia congelada del blueprint del momento del fallo** (gotcha documentado): vuelven a fallar aunque `escapeJSON()` esté aplicado, y cada fallo genera email. Última ejecución real de PARTES1/4: 28-jul 16:22; PARTES4/4 (firma): 30-jul 09:29. Sin ejecuciones el 31.
- **Por qué importa:** responde a lo que vio Efrén — ruido residual del incidente del 27-28, no algo que disparara la demo. Si no se purga, seguirá llegando correo y erosionando confianza.
- **Coste:** 15-20 min (purgar desde la UI de Make; los 5 partes ya se relanzaron y funcionan). Retainer, esta semana. Añadir "purgar cola" al procedimiento post-incidente.

---

### 🟡 Importantes (7)

#### I-A — Truncación silenciosa a 100 registros (partes y empleados)

- **Dónde:** `notion.js:782-788` (partes) y `:372-377` (empleados), ambas `page_size: 100` **sin paginar**. Medido: Partes tiene **190 filas**, Empleados **1.554**.
- **Efecto en demo:** "busca el parte de tal obra del mes pasado" → no aparece, sin aviso. Y el modal de detalles resuelve el ID Copuno cruzando contra `datos.empleados` (`App.jsx:2170`), que tiene 100 de 1.554 → **la columna ID sale "—" para ~94 % de los trabajadores** (se pagan 1,7 s y 548 KB de arranque por un índice que casi siempre falla).
- **Coste:** 2-3 h — quitar `/api/empleados` del arranque, resolver el ID Copuno en el endpoint de detalles (ya hay resolvedor con cache en `notion.js:549-562`), y en partes paginar o filtrar por ventana de fechas. Empeora cada semana.

#### I-B — 100 % de las obras activas sin `Persona Autorizada` → selector de firmantes siempre vacío

- **Verificado por API:** de **56 obras activas, 56 sin `Persona Autorizada`**. La BD tiene 3 entradas: `Raul Fayos Martinez`, `MELENDEZ` (sin email) y `Persona firmante Notionvan - tests`.
- **Qué:** `GET /api/obras/:id/firmantes-autorizados` devuelve siempre `[]`; cada parte exige marcar «búsqueda libre», donde además aparece la entrada de pruebas. Es **N1 de la deuda** y es **dato del cliente, 0 h de código**: encaja exactamente en la rutina semanal que Efrén acaba de ordenar a Paola y Óscar.
- **Coste:** 1 h propia (guía + verificación) + trabajo del cliente. Borrar/archivar la entrada de pruebas antes de septiembre.

#### I-C — `firmantes-autorizados` hace N+1 secuencial y no tiene cache

- **Dónde:** `notion.js:349-357` (bucle con `await` por firmante), `server.js:220-235` (sin cache). Es I7, aplazado. Hoy no duele porque no hay firmantes (I-B); en cuanto se pueble, cada selección de obra costará 1+N llamadas secuenciales (~2 s con 3 firmantes).
- **Coste:** 30 min (Promise.all acotado + cache 30-60 s). Hacerlo **antes** de poblar firmantes.

#### I-D — AuthGate deja la pantalla en blanco sin límite de tiempo

- **Dónde:** `src/auth/AuthGate.jsx:190-204`: mientras `listo` es `false` devuelve `null` — blanco, sin logo ni spinner, hasta que resuelve `supabase.auth.getSession()`. Sin timeout ni estado de error: si Supabase falla, el blanco es permanente. Hoy no aplica en producción, pero el corte está previsto antes de septiembre — se estrenaría en la demo.
- **Coste:** 30-45 min (spinner con marca + timeout ~8 s con mensaje accionable).

#### I-E — Cada petición espera a `supabase.auth.getSession()`; un 401 puede expulsar con el parte a medias

- **Dónde:** `notionService.js:18-39` (interceptor `await getSession()` en **cada** llamada) y `:61-65` (401 → `refreshSession` → `signOut`). Ante 401 masivos (p. ej. fallo del JWKS), cada respuesta dispara refresh y, si falla, `signOut()`: el jefe pierde el formulario sin guardar. La verificación JWT del servidor está bien resuelta (local, JWKS cacheado 10 min, `auth.js:42-57`); falta dedupe de peticiones JWKS en vuelo en lambda fría.
- **Coste:** 1-1,5 h (cachear token en módulo, revalidar cerca de expiración; no hacer signOut con formulario abierto). Tras el corte de auth.

#### I-F — Sin retry ni backoff ante 429/5xx de Notion

- **Dónde:** `notion.js:91-115` mapea el 429 a `Error` → el endpoint responde 500. El único retry es de brocha gorda en cliente (`notionService.js:492-505`) y **reintenta el lote entero**, empeorando el burst.
- **Coste:** 2-3 h (un reintento respetando `Retry-After` en `createClient` + límite de concurrencia global). Mes siguiente.

#### I-G — Frescura del flujo obra→empleados: correcto hoy, con una asimetría a vigilar

- **Verificado:** `GET /api/obras/:id/empleados` (`server.js:419-431`) **no pasa por cache** y consulta por relación inversa (`notion.js:322-329`): lo que Paola y Óscar dejen el viernes se ve el lunes al instante. **No cachear este endpoint** (o TTL ≤ 10 s). **Multi-obra:** soportado sin penalización ni conflicto — confirmado.
- **Asimetría:** `crear`/`actualizar` leen los asignados desde la página de la obra (`notion.js:896-899`, `:939-941`), donde **Notion trunca las relaciones a 25 elementos** (máximo observado: exactamente 25). Hoy solo afecta al log de "empleados no asignados"; si mañana se usa para validar, dará falsos positivos.
- **Race Paola-edita-mientras-jefe-crea:** ventana corta, daño nulo (el servidor no valida asignación). **No arreglar.**

---

### 🔵 Informativos (6)

- **No hace falta virtualizar el listado** — 100 filas de JSX en tablet no es el problema; el coste está en red y Notion.
- **`server.js` (934 líneas) está cohesivo, no acoplado.** No es la causa de nada de lo anterior.
- **`/api/datos-completos` es código muerto desde el frontend** — justamente la pieza que resuelve C2.
- **`src/App.jsx` sigue en 3.357 líneas** — el motivo por el que un `ReferenceError` vive meses sin verse. Trocearlo es proyecto aparte; no cabe antes de septiembre.
- **El polling del modal de estado (`App.jsx:1645-1688`) sí funciona** y está bien construido — sirve de patrón para arreglar C1.
- **Suite smoke: 45/45 en 0,3 s.** Cubre el contrato de servidor; no puede cubrir el bug de `App.jsx` — la verificación de frontend sigue siendo manual, aceptable en este retainer.

---

## Plan recomendado antes de septiembre

**Bloque 1 — "la demo va fluida" (6-8 h, retainer, un único pase, desplegar junto):**

| # | Ítem | Sev | Coste | Por qué antes de septiembre |
|---|---|---|---|---|
| 1 | C6 — purgar las 10 ejecuciones incompletas de Make | 🟠 | 0,3 h | Corta los correos que ya ha visto el cliente |
| 2 | C1 — arreglar el polling + intervalo base 10-15 s + no re-render sin cambios | 🟠 | 2 h | Mata la queja de "no actualiza" |
| 3 | C5 — rate limit por usuario autenticado | 🟠 | 1 h | Sin esto, el punto 2 tumba la demo con 3 usuarios |
| 4 | C2 — consolidar el arranque en `/api/datos-completos`, quitar duplicados | 🟠 | 2,5 h | Arranque de 4-8 s a ~3 s |
| 5 | C3 — `filter_properties` en obras/empleados/partes | 🟠 | 2 h | −1 s y −600 KB por refresco, patrón ya probado |
| 6 | C4 — cachear `estado-opciones` y subir su intervalo | 🟠 | 0,3 h | Libera presupuesto de Notion |

**Bloque 2 — antes o durante (3-5 h + trabajo del cliente):**

| # | Ítem | Sev | Coste |
|---|---|---|---|
| 7 | I-B — poblar `Persona Autorizada` en las 56 obras activas y borrar la entrada de pruebas | 🟡 | 1 h propia + cliente |
| 8 | I-C — paralelizar y cachear firmantes **antes** de poblarlos | 🟡 | 0,5 h |
| 9 | I-A — quitar `/api/empleados` del arranque y resolver el ID Copuno en servidor | 🟡 | 2-3 h |
| 10 | I-D — spinner con marca y timeout en AuthGate | 🟡 | 0,5 h |

**Fuera del pre-septiembre:** I-E (tras el corte de auth), I-F (mes siguiente), paginación de partes (proyecto aparte junto con el troceado de `App.jsx`).

**Antes de la demo, sin excepción:** pasada manual en navegador del flujo completo (crear → enviar-datos → firmar → ver actualización sola) con build de producción. Los 45 smoke no detectan nada de lo que ha fallado aquí.

---

## Lo que NO se pudo verificar

- **429 de Notion en producción** — hipótesis fuerte; confirmar buscando "Límite de rate limit excedido" en logs de Vercel de una mañana laborable (retención: días).
- **Valores reales de `RATE_LIMIT_MAX` y `CACHE_TTL_MS` en Production** — los cálculos asumen los defaults; el dashboard de Vercel manda.
- **Latencia Notion desde `cdg1`** — medidas hechas desde España; el orden de magnitud se mantiene, la cifra exacta no.
- **Si el "colgado" fue el arranque o la falta de refresco** — ambas encajan y no son excluyentes. Desambiguar con una pregunta a Efrén: «¿se quedó parado al abrir, o abrió bien y luego no cambiaba nada?».
- **`getSession()` bajo 5-9 llamadas concurrentes en Safari/iPad** — antecedentes conocidos de bloqueos del lock en iOS; probar la preview con auth en un iPad real.
- **Origen exacto de los correos de Make** — la cola de incompletas es la explicación más probable y está verificada; si los correos son del 29-31 y no del 28, hay otra fuente.

---

## Apéndice — Impacto del salto de Vercel Hobby a Pro (previsto)

El upgrade **no cambia el diagnóstico ni el plan**: los seis críticos son de la aplicación y se comportan igual en Pro. Tampoco elimina cold starts, ni hace útil el cache en memoria entre lambdas (I2), ni toca el límite de 3 req/s de Notion. No esperar que el plan arregle el «colgado».

Lo que sí cambia:

1. **Margen de timeout.** En Hobby el límite por defecto de una función es ~10 s; la query de partes ya cuesta 3,5 s de Notion y, con cold start + el `retryOperation` del cliente reintentando el lote (C2), un arranque en frío queda cerca del 504. Pro da bastante más techo — reduce la probabilidad de error visible en frío, sin sustituir a los fixes.
2. **Desbloquea la telemetría (I4).** Los log drains son de plan de pago: es lo que tenía bloqueado el nivel 3 de observabilidad y la integración Better Stack ya decidida. Además, la retención de logs de Hobby hace casi imposible confirmar la hipótesis de los 429 de Notion; con Pro se puede capturar una mañana laborable real.
3. **Protección de previews granular.** En Hobby los previews protegidos exigen sesión de Vercel («todo o nada», gotcha documentado). Pro permite bypass y accesos compartidos — facilita el E2E en preview con usuarios reales del cliente antes del corte de auth.
4. **Cumplimiento.** Hobby es para uso personal no comercial según los términos de Vercel; esta es una app interna comercial de cliente. El salto ya consta en el IMD con coste a cargo de Copuno según la Propuesta.

**Al completar el upgrade, dar de alta la revisión periódica.** Contratar Pro y no mirar nunca los
log drains no sirve de nada: la telemetría es justo lo que Pro desbloquea. Existe
[`scripts/revision-telemetria.sh`](../scripts/revision-telemetria.sh), que **comprueba primero si el
plan ya es Pro** y se calla si sigue en Hobby (para que el recordatorio no eduque a ignorarlo).
Lo dispara una tarea programada mensual (`revision-telemetria-copuno`, día 8 a las 10:00).
Lo que mide y lo que hay que mirar a mano está en el propio script; los criterios que reabrirían la
decisión de arquitectura, en [ADR-007](./adr/ADR-007-sincronizacion-notion-supabase.md).

**Operativa del upgrade:** transferir el proyecto a un team Pro implica cambio de ownership — verificar después que las variables de entorno (en especial `SUPABASE_*` del scope Preview y el futuro `AUTH_OBLIGATORIA`), el dominio y la integración GitHub siguen en su sitio, y revisar los defaults de Deployment Protection del team nuevo. **Orden recomendado:** upgrade antes del corte de auth y de la demo de septiembre, para que la validación en preview y la telemetría estén disponibles cuando toquen.

---

## Mensaje sugerido para Efrén

> «He revisado a fondo lo del 'colgado': son tres cosas concretas y ya localizadas —el refresco automático del listado estaba fallando sin avisar, el arranque hacía el doble de llamadas de las necesarias y las consultas a Notion traían mucho más dato del que hace falta—. Lo dejo resuelto dentro del retainer antes de septiembre, con una prueba en tablet como la que usaréis en la central. Los correos de Make que viste son cola atrasada del incidente del 28 de julio, ya resuelto: los limpio esta semana.»

Y la petición que se apoya en su propia directriz:

> «Aprovechando que Paola y Óscar van a dejar el personal asignado por obra cada viernes, necesito que en esa misma pasada rellenen la 'Persona Autorizada' de cada obra. Ahora mismo no la tiene ninguna, y por eso al crear un parte hay que buscar el firmante a mano en toda la base. Es trabajo vuestro en Notion, no de programación, y es lo que más se va a notar en la demo.»

Nada de esto es proyecto aparte. Lo que sí lo es —y no hay que mencionar ahora— es el troceado de `App.jsx` y la paginación completa del histórico de partes.
