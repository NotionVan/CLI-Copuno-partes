# Changelog v1.12.2 — F7 (deploy 3): migración de Vercel a `functions`

**Fecha:** 2026-08-17
**Tipo:** patch — infraestructura de despliegue, sin cambio funcional visible
**Contexto:** tercer y último deploy de F7 (7a). Cierra el plan pre-demo completo (F0-F7).

## Qué cambia

- **`vercel.json` migra de `builds` (legacy) a `functions`**: wrapper [api/index.js](api/index.js) de 2 líneas (Vercel solo construye funciones bajo `/api`; [server.js](server.js) no se toca — ya exportaba la app con guard `require.main`).
- **`maxDuration: 60`** — antes no fijable con `builds`: una edición con muchos empleados podía morir por timeout a mitad de escritura (H2). Con los lotes de v1.12.0 ninguna escritura real se acerca, pero el cinturón queda puesto.
- **Catch-all SPA a `/index.html`** (antes `/dist/index.html`): con `outputDirectory`, los estáticos se sirven desde la raíz del deployment — conservar el destino viejo habría dejado los deep-links en blanco (riesgo R2 del análisis adversarial).
- **Headers de cache nuevos** para `manual.html` (1 h), logos y favicon (24 h) — antes solo `/assets/` tenía cabeceras.
- Sin `regions` (iad1 correcto — BE-16) y sin `engines` (la versión de Node la fija el setting del proyecto en ambos formatos: misma antes y después).

## Verificación (preview del PR #3, con Protection Bypass for Automation)

- `/api/health` 200 JSON · SPA en `/` y en deep-link inexistente · assets `immutable` · `manual.html`/logo con los headers nuevos · `/api/*` con `private, no-cache` · `/api/noexiste` → 401 JSON **de la app** (el rewrite entrega el path original a Express) · app montada completa en navegador headless (login con marca, cero errores JS).
- **Fluid Compute NO se activa en este deploy** — es un toggle de dashboard aparte y reversible; antes de activarlo, auditar el estado module-level compartido (cache, rate limiter, idempotencia — R4).

## Post-merge

Re-verificado en app.copuno.com: health, SPA, deep-links, 401 de la app y cabeceras.
