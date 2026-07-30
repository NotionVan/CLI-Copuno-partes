# v1.9.0 — Autenticación de plataforma (ADR-006, resuelve H1)

**Fecha:** 2026-07-29 · **Rama:** `feature/auth-supabase` (merge a `master` coordinado con Efrén — al desplegar, quien no tenga usuario no entra)

## Qué cambia

La app pasa de URL pública a plataforma con login. Supabase Auth (proyecto
"Partes de Obra", org Grupo Copuno) autentica; el servidor verifica el JWT en
local en cada petición.

### Frontend
- **Pantalla de login** (email + contraseña, único método — ADR-006) en
  [src/auth/AuthGate.jsx](src/auth/AuthGate.jsx), envolviendo la app en
  [src/main.jsx](src/main.jsx). Incluye "¿Has olvidado tu contraseña?" (email
  con enlace de reset) y pantalla de nueva contraseña (flujo `PASSWORD_RECOVERY`).
- **Cliente Supabase** en [src/lib/supabase.js](src/lib/supabase.js) — `null`
  sin variables de entorno (dev/mock sigue funcionando sin login).
- **Interceptores** en [src/services/notionService.js](src/services/notionService.js):
  el JWT vigente viaja en `Authorization` en toda llamada `/api/*`; un `401`
  del servidor cierra sesión y vuelve al login.

### Backend
- **Middleware JWT** en [src-server/middleware/auth.js](src-server/middleware/auth.js),
  montado en `/api/*` (server.js) con `/api/health` exento (lo usa el banner de
  versión). Verificación **en local** vía JWKS cacheado (sin llamada de red por
  petición); soporta fallback HS256 por si el proyecto usara JWT legacy.
  Token ausente/inválido → `401` antes de tocar Notion o Make.
- `req.usuario` (`id`, `email`) queda disponible para la futura autorización
  por módulo (`accesos_modulo`).

### Fuera de perímetro (sin cambios)
- Flujo de firma (`firma-parte.html` → Make, no pasa por `/api/*`).
- Saneado económico y resto de endpoints.

## Variables de entorno nuevas (Vercel + .env)

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | `https://cuwtneprjbvumfjycnmn.supabase.co` |
| `VITE_SUPABASE_URL` | ídem |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_ykXzh316ec5hhLXyVtjYjA_vEBkL7uk` (pública por diseño) |

Sin `SUPABASE_URL` el servidor avisa y deja pasar (modo desarrollo); sin las
`VITE_*` el frontend no muestra login.

## Dependencias nuevas
- `@supabase/supabase-js` (cliente auth frontend) · `jose` (verificación JWT servidor)

## Pendiente antes del corte a producción
- **Reapuntar Site URL / Redirect URLs ANTES de fusionar y borrar la rama.** Durante el
  desarrollo apuntan al alias de rama
  (`copuno-gestion-partes-git-feature-auth-3911d1-copunos-projects.vercel.app`, fijado el
  2026-07-30; el valor previo era `http://localhost:3000`). Ese alias **muere al borrar la
  rama** y con él dejarían de resolver los enlaces de invitación y de reset de contraseña.
  Destino: la URL de producción, y `https://app.copuno.com` cuando exista el DNS (ADR-005).
- Añadir las tres variables `SUPABASE_*` al scope **Production** de Vercel (hoy solo en Preview):
  hasta que estén, producción sigue sin login — deliberado, para que el corte sea una decisión
  explícita y no un efecto colateral del merge.
- Altas piloto (Javi + Efrén) y E2E en preview.
- Decidir operativa de altas/bajas y ventana de corte (punto 3 del ADR).
- `@regression-checker` sobre firma, PDF y sync Notion.
