# Copuno · Gestión de Partes — Informe técnico de la intervención de agosto 2026

> Registro de ingeniería de la intervención ejecutada entre el 17 y el 18 de agosto
> de 2026 sobre la aplicación en producción: **diagnóstico, causa raíz, diseño,
> implementación, verificación y resultado**. Escrito para que un desarrollador que
> no participó pueda entender qué se cambió, por qué se eligió esa solución y qué se
> rompe si la altera.
>
> - **Autor:** NotionVan · **Fecha:** 2026-08-18
> - **Versiones:** v1.9.0 → **v1.13.2** (16 despliegues, 2 jornadas)
> - **Diagnóstico previo:** [INFORME_UX_RENDIMIENTO_2026-08-17.md](INFORME_UX_RENDIMIENTO_2026-08-17.md) (105 hallazgos)
> - **Arquitectura resultante:** [ARQUITECTURA.md](ARQUITECTURA.md) §3.1
> - **Estado al cierre:** v1.13.2 en producción · suite de humo 64/64 · working tree limpio

---

## 1 · Resumen

| Indicador | Antes | Ahora | Δ |
|---|---|---|---|
| Time-to-interactive del menú | 4-8 s (spinner global) | **~160 ms** | ~30× |
| Peticiones en el arranque | 9, en cascada de 3 saltos | **3** | −67 % |
| Segunda apertura (datos en pantalla) | idéntica a la primera | **47 ms** | ~100× |
| Query de partes (Notion → lambda) | 935 KB / 1,94 s | **357 KB** | −62 % |
| Query de empleados (Notion → lambda) | 652 KB / 2,91 s | **171 KB / 0,7 s** | −74 % |
| `POST /partes-trabajo` (10 empleados) | 8,5 s | **4,8 s** | −44 % |
| `PUT /partes-trabajo/:id` (10 empleados) | 17,2 s | **13,1 s** | −24 % |
| Guardado percibido | 4-6 s (2-4 s artificiales) | **~1,5 s** | −70 % |
| Detección de cambios ajenos | inexistente (roto desde v1.3) | **12-30 s** | — |
| Coste de comprobar novedades | query completa 1,5-2,5 s | **0,43 s** | −75 % |
| Catálogo de empleados accesible | 100 de 1.533 | **1.533** | 15× |
| Cobertura de humo | 45 casos | **64 casos** | +42 % |

**Tres defectos de integridad** encontrados durante la intervención pesaron más que
todo lo anterior: nombres de empleado servidos vacíos en producción, horas a 0
grabadas como 8, y una ruta de edición capaz de vaciar un parte. Ninguno se
manifestaba como error: el sistema respondía 200 con datos incorrectos.

---

## 2 · Metodología

**Principio:** ninguna cifra de este informe es una estimación. Las mediciones de
«antes» y «después» comparten máquina, conexión y método; no se cruzan fuentes.

| Qué se mide | Cómo |
|---|---|
| Latencia y payload de Notion | `curl` directo contra la API con el token de producción. Aísla el coste de la query del resto del stack |
| Latencia de endpoint | Servidor Express local contra la **BD real de producción**, midiendo petición fría y cacheada. Es la cifra que percibe el usuario |
| Time-to-interactive | Puppeteer headless contra el modo mock, viewport de tablet, hasta el primer frame interactivo |
| Escrituras | Cronometradas contra Notion real: crear y editar partes de 10 empleados en la obra de pruebas, mismo entorno antes/después |
| Regresión | Suite `node:test` + `@regression-checker` (agente independiente) sobre los 3 flujos críticos antes de cada merge |

**Comando canónico de las latencias de Notion** (reproducible):

```bash
curl -s -o /dev/null -w "%{size_download}B %{time_total}s\n" \
  -H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2022-06-28" \
  -X POST "https://api.notion.com/v1/databases/<id>/query" \
  -H "Content-Type: application/json" -d '{"page_size":100}'
```

**Volumen del sistema al medir:** 191 partes · 1.533 empleados · 54 obras activas ·
565 detalles de horas · 141 vehículos. Relevante porque descarta la hipótesis
«el problema es el volumen»: con estas magnitudes, ninguna API razonable debería ir
lenta. El problema era de diseño de acceso, no de escala.

---

## 3 · Estado inicial: anatomía de los problemas

### 3.1 Los tres defectos de integridad

#### I9 — Nombres de empleado vacíos en producción

**Síntoma:** los 100 empleados devueltos por la API llegaban con `nombre: ''`, y
`GET /api/empleados/buscar?q=...` devolvía 500.

**Causa raíz:** el mapper accedía a la propiedad título **por su nombre literal**:

```js
nombre: extractPropertyValue(page.properties['Nombre Completo'])
```

Alguien renombró esa propiedad en la UI de Notion a cadena vacía. El acceso pasó a
devolver `undefined` → `''` para todos los registros, sin excepción ni log. La
búsqueda, que filtraba por `property: 'Nombre Completo'`, empezó a recibir 400 de
Notion, que el servidor traducía a 500.

**Por qué importa más de lo que parece:** el disparador estaba **fuera del código**.
Ningún test, revisión ni despliegue lo habría detectado, y llevaba semanas activo.
Es la explicación más probable del fallo de la demostración ante la central en julio.

**Fix estructural** — resolver el título por *tipo*, no por nombre:

```js
function titleDe(page) {
  for (const prop of Object.values(page.properties || {})) {
    if (prop.type === 'title') return extractPropertyValue(prop)
  }
  return ''
}
```

Y la búsqueda pasa a filtrar por el ID canónico `'title'`, que Notion garantiza
estable frente a renombrados. La clase entera de fallo queda cerrada, no solo esta
instancia.

#### UX-23 — El 0 de horas se grababa como 8

```js
const horas = Number(empleadosHoras[empleadoId] || 8)   // antes
const horas = Number(empleadosHoras[empleadoId] ?? 8)   // ahora
```

`||` trata el `0` como falsy. Un trabajador presente sin jornada imputable se
grababa con jornada completa — y ese dato viaja al PDF firmado y al CSV de
facturación. El mock devolvía valores que no pasaban por esa rama, razón por la que
la suite no lo detectaba; se añadió un caso que fija el contrato.

#### UX-4 — La edición podía vaciar un parte

El `PUT` implementa *wipe-and-recreate*: archiva todos los detalles y los recrea con
el payload recibido. Si `getDetallesCompletosParte` fallaba, el formulario abría con
0 empleados, y guardar archivaba las horas reales sin recrear nada. Era el único
camino de pérdida de datos del producto. Ahora el formulario **no abre** si la carga
falla, y se añadió un guard N→0.

### 3.2 Patologías de rendimiento

| Patología | Detalle | Coste |
|---|---|---|
| Arranque en cascada | 9 peticiones (3× `/health`, 2× `estado-opciones`, 4 catálogos) en 3 saltos secuenciales. `PantallaPrincipal` es JSX estático, sin dependencia de datos, pero estaba tras el ternario `loading` global | 4-8 s hasta ver nada |
| Sobre-fetch | Ninguna query usaba `filter_properties`: Notion devolvía cada página completa aunque el mapper leyera 19 campos | 935 KB por listado |
| Sin caché de cliente | Cada montaje empezaba de cero | Reabrir = arrancar |
| Esperas artificiales | `setTimeout` de 2-4 s tras guardar «para que se lea el mensaje», más 2,5 s en el camino 409 | 4-6 s percibidos |
| Escrituras seriales | Bucle `await` con `sleep(100)` intercalado: crear un parte de 10 empleados = 14 round-trips secuenciales | 8,5 s |
| N+1 en firmantes | Un `GET /pages` por firmante, secuencial, sin caché | — |

### 3.3 Patologías de fiabilidad

#### C1 — El polling del listado llevaba muerto desde v1.3

```js
useEffect(() => {
  const id = setInterval(() => {
    if (editandoParte) return        // ReferenceError: editandoParte is not defined
    cargarPartes()
  }, 30000)
  return () => clearInterval(id)
}, [])                                // catch vacío tragándose la excepción
```

`editandoParte` vivía en el componente hijo, no en el scope del efecto. Cada tick
lanzaba `ReferenceError`, un `catch {}` lo silenciaba y el listado nunca se
refrescaba. **Origen directo de la queja «la app no actualiza», activa durante meses.**

#### BE-3 — La caché en memoria no se invalidaba tras escribir

Existía un único `cache.delete`, el del vencimiento por TTL. Tras crear un parte, un
`GET` que cayera en la misma instancia dentro de los 30 s de TTL servía el listado
**sin el parte recién creado**. Es la segunda mitad —independiente— de la misma queja.

#### Otras

- **Sin Error Boundary**: cualquier excepción de render dejaba la pantalla en blanco.
- **Rate limit por IP**: detrás del NAT de la central, 3 pestañas agotaban el cupo de
  toda la oficina. Escenario textual de una demo.
- **Indicador de conexión mentiroso**: los fallos de polling se descartaban en
  silencio, así que la píldora decía «Conectado» sin cobertura.
- **`AuthGate` devolvía `null`** sin timeout ni `.catch()`: un fallo de
  `getSession()` dejaba blanco permanente.

---

## 4 · Intervención

Ocho fases, un despliegue por fase, cada una revertible de forma independiente.
Regla transversal: suite verde + bump SemVer + changelog antes de cada merge;
`@regression-checker` obligatorio en las fases que tocan lectura de estado, cliente
Notion, sincronización o escrituras.

### F0 · Línea base (v1.9.1)

Medir antes de tocar. Se activó la telemetría real de la plataforma y se corrigió un
error de documentación con impacto: `DESPLIEGUE_VERCEL.md` recomendaba
`"regions": ["cdg1"]`.

**Por qué eso habría sido un error:** la función corre en `iad1`, junto a la API de
Notion (us-east). Cada operación de usuario provoca entre 1 y 24 round-trips a Notion
frente a **uno solo** hacia el usuario. Acercar la función al usuario europeo aleja
las 24 llamadas: coste neto estimado **+1-1,3 s por parte creado**. La intuición
«pon el servidor cerca del usuario» es exactamente la equivocada en un backend
chatty contra una API remota.

### F1 · Integridad y red de seguridad (v1.9.2)

- `invalidateCache()` con claves exactas y por prefijo, invocado en **las 5 rutas de
  escritura**. Prerrequisito duro de todo lo demás: cualquier capa de caché añadida
  después heredaría el bug si no se arreglaba primero.
- `?? 8`, clamp de horas en `onBlur` (antes el clamp por pulsación convertía «7.5»
  en 24), Error Boundary global, eliminación de las esperas artificiales.
- Normalización de los `className` de estado: tres de los cinco badges salían sin
  estilo por desajuste entre el valor de Notion y la clase CSS.

### F2 · Dieta de payload (v1.9.3)

`filter_properties` en todo el catálogo, con los IDs de propiedad obtenidos por API y
congelados en `PROPS_CATALOGO`. Aquí se detectó I9.

**Verificación elegida — golden-diff:** se capturó la respuesta de cada endpoint
antes y después contra Notion real y se comparó campo a campo. `obras`, `jefes-obra`
y `estado` idénticos byte a byte; `empleados` con los nombres recuperados;
`partes-trabajo` difería solo en el campo corregido. Cero cambios de forma en los
DTOs. Es la única forma de garantizar que una optimización de payload no ha
amputado un campo que alguien lee.

**Resultado:** partes 935→357 KB (−62 %); empleados 652→171 KB, 2,91→0,7 s (−74 %).

**Matiz honesto:** el ahorro es Notion→lambda, no lambda→navegador (el servidor ya
mapeaba a DTO). Gana el tiempo de query, el parseo y la presión sobre el límite de
3 req/s. Se documenta así para no vender una mejora que el usuario no percibe
directamente.

### F3 · Arranque (v1.10.0)

- `getDatosCompletos()` pasa de 4 llamadas a **una** contra `/api/datos-completos`
  (endpoint que existía pero estaba muerto desde el frontend), **con fallback
  automático al camino antiguo** si falla.
- `PantallaPrincipal` sale del gate de carga global.
- App-shell en `index.html`: logo y spinner pintados **antes de que cargue el JS**;
  `preconnect` a Supabase; `AuthGate` pinta el mismo shell y añade `.catch()`.

**Corrección de diseño sobre el plan original:** consolidar *todo* en una llamada
habría **empeorado** el time-to-usable — hoy obras y jefes llegan en ~0,6 s en
paralelo, y consolidados esperarían a partes (2,5 s). Se resolvió sacando el menú del
gate: el usuario ve UI útil a los 160 ms y los catálogos llegan mientras decide.

**Medido:** menú interactivo en 158-160 ms; arranque con exactamente 3 peticiones.

### F4 · Caché local y feedback (v1.10.1)

`src/lib/cacheLocal.js` — SWR sobre `localStorage`:

- Clave versionada `copuno:datos:v<versión>`: **cada despliegue purga las cachés
  locales**, lo que da un kill-switch gratuito sin código adicional.
- **Sin empleados en disco** (DNI y teléfono no tocan el almacenamiento de una tablet
  compartida) ni datos económicos. Caducidad 24 h. Limpieza en logout.
- Si la revalidación falla con datos ya pintados, se mantiene la foto y avisa el
  indicador de conexión: nunca una pantalla de error sobre datos válidos.

**Medido: segunda apertura con listado lleno en 47 ms.**

Entra también el toast único con `role="status"` (los mensajes salían fuera del
viewport: causa de «pulso Enviar y no pasa nada»), la protección de UX-4, targets a
44 px y contrastes AA.

### F5 · Resiliencia multiusuario (v1.10.2)

- **Rate limit en dos capas**: grueso por IP (5.000/15 min) **delante** de la
  autenticación —protege la verificación JWT del martilleo anónimo— y fino por
  `req.usuario.id` (1.000/15 min) **detrás**. El orden importa: invertirlo o expone
  la verificación de token, o vuelve al cupo compartido tras el NAT.
- Semáforo global de 5 hacia Notion; 429 → 503 con `Retry-After`; retry con backoff
  y jitter solo en lecturas.
- `no-store` → `private, no-cache, must-revalidate`: habilita **304 con 0 bytes**
  usando el ETag que Express ya generaba. `private` se mantiene porque los payloads
  llevan DNI y teléfono: prohibido cachear en intermediarios compartidos.
- `express.static` movido al final: cada `/api/*` pagaba un `stat()` de disco antes.

### F6 · Sincronización (v1.11.0)

La pieza central. Dos mitades:

**Cliente** — polling reconstruido con el patrón que sí funcionaba en la app (el poll
del modal): flag `cancelled` + `setTimeout` encadenado (no `setInterval`), hash-guard
que devuelve `prev` si la foto no cambió —así los `useMemo` de la consulta no se
invalidan—, cadencia 12/20/30 s, sin tick inmediato, pausado en background.

**Detalle no obvio:** el estado «hay una edición abierta» viaja por **ref**
(`edicionAbiertaRef`) y no por estado. Una closure del efecto capturaría el valor en
el momento de montarse y leería siempre `false`: es exactamente la clase de error que
mató al polling original en v1.3.

**Servidor** — freshness-check antes de repetir la query completa:

```js
async hayCambiosDesde({ client, desdeIso }) {
  const data = await client.request('POST', conProps(`/databases/${DATABASES.PARTES_TRABAJO}/query`, ['title']), {
    filter: { timestamp: 'last_edited_time', last_edited_time: { after: desdeIso } },
    page_size: 1
  })
  return data.results.length > 0
}
```

Tres decisiones dentro de esas seis líneas:

1. **Filtro a nivel `timestamp`, no de propiedad.** `last_edited_time` como timestamp
   es metadato del sistema: inmune a renombrados. Lección directa de I9.
2. **`page_size: 1` + `filter_properties: ['title']`**: solo interesa la existencia,
   no el contenido. 0,43 s medidos frente a 1,5-2,5 s de la query completa.
3. **El cursor vive en el servidor**, calculado como el máximo `ultimaEdicion` de la
   foto (`cursorDeFoto`), no en el cliente. Un cursor en la tablet dependería del
   reloj del dispositivo y divergiría entre usuarios.

Y el manejo de saturación, que es una decisión de producto más que técnica:

```js
if (err?.status === 429) {
  logCamino('stale-por-429')
  return res.json(foto.data)     // foto algo vieja > 503
}
```

Con Notion saturado, servir datos de hace dos minutos es mejor respuesta que un error:
la query completa también habría fallado. Complemento: `PARTES_TTL_DURO_MS` (5 min)
como techo absoluto, porque **el check no ve los archivados** — un parte borrado en
Notion no genera `last_edited_time` nuevo en la query.

### F7 · Escrituras (v1.12.0 → v1.12.2)

**Orden invertido respecto al plan** (7b antes que 7a) tras análisis adversarial: con
las escrituras en lotes ningún PUT real supera 8-10 s, así que `maxDuration` dejaba
de ser prerrequisito; y la migración de `vercel.json` es el único cambio cuyo modo de
fallo es «/api entero caído», por lo que va al final y con ventana de observación.

**Batching con barrera:**

```js
async function enLotes(items, concurrencia, fn) {
  const salida = []
  for (let i = 0; i < items.length; i += concurrencia) {
    const lote = items.slice(i, i + concurrencia)
    const resultados = await Promise.all(lote.map(item =>
      fn(item).then(value => ({ ok: true, value }))
              .catch(error => ({ ok: false, item, error }))
    ))
    salida.push(...resultados)
  }
  return salida
}
const DETALLES_CONCURRENCIA = 3
```

**Por qué 3 y no 5:** las escrituras comparten el semáforo global de 5 con las
lecturas del polling de *otros* usuarios. Saturarlo con escrituras encolaría los
`GET` de todo el mundo. Se deja hueco deliberadamente.

**Archivado transaccional — el cambio más importante de la fase.** El
`@regression-checker` detectó que `enLotes` completaba todas las tandas antes de
comprobar fallos: un archivado parcial dejaba horas ocultas y devolvía mensaje de
éxito. Se sustituyó por corte al primer fallo **más rollback**:

```js
async function archivarDetallesConRollback({ client, detalles }) {
  const archivados = []
  let fallo = null
  for (let i = 0; i < detalles.length && !fallo; i += DETALLES_CONCURRENCIA) {
    const res = await Promise.all(lote.map(d =>
      conReintento429(() => client.request('PATCH', `/pages/${d.id}`, { archived: true }))
        .then(() => ({ ok: true, id: d.id }))
        .catch(error => ({ ok: false, id: d.id, error }))
    ))
    res.filter(r => r.ok).forEach(r => archivados.push(r.id))
    fallo = res.find(r => !r.ok) || null
  }
  if (!fallo) return { ok: true }
  // desarchivar lo ya archivado y reportar lo irrecuperable
  const rollback = await enLotes(archivados, DETALLES_CONCURRENCIA, id =>
    conReintento429(() => client.request('PATCH', `/pages/${id}`, { archived: false })))
  return { ok: false, error: fallo.error, noRestaurados: rollback.filter(r => !r.ok).map(r => r.item) }
}
```

Notion no tiene transacciones. Esto es lo más parecido que se puede construir encima,
y el invariante que protege es de negocio: **un parte nunca queda con horas de menos
ni duplicadas**, porque esas horas acaban en el PDF firmado y en la facturación.

**Optimismo en la UI, con un límite explícito:** al pulsar «Enviar datos» la tarjeta
pasa a `Procesando` —que es la verdad, el servidor marca ese estado antes del
webhook— y **nunca** a `Datos Enviados` antes de la confirmación. Si el webhook
fallara, el servidor revierte a Borrador, y un capataz no debe irse de la obra
creyendo enviado un parte que no lo está.

El parche se re-aplica sobre **toda** foto entrante:

```js
const conParches = (partes) => {
  if (parcheEstadoRef.current.size === 0) return partes
  const ahora = Date.now()
  return partes.map(p => {
    const parche = parcheEstadoRef.current.get(p.id)
    if (!parche) return p
    if (p.estado === parche.estado || ahora - parche.ts > PARCHE_TTL_MS) {
      parcheEstadoRef.current.delete(p.id)   // se disuelve solo
      return p
    }
    return { ...p, estado: parche.estado }
  })
}
```

TTL de 60 s > caché de 30 s + tick de 12 s: la verdad del servidor siempre acaba
mandando. Cierra I8 de raíz — antes, una foto stale de otra instancia devolvía la
tarjeta a «Borrador» con el botón reactivado.

**Medido (local → Notion real, mismo entorno):** crear 10 empleados 8,5 → **4,8 s**
(−44 %); editar 17,2 → **13,1 s** (−24 %). El suelo restante en la edición es el
wipe-and-recreate: 20 escrituras. Sustituirlo por diffing es deuda consciente,
documentada y no abordada.

### Posterior · v1.12.3 → v1.13.2

- **v1.12.3 — telemetría antes de invertir.** `INSTANCE_ID` por lambda en
  `/api/health` y en los logs; eventos `partes_cache` (con el camino tomado) y
  `enviar_datos_entrada` (estado de idempotencia). Objetivo: medir cuántas instancias
  conviven y si la idempotencia in-memory se reparte entre ellas, antes de gastar los
  2-3 días del store compartido. Instrumentar es más barato que suponer.
- **v1.13.0/v1.13.1 — catálogo completo.** El buscador exigía 3 letras y devolvía
  máximo 20 resultados **sin avisar de que había más**. Ahora `listarTodos` pagina la
  BD entera y el filtrado es local e instantáneo. Una segunda pasada adversarial
  corrigió 6 casos límite, entre ellos un falso aviso de «IDs duplicados» que el
  filtro por prefijo generaba, y la ausencia de indicador durante la descarga —que
  reproducía exactamente la percepción original de «lista rota».
- **v1.13.2 — P4.** Retry de 429 por página y guard de promesa en vuelo: dos
  peticiones concurrentes con caché fría comparten una descarga (32→16 llamadas).

---

## 5 · Decisiones de diseño que merecen discusión

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| Cursor del freshness-check en el servidor | Cursor en el cliente (delta polling clásico) | 10 riesgos catalogados: reloj de la tablet, divergencia con el top-100 ordenado por fecha, caché de servidor inutilizada por claves únicas por cursor, envelope que rompía 5 tests |
| Filtro `timestamp` | Filtro por propiedad `Última edición` | Inmune a renombrados. Lección de I9 |
| Concurrencia 3 en escrituras | 5 (el máximo del semáforo) | Deja hueco para las lecturas de otros usuarios |
| Rollback en el archivado | Fail-fast simple | Fail-fast deja el parte a medias; el invariante de horas es de facturación |
| Optimista solo hasta `Procesando` | Pintar `Datos Enviados` al instante | El servidor puede revertir a Borrador; mentir aquí tiene consecuencia física (el capataz se va de la obra) |
| Ref para «edición abierta» | Estado de React | La closure del efecto capturaría un valor stale: causa raíz del C1 original |
| Caché local sin empleados | Snapshot completo | DNI y teléfono en el disco de una tablet compartida |
| Clave de caché versionada | Migración explícita de esquema | Cada deploy purga: kill-switch gratis, cero código de migración |
| Servir foto stale ante 429 | Devolver 503 | La query completa también fallaría; datos de hace 2 min > error |
| No fijar `regions` | `cdg1` (cerca del usuario) | El backend es chatty contra us-east: acercarlo al usuario cuesta 1-1,3 s por parte |
| `sanitizeEconomic` se queda | Mover el saneado al mapper | Se conserva como cinturón del invariante: ningún endpoint devuelve importes |

---

## 6 · Estado actual

**Endpoints, contra la BD real de producción (18-08):**

| Endpoint | Frío | Cacheado | Payload |
|---|---|---|---|
| `/api/datos-completos` | 1,38 s | **3,8 ms** | 123 KB |
| `/api/partes-trabajo` | 1,17 s | **4,1 ms** | 94,6 KB |
| `/api/empleados` (1.533) | 7,58 s | **6,1 ms** | 373 KB |
| `/api/obras` | 1,67 s | **2,1 ms** | 6,6 KB |
| `/api/jefes-obra` | 0,65 s | **0,8 ms** | 0,3 KB |

**Bundle:** 341 KB raw / **91,4 KB gzip** (chunk principal) + 44,9 KB react-vendor +
9,7 KB CSS. De los 91 KB, ~56 son supabase-js (medido construyendo sin las variables
de entorno de auth: el chunk baja a 35,1 KB).

**Suite:** 64 casos en `node:test` — flujos críticos, idempotencia del envío,
middleware JWT, freshness-check con sus 4 ramas, lotes con reproducción del fallo
detectado por el checker, y paginación del catálogo con retry de 429.

**Mecanismos vigentes:** inventario completo con «qué se rompe si lo alteras» en
[ARQUITECTURA.md](ARQUITECTURA.md) §3.1.

---

## 7 · Lo que deliberadamente no se hizo

- **Migración a Supabase (ADR-007).** El único criterio activado del ADR-001 era
  «listados >3 s», y su causa era el N+1 y la ausencia de `filter_properties` — con
  **190 partes**, no por volumen. Migrar habría sido cambiar de base de datos para no
  optimizar una consulta. Reabrir solo si tras esto p95 >1,5 s sostenido, ≥5 429/día
  o ≥2 incidencias de datos stale por semana.
- **Sentry.** Clasificado proyecto aparte (6-12 h): dependencia nueva, source maps,
  región UE explícita, scrubbing de PII y testing. Además **no habría detectado**
  ninguno de los dos fallos que más dolieron: ambos fueron datos vacíos aceptados en
  silencio, no excepciones.
- **Fluid Compute.** Un toggle de dashboard, pero requiere auditar antes el estado
  module-level con read-modify-write entre awaits (caché, rate limiter, idempotencia).
- **Diffing en el PUT.** El wipe-and-recreate se mantiene: 20 escrituras por edición.
  Sustituirlo es la optimización pendiente más golosa y la más arriesgada.
- **Virtualización de listas, service worker, lazy de modales.** Descartados por
  relación riesgo/beneficio a semanas de una demostración.
- **Bloque UX menor** (~12 h): diferido a post-demo por congelación.

---

## 8 · Deuda viva

| Id | Descripción | Severidad | Ventana |
|---|---|---|---|
| P1 | La versión de API `2022-06-28` rompe contra una BD en cuanto se le añade una 2ª data source desde la UI de Notion. **El disparador está fuera de nuestro código** | 🔴 | Post-demo, 1-2 h |
| I-A | El listado de partes trunca a 100 de 191 | 🟡 | Octubre |
| — | Estado en memoria por instancia (caché, idempotencia, rate limit) | 🟡 | Decidir con la telemetría de v1.12.3 |
| P3 | Los webhooks oficiales de Notion harían innecesario el polling y cerrarían el punto ciego de archivados; requieren store compartido | 🟡 | Octubre, junto al KV |
| E1 | Token de Notion hardcodeado en 5 puntos de 3 escenarios Make | 🟠 | Post-demo |
| — | 54 obras activas sin Persona Autorizada | 🟠 | Depende del cliente |

---

## 9 · Nota metodológica

- Las escrituras se midieron desde España contra Notion en us-east. En producción la
  función corre en `iad1`, junto a la API: **los tiempos reales son mejores** que los
  publicados. Se prefiere el dato conservador.
- Los 7,58 s del catálogo son el peor caso posible: caché vacía, conexión doméstica,
  16 páginas secuenciales. El usuario no lo percibe porque la descarga es en segundo
  plano y el buscador server-side sigue disponible mientras llega.
- Antes y después comparten método, máquina y conexión. No se cruzan fuentes.
- Ningún dato procede de estimación. Lo no medible se indica como tal.
- Los tests de la suite corren contra el mock: no validan `filter_properties` ni el
  comportamiento ante 429 reales. Por eso las fases F2 y F5 exigieron verificación
  adicional contra Notion real, y por eso el golden-diff existe.
