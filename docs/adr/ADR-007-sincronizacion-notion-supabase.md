# ADR-007 — Sincronización Notion ↔ Supabase para la app de partes

- **Fecha:** 2026-08-03
- **Estado:** 🟡 **BORRADOR — evaluado y aplazado.** No implementar nada de lo que aquí se describe
  sin reabrir la decisión con datos nuevos.
- **Autor:** Javi Collado (planteamiento) — evaluación en sesión de trabajo del 3-ago-2026
- **Depende de:** [ADR-001](./ADR-001-notion-como-bbdd.md) (criterios de migración),
  [ADR-002](./ADR-002-capa-abstraccion-datos.md) (capa `data.js`),
  [ADR-003](./ADR-003-supabase-destino-migracion.md) (Supabase como destino)

---

## Contexto

Planteamiento literal de Javi: *"¿y sincronizar Notion con Supabase? La webapp lee y escribe de
Supabase y se sincroniza con Notion."*

Surge al hilo de la latencia: la query de partes cuesta **~3,5 s**, Notion admite **~3 req/s** y la
app hace varias llamadas por cada petición de usuario. La intuición —que el cuello de botella es
usar Notion como base de datos en caliente— **es correcta**. Lo que este ADR evalúa es la *forma*
concreta propuesta.

El ADR-003 ya dejó decidido el destino (Supabase) y dejó **fuera de su alcance**, expresamente, la
estrategia de sincronización: *"cómo se hace la migración (big-bang vs gradual, sync bidireccional
con Notion durante transición) se decidirá en su propio ADR cuando se active"*. Este es ese ADR.

## ¿Están activados los criterios del ADR-001?

Evaluación a 2026-08-03:

| # | Criterio | Estado |
|---|---|---|
| 1 | Incidente de integridad (H2) con impacto operativo | 🟡 **Parcial** — los 5 partes atascados en `Procesando` del 28-jul (fallo de Make, no de Notion) |
| 2 | >5.000 partes activos **o** listados >3 s sostenidos | ⚠️ **Activado, por la causa equivocada** — ver abajo |
| 3 | El cliente deja de editar en Notion | ❌ **No, y va en contra** — ver abajo |
| 4 | Notion cambia precios / rate limits / API | ❌ No consta |
| 5 | Requisitos transaccionales reales (ACID) | ❌ No — factura Chorus, no la app |

**Sobre el criterio 2 — se cumple la letra, no el espíritu.** El listado tarda 3,5 s, sí, pero hay
**190 partes**, no 5.000: el umbral de volumen está lejísimos. La lentitud viene del N+1 y de traer
**934 KB** sin `filter_properties` (hallazgos **C2** y **C3** de la auditoría pre-septiembre). Es un
problema de implementación, no del motor. **Migrar por esto sería cambiar de base de datos para no
tener que optimizar una consulta.**

**Sobre el criterio 3 — es el que más pesa, y apunta a quedarse.** Notion no es solo la BBDD de la
app: es el **puesto de trabajo del cliente**. Paola y Óscar mantienen datos allí, el asistente de
RRHH ("el bigotito") vive allí, y Make escribe allí el PDF y el documento firmado. El criterio que
activaría la migración es justo el contrario del que se cumple.

## Evaluación de la propuesta: bidireccional

Lo propuesto —la app lee **y escribe** en Supabase, y algo sincroniza con Notion— es
**sincronización bidireccional**, la variante más cara de todas. Problemas concretos, no teóricos:

1. ~~**Notion no ofrece webhooks fiables de cambios en bases de datos.**~~ Para enterarse de lo que
   edita la oficina hay que **hacer polling contra Notion** — es decir, martillear justo la API
   cuyo límite de 3 req/s se quería esquivar. La sincronización se comería el presupuesto de
   peticiones que se pretende liberar. ~~**Esto solo ya descarta la variante.**~~

   > ⚠️ **PREMISA CADUCADA (verificado 2026-08-17).** Notion **sí** tiene webhooks oficiales (GA),
   > con eventos `page.created` / `properties_updated` / `deleted` / `undeleted` sobre las páginas
   > de una base de datos. La detección de cambios ya no exige polling: el evento llega por push
   > (entrega típica <1 min) y solo hay que hacer un fetch dirigido para leer el dato. Esto **no
   > reabre por sí solo la variante bidireccional** —los problemas 2 a 5 (eco, conflictos, doble
   > fuente de verdad, coste) siguen intactos— pero sí **abarata mucho la variante unidireccional**
   > (Supabase como caché de lectura), que era ya la preferida, y añade un escalón intermedio más
   > barato antes de ejecutarla: **webhooks + KV compartido** manteniendo Notion como único motor.
   > Detalle, cifras y fuentes en [INVESTIGACION_NOTION_API_2026-08.md](../INVESTIGACION_NOTION_API_2026-08.md);
   > catalogado como P3 en [DEUDA_TECNICA.md](../DEUDA_TECNICA.md).
2. **Bucles y eco.** Make escribe `URL PDF`, `AUX ID PDF Onedrive` y `Documento Firmado` en Notion
   **desde fuera del perímetro de la app**. Habría que traer esos cambios de vuelta y, a la vez,
   distinguir "cambio legítimo de Make" de "eco de mi propia escritura", o el sistema se
   retroalimenta.
3. **Doble fuente de verdad.** El día que Notion y Supabase difieran, alguien decide quién gana.
   Ese alguien sería Javi, a mano, sobre partes de obra reales que alimentan facturación de cliente.
4. **El flujo de firma es crítico y externo.** `firma-parte.html` vive en `copuno.com` (WordPress) y
   postea directamente a Make. Cualquier modelo de sincronización tiene que respetarlo intacto.

## Alternativa preferida (si se ejecuta algo): unidireccional, Supabase como caché de lectura

**Notion sigue siendo la fuente de verdad. La app lee de Supabase y escribe en Notion.** Un proceso
refresca Supabase desde Notion, en un solo sentido.

| | Bidireccional (propuesta) | **Caché de lectura (preferida)** |
|---|---|---|
| Conflictos | Hay que resolverlos | **No existen** |
| Bucles con Make | Riesgo real | **Ninguno** (Make sigue escribiendo en la fuente) |
| Fuente de verdad | Ambigua | **Notion, sin discusión** |
| El cliente nota el cambio | Sí (Notion pasa a "vista") | **No** |
| Resuelve latencia y rate limit | Sí | **Sí** |
| Resuelve truncación a 100 registros (I-A) | Sí | **Sí** |
| Resuelve H2 (transaccionalidad) | Sí | No |
| Resuelve realtime (H3) | Sí | No |

Da el grueso del beneficio con una fracción del riesgo. Lo que no resuelve —transaccionalidad y
realtime— **hoy no es el dolor**; el dolor es la latencia y el rate limit.

## Decisión

**Aplazar. No se implementa sincronización de ningún tipo por ahora.** El orden acordado:

1. **Primero, C2 y C3** (6-8 h, ya diagnosticados). Si la query baja de 3,5 s a menos de 1 s, el
   único criterio activado del ADR-001 **deja de estarlo** y esta decisión se pospone con
   tranquilidad. Compárese con las **1-2 semanas** que el ADR-003 estima para la migración.
2. **Dejar que Supabase se asiente** en el stack por la puerta que ya ha entrado: autenticación
   (v1.9.0, ADR-006). Es la forma barata de acumular experiencia operativa con él.
3. **Medir**, con la telemetría que desbloquea el plan Pro de Vercel (log drains): p95 real de la
   query de partes, frecuencia de 429 de Notion, cold starts. Hoy se decide con estimaciones.
4. **Reabrir cuando llegue el módulo de flota**, que traerá datos que **no** vienen de Notion
   (Mapon, Solred). Ahí la pregunta cambia de naturaleza: ya no es "migrar lo que hay", sino "dónde
   viven los datos nuevos" — y probablemente la respuesta sea Supabase para lo nuevo y Notion para
   lo que la oficina edita.

**Si en esa reapertura se decide ejecutar, la variante por defecto es la unidireccional** (caché de
lectura), y la bidireccional necesita justificación explícita que responda al punto 1 de la
evaluación (cómo detectar cambios en Notion sin polling).

## Consecuencias de aplazar

- **Positiva:** no se añade una quinta pieza al stack (Vercel + Make + Notion + Supabase + sync) sin
  haber agotado antes una optimización de 6-8 h ya diagnosticada.
- **Positiva:** la decisión se tomará con métricas reales en vez de con estimaciones.
- **Negativa:** se conservan H2 (integridad transaccional) y H3 (realtime) sin resolver
  estructuralmente. Ambos siguen mitigados como describe el ADR-001.
- **Negativa:** si C2/C3 no bajan la latencia lo previsto, se habrán gastado 6-8 h antes de
  reabrir. Aceptado: esas horas hay que gastarlas igual de cara a la demo de septiembre.

## Criterios para reabrir

1. **C2 y C3 hechos y la query sigue por encima de 3 s** → el criterio 2 del ADR-001 estaba bien
   activado y el problema sí es el motor.
2. **Llega el módulo de flota** con datos que no son de Notion.
3. **Se activa cualquier otro criterio del ADR-001** (en especial el 3: que el cliente deje de
   editar en Notion).
4. **La telemetría muestra 429 de Notion recurrentes** en horario laboral real, no como hipótesis.

## Referencias

- [ADR-001](./ADR-001-notion-como-bbdd.md) — criterios que activan la migración.
- [ADR-003](./ADR-003-supabase-destino-migracion.md) — Supabase como destino; deja este ADR fuera de su alcance a propósito.
- [ADR-006](./ADR-006-autenticacion-unica-autorizacion-por-modulo.md) — Supabase ya en el stack para auth.
- [docs/AUDITORIA_PRE_SEPTIEMBRE.md](../AUDITORIA_PRE_SEPTIEMBRE.md) — C2, C3 e I-A.
- [docs/DEUDA_TECNICA.md](../DEUDA_TECNICA.md) — H2, H3.
