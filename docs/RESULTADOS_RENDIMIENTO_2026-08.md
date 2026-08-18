# Copuno · Gestión de Partes
# Informe técnico de la intervención de rendimiento, fiabilidad e integridad
## Agosto de 2026

---

**Documento:** Informe de ingeniería · cierre de intervención
**Autor:** NotionVan
**Fecha de emisión:** 18 de agosto de 2026
**Periodo cubierto:** 17-18 de agosto de 2026
**Versiones:** v1.9.0 → v1.13.2 · 16 despliegues a producción
**Sistema:** Copuno — Gestión de Partes (`app.copuno.com`)
**Estado al cierre:** v1.13.2 en producción · suite de humo 64/64 · árbol de trabajo limpio

**Documentos relacionados**

| Documento | Relación |
|---|---|
| `docs/INFORME_UX_RENDIMIENTO_2026-08-17.md` | Diagnóstico previo. 105 hallazgos con evidencia y línea base. Es la foto del *antes* |
| `docs/ARQUITECTURA.md` §3.1 | Inventario de mecanismos vigentes con su regla de no-rotura |
| `docs/DEUDA_TECNICA.md` | Registro cronológico de hallazgos abiertos y cerrados |
| `CHANGELOG_V1.9.1` … `V1.13.2` | Detalle por despliegue (15 archivos) |
| `docs/SMART_POLLING.md` | Diseño de la sincronización entre usuarios, v3 |
| `docs/INVESTIGACION_NOTION_API_2026-08.md` | Estado del arte y límites de la plataforma de datos |
| `docs/CACHE_NOTION_INDUSTRIA_2026-08.md` | Estudio comparado de estrategias de caché y diseño del siguiente escalón |

### Cómo leer este documento

- Las secciones **1 a 3** son contexto, resumen y método. Léalas si va a citar cifras.
- Las secciones **4 a 7** son el cuerpo técnico: sistema, estado inicial, despliegues
  e intervención. Es donde está el detalle de implementación.
- Las secciones **8 a 10** contienen las decisiones de diseño, los fallos introducidos
  durante la propia intervención y el estado resultante. Si solo va a leer una parte,
  lea la 8.
- Las secciones **11 a 14** son operativas: verificación, procedimientos, deuda.
- Los **apéndices** contienen los comandos de reproducción, el inventario de
  configuración, la superficie de API y el modelo de datos.

---

# 1 · Contexto y encargo

## 1.1 Origen

El 22 de julio de 2026, durante una visita a la central del cliente, la prueba del
parte digital ante dos responsables **falló con un error visible en pantalla**. El
director general preguntó literalmente si aquello por lo que había pagado funcionaba,
y el responsable técnico del cliente tuvo que responder que no. La aplicación pasó a
presentarse internamente como «fase de prototipo».

El compromiso asumido tras ese episodio fue explícito: **dejar el módulo de partes
operativo para septiembre**, mes en que tres usuarios nuevos (Óscar, Paola y Andrés)
arrancan la operativa real, con un salto a más obras previsto para octubre.

En paralelo existía una queja recurrente y antigua del cliente, nunca resuelta: *«la
app no actualiza, hay que refrescar a mano»*.

## 1.2 Restricciones del encargo

| Restricción | Implicación práctica |
|---|---|
| Los tres flujos críticos no se tocan sin verificación independiente | Firma digital, generación de PDF y sincronización con Notion pasan por revisión de regresión antes de cada fusión |
| Congelación de versiones el 31 de agosto | Todo cambio estructural debe estar desplegado y observado antes de esa fecha |
| No introducir dependencias nuevas sin necesidad real | Convención explícita del proyecto: el stack es deliberadamente simple |
| Ningún endpoint puede devolver datos económicos | Invariante de negocio: precios e importes se redactan antes de responder |
| Presupuesto acotado | La intervención compite con soporte y con la preparación de la demostración |

## 1.3 Qué se buscaba

Dos objetivos, en este orden:

1. **Que no vuelva a fallar delante de nadie.** Eliminar los modos de fallo visibles:
   pantallas en blanco, errores sin contexto, estados que mienten.
2. **Que se sienta rápida.** La percepción de velocidad en tablet de obra, no el
   número en un banco de pruebas.

Explícitamente **fuera de objetivo**: funcionalidad nueva. Cita textual del encargo al
cliente: *«lo que tengo en la plancha es que vaya más rápido y que vaya mejor. No son
mejoras nuevas ni funciones nuevas.»*

---

# 2 · Resumen ejecutivo

## 2.1 Cifras

| Indicador | Antes | Ahora | Δ |
|---|---|---|---|
| Time-to-interactive del menú | 4-8 s (spinner global) | **~160 ms** | ~30× |
| Peticiones en el arranque | 9, en cascada de 3 saltos | **3** | −67 % |
| Segunda apertura con datos en pantalla | idéntica a la primera | **47 ms** | ~100× |
| Query de partes (Notion → lambda) | 935 KB / 1,94 s | **357 KB** | −62 % |
| Query de empleados (Notion → lambda) | 652 KB / 2,91 s | **171 KB / 0,7 s** | −74 % |
| `POST /partes-trabajo` (10 empleados) | 8,5 s | **4,8 s** | −44 % |
| `PUT /partes-trabajo/:id` (10 empleados) | 17,2 s | **13,1 s** | −24 % |
| Guardado percibido por el usuario | 4-6 s | **~1,5 s** | −70 % |
| Detección de cambios de otros usuarios | inexistente | **12-30 s** | recuperado |
| Coste de comprobar novedades | 1,5-2,5 s | **0,43 s** | −75 % |
| Catálogo de empleados accesible | 100 de 1.533 | **1.533** | 15× |
| Refresco sin cambios (red) | payload completo | **304, 0 bytes** | −100 % |
| Cobertura de pruebas de humo | 45 casos | **64 casos** | +42 % |
| Modos de fallo con pantalla en blanco | 3 identificados | **0** | — |

## 2.2 Lo que no era rendimiento y valía más

Tres defectos de integridad, encontrados durante la intervención y no antes:

1. **Nombres de empleado vacíos en producción.** Activo durante semanas. Explicación
   más probable del fallo ante la central.
2. **Horas a cero grabadas como ocho.** Afectaba a lo que se factura.
3. **Ruta de edición capaz de vaciar un parte.** Único camino de pérdida de datos.

Ninguno se manifestaba como error. El sistema respondía correctamente con datos
incorrectos, que es el modo de fallo más caro de detectar y el más caro de sufrir.

## 2.3 Lectura de conjunto

La aplicación no era lenta por volumen —191 partes y 1.533 empleados no son un reto
para ninguna base de datos— sino por **diseño de acceso**: peticiones en cascada,
consultas sin acotar, escrituras seriales y ausencia de cualquier caché entre el
usuario y el origen. Las tres cuartas partes de la ganancia salen de corregir eso,
sin cambiar de tecnología, sin añadir dependencias y sin tocar el modelo de datos.

---

# 3 · Metodología

## 3.1 Principios aplicados

1. **Ninguna cifra estimada.** Lo que no se pudo medir se declara como no medido.
2. **Antes y después con el mismo método**, la misma máquina y la misma conexión.
   No se comparan mediciones de origen distinto.
3. **Se publica el dato conservador** cuando el entorno de medición es peor que el de
   producción (ver §3.4).
4. **Un despliegue por fase**, verificado en producción antes de continuar. Ninguna
   fase depende de que la siguiente funcione.
5. **Reversión disponible en todo momento**: cada fase es independiente y el sistema
   de despliegue permite volver a la versión anterior de forma inmediata.

## 3.2 Instrumentos

| Qué se mide | Instrumento | Por qué ese |
|---|---|---|
| Latencia y tamaño de las consultas a Notion | `curl` directo con el token de producción | Aísla el coste de la consulta del resto del stack. Sin él, se confunde lentitud de red con lentitud de aplicación |
| Latencia de endpoint completo | Servidor Express local contra la base de datos **real de producción**, midiendo petición fría y cacheada | Es la cifra que percibe el usuario. Incluye mapeo, saneado y serialización |
| Time-to-interactive | Puppeteer headless contra el modo simulado, viewport de tablet | Elimina la variabilidad de red para medir el coste de arranque del cliente |
| Escrituras | Cronómetro contra Notion real: crear y editar partes de 10 empleados en la obra de pruebas | Las escrituras no se pueden simular: el coste está en los viajes de ida y vuelta |
| Payload al navegador | Tamaño de respuesta del endpoint, con y sin compresión | Distingue el ahorro Notion→servidor del ahorro servidor→navegador. Son distintos y se documentan por separado |
| Regresión funcional | Suite `node:test` (64 casos) más agente revisor independiente | La suite cubre contrato; el revisor cubre razonamiento sobre los flujos críticos |

## 3.3 Comandos canónicos

Latencia y tamaño de una consulta a Notion:

```bash
curl -s -o /dev/null -w "%{size_download}B %{time_total}s\n" \
  -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2022-06-28" \
  -X POST "https://api.notion.com/v1/databases/<id>/query" \
  -H "Content-Type: application/json" -d '{"page_size":100}'
```

Latencia de endpoint, fría y cacheada:

```bash
SUPABASE_URL= PORT=3199 node server.js &
curl -s -o /tmp/x.json -w "frio: %{time_total}s\n" http://localhost:3199/api/<endpoint>
curl -s -o /dev/null  -w "cache: %{time_total}s\n" http://localhost:3199/api/<endpoint>
```

Suite completa:

```bash
npm run test:smoke
```

## 3.4 Sesgos declarados

- **Las escrituras se midieron desde España contra servidores en la costa este de
  Estados Unidos.** En producción la función se ejecuta en esa misma región, junto a
  la base de datos. Los tiempos reales de producción son **mejores** que los
  publicados. Se ha optado por no extrapolar.
- **La medición del catálogo de empleados (7,58 s) es el peor caso posible**: caché
  vacía, conexión doméstica y dieciséis páginas secuenciales.
- **Las pruebas automáticas corren contra datos simulados.** No validan el
  comportamiento de la limitación de propiedades ni la respuesta ante saturación
  real. Esta limitación motivó las verificaciones adicionales descritas en §11.
- **No hay medición de campo en producción con usuarios reales** para el periodo
  posterior: la telemetría de plataforma se activó el 17 de agosto y no acumula
  todavía una serie significativa.

## 3.5 Volumen del sistema al medir

| Entidad | Registros |
|---|---|
| Partes de trabajo | 191 (188 tras la limpieza de datos de prueba) |
| Empleados | 1.533 |
| Obras activas | 54 (de 140 totales) |
| Detalles de horas | 565 (562 tras la limpieza) |
| Vehículos | 141 |
| Personas autorizadas | 3 (2 reales, 1 de pruebas) |
| Usuarios de la aplicación | 5 |

Este volumen es relevante porque **descarta la hipótesis del volumen**. Con estas
magnitudes ninguna base de datos razonable debería ir lenta. El problema era de
diseño de acceso.

---

# 4 · El sistema

## 4.1 Arquitectura

```
Navegador (React 18 + Vite 7)
    │  fetch /api/*  (mismo origen)
    ▼
Función serverless (Node + Express 4)  ── región us-east, junto a la API de datos
    ├─→ API de Notion v1          (lectura y escritura del modelo de datos)
    └─→ Webhook de Make           (generación de PDF, firma, archivado en OneDrive)
```

Decisiones estructurales heredadas, no revisadas en esta intervención:

- **Notion como base de datos.** Documentado y con criterios explícitos de migración
  (ADR-001). Ninguno se activó por volumen; ver §13.1.
- **Toda escritura pasa por el servidor.** El cliente nunca escribe en el origen.
- **Ningún endpoint devuelve datos económicos.** Se redactan antes de responder. Es
  un invariante deliberado, no un descuido.
- **Un solo dominio, un módulo por ruta** (ADR-005), porque la sesión de usuario está
  ligada al origen: un dominio equivale a un único inicio de sesión para todos los
  módulos futuros.

## 4.2 Modelo de datos

Seis bases de datos en el espacio de trabajo del cliente:

| Base | Función | Notas |
|---|---|---|
| Obras | Proyectos activos | Filtradas por estado `Activa` en los desplegables |
| Persona Autorizada | Firmantes habilitados | Relación con Obras, hoy sin poblar |
| Empleados | Plantilla completa | 1.533 registros; contiene datos personales |
| Partes de trabajo | Tabla principal: un parte = una jornada en una obra | Estado, PDF, firma, relaciones |
| Detalle Horas | Horas por empleado dentro de un parte | Relación con Partes y Empleados |
| Vehículos | Flota | Fuente del autocompletado de matrículas |

**Trampas del modelo, documentadas porque han causado incidentes:**

- Varias propiedades tienen **un espacio final en su nombre** (`Rectifica a `,
  `Rectificado por `, ` Email`, `Horas Encargado `, `Vehiculos `). Deben referenciarse
  exactamente así o la lectura falla en silencio.
- La propiedad `Vehiculos` (sin tilde, texto) es un **espejo que escribe el servidor**
  a partir de la relación `Vehiculos ` (con espacio final). El pipeline de generación
  de PDF consume el espejo, no la relación. Existe porque el editor del sistema de
  automatización trunca las rutas con caracteres no ASCII.
- El título de la base de Empleados fue renombrado manualmente en algún momento, lo
  que provocó el incidente descrito en §5.1.1.

## 4.3 Ciclo de vida de un parte

```
  Borrador ──[enviar-datos]──► Procesando ──[webhook OK]──► Datos Enviados
     ▲                             │                              │
     │                             │ (fallo del webhook)          │ [Make genera PDF]
     └─────────────────────────────┘                              ▼
                                                          Listo para firmar
                                                                  │ [firma del jefe de obra]
                                                                  ▼
                                                              Firmado
```

Estados que **bloquean la edición**: `Procesando`, `Datos Enviados`, `Firmado`. Un
parte firmado solo puede corregirse creando un **rectificativo**, que es un parte
nuevo enlazado al original por una relación reflexiva.

## 4.4 Pipeline de generación y firma

Cuatro escenarios encadenados en la plataforma de automatización:

| Escenario | Función | Escribe en el modelo |
|---|---|---|
| 1/4 | Recoge la cabecera del parte | — |
| 2/4 | Recupera los detalles de horas | — |
| 3/4 | Rellena la plantilla, la convierte y la sube al almacenamiento | `Estado: Listo para firmar` |
| 4/4 | Recibe la firma, genera el PDF final, lo sube | `URL PDF`, identificador de archivo, `Estado: Firmado` |

**Dato corregido durante esta intervención:** la documentación afirmaba durante meses
que el escenario 3/4 escribía la dirección del PDF. No es cierto: la escribe el 4/4 al
firmar. Un parte sin firmar nunca tiene dirección de PDF, y eso es lo esperado, no un
fallo. La verificación se hizo contra los blueprints vivos.

## 4.5 Superficie de API

Veinte endpoints bajo `/api/*`. Los relevantes para esta intervención:

| Método | Ruta | Papel en el rendimiento |
|---|---|---|
| GET | `/api/datos-completos` | Arranque consolidado: 4 consultas en una sola invocación |
| GET | `/api/partes-trabajo` | Listado. Caché con comprobación de novedades y ventana de fechas opcional |
| GET | `/api/empleados` | Catálogo completo paginado, caché de 10 minutos |
| GET | `/api/partes-trabajo/:id/estado` | El endpoint más consultado: alimenta el seguimiento del modal |
| POST | `/api/partes-trabajo` | Creación. Escrituras por lotes |
| PUT | `/api/partes-trabajo/:id` | Edición. Borrado y recreación con reversión |
| POST | `/api/partes-trabajo/:id/enviar-datos` | Dispara el pipeline. Idempotente |
| GET | `/api/health` | Diagnóstico y comparación de versión |

---

# 5 · Estado inicial: anatomía completa

La auditoría del 17 de agosto sobre el código en producción produjo **105 hallazgos**:
20 de servidor, 29 de interfaz y 56 de experiencia de uso. Los 13 hallazgos críticos
detectados en una auditoría previa de julio **seguían vivos al 100 %**, verificados
uno a uno con referencia a fichero y línea.

Lo que sigue no es la lista completa —está en el informe de diagnóstico— sino la
anatomía de las cuatro familias de problema.

## 5.1 Familia A · Integridad de datos

Son los más graves porque **no se manifiestan como errores**. El sistema responde
correctamente con datos incorrectos.

### 5.1.1 Nombres de empleado vacíos en producción

**Síntoma observado:** los 100 empleados devueltos por la API llegaban con
`nombre: ''`. La búsqueda por nombre devolvía error 500.

**Causa raíz.** El mapeador accedía a la propiedad título por su nombre literal:

```js
nombre: extractPropertyValue(page.properties['Nombre Completo'])
```

Alguien renombró esa propiedad en la interfaz de Notion, dejándola como cadena vacía.
El acceso pasó a devolver `undefined` para **todos** los registros, sin lanzar
excepción ni dejar traza. La búsqueda, que filtraba por ese mismo nombre literal,
empezó a recibir 400 de la API, que el servidor traducía a 500.

**Por qué es el hallazgo más importante del informe.** El disparador estaba **fuera
del código**. No hay test, revisión de código ni despliegue que lo hubiera detectado:
el repositorio no cambió. Llevaba semanas activo y es la explicación más probable del
fallo ante la central en julio. Verificado en vivo antes de corregir: 100 de 100
nombres vacíos, búsqueda con error.

**Corrección estructural.** Resolver el título por **tipo de propiedad**:

```js
function titleDe(page) {
  for (const prop of Object.values(page.properties || {})) {
    if (prop.type === 'title') return extractPropertyValue(prop)
  }
  return ''
}
```

Y la búsqueda pasa a filtrar por el identificador canónico `'title'`, que la
plataforma garantiza estable frente a renombrados. **Se cierra la clase entera de
fallo, no solo esta instancia** — que es la diferencia entre parchear y corregir.

**Deuda derivada, documentada:** el mismo patrón de acceso literal se usa en las cinco
propiedades con espacio final en el nombre. Generalizarlo está anotado como tarea
posterior.

### 5.1.2 El cero de horas se grababa como ocho

```js
const horas = Number(empleadosHoras[empleadoId] || 8)   // antes
const horas = Number(empleadosHoras[empleadoId] ?? 8)   // ahora
```

El operador `||` trata el `0` como valor falso. Un trabajador presente en obra sin
jornada imputable se grababa con jornada completa. **Ese dato viaja al PDF firmado y
al fichero de facturación**: no es un error cosmético, es dinero.

**Por qué la suite no lo detectaba:** el conjunto de datos simulado devolvía valores
que nunca pasaban por esa rama. Se añadió un caso que fija el contrato explícitamente,
con el valor `0` como entrada.

### 5.1.3 La edición podía vaciar un parte

La actualización implementa **borrado y recreación**: archiva todos los detalles de
horas existentes y los recrea con el contenido recibido. Si la carga previa de
detalles fallaba, el formulario abría con cero empleados y guardar archivaba las horas
reales sin recrear nada.

Era el **único camino de pérdida de datos del producto**, y se activaba con un simple
fallo de red en el momento de abrir la edición. Corrección: el formulario no abre si
la carga falla, con aviso explícito y opción de reintentar, más una guarda adicional
ante la transición de N detalles a 0.

## 5.2 Familia B · Rendimiento

| Patología | Detalle técnico | Coste |
|---|---|---|
| **Arranque en cascada** | 9 peticiones: 3 comprobaciones de salud duplicadas, 2 de opciones de estado, 4 catálogos. En 3 saltos secuenciales. La pantalla de bienvenida es JSX estático sin dependencia de datos, pero estaba atrapada tras el ternario de carga global | 4-8 s hasta ver algo |
| **Sobre-fetch sistemático** | Ninguna consulta limitaba las propiedades solicitadas. La API devolvía cada página completa aunque el mapeador leyera 19 campos | 935 KB por listado |
| **Sin caché de cliente** | Ni almacenamiento local ni revalidación. Cada montaje empezaba de cero | Reabrir = arrancar |
| **Esperas artificiales** | Retardo de 2-4 s tras guardar «para que se lea el mensaje», más 2,5 s en el camino de conflicto | 4-6 s percibidos |
| **Escrituras seriales con pausa** | Bucle `await` con `sleep(100)` intercalado. Crear un parte de 10 empleados eran 14 viajes secuenciales | 8,5 s |
| **N+1 en firmantes** | Una petición por firmante, secuencial, sin caché | Proporcional al número de firmantes |
| **Cero memoización** | 0 usos de `useMemo`, `useCallback` o `React.memo` en 3.357 líneas. Los filtros del listado se recalculaban en cada pulsación de tecla | Perceptible al escribir |
| **Cómputo muerto** | Un agregado calculado en cada render cuyo consumidor estaba comentado | Puro desperdicio |
| **Búsqueda con condición de carrera** | Tres buscadores con antirrebote que cancelaba el temporizador pero no la petición: la respuesta lenta de una consulta anterior podía pisar a la nueva | Resultados incorrectos |

## 5.3 Familia C · Fiabilidad

### 5.3.1 El seguimiento del listado llevaba muerto desde la versión 1.3

```js
useEffect(() => {
  const id = setInterval(() => {
    if (editandoParte) return      // ReferenceError: editandoParte is not defined
    cargarPartes()
  }, 30000)
  return () => clearInterval(id)
}, [])                              // catch vacío silenciando la excepción
```

La variable `editandoParte` vivía en el componente hijo, no en el ámbito del efecto.
Cada ciclo lanzaba una excepción de referencia, un bloque `catch` vacío la silenciaba
y **el listado no se refrescaba jamás**.

Es el origen directo de la queja del cliente, activa durante meses. Nadie lo detectó
porque el síntoma —«hay que refrescar a mano»— se atribuía a la plataforma de datos,
no a un error de programación silenciado.

### 5.3.2 La caché del servidor no se invalidaba tras escribir

Existía una única eliminación de clave: la del vencimiento por tiempo. Tras crear un
parte, una lectura que cayera **en la misma instancia** dentro de los 30 segundos de
vigencia servía el listado sin el parte recién creado.

Es la **segunda mitad, con causa independiente**, de la misma queja. Dos defectos
distintos produciendo el mismo síntoma explica por qué las tentativas anteriores de
resolverlo no funcionaron: se corregía uno y el otro seguía activo.

### 5.3.3 Modos de fallo con pantalla en blanco

Tres caminos identificados:

1. **Sin barrera de errores de render.** Cero *error boundaries* en toda la
   aplicación: cualquier excepción durante el pintado dejaba el documento vacío.
2. **La verificación de sesión devolvía vacío** sin control de errores ni tiempo
   máximo. Un fallo de red en ese punto dejaba la pantalla en blanco de forma
   permanente, sin recuperación posible salvo recargar.
3. **Cualquier fallo de datos sustituía la aplicación entera** por una pantalla de
   error de conectividad, incluso cuando el fallo afectaba a un solo catálogo.

### 5.3.4 El reintento como amplificador de congestión

La función de reintento repetía **el lote completo** de peticiones tres veces con
retardo creciente, incluidos los errores 4xx que nunca van a resolverse reintentando.
Ante saturación de la plataforma de datos, el cliente respondía multiplicando la carga
por tres: el comportamiento exactamente contrario al necesario.

### 5.3.5 Límite de peticiones contado por dirección de red

Detrás de la red compartida de la central, **tres pestañas agotaban el cupo de toda la
oficina**. Es el escenario literal de una demostración con varias personas mirando.

### 5.3.6 El indicador de conexión mentía

Los fallos del seguimiento se descartaban en silencio, de modo que la píldora seguía
mostrando «Conectado» sin cobertura. Combinado con un tiempo máximo de espera de 60
segundos y mensajes de error en inglés técnico, el resultado para un jefe de obra sin
cobertura era: un minuto de espera y después `timeout of 60000ms exceeded`.

## 5.4 Familia D · Experiencia de uso

De los 56 hallazgos, los que tenían consecuencia operativa directa:

| Hallazgo | Consecuencia |
|---|---|
| Los mensajes de confirmación aparecían **fuera del área visible** (banner arriba, botón en la tarjeta 40) | «Pulso Enviar y no pasa nada» |
| La confirmación de parte creado **se autodestruía**: el propio refresco desmontaba el formulario | Spinner largo → formulario vacío → el usuario lo rellenaba otra vez |
| Tres de los cinco estados salían **sin estilo** por desajuste entre el valor y la clase de estilo | El dato más mirado del producto, ilegible |
| Objetivos táctiles de 22 a 36 px | Difíciles con guantes. El mínimo recomendado es 44 |
| Contrastes de 2,86:1 a 3,7:1 en avisos y estados | Por debajo del mínimo de accesibilidad. Crítico a pleno sol |
| Ningún campo declaraba tipo de teclado | Teclado alfabético completo para introducir horas en tablet |
| Modales sin rol declarado, sin captura de foco, 19 etiquetas sin asociar | Inaccesible con lector de pantalla |
| Intro en cualquier buscador **enviaba el formulario** | Partes creados a medias desde el teclado |
| No se podían teclear medias jornadas: el límite se aplicaba en cada pulsación | Escribir «7.5» acababa en 24 |

---

# 6 · Los dieciséis despliegues

Cronología completa. Cada línea corresponde a un despliegue verificado en producción
antes de continuar con el siguiente.

| Versión | Fecha | Fase | Contenido | Verificación |
|---|---|---|---|---|
| v1.9.1 | 17-08 | F0 | Línea base, telemetría, corrección de la guía de despliegue | Mediciones registradas |
| v1.9.2 | 17-08 | F1 | Invalidación de caché, cero de horas, medias jornadas, barrera de errores, fin de esperas artificiales | Suite 46 casos |
| v1.9.3 | 17-08 | F2 | Limitación de propiedades, corrección de nombres vacíos | Comparación campo a campo + revisión de regresión |
| v1.10.0 | 17-08 | F3 | Arranque consolidado, pantalla de bienvenida liberada, shell inmediato | Navegador: 158 ms, 3 peticiones |
| v1.10.1 | 17-08 | F4 | Caché local, aviso flotante, protección de edición, objetivos táctiles | Navegador: 47 ms en segunda apertura |
| v1.10.2 | 17-08 | F5 | Límite en dos capas, semáforo, revalidación, conexión honesta | Verificación de 304 y de caída de red |
| v1.11.0 | 17-08 | F6 | Seguimiento revivido, comprobación de novedades | Dos navegadores + revisión de regresión |
| v1.12.0 | 17-08 | F7a | Escrituras por lotes, archivado con reversión | Cronometrado contra datos reales |
| v1.12.1 | 17-08 | F7b | Estado optimista, tiempos máximos de escritura | Navegador con red interrumpida |
| v1.12.2 | 17-08 | F7c | Migración de la configuración de despliegue | Lista de 8 comprobaciones en vista previa y en producción |
| v1.12.3 | 18-08 | — | Telemetría multi-instancia, causa de la saturación | Suite 59 casos |
| v1.13.0 | 18-08 | — | Catálogo completo de empleados | Extremo a extremo contra datos reales + navegador |
| v1.13.1 | 18-08 | — | Seis casos límite del catálogo | Suite 62 casos + navegador |
| v1.13.2 | 18-08 | — | Reintento ante saturación y descarga compartida | Suite 64 casos + prueba de concurrencia real |

Dos versiones anteriores completan el marco: **v1.9.0** (autenticación de plataforma,
desarrollada en julio y activada el 3 de agosto) y **v1.8.0** (exportación para
facturación, julio).

**Ritmo:** diez despliegues el 17 de agosto, cuatro el 18. Cada uno con incremento de
versión, changelog propio y suite en verde. El ritmo fue posible porque las fases eran
independientes: ninguna necesitaba que la siguiente funcionara.

---

# 7 · La intervención, fase a fase

Cada fase sigue la misma estructura: qué se atacó, qué se decidió y por qué, cómo se
implementó, cómo se verificó y qué se obtuvo.

## 7.1 F0 · Línea base (v1.9.1)

**Objetivo.** Medir antes de tocar. Sin línea base, cualquier cifra posterior es una
afirmación sin respaldo.

**Contenido.** Activación de la telemetría real de plataforma, registro de latencias
y tamaños de las seis consultas principales, recuento de peticiones de arranque, y
corrección de un error en la guía de despliegue.

**El error de la guía merece explicación** porque es contraintuitivo. La guía
recomendaba fijar la región de despliegue en Europa, cerca de los usuarios. Aplicarlo
habría **empeorado** el sistema:

> La función se ejecuta junto a la API de datos, en la costa este de Estados Unidos.
> Cada operación de usuario provoca entre **1 y 24 viajes de ida y vuelta** contra esa
> API, frente a **uno solo** hacia el usuario. Acercar la función al usuario europeo
> acerca ese único viaje y aleja los otros veinticuatro. Coste neto estimado:
> **+1 a +1,3 segundos por parte creado**.

La regla general «pon el servidor cerca del usuario» se invierte cuando el servidor es
conversacional contra un origen remoto. Se sustituyó por una advertencia explícita de
no fijar región.

## 7.2 F1 · Integridad y red de seguridad (v1.9.2)

**Prioridad de orden.** La invalidación de caché va **primero** porque es
prerrequisito de todo lo demás: cualquier capa de caché añadida después habría
heredado el defecto y lo habría hecho más difícil de ver.

**Contenido:**

- Helper de invalidación con soporte de claves exactas y por prefijo, invocado en las
  **cinco** rutas de escritura: creación, edición, rectificación, las tres
  transiciones de estado del envío, y el cambio de estado de empleado.
- Corrección del cero de horas con límite `[0,24]`, más caso de prueba.
- Límite de horas aplicado al salir del campo en lugar de en cada pulsación.
- Barrera de errores de render global y por sección: un fallo degrada una zona, no la
  aplicación entera.
- Eliminación de las esperas artificiales; el mensaje sobrevive al cierre del modal.
- Normalización de los nombres de clase de estado: tres de los cinco badges salían sin
  estilo.
- Intro capturado en los tres buscadores.

**Verificación.** Suite ampliada a 46 casos. Crear un parte y comprobar que aparece en
el listado en menos de 30 segundos. Forzar una excepción en desarrollo y comprobar que
la barrera la contiene.

## 7.3 F2 · Dieta de payload (v1.9.3)

**Decisión.** Limitar las propiedades solicitadas en todas las consultas de catálogo,
con los identificadores obtenidos por API y congelados en una constante. La regla que
se documenta: **la lista de identificadores debe ser exactamente lo que lee su
mapeador**, ni más ni menos.

**Riesgo asumido y cómo se mitigó.** Una optimización de payload puede amputar en
silencio un campo que alguien lee, y el síntoma aparece semanas después. Mitigación:
**comparación campo a campo** de la respuesta de cada endpoint antes y después,
contra datos reales.

Resultado de la comparación: obras, personas autorizadas y estado **idénticos byte a
byte**; empleados con los nombres recuperados —efecto del hallazgo descrito en
§5.1.1—; partes con una única diferencia, en el campo corregido. Cero cambios de forma.

**Resultado medido:**

| Consulta | Antes | Después | Δ |
|---|---|---|---|
| Partes | 935 KB | 357 KB | −62 % |
| Empleados | 652 KB / 2,91 s | 171 KB / 0,7 s | −74 % |

**Matiz que se documenta expresamente:** el ahorro es entre la plataforma de datos y
el servidor, **no** entre el servidor y el navegador, porque el servidor ya mapeaba a
un objeto reducido antes de responder. Lo que se gana es tiempo de consulta, tiempo de
análisis y presión sobre el límite de peticiones por segundo. Atribuirle una mejora
directa de la experiencia del usuario sería incorrecto.

**Bonus de la fase:** el endpoint de estado del parte —el más consultado de la
aplicación, porque alimenta el seguimiento del modal— descargaba la página completa
para leer dos propiedades. Aquí se corrigió también.

## 7.4 F3 · Arranque (v1.10.0)

**Corrección de diseño sobre el plan original.** El plan proponía consolidar las
cuatro llamadas de arranque en una. El análisis previo detectó que eso habría
**empeorado** el tiempo hasta poder usar la aplicación:

> Obras y personas autorizadas llegan en unos 0,6 segundos en paralelo. Partes tarda
> 2,5. Consolidadas en una sola respuesta, todo espera a la más lenta: el usuario
> tarda 2,5 segundos en poder hacer nada, en lugar de 0,6.

La solución no fue renunciar a consolidar, sino **quitar el bloqueo**: la pantalla de
bienvenida es estática y no necesita datos, así que sale del gate de carga. El usuario
ve interfaz útil a los 160 ms y elige qué hacer mientras los catálogos llegan. Solo
las pantallas que necesitan datos esperan por ellos.

**Contenido:**

- Una llamada consolidada, **con retorno automático al camino de cuatro llamadas** si
  falla. Un endpoint consolidado sin plan B es un punto único de fallo nuevo.
- Eliminación de dos comprobaciones de conectividad redundantes del camino crítico y
  de un ciclo inmediato duplicado.
- Shell de aplicación en el documento HTML: logo y spinner **antes de que cargue el
  código**.
- Preconexión al proveedor de identidad y precarga del logotipo.
- La verificación de sesión pinta el mismo shell y añade control de errores: un fallo
  de red ya no deja blanco permanente, cae al inicio de sesión.
- Ventana de fechas opcional en el listado, aditiva y validada: base para acotar por
  defecto en octubre.

**Verificación.** Navegador: menú interactivo en **158 ms**, arranque con exactamente
**3 peticiones**. Ventana de fechas contra datos reales: con filtro de agosto, un
parte; sin filtro, los cien más recientes.

## 7.5 F4 · Caché local y retroalimentación (v1.10.1)

**La pieza que más cambia la percepción.** Estrategia de servir-mientras-revalida
sobre almacenamiento local del navegador.

**Tres decisiones de diseño:**

1. **Clave versionada** (`copuno:datos:v<versión>`). Cada despliegue invalida todas
   las cachés locales existentes. Esto da un **interruptor de emergencia gratuito**:
   si la caché local causara un problema, publicar una versión lo resuelve sin escribir
   código de migración ni de limpieza.
2. **Exclusión de empleados.** DNI y teléfono **no tocan el disco** de una tablet
   compartida entre jefes de obra. Tampoco datos económicos. Caducidad de 24 horas y
   limpieza al cerrar sesión.
3. **Si la revalidación falla con datos ya pintados, se mantienen los datos** y se
   avisa por el indicador de conexión. Nunca una pantalla de error sobre información
   válida.

**Medición: segunda apertura con el listado lleno en 47 milisegundos.**

**Resto de la fase:**

- Aviso flotante único, con rol declarado para lectores de pantalla, sobre los modales.
  Éxito y advertencia se cierran solos; los errores persisten hasta que el usuario los
  cierra. Sustituye a tres banners que aparecían fuera del área visible.
- La confirmación de parte creado deja de autodestruirse.
- Los errores dejan de disfrazarse de listas vacías: cuatro puntos que mostraban «esta
  obra no tiene empleados» cuando lo que había ocurrido era un fallo de red ahora
  distinguen ambos casos y ofrecen reintentar.
- Guarda de secuencia en los tres buscadores: la respuesta lenta de una consulta
  anterior ya no pisa a la nueva.
- Tiempo máximo de espera de 60 a 20 segundos; el reintento deja de repetir errores
  4xx, desarmando el amplificador de congestión.
- Memoización de los agregados del listado, eliminación del cómputo muerto,
  sustitución de una búsqueda cuadrática por un mapa.
- Objetivos táctiles a 44 px, contrastes conformes, tipos de teclado declarados.

## 7.6 F5 · Resiliencia multiusuario (v1.10.2)

**Límite de peticiones en dos capas.** El orden es la parte importante:

```
petición → [limitador grueso por IP: 5.000/15 min] → autenticación → [limitador fino por usuario: 1.000/15 min] → ruta
```

- El **grueso va delante** de la autenticación para proteger la verificación de token
  del martilleo anónimo. Umbral alto: no debe afectar al uso legítimo.
- El **fino va detrás**, con clave por identificador de usuario. Resuelve el problema
  de la red compartida: cada persona tiene su cupo, independientemente de desde dónde
  se conecte.

Invertir ese orden tiene dos modos de fallo: o se expone la verificación de token, o
se vuelve al cupo compartido tras la red corporativa.

**Resto de la fase:**

- Semáforo global de cinco peticiones simultáneas hacia la plataforma de datos,
  respetando el límite de tres por segundo **compartido con las automatizaciones**.
- Saturación traducida a respuesta 503 con tiempo de espera sugerido; reintento con
  retardo progresivo y aleatorización, solo en lecturas.
- Cabecera de caché de `no-store` a `private, no-cache, must-revalidate`: habilita la
  respuesta vacía de 0 bytes cuando no hay cambios, aprovechando la etiqueta de
  entidad que el servidor ya generaba. Se mantiene `private` porque los datos llevan
  DNI y teléfono: prohibido cachear en intermediarios compartidos.
- Servido de estáticos movido al final: cada petición de API pagaba una consulta al
  disco antes de llegar a su ruta.
- Diccionario de errores comprensibles. «No hay conexión ahora mismo, lo que habías
  rellenado sigue aquí» en lugar de `timeout of 20000ms exceeded`. El detalle técnico
  queda en la consola.
- Indicador de conexión honesto: escucha los eventos del navegador **y**, además, dos
  fallos consecutivos del seguimiento lo ponen en «Sin conexión, no guardes todavía»
  aunque el sistema operativo no haya detectado la caída.

## 7.7 F6 · Sincronización entre usuarios (v1.11.0)

La fase que cierra la queja histórica del cliente. Dos mitades independientes.

### Mitad cliente

Seguimiento reconstruido con el patrón que **sí funcionaba** en la aplicación —el del
modal de detalles, único superviviente—: bandera de cancelación más temporizadores
encadenados en lugar de intervalo, comprobación de huella que devuelve el estado
anterior si la foto no cambió (así los agregados memoizados no se invalidan y no hay
repintado), cadencia adaptativa de 12, 20 y 30 segundos según actividad reciente, sin
ciclo inmediato al montar, y pausa real en segundo plano.

**Detalle no obvio, y la razón de que el original muriera:**

> El estado «hay una edición abierta» viaja por **referencia**, no por estado de React.
> Una clausura del efecto capturaría el valor del momento de montarse y leería siempre
> «no». Es exactamente la clase de error que mató al seguimiento en la versión 1.3.

Se añade también interruptor de apagado por constante: cambiar un valor y desplegar
detiene el seguimiento sin más cambios.

### Mitad servidor

Comprobación de novedades antes de repetir la consulta completa:

```js
async hayCambiosDesde({ client, desdeIso }) {
  const data = await client.request('POST', conProps(`/databases/${DATABASES.PARTES_TRABAJO}/query`, ['title']), {
    filter: { timestamp: 'last_edited_time', last_edited_time: { after: desdeIso } },
    page_size: 1
  })
  return data.results.length > 0
}
```

**Tres decisiones en seis líneas:**

1. **Filtro a nivel de marca temporal del sistema, no de propiedad con nombre.** Es
   metadato de la plataforma: inmune a renombrados. Lección directa del incidente de
   los nombres vacíos, aplicada preventivamente.
2. **Una sola fila y una sola propiedad.** Solo interesa la existencia, no el
   contenido. 0,43 segundos medidos frente a 1,5-2,5 de la consulta completa.
3. **El cursor vive en el servidor**, calculado como la última edición más reciente de
   la foto en caché. Un cursor en el cliente dependería del reloj de la tablet y
   divergiría entre usuarios.

**Manejo de saturación**, que es decisión de producto más que técnica:

```js
if (err?.status === 429) {
  logCamino('stale-por-429')
  return res.json(foto.data)     // foto algo vieja > error
}
```

Con la plataforma saturada, servir datos de hace dos minutos es mejor respuesta que un
error: la consulta completa también habría fallado.

**Límite conocido y su compensación:** la comprobación **no detecta registros
archivados**. Un parte borrado en la plataforma no genera una edición nueva, así que
la comprobación diría «sin cambios» indefinidamente. Compensado con un techo absoluto
de cinco minutos, tras el cual se repite la consulta completa pase lo que pase.

**Verificación contra datos reales, secuencia completa:** consulta completa 1,51 s →
caché 4 ms → comprobación sin cambios 0,43 s → edición real en la plataforma →
detectada → consulta completa 1,71 s → siguiente comprobación 0,36 s. Y en dos
navegadores simultáneos: parte creado en uno, aparece en el otro sin intervención.

**Efecto colateral buscado:** con el listado vivo, el seguimiento del modal baja su
agresividad de 3 a 8 segundos de suelo. El endpoint más consultado de la aplicación
deja de competir consigo mismo.

## 7.8 F7 · Camino de escritura (v1.12.0 → v1.12.2)

**Orden invertido respecto al plan.** El plan situaba la migración de configuración
antes que las escrituras. El análisis adversarial lo invirtió por dos razones: con
lotes, ninguna actualización real supera los 8-10 segundos, luego ampliar el límite de
ejecución deja de ser prerrequisito; y la migración es **el único cambio cuyo modo de
fallo es dejar toda la API caída**, por lo que va al final, con ventana de observación.

### Batching

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

**Por qué tres y no cinco:** las escrituras comparten el semáforo global de cinco con
las **lecturas del seguimiento de otros usuarios**. Saturarlo con escrituras encolaría
las consultas de todo el mundo. Se deja hueco deliberadamente. El error por captura
por elemento preserva el contrato histórico: la operación informa de qué elementos
fallaron sin abortar los demás.

### Archivado transaccional

**El cambio más importante de la fase, y no estaba en el plan.** La revisión de
regresión detectó que la primera implementación completaba todos los lotes antes de
comprobar fallos: un archivado parcial dejaba horas ocultas **y devolvía mensaje de
éxito**. Se sustituyó por corte al primer fallo más reversión de lo ya archivado:

```js
async function archivarDetallesConRollback({ client, detalles }) {
  const archivados = []
  let fallo = null
  for (let i = 0; i < detalles.length && !fallo; i += DETALLES_CONCURRENCIA) {
    const lote = detalles.slice(i, i + DETALLES_CONCURRENCIA)
    const res = await Promise.all(lote.map(d =>
      conReintento429(() => client.request('PATCH', `/pages/${d.id}`, { archived: true }))
        .then(() => ({ ok: true, id: d.id }))
        .catch(error => ({ ok: false, id: d.id, error }))
    ))
    res.filter(r => r.ok).forEach(r => archivados.push(r.id))
    fallo = res.find(r => !r.ok) || null
  }
  if (!fallo) return { ok: true }

  const rollback = await enLotes(archivados, DETALLES_CONCURRENCIA, id =>
    conReintento429(() => client.request('PATCH', `/pages/${id}`, { archived: false })))
  const noRestaurados = rollback.filter(r => !r.ok).map(r => r.item)
  noRestaurados.forEach(id => console.error(`Rollback fallido: el detalle ${id} quedó archivado`))
  return { ok: false, error: fallo.error, noRestaurados }
}
```

La plataforma de datos **no ofrece transacciones**. Esto es lo más parecido que puede
construirse encima. El invariante que protege es de negocio, no técnico:

> Un parte nunca queda con horas de menos ni duplicadas, porque esas horas acaban en
> el PDF firmado y en el fichero de facturación.

Incluso el fallo del propio deshacer se registra de forma explícita y se devuelve al
llamante: si algo queda irrecuperable, el sistema lo dice en lugar de fingir.

### Optimismo con límite explícito

Al pulsar «Enviar datos» la tarjeta pasa a **«Procesando»** —que es la verdad, porque
el servidor marca ese estado antes de invocar el webhook— y **nunca** a «Datos
Enviados» antes de la confirmación.

> Si el webhook fallara, el servidor revierte el parte a Borrador. Un capataz no debe
> irse de la obra creyendo enviado un parte que no lo está. El límite del optimismo
> aquí no es técnico: es que la consecuencia de mentir es física.

El estado optimista se re-aplica sobre **toda** foto entrante —seguimiento, refresco
manual, reconexión, montaje— y se disuelve solo cuando el servidor confirma ese mismo
estado o al cabo de 60 segundos:

```js
const conParches = (partes) => {
  if (parcheEstadoRef.current.size === 0) return partes
  const ahora = Date.now()
  return partes.map(p => {
    const parche = parcheEstadoRef.current.get(p.id)
    if (!parche) return p
    if (p.estado === parche.estado || ahora - parche.ts > PARCHE_TTL_MS) {
      parcheEstadoRef.current.delete(p.id)
      return p
    }
    return { ...p, estado: parche.estado }
  })
}
```

El margen de 60 segundos es mayor que la suma de la caché (30 s) y el ciclo de
seguimiento (12 s): **la verdad del servidor siempre acaba imponiéndose**.

### Migración de configuración de despliegue

Formato heredado a formato actual, lo que habilita fijar el límite de ejecución en 60
segundos. Se ejecutó mediante rama y solicitud de fusión —excepción al flujo habitual—
porque la vista previa era obligatoria aquí. Lista de ocho comprobaciones en la vista
previa y repetición completa en producción tras la fusión.

### Resultado

| Operación | Antes | Después | Δ |
|---|---|---|---|
| Crear parte, 10 empleados | 8,5 s | **4,8 s** | −44 % |
| Editar parte, 10 empleados | 17,2 s | **13,1 s** | −24 % |
| Envío con sincronización de espejo | — | 3,3 s | incluye webhook real |

El suelo restante en la edición es el borrado y recreación completo: veinte escrituras
por operación. Sustituirlo por comparación de diferencias es deuda consciente,
documentada y **no abordada** por relación riesgo/beneficio antes de una demostración.

## 7.9 Trabajo posterior (v1.12.3 → v1.13.2)

### Instrumentación antes de invertir (v1.12.3)

Identificador de instancia en el diagnóstico y en los registros, más dos eventos
estructurados: el camino de caché tomado en cada petición de listado, y el estado de
idempotencia de cada envío.

**Pregunta que responde:** ¿cuántas instancias conviven realmente en horario laboral, y
se reparte la idempotencia entre ellas? Dos envíos del mismo parte con identificadores
de instancia distintos significarían que el control de duplicados se ha repartido, lo
que abre la puerta a un doble disparo del pipeline.

**Por qué se hizo así:** el siguiente escalón de infraestructura cuesta dos o tres
días. Instrumentar cuesta una hora. **Medir antes de invertir** es más barato que
suponer, y si los datos dicen que no hace falta, la hora está bien gastada igualmente.

### Catálogo completo (v1.13.0 y v1.13.1)

**Origen: un aviso del cliente**, no una auditoría. «No se cargan las listas
completas».

**Diagnóstico contra datos reales antes de tocar nada.** Las listas *por obra*
resultaron estar bien: ninguna de las 54 obras activas se acerca al límite de cien, con
una media de ocho trabajadores. El hueco estaba en la búsqueda libre sobre toda la
plantilla, que exigía tres letras y devolvía **como máximo veinte resultados sin
avisar de que había más**. Con apellidos comunes sobre 1.533 registros, el empleado
buscado podía quedar fuera sin ningún indicio.

**Solución.** Paginación completa de la base, servida con caché propia de diez minutos,
memoizada en el cliente y filtrada localmente. El buscador anterior permanece como
plan B mientras el catálogo llega o si falla.

**Segunda pasada adversarial**, que encontró seis casos límite antes de que los viera
nadie. Los dos relevantes:

- **Falso aviso de identificadores duplicados.** El filtro por prefijo hacía que
  teclear `123` coincidiera con 123, 1234 y 12345, y el aviso heredado gritaba
  «hay N empleados con ese identificador» sin haber duplicado alguno.
- **Ausencia de indicador durante la descarga.** Sin él, los primeros segundos
  mostraban una lista vacía: **exactamente la percepción original de lista rota** que
  se estaba corrigiendo.

Los otros cuatro: acentos —«jose» no encontraba «José»—, orden no alfabético, aviso de
tope ausente en la edición, e identificadores con ceros a la izquierda.

### Resiliencia del catálogo (v1.13.2)

Hallazgo de la revisión de regresión posterior al despliegue: la paginación no
reintentaba ante saturación, y dos peticiones concurrentes con caché vacía duplicaban
las dieciséis llamadas.

Corrección: reintento por página reutilizando el mecanismo ya existente, y
reutilización de la promesa en vuelo, de modo que varias peticiones simultáneas
comparten una sola descarga. Verificado contra datos reales: dos peticiones lanzadas a
la vez terminan en el mismo milisegundo.

---

# 8 · Decisiones de diseño

Esta sección existe porque en una intervención el valor no está solo en lo que se
hizo, sino en lo que se consideró y se descartó. Un revisor que discrepe de una
decisión encontrará aquí el argumento contra el que discutir.

## 8.1 Tabla de decisiones

| # | Decisión tomada | Alternativa descartada | Razón |
|---|---|---|---|
| 1 | Cursor de la comprobación de novedades **en el servidor** | Cursor en el cliente (seguimiento incremental clásico) | Diez riesgos catalogados: dependencia del reloj de la tablet, divergencia con el listado ordenado por fecha, caché de servidor inutilizada por claves únicas por cursor, cambio de contrato que rompía cinco pruebas |
| 2 | Filtro por **marca temporal del sistema** | Filtro por propiedad con nombre | Inmune a renombrados. Aplicación preventiva de la lección del incidente de nombres vacíos |
| 3 | Concurrencia **3** en escrituras | 5, el máximo del semáforo | Deja hueco para las lecturas del seguimiento de otros usuarios |
| 4 | **Reversión** en el archivado | Corte simple al primer fallo | El corte simple deja el parte a medias; el invariante de horas afecta a facturación |
| 5 | Optimismo solo hasta **«Procesando»** | Pintar «Datos Enviados» al instante | El servidor puede revertir. Mentir aquí tiene consecuencia física: el capataz se va de la obra |
| 6 | **Referencia** para «edición abierta» | Estado de React | La clausura capturaría un valor obsoleto: causa raíz exacta del fallo original |
| 7 | Caché local **sin empleados** | Instantánea completa | DNI y teléfono en el disco de una tablet compartida |
| 8 | Clave de caché **versionada** | Migración explícita de esquema | Cada despliegue purga: interruptor gratuito, cero código de migración |
| 9 | Servir **foto antigua** ante saturación | Devolver error de servicio | La consulta completa también fallaría; datos de hace dos minutos superan a un error |
| 10 | **No fijar región** de despliegue | Región europea, cerca del usuario | El servidor es conversacional contra la costa este: acercarlo al usuario cuesta más de un segundo por parte |
| 11 | Consolidar el arranque **pero liberar el menú** | Consolidar todo tras el bloqueo de carga | Consolidar sin liberar habría empeorado el tiempo hasta poder usar la aplicación: todo esperaría a la consulta más lenta |
| 12 | Endpoint consolidado **con plan B** | Consolidado sin alternativa | Un punto único de fallo nuevo en el camino crítico del arranque |
| 13 | Mantener el **saneado económico** | Moverlo al mapeador | Se conserva como cinturón del invariante: ningún endpoint devuelve importes, aunque alguien añada un campo por descuido |
| 14 | Espejo de vehículos **en el camino del envío** | Moverlo al guardado | Moverlo reabriría un incidente conocido: PDF generados sin matrículas |
| 15 | Orden **7b antes que 7a** | El orden del plan | La migración de configuración es el único cambio que puede dejar toda la API caída: va al final, con observación |
| 16 | Techo absoluto de **cinco minutos** | Confiar solo en la comprobación | La comprobación no detecta registros archivados |
| 17 | Reintento **solo en lecturas** | Reintento general | Reintentar una escritura sin idempotencia garantizada duplica efectos |
| 18 | Interruptor de apagado del seguimiento | Sin interruptor | Permite desactivar la funcionalidad más nueva con un cambio de una línea si diera problemas en la demostración |

## 8.2 Las cinco decisiones que más discusión merecen

**1. Servir datos antiguos ante saturación.** Es la decisión más discutible del
informe. El argumento a favor: la alternativa —un error— tampoco da datos frescos, y
además rompe la pantalla. El argumento en contra: el usuario no sabe que está viendo
datos de hace dos minutos. Mitigación implementada: el indicador de conexión refleja
la degradación, y existe un techo temporal absoluto. **Si algún día un parte
desaparecido durante cinco minutos causa un problema real, esta decisión es la
primera que hay que revisar.**

**2. Borrado y recreación en la edición.** Se mantiene, con reversión. La alternativa
—comparar diferencias y aplicar solo los cambios— reduciría las escrituras de veinte a
dos o tres en el caso típico, pero introduce una máquina de estados nueva en el camino
más delicado del producto, a semanas de una demostración. Es la deuda más golosa que
queda viva.

**3. Optimismo limitado a «Procesando».** Podría argumentarse que pintar «Datos
Enviados» al instante mejora la percepción y que la reversión es rara. Se rechaza
porque el coste del caso raro no es una pantalla incorrecta: es un capataz que
abandona la obra creyendo enviado un parte que no lo está, y un cliente que descubre
el hueco al facturar.

**4. Concurrencia tres.** Elegida por razonamiento, no por medición: no se probaron
empíricamente los valores 2, 4 y 5. Es una decisión conservadora y revisable con datos
de producción.

**5. No migrar la base de datos.** La más estructural. Ver §13.1.

---

# 9 · Fallos introducidos durante la intervención

Un informe donde solo hay aciertos no es creíble. Estos son los defectos que la propia
intervención introdujo y que se detectaron antes de llegar al usuario, con el
mecanismo que los cazó.

| # | Defecto introducido | Fase | Detectado por | Consecuencia si hubiera pasado |
|---|---|---|---|---|
| 1 | El batching completaba todos los lotes antes de comprobar fallos: un archivado parcial dejaba horas ocultas **y devolvía éxito** | F7 | Revisión de regresión independiente | Horas desaparecidas de un parte, con mensaje de éxito. Llegaría al PDF y a la facturación |
| 2 | Un refresco manual o una reconexión **pisaban el estado optimista**, devolviendo la tarjeta a «Borrador» | F7 | Revisión de regresión independiente | El usuario vuelve a pulsar Enviar sobre un parte ya enviado |
| 3 | Clausura obsoleta en el detector de reconexión: leía datos vacíos y provocaba un parpadeo de esqueleto | F7 | Revisión de regresión independiente | Parpadeo visible al recuperar la red |
| 4 | Envío con cuerpo nulo: la biblioteca serializaba la cadena `"null"`, que el analizador estricto rechazaba con 400 | F7 | Pruebas en navegador | El estado optimista se borraba por un error espurio |
| 5 | Falso aviso de identificadores duplicados por el filtro de prefijo | v1.13.0 | Pasada adversarial propia | Aviso de alarma constante y falso al buscar por identificador |
| 6 | Sin indicador durante la descarga del catálogo | v1.13.0 | Pasada adversarial propia | **Reproducía la percepción de lista rota que se estaba corrigiendo** |
| 7 | Paginación sin reintento ni protección de concurrencia | v1.13.0 | Revisión posterior al despliegue | Fallo del catálogo con varios usuarios simultáneos y caché vacía |

**Lecturas de esta tabla.** Cuatro de los siete los detectó un **revisor independiente**
y no las pruebas automáticas: la suite verifica contrato, no razonamiento sobre
invariantes de negocio. Dos los detectó una **pasada adversarial deliberada** hecha
después de dar el trabajo por terminado, a petición explícita. Y el número 6 es el más
instructivo: una corrección puede reproducir el síntoma que pretende eliminar si se
descuida la percepción durante el estado transitorio.

**Un incidente de proceso, también documentado:** un despliegue se subió con una
prueba en rojo porque el encadenamiento de comandos no cortaba ante fallo. Se detectó,
se comunicó, y resultó ser una prueba inestable por márgenes de tiempo demasiado
ajustados, que se corrigió endureciéndolos. El fallo de proceso —encadenar sin cortar
ante error— es más relevante que el síntoma.

---

# 10 · Estado actual

## 10.1 Latencias de endpoint

Medición del 18 de agosto contra la base de datos real de producción, endpoint
completo, petición fría y cacheada:

| Endpoint | Frío | Cacheado | Payload |
|---|---|---|---|
| `/api/datos-completos` | 1,38 s | **3,8 ms** | 123 KB |
| `/api/partes-trabajo` | 1,17 s | **4,1 ms** | 94,6 KB |
| `/api/empleados` (1.533) | 7,58 s | **6,1 ms** | 373 KB |
| `/api/obras` | 1,67 s | **2,1 ms** | 6,6 KB |
| `/api/jefes-obra` | 0,65 s | **0,8 ms** | 0,3 KB |

**Lectura.** El arranque completo cuesta **1,38 s en el peor caso** —caché
completamente vacía— y **menos de 4 ms** en el caso normal. El catálogo de empleados
es la operación más cara del sistema, dieciséis consultas paginadas, y por eso se
descarga en segundo plano mientras el usuario puede seguir trabajando, se conserva
diez minutos, y varias peticiones simultáneas comparten una sola descarga.

## 10.2 Cliente

| Recurso | Bruto | Comprimido |
|---|---|---|
| Fragmento principal | 341,8 KB | **91,4 KB** |
| Biblioteca base (React) | 138,9 KB | 44,9 KB |
| Estilos | 58,2 KB | 9,7 KB |
| Componentes de interfaz | 5,9 KB | 2,3 KB |

De los 91,4 KB del fragmento principal, unos **56 corresponden al cliente de
autenticación**: medido construyendo sin las variables de entorno correspondientes, el
fragmento baja a 35,1 KB. Es el candidato evidente si algún día hace falta recortar el
camino crítico, mediante carga diferida.

## 10.3 Presupuesto de rendimiento

Valores que el sistema debe mantener. Si alguno se degrada de forma sostenida, es
señal de regresión:

| Métrica | Objetivo | Actual | Margen |
|---|---|---|---|
| Time-to-interactive del menú | < 500 ms | ~160 ms | Amplio |
| Arranque con caché fría | < 2,5 s | 1,38 s | Amplio |
| Segunda apertura | < 300 ms | 47 ms | Amplio |
| Peticiones en el arranque | ≤ 3 | 3 | En el límite |
| Detección de cambios ajenos | < 60 s | 12-30 s | Cómodo |
| Crear parte, 10 empleados | < 6 s | 4,8 s | Ajustado |
| Editar parte, 10 empleados | < 15 s | 13,1 s | **Ajustado** |
| Fragmento principal comprimido | < 120 KB | 91,4 KB | Cómodo |

Los dos valores ajustados son los de escritura, y ambos mejoran en producción respecto
a la medición publicada (§3.4). La edición es la que primero rompería el presupuesto
si crecen los partes por número de empleados.

## 10.4 Inventario de mecanismos vigentes

Resumen; el detalle con la regla de no-rotura de cada uno está en el documento de
arquitectura, sección 3.1.

**Lectura:** limitación de propiedades por consulta · resolución de título por tipo ·
caché en memoria con vigencia por clave · invalidación en las cinco rutas de escritura
· comprobación de novedades con techo absoluto · caché de firmantes · catálogo
paginado con reintento y protección de concurrencia · semáforo global de cinco.

**Escritura:** lotes de tres · reintento ante saturación · archivado con reversión ·
espejo de vehículos en el camino del envío · idempotencia del envío.

**Cliente:** caché local versionada sin datos personales · seguimiento adaptativo con
pausas e interruptor · estado optimista con caducidad · catálogo memoizado con
normalización de acentos · límite de peticiones en dos capas · barrera de errores de
render · indicador de conexión honesto.

## 10.5 Riesgo estructural conocido

**Toda la caché, la idempotencia y el control de límites viven en memoria, por
instancia.** Con varias instancias en paralelo conviven copias independientes: cada
una mantiene su propia foto, su propio registro de envíos y su propio contador.

Consecuencias posibles: dos envíos del mismo parte atendidos por instancias distintas
podrían no verse mutuamente, y el cupo efectivo se multiplica por el número de
instancias.

Está **instrumentado desde v1.12.3** y el diseño del almacén compartido está terminado
y presupuestado. La decisión de ejecutarlo depende de los datos, no de la intuición.

---

# 11 · Verificación y control de calidad

## 11.1 Las cuatro capas

| Capa | Qué cubre | Qué NO cubre |
|---|---|---|
| **Suite de humo** (64 casos, `node:test`) | Contrato de los endpoints, idempotencia, verificación de sesión, ramas de la comprobación de novedades, lotes con reversión, paginación con reintento | Corre contra datos simulados: no valida la limitación de propiedades ni la saturación real |
| **Revisión de regresión** (agente independiente) | Razonamiento sobre los tres flujos críticos: firma, generación de PDF, sincronización. Busca invariantes rotos, no fallos de sintaxis | No ejecuta el sistema: razona sobre el código y las pruebas |
| **Verificación contra datos reales** | Lo que el simulado no puede: payloads reales, comportamiento ante saturación, tiempos de escritura, concurrencia | Manual, no automatizada |
| **Verificación en navegador** | Percepción, estados transitorios, comportamiento sin red, accesibilidad | Manual |

**La honestidad relevante:** la suite corre contra datos simulados. Eso significa que
**no habría detectado** ni el fallo de los nombres vacíos, ni el del cero de horas
—porque el simulado devolvía valores que no pasaban por esa rama—, ni una limitación
de propiedades mal construida. Por eso existen las otras tres capas, y por eso las
fases que tocaban lectura o saturación exigieron verificación adicional explícita.

## 11.2 Comparación campo a campo

Técnica empleada en la fase de dieta de payload, y reutilizable en cualquier
optimización de lectura:

1. Capturar la respuesta de cada endpoint **antes** del cambio, contra datos reales.
2. Aplicar el cambio.
3. Capturar de nuevo y comparar estructuralmente.
4. **Toda diferencia debe ser explicable.** Una diferencia no prevista es un campo
   amputado.

En su aplicación real: tres endpoints idénticos byte a byte, uno con la corrección
esperada y otro con una única diferencia atribuible al defecto que se estaba
arreglando. Cero cambios de forma.

## 11.3 Verificación extremo a extremo

Ejecutada tras las fases que tocan escritura, sobre la obra de pruebas:

crear parte con diez empleados, dos matrículas y notas multilínea → verificar en la
plataforma que existen los diez detalles, el nombre, el espejo de matrículas y las
notas → editar quitando dos y añadiendo uno → verificar ausencia de duplicados y de
huérfanos → **editar la relación a mano en la plataforma** y comprobar que el espejo
se re-deriva antes de generar el PDF → enviar → verificar el PDF **con las matrículas
presentes** → firmar → verificar el documento firmado.

El paso de editar a mano existe porque es el modo de fallo real que produjo un
incidente anterior: un PDF generado sin matrículas porque el espejo estaba desfasado.

## 11.4 Qué se verificó en producción tras cada despliegue

Diagnóstico respondiendo con la versión esperada · aplicación montada en navegador con
sesión real · cabeceras de caché · enlaces profundos · listado y detalle · consola sin
errores. Para la migración de configuración, lista extendida de ocho comprobaciones en
vista previa **y** repetición completa tras la fusión.

---

# 12 · Runbook operativo

## 12.1 Interruptores disponibles

| Interruptor | Efecto | Cómo |
|---|---|---|
| Seguimiento del listado | Detiene la actualización automática | Constante en el cliente + despliegue |
| Caché local | Purga todas las cachés locales existentes | Incremento de versión (automático en cada despliegue) |
| Vigencia de caché de servidor | `0` desactiva toda la caché en memoria | Variable de entorno |
| Techo de la foto de partes | Fuerza consulta completa más a menudo | Variable de entorno |
| Modo simulado | Desconecta la plataforma de datos por completo | Variable de entorno |
| Reversión de despliegue | Vuelve a la versión anterior de forma inmediata | Panel de la plataforma de despliegue |

## 12.2 Diagnóstico rápido

| Síntoma | Primera comprobación | Causa probable |
|---|---|---|
| «La aplicación no actualiza» | Consola del navegador; el seguimiento registra sus fallos | Seguimiento detenido, o caché sin invalidar tras escritura |
| Un parte recién creado no aparece | ¿Aparece tras 30 segundos o tras pulsar Refrescar? | Invalidación de caché; verificar que la ruta de escritura invalida |
| Nombres o campos vacíos en un listado | Comparar la respuesta cruda de la plataforma con el mapeador | Propiedad renombrada en la plataforma; comprobar la resolución por tipo |
| El PDF sale sin matrículas | Estado del espejo de texto frente a la relación | Espejo desfasado; se re-deriva en el envío |
| Errores intermitentes con varios usuarios | Registros: eventos de caché e identificadores de instancia | Saturación de la plataforma, o divergencia entre instancias |
| Pantalla en blanco | Consola | Debería ser imposible: hay barrera de errores. Si ocurre, es un fallo nuevo |

## 12.3 Reglas de no-rotura

Extracto de la sección 3.1 del documento de arquitectura. Las cinco que más fácilmente
se rompen sin darse cuenta:

1. **Toda ruta de escritura nueva debe invalidar la caché.** Sin eso, reaparece el
   defecto de datos obsoletos, que es intermitente y difícil de atribuir.
2. **Si se añade un campo a un mapeador, hay que añadir su identificador a la lista de
   propiedades solicitadas.** Si no, llega vacío en silencio.
3. **El estado optimista debe aplicarse en toda ruta que introduzca datos nuevos** en
   el listado. Omitirlo en una ruta nueva reabre el defecto de estados que mienten.
4. **No mover la sincronización del espejo de vehículos** fuera del camino del envío.
5. **No invertir el orden de los limitadores** de peticiones respecto a la
   autenticación.

## 12.4 Qué vigilar en septiembre

Con tres usuarios nuevos entrando en operativa real:

- **Identificadores de instancia distintos** en horario laboral: mide la convivencia
  de instancias y decide si el almacén compartido es urgente.
- **Envíos duplicados** del mismo parte con instancias distintas: sería la señal de
  que la idempotencia se ha repartido.
- **Frecuencia de saturación** y su causa declarada: distingue si la cuota se consume
  por la aplicación o por las automatizaciones, porque los remedios son opuestos.
- **Errores de escritura parciales:** cualquier aparición justifica revisar el
  archivado con reversión.

---

# 13 · Lo que deliberadamente no se hizo

## 13.1 Migración a otro motor de base de datos

La decisión estructural más importante de las no tomadas.

**Estado:** evaluada formalmente y **aplazada**, con criterios de reapertura escritos.

**Argumento.** De los cinco criterios de migración definidos, solo uno estaba activado:
«listados por encima de tres segundos». Su causa era el patrón de consulta —una
consulta por elemento y ausencia de limitación de propiedades— con **190 registros**.

> Migrar entonces habría sido cambiar de base de datos para no optimizar una consulta.

Tras la intervención, ese criterio ya no se cumple. La reapertura queda condicionada a
señales medibles: latencia alta sostenida durante una semana laboral, más de cien
partes en la ventana operativa, saturación recurrente, o incidencias repetidas de
datos obsoletos.

**Matiz honesto sobre el escalón siguiente:** el almacén compartido diseñado para
octubre es, conceptualmente, una caché de lectura como la que proponía la migración,
construida sobre otra tecnología. Es más barata y menos invasiva, pero pertenece a la
misma familia de soluciones. Se documenta así para que nadie lo presente como algo
distinto de lo que es.

## 13.2 Sistema externo de seguimiento de errores

**Clasificado como proyecto aparte** por un análisis de alcance independiente.

**Coste real, no solo el evidente:** dependencia nueva en dos capas, mapas de código
en la construcción, **región de datos europea explícita** —no viene por defecto—,
**depuración de datos personales** (nombres y DNI de empleados: sin ello se adquiere
una obligación regulatoria por la puerta de atrás con un plan gratuito), y pruebas
forzando errores reales.

**Advertencia de honestidad comercial que se documentó desde el principio:** este
sistema **no habría detectado** ninguno de los dos fallos que más han dolido en el
proyecto. Ambos fueron datos vacíos aceptados en silencio, no excepciones de código.
Venderlo como «así no vuelve a pasar» sería falso.

**Lo que sí se hizo:** verificar que los avisos automáticos de fallo de las
automatizaciones estaban activos. Lo estaban. El compromiso operativo de enterarse de
los fallos sin que llame el cliente ya estaba cubierto; lo que quedó fue una decisión
de negocio sobre a quién deben llegar esos avisos.

## 13.3 Otros descartes

| Descartado | Razón |
|---|---|
| Servidor de larga vida | Requiere auditar antes el estado compartido en memoria entre operaciones asíncronas. Reversible, previsto para después de la demostración |
| Comparación de diferencias en la edición | Reduciría veinte escrituras a dos o tres, pero introduce una máquina de estados nueva en el camino más delicado. Deuda consciente |
| Virtualización de listas | El volumen no lo justifica |
| Trabajador de servicio | Complejidad de invalidación desproporcionada |
| Carga diferida de modales | Riesgo de fragmento no encontrado tras un despliegue con una sesión abierta |
| Mover el saneado económico al mapeador | Se conserva como cinturón del invariante |
| Bloque de mejoras menores de interfaz (~12 h) | Diferido por congelación previa a la demostración |
| Panel de estado y reintentos automáticos de las automatizaciones | **Nadie lo ha pedido.** Se documenta el criterio para no acometerlo por inercia |

---

# 14 · Deuda técnica viva

| Id | Descripción | Severidad | Coste | Ventana |
|---|---|---|---|---|
| P1 | La versión de la interfaz de datos en uso **deja de funcionar** contra una base en cuanto alguien del cliente le añade una segunda fuente de datos desde su aplicación. **El disparador está fuera de nuestro código** | Alta | 1-2 h | Primera semana tras la demostración |
| I-A | El listado de partes muestra los 100 más recientes de 191 | Media | 4-6 h | Octubre |
| — | Estado en memoria por instancia | Media | 2-3 días | Decidir con la telemetría |
| P3 | Los avisos automáticos de la plataforma harían innecesario el seguimiento y cerrarían el punto ciego de los archivados | Media | 0,5 + 2-3 días | Octubre, junto al almacén compartido |
| E1 | Credencial incrustada en cinco puntos de tres automatizaciones | Media-alta | 2-3 h | Tras la demostración |
| — | Borrado y recreación sin comparación de diferencias | Baja | 1-2 días | Sin fecha |
| — | Resolución literal en las cinco propiedades con espacio final | Baja | 1 h | Tras la migración de versión |
| — | 54 obras activas sin persona autorizada asignada | Operativa | Cliente | Antes de septiembre |

**Sobre P1**, que es el único riesgo alto: no es un defecto del código sino una
caducidad. La versión de interfaz en uso data de 2022, y la plataforma introdujo en
2025 un cambio incompatible que se activa cuando una base pasa a tener más de una
fuente de datos. Ese cambio lo puede provocar el cliente desde su interfaz, sin tocar
nada nuestro. Herramientas de integración comerciales tardaron semanas en adaptarse.

---

# Apéndice A · Comandos de reproducción

```bash
# Suite completa
npm run test:smoke

# Servidor local contra datos reales (sin autenticación)
SUPABASE_URL= PORT=3199 node server.js

# Latencia de endpoint: fría y cacheada
curl -s -o /tmp/x.json -w "frio:  %{time_total}s\n" http://localhost:3199/api/<endpoint>
curl -s -o /dev/null   -w "cache: %{time_total}s\n" http://localhost:3199/api/<endpoint>

# Latencia y tamaño de una consulta directa a la plataforma de datos
curl -s -o /dev/null -w "%{size_download}B %{time_total}s\n" \
  -H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2022-06-28" \
  -X POST "https://api.notion.com/v1/databases/<id>/query" \
  -H "Content-Type: application/json" -d '{"page_size":100}'

# Prueba de concurrencia: dos peticiones simultáneas con caché fría
(curl -s -o /dev/null -w "A: %{time_total}s\n" http://localhost:3199/api/empleados &
 curl -s -o /dev/null -w "B: %{time_total}s\n" http://localhost:3199/api/empleados & wait)

# Construcción y tamaño del paquete
npm run build

# Comprobación de versión en producción
curl -s https://app.copuno.com/api/health
```

# Apéndice B · Configuración

| Variable | Valor por defecto | Papel |
|---|---|---|
| `NOTION_TOKEN` | — | Credencial de la plataforma de datos. Requerida salvo modo simulado |
| `USE_MOCK_DATA` | `false` | Desconecta la plataforma de datos |
| `CACHE_TTL_MS` | `30000` | Vigencia general de la caché de catálogos. `0` la desactiva |
| `PARTES_TTL_DURO_MS` | `300000` | Techo absoluto de la foto de partes. Cubre los registros archivados |
| `FIRMANTES_TTL_MS` | `60000` | Vigencia de la caché de firmantes por obra |
| `ESTADO_OPCIONES_TTL_MS` | `600000` | Vigencia de las opciones de estado |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Ventana de los limitadores |
| `RATE_LIMIT_MAX` | `1000` | Cupo fino, por usuario autenticado |
| `RATE_LIMIT_IP_MAX` | `5000` | Cupo grueso, por dirección de red |
| `PARTES_WEBHOOK_TIMEOUT_MS` | `10000` | Espera máxima al pipeline de generación |
| `ALLOWED_ORIGINS` | vacío | Orígenes permitidos. En producción, restringido al dominio propio |
| `AUTH_OBLIGATORIA` | — | Si está activa, la ausencia de configuración de sesión aborta el arranque en lugar de dejar la API abierta |

# Apéndice C · Glosario

| Término | Significado en este documento |
|---|---|
| **Parte** | Registro de una jornada de trabajo en una obra: fecha, obra, firmante, trabajadores con sus horas, vehículos y notas |
| **Rectificativo** | Parte nuevo creado a partir de uno firmado para corregirlo. El original no se modifica |
| **Detalle de horas** | Fila que relaciona un empleado con un parte y una cantidad de horas |
| **Espejo** | Copia de texto que el servidor mantiene a partir de una relación, para consumo del pipeline de generación |
| **Comprobación de novedades** | Consulta mínima que pregunta si algo cambió desde una marca temporal, antes de repetir la consulta completa |
| **Estado optimista** | Estado pintado en la interfaz antes de la confirmación del servidor, con caducidad |
| **Servir-mientras-revalida** | Mostrar datos guardados de inmediato y actualizarlos en segundo plano |
| **Instancia** | Ejecución independiente de la función de servidor. Varias pueden convivir, cada una con su propia memoria |
| **Idempotencia** | Propiedad por la que repetir una operación no duplica su efecto |
| **Congelación** | Periodo previo a una demostración en el que solo se admiten correcciones urgentes |

---

**Fin del informe.**

*Elaborado por NotionVan el 18 de agosto de 2026. Las cifras corresponden a mediciones
propias sobre el sistema en producción. Los procedimientos de reproducción están en el
apéndice A para que cualquier tercero pueda verificarlas.*
