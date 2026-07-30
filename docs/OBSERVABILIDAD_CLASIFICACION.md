# Observabilidad de la plataforma — clasificación de alcance

- **Fecha:** 2026-07-30
- **Origen:** pregunta interna de Javi (**no** petición del cliente). Importante para el encuadre:
  nadie de Copuno ha pedido esto todavía.
- **Clasificado por:** `@scope-guardian` contra [.claude/scope-rules.md](../.claude/scope-rules.md)
- **Destino:** QBR con Efrén (~15-ago)

## Por qué surge

Los dos fallos que más han dolido no dejaron rastro accionable:

- **M8** — las matrículas se perdían entre PARTES1/4 y 2/4: el escenario terminaba **en verde** y
  el PDF salía mal. Ningún error registrado.
- **"La app no actualiza"** — queja recurrente del cliente, sin excepción asociada.

Hoy un fallo del pipeline se descubre **cuando el cliente lo reporta**.

## Veredicto por niveles

| Nivel | Qué es | Clasificación | Esfuerzo |
|---|---|---|---|
| 1A | Notificaciones **nativas** de Make (Settings → Notifications, sin tocar blueprint) | **Retainer** | 1-2 h |
| 1B | Error handlers **custom** en blueprint (routers/filters con contexto del fallo) | Zona gris | 3-6 h |
| 2 | **Sentry** (error tracking) en SPA React + Express | **Proyecto aparte** | 6-12 h |
| 3 | **Plataforma de logs externa** (Axiom/Better Stack/Datadog) vía log drains | **Proyecto aparte** | 15-25 h |

### Nivel 1 — avisos de fallo en Make

**Hacer la ruta 1A y parar ahí.** Es configuración pura sobre algo ya construido (retainer), da el
80 % del valor —enterarse de que algo falló— y no toca los blueprints recién blindados en M9.
La 1B solo si el cliente pide después contexto detallado en el aviso.

**Este nivel vale más ahora que hace una semana:** antes de **E3** (data structures obligatorias en
los webhooks, aplicado el 28-jul) un fallo tipo M8 ni siquiera generaba error en Make — el webhook
aceptaba el vacío sin protestar, así que un manejador de error no habría hecho nada. Ahora sí.

**Riesgo de scope creep — y aquí el riesgo es Javi, no el cliente:** convertir "un email cuando
falla" en "un dashboard de estado con reintentos automáticos". Nadie lo ha pedido.

### Nivel 2 — Sentry

Capa nueva del stack: dependencia nueva, cuenta de terceros, configuración en Vercel,
instrumentación en dos capas. Choca además con la convención "no introducir librerías nuevas sin
necesidad real" — no lo invalida, pero confirma que es decisión de alcance, no un fix.

Trabajo real incluido en la estimación: `Sentry.init` + ErrorBoundary + source maps en el build de
React, middleware de captura en Express, **fijar región de datos UE explícitamente** (no viene por
defecto), **scrubbing de PII** (nombres y DNI de empleados — sin filtrarlo se cuela una obligación
RGPD por la puerta de atrás con un plan "gratis") y testing forzando errores reales.

**Aviso de honestidad comercial:** Sentry **no** habría detectado M8. Aquello fue un dato vacío
aceptado en silencio por el pipeline, no una excepción de código. No venderlo como "así no vuelve a
pasar lo de las matrículas".

Otros riesgos: el free tier (5k eventos/mes) se agota solo y el salto a plan de pago es decisión
explícita del cliente; y los `try/catch` silenciosos existentes (probables en el polling, dado el
precedente de "la app no actualiza") no reportan nada hasta instrumentarlos uno a uno — horas no
incluidas si aparecen sobre la marcha.

### Nivel 3 — plataforma de logs

El más claro de los tres, ni siquiera zona gris. No es solo trabajo técnico: exige que el cliente
**contrate planes de pago de Vercel y Supabase** que hoy no tiene (los log drains no están en los
planes actuales), elija proveedor, asuma **coste recurrente** y firme un **DPA como encargado de
tratamiento** — los logs llevan nombres, emails y DNI de empleados. Decisiones de negocio y legales
que el cliente debe tomar **antes** de facturar una sola hora. Los costes recurrentes los paga el
cliente aparte y no se absorben (sección "Costes de terceros" de las reglas de scope).

Riesgo principal: que se apruebe en una conversación de 10 minutos del QBR sin que el cliente haya
interiorizado el coste recurrente ni la responsabilidad RGPD. Eso vuelve como "esto no lo
entendíamos así".

## Riesgo transversal (el más importante)

**No presentar los tres niveles juntos bajo el paraguas "observabilidad".** El cliente anclaría todo
al coste del Nivel 1 (casi gratis) y percibiría el 2 y el 3 como algo que debería entrar en el mismo
cubo barato. Separarlos en el tiempo y en el documento.

**Tampoco agrupar con el módulo Vehículos.** Vehículos es funcionalidad de negocio visible;
observabilidad es infraestructura invisible de calidad de servicio. Agrupados, el cliente ancla el
precio al elemento visible y percibe la observabilidad como "gratis, que ya va en el paquete".

## Plan para el QBR del 15-ago

- **Llevar como hecho:** aviso de fallos en Make ya reforzado (Nivel 1A), dentro del retainer.
  Genera confianza y no pide nada.
- **Llevar como propuesta:** Sentry (Nivel 2), suelto, enmarcado en resultado — "detección proactiva
  de errores reales de usuario antes de que los reporte el jefe de obra". Sin horas en el documento
  (se presupuesta por ROI/resultado).
- **Dejar fuera:** Nivel 3 por completo. Ya hay dos iniciativas grandes en cola (auth Supabase
  20-35 h y Vehículos fase 2) y este QBR no es el sitio para una tercera que arrastra una decisión
  legal.
