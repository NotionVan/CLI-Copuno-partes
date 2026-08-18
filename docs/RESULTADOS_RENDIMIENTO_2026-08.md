# Copuno · Gestión de Partes — Informe de resultados de la intervención de agosto 2026

> **Qué es este documento.** El registro técnico completo de la intervención de
> rendimiento y experiencia de uso ejecutada entre el 17 y el 18 de agosto de 2026:
> **cómo estaba la aplicación, qué se hizo, cómo está ahora**. Todas las cifras son
> medidas, no estimadas; cada una indica cómo se obtuvo para que pueda reproducirse.
>
> - **Autor:** NotionVan · **Fecha:** 2026-08-18
> - **Versiones cubiertas:** v1.9.0 → **v1.13.2** (16 despliegues)
> - **Documento de diagnóstico previo:** [INFORME_UX_RENDIMIENTO_2026-08-17.md](INFORME_UX_RENDIMIENTO_2026-08-17.md)
> - **Estado del sistema al cierre:** v1.13.2 en producción, suite de humo 64/64 verde

---

## 1 · Resumen ejecutivo

La aplicación funcionaba, pero se **sentía** lenta y poco fiable, y arrastraba dos
defectos silenciosos que corrompían datos sin avisar. En dos jornadas de trabajo se
ejecutó un plan de ocho fases, más dos correcciones posteriores, con un despliegue
verificado por fase y capacidad de revertir en cualquier punto.

| Indicador | Antes (17-08) | Ahora (18-08) | Cambio |
|---|---|---|---|
| Menú principal visible tras entrar | 4-8 s de spinner | **~160 ms** | ~30× |
| Peticiones en el arranque | 9 (cascada de 3 saltos) | **3** | −67 % |
| Segunda apertura de la app | igual que la primera | **47 ms** con datos en pantalla | ~100× |
| Payload de partes desde Notion | 935 KB / 1,94 s | **357 KB** | −62 % |
| Payload de empleados desde Notion | 652 KB / 2,91 s | **171 KB / 0,7 s** | −74 % |
| Crear un parte (10 trabajadores) | 8,5 s | **4,8 s** | −44 % |
| Editar un parte (10 trabajadores) | 17,2 s | **13,1 s** | −24 % |
| Guardar (percibido por el usuario) | 4-6 s | **~1,5 s** | −70 % |
| «Enviar datos» (percibido) | 2-4 s + riesgo de estado falso | **instantáneo** | — |
| Actualización del listado entre usuarios | **no existía** (roto desde v1.3) | **12-30 s automático** | — |
| Comprobación de novedades en servidor | query completa 1,5-2,5 s | **0,43 s** | −75 % |
| Empleados accesibles al crear un parte | 100 de 1.533 | **1.533** | ×15 |

**Tres hallazgos que no eran de rendimiento y valían más que él:**

1. **Un fallo activo y silencioso en producción**: todos los nombres de empleado se
   servían vacíos y la búsqueda por nombre devolvía error. Llevaba semanas así. Es,
   con alta probabilidad, lo que falló en la demostración ante la central de julio.
2. **Las horas a 0 se grababan como 8.** Un trabajador presente sin jornada se
   facturaba como jornada completa.
3. **La edición podía vaciar un parte**: si fallaba la carga de detalles, el
   formulario abría vacío y al guardar archivaba las horas reales. Único camino de
   pérdida de datos del producto.

---

## 2 · Método

Para que las cifras sean auditables:

- **Latencias de Notion**: `curl` directo contra la API con el token de producción,
  desde la misma máquina y conexión en ambas mediciones.
  `curl -s -o /dev/null -w "%{size_download}B %{time_total}s\n" -H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2022-06-28" -X POST https://api.notion.com/v1/databases/<id>/query -d '{"page_size":100}'`
- **Latencias de la aplicación**: servidor Express local apuntando a la **base de
  datos real de producción**, midiendo el endpoint completo (petición fría y
  cacheada). Es la cifra que refleja lo que espera el usuario, no solo la query.
- **Tiempos de interfaz**: navegador headless (puppeteer) contra el modo simulado,
  viewport de tablet, midiendo hasta el primer frame interactivo.
- **Escrituras**: cronometradas contra Notion real creando y editando partes de
  10 trabajadores en la obra de pruebas, mismo entorno antes y después.
- **Volumen del sistema al medir**: 191 partes, 1.533 empleados, 54 obras activas,
  565 registros de detalle de horas, 141 vehículos.

Cada fase se desplegó por separado, se verificó en producción y quedó registrada en
su propio changelog. Los tres flujos críticos —firma digital, generación del PDF y
sincronización con Notion— se auditaron con un revisor independiente antes de cada
fusión.

---

## 3 · El punto de partida

Auditoría del 17 de agosto sobre el código en producción: **56 hallazgos de
experiencia de uso, 20 de servidor y 29 de interfaz**. Los 13 hallazgos críticos
detectados en julio seguían vivos al 100 %.

### 3.1 Por qué se sentía lenta

- **El arranque hacía 9 peticiones en cascada de 3 saltos** antes de mostrar nada:
  tres comprobaciones de salud duplicadas, dos de opciones de estado, y los cuatro
  catálogos. La pantalla de bienvenida —que no necesita ningún dato— estaba atrapada
  detrás de todas ellas.
- **Cada consulta traía todo el contenido de cada ficha**, incluidos campos que la
  aplicación nunca lee. Un listado de partes movía 935 KB desde Notion.
- **Cada apertura empezaba de cero.** No había memoria local: reabrir la aplicación
  costaba lo mismo que abrirla por primera vez.
- **Al guardar, la aplicación esperaba 2-4 segundos a propósito** «para que se lea el
  mensaje», sumados al tiempo real de guardado.
- **Las escrituras se hacían de una en una con pausas de 100 ms intercaladas.**
  Crear un parte de 10 trabajadores eran 14 viajes secuenciales a Notion.

### 3.2 Por qué se sentía poco fiable

- **El listado no se actualizaba solo.** La actualización automática estaba **rota
  desde la versión 1.3** por un error de programación que un `catch` vacío ocultaba.
  De ahí la queja recurrente: «hay que refrescar a mano».
- **La memoria interna del servidor no se limpiaba tras escribir.** Un parte recién
  creado podía no aparecer durante 30 segundos. Era la mitad intermitente de la misma
  queja, y tenía una causa distinta a la anterior.
- **Cualquier error pintaba una pantalla completa de fallo**, y no había ninguna red
  de seguridad ante errores de programación: una excepción dejaba la pantalla en
  blanco. Sin traza, sin mensaje, sin vuelta atrás.
- **El indicador de conexión mentía**: decía «Conectado» sin cobertura, porque los
  fallos se descartaban en silencio.
- **Los mensajes de error eran técnicos y en inglés** («timeout of 20000ms exceeded»).
- **El límite de uso se contaba por dirección IP**: detrás de la red de la central,
  tres pestañas agotaban el cupo de toda la oficina — exactamente el escenario de una
  demostración.

### 3.3 Los defectos de integridad

Los descritos en el resumen: nombres vacíos, el 0 convertido en 8, y la edición que
podía vaciar un parte. Ninguno de los tres era visible como «error»: el sistema
seguía funcionando y devolviendo datos incorrectos.

---

## 4 · Qué se hizo

Ocho fases, un despliegue por fase, cada una reversible de forma independiente.

### F0 · Medición (v1.9.1)
Antes de tocar nada, línea base completa y activación de la telemetría real de la
plataforma. Se corrigió además una recomendación equivocada en la documentación de
despliegue: fijar la región europea habría **empeorado** el backend 1-1,3 s por parte,
porque la función vive junto a la API de Notion y cada operación de usuario provoca
entre 1 y 24 viajes a Notion frente a uno solo hacia el usuario.

### F1 · Integridad y red de seguridad (v1.9.2)
- La memoria interna se limpia tras **las cinco rutas de escritura**.
- El 0 de horas se respeta (`|| 8` → `?? 8`), con prueba automática que lo fija.
- Se pueden teclear medias jornadas: el límite se aplica al salir del campo, no en
  cada pulsación (antes «7.5» acababa siendo 24).
- Fuera las esperas artificiales de 2-4 segundos.
- Red de seguridad global ante errores de programación: nunca más pantalla en blanco.
- Los cinco estados del parte se ven con su color; Intro en un buscador ya no crea
  el parte a medias.

### F2 · Dieta de datos (v1.9.3)
Cada consulta pide **solo los campos que la aplicación lee**. Aquí se detectó y
corrigió el fallo de los nombres vacíos, con una solución estructural: la propiedad
título se localiza **por su tipo**, no por su nombre, de modo que un renombrado
manual en Notion no puede volver a romperlo.
**Medido:** partes 935 → **357 KB** (−62 %); empleados 652 → **171 KB** y 2,91 →
**0,7 s** (−74 %). Verificado con comparación campo a campo antes/después: cero
cambios de forma en los datos entregados.

### F3 · Arranque (v1.10.0)
Una sola petición consolidada en lugar de cuatro, con retorno automático al camino
antiguo si falla. La pantalla de bienvenida sale del bloqueo. Logo y spinner visibles
**desde el primer fotograma**, antes de que cargue el código.
**Medido:** menú interactivo en **158-160 ms**; arranque con exactamente 3 peticiones.

### F4 · Memoria local y fluidez (v1.10.1)
La aplicación recuerda la última foto de los catálogos y la pinta al instante mientras
revalida por detrás.
**Medido: segunda apertura con el listado lleno en 47 ms.**
Diseño deliberado: clave versionada (cada despliegue purga las memorias locales, lo
que da un interruptor de emergencia gratis), **sin datos personales de empleados en
el disco** de una tablet compartida, caducidad de 24 h y limpieza al cerrar sesión.
En esta fase entra también el aviso flotante único —los mensajes ya no aparecen fuera
de la pantalla—, la protección de la edición ante fallos de carga, y los objetivos
táctiles a 44 px con contrastes accesibles, pensados para tablet a pleno sol y con
guantes.

### F5 · Varios usuarios a la vez (v1.10.2)
Límite de uso en dos capas: grueso por dirección IP delante de la autenticación, fino
**por usuario** detrás. Se acabó el problema de la red compartida de la central.
Añadido semáforo global hacia Notion, reintento ante saturación, respuesta honesta al
cliente cuando el sistema está ocupado, y validación por etiqueta de versión: un
refresco sin novedades pasa de descargar todo a **0 bytes**.
El indicador de conexión dice la verdad y los errores hablan en castellano llano.

### F6 · Sincronización entre usuarios (v1.11.0)
El corazón de la queja histórica. La actualización automática **revive** con el patrón
que sí funcionaba en la aplicación, y se añade una comprobación previa barata en el
servidor: antes de repetir la consulta completa, se pregunta a Notion si algo ha
cambiado desde la última foto.
**Medido contra Notion real:** consulta completa 1,51 s → memoria 4 ms → comprobación
sin cambios **0,43 s** → cambio real detectado → consulta completa 1,71 s.
La actualización **se pausa mientras hay una edición abierta** (no puede pisar un
formulario a medio rellenar) y **no consume nada en segundo plano**.

### F7 · Escrituras (v1.12.0 → v1.12.2)
- Detalles de horas en **lotes de tres en paralelo**, sin pausas intercaladas.
- **Archivado transaccional**: si un guardado falla a medias, se deshace lo hecho y
  el parte queda exactamente como estaba. Nunca con horas de menos ni duplicadas.
- Estado optimista real: «Enviar datos» responde al instante y **no puede mostrar un
  estado falso** aunque falle la cobertura justo después.
- Infraestructura de despliegue modernizada, con límite de ejecución ampliado a 60 s.

**Medido (local → Notion real, mismo entorno):**

| Operación | Antes | Después |
|---|---|---|
| Crear parte, 10 trabajadores | 8,5 s | **4,8 s** |
| Editar parte, 10 trabajadores | 17,2 s | **13,1 s** |

### Posterior · Telemetría y catálogo (v1.12.3 → v1.13.2)
- **v1.12.3**: instrumentación para decidir con datos, y no por intuición, si el
  siguiente escalón de infraestructura es necesario antes de octubre.
- **v1.13.0/v1.13.1**: a raíz de un aviso del cliente, el buscador de plantilla pasa
  de mostrar 20 nombres exigiendo 3 letras a **mostrar los 1.533 empleados**,
  ordenados y filtrando al instante desde la primera letra, con o sin tildes. Una
  segunda revisión adversarial corrigió seis casos límite antes de que los viera nadie.
- **v1.13.2**: la descarga del catálogo reintenta si Notion pide esperar, y varias
  peticiones simultáneas comparten una sola descarga.

---

## 5 · Cómo está ahora

Medición del 18-08 contra la base de datos real de producción, endpoint completo:

| Endpoint | Petición fría | Con memoria | Tamaño |
|---|---|---|---|
| Arranque consolidado (`/api/datos-completos`) | 1,38 s | **3,8 ms** | 123 KB |
| Listado de partes | 1,17 s | **4,1 ms** | 94,6 KB |
| Catálogo completo de empleados (1.533) | 7,58 s | **6,1 ms** | 373 KB |
| Obras activas | 1,67 s | **2,1 ms** | 6,6 KB |
| Personas autorizadas | 0,65 s | **0,8 ms** | 0,3 KB |

Lectura: el arranque completo de la aplicación cuesta hoy **1,38 s en el peor caso**
(memoria vacía) y **menos de 4 ms** en el caso normal. El catálogo de empleados es la
operación más cara del sistema —16 consultas paginadas— y por eso se descarga en
segundo plano, se guarda 10 minutos y varias peticiones simultáneas la comparten.

**Programa cliente:** 341 KB en bruto / **91 KB comprimidos** para el paquete
principal, más 45 KB de biblioteca base. De esos 91 KB, unos 56 corresponden al
sistema de autenticación.

**Cobertura de pruebas:** 64 pruebas automáticas de humo cubriendo los flujos
críticos, la idempotencia del envío, la verificación de sesión, la comprobación de
novedades, los lotes de escritura con su reversión y la paginación del catálogo.

---

## 6 · Lo que deliberadamente no se hizo

Un informe honesto incluye las decisiones de no actuar:

- **Migrar la base de datos a otro motor.** Evaluado y aplazado con criterio escrito:
  el único síntoma que lo justificaba —listados lentos— tenía como causa consultas sin
  optimizar, no el volumen de datos. Migrar habría sido cambiar de base de datos para
  no optimizar una consulta.
- **Sistema externo de seguimiento de errores.** Clasificado como proyecto aparte:
  añade una dependencia nueva, un tercero y obligaciones de protección de datos
  personales. Se verificó además que los avisos nativos de fallo **ya estaban activos**.
- **Servidor de larga vida.** Disponible con un interruptor, pero requiere auditar
  antes el estado compartido en memoria. Pendiente para después de la demostración.
- **Bloque de mejoras menores de interfaz** (~12 h): diferido conscientemente para no
  tocar el producto en las semanas previas a la presentación.
- **Reintentos automáticos y panel de estado de las automatizaciones**: nadie los ha
  pedido. Se documenta el criterio para no caer en ello por inercia.

---

## 7 · Riesgos vivos

| Riesgo | Severidad | Estado |
|---|---|---|
| La versión de la API de Notion en uso deja de funcionar si el cliente añade una segunda fuente de datos a una base desde su interfaz | 🔴 Alta | Diagnosticado; migración planificada para después de la demostración (1-2 h). El disparador no está en nuestro código |
| El listado de partes sigue mostrando los 100 más recientes de 191 | 🟡 Media | Documentado; paginación completa prevista para octubre |
| La memoria del servidor es por instancia: con varias en paralelo, cada una mantiene su propia copia | 🟡 Media | Instrumentado desde v1.12.3; el diseño del siguiente escalón está terminado y presupuestado, a la espera de los datos |
| Ninguna de las 54 obras activas tiene firmante asignado | 🟠 Operativo | Depende del cliente. Es la mejora de uso diario más visible que queda |

---

## 8 · Dónde está cada cosa

| Documento | Contenido |
|---|---|
| [INFORME_UX_RENDIMIENTO_2026-08-17.md](INFORME_UX_RENDIMIENTO_2026-08-17.md) | Diagnóstico completo: 105 hallazgos con evidencia y línea base |
| `CHANGELOG_V1.9.1` → `V1.13.2` (15 archivos) | Detalle técnico de cada despliegue, con sus mediciones |
| [ARQUITECTURA.md](ARQUITECTURA.md) | Cómo funciona el sistema hoy, incluidos los mecanismos nuevos |
| [DEUDA_TECNICA.md](DEUDA_TECNICA.md) | Hallazgos abiertos y cerrados, con historial cronológico |
| [SMART_POLLING.md](SMART_POLLING.md) | Diseño de la sincronización entre usuarios |
| [INVESTIGACION_NOTION_API_2026-08.md](INVESTIGACION_NOTION_API_2026-08.md) | Estado del arte de la plataforma y sus límites |
| [CACHE_NOTION_INDUSTRIA_2026-08.md](CACHE_NOTION_INDUSTRIA_2026-08.md) | Cómo resuelven esto productos equivalentes, y el diseño del siguiente escalón |
| [APUNTALAMIENTO_NOTION_2026-08.md](APUNTALAMIENTO_NOTION_2026-08.md) | Endurecimiento del espacio de trabajo y plan de formación |

---

## 9 · Nota de honestidad metodológica

- Las cifras de escritura se midieron desde España contra Notion en Estados Unidos.
  En producción, la función se ejecuta junto a la base de datos, por lo que los
  tiempos reales son **mejores** que los publicados aquí. Se prefiere el dato
  conservador.
- La medición del catálogo de empleados (7,58 s) es la peor posible: memoria vacía y
  desde una conexión doméstica. El usuario no la percibe porque ocurre en segundo
  plano mientras puede seguir trabajando.
- «Antes» y «después» se midieron con el mismo método, la misma máquina y la misma
  conexión. No se comparan mediciones de origen distinto.
- Ningún dato de este informe procede de una estimación. Lo que no se pudo medir se
  indica como tal.
