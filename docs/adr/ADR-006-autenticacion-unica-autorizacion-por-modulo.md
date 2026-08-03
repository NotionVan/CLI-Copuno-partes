# ADR-006 — Autenticación única de plataforma y autorización por módulo

- **Fecha:** 2026-07-29
- **Estado:** Vigente (aprobado; ejecución en curso)
- **Autor:** Javi Collado
- **Relacionado con:** [ADR-003](./ADR-003-supabase-destino-migracion.md) (Supabase como destino), [ADR-005](./ADR-005-dominio-y-espacio-de-nombres.md) (dominio único con módulo por ruta)
- **Resuelve:** H1 de [DEUDA_TECNICA](../DEUDA_TECNICA.md) (ningún endpoint `/api/*` autenticado) — junto con el middleware pendiente en la app

---

## Contexto

H1 lleva abierto desde 2026-05-11: cualquiera con la URL puede listar plantilla (DNI, teléfonos),
partes con horas y emails de jefes, y disparar el webhook de Make. Es dato personal bajo RGPD.
La decisión de resolverlo con Supabase Auth (no con `X-API-Key`) estaba tomada desde mayo
("H1 bloqueado por Supabase"); lo que faltaba era la arquitectura concreta.

Novedades que obligan a decidirla ahora:

1. **El cliente tiene cuenta Supabase propia**: organización **Grupo Copuno** (plan Free),
   owner `notionvan@copuno.com`. La plataforma se monta ahí, **no** en la cuenta personal de
   NotionVan. Proyecto: **"Partes de Obra"** (`cuwtneprjbvumfjycnmn`), región `eu-west-1`
   (Irlanda). Se valoró recrearlo en `eu-west-3` (París, "pareja con Vercel `cdg1`") y se
   **descartó el 2026-07-29**: el JWT se valida en local en el servidor (sin llamada de red por
   petición), ambas regiones son UE a efectos de RGPD y el beneficio de latencia era marginal.
   Decisión cerrada — no mover.
   - 🔎 **Corrección del 2026-08-03**: esa "pareja con Vercel `cdg1`" **no existe** — la función
     de Vercel se ejecuta en **`iad1` (Washington)**, no en `cdg1` (verificado con
     `x-vercel-id: cdg1::iad1::…`; el `cdg1` que aparecía es el edge que recibe la petición, no
     donde corre el código). **La decisión no cambia** —sigue sin haber llamada de red por
     petición, que es el motivo real— pero uno de sus argumentos citaba un emparejamiento
     inexistente. Se deja escrito para que nadie lo reutilice como premisa.
2. **Las bases de usuarios de los módulos futuros son disjuntas.** Los usuarios de vehículos o
   del portal de empleado no son los jefes de obra de partes. Se planteó un proyecto Supabase
   por módulo para reflejarlo.
3. **La visión de producto es un portal único**: el usuario entra en `app.copuno.com`, se
   identifica una vez, y ve las tarjetas de los módulos a los que tiene acceso
   (`/partes`, `/vehiculos`, `/almacen`, `/empleado`, …).
4. **Restricción del dashboard de Supabase (verificado 2026-07-29):** el provider Email es un
   único interruptor que habilita a la vez password, magic link y OTP. No existe toggle para
   dejar solo password.

## Opciones evaluadas

### A) Un proyecto Supabase por módulo

- ✅ Bases de usuarios físicamente separadas.
- ❌ **Incompatible con el portal único**: no se puede saber contra qué proyecto autenticar a un
  usuario hasta saber quién es — que es justo lo que el login debe responder.
- ❌ Varios SDK/sesiones conviviendo en el mismo origen (`app.copuno.com`): logout, navegación y
  estado compartido se vuelven casos especiales.
- ❌ Free tier: máximo 2 proyectos activos por organización — la plataforma prevé ≥3 módulos.
- ❌ Invalida la ventaja decisiva por la que ADR-005 eligió dominio único ("un solo origen ⇒ una
  sola sesión").

### B) Un único proyecto + autorización por módulo — **elegida**

La separación de poblaciones es un problema de **autorización**, no de autenticación:

```
auth.users            (una sola base: todo el que puede entrar en la plataforma)
  └── perfiles        (espejo 1:1, lo mantiene un trigger)
        └── accesos_modulo (usuario_id, modulo, rol) — sin fila = sin acceso
```

Un usuario de vehículos no tiene fila `partes` y viceversa. Poblaciones disjuntas si se quiere;
y la persona que necesite dos módulos (dirección, administración) es una fila más, no una
segunda cuenta.

## Decisión

1. **Un único proyecto Supabase** ("Partes de Obra", org Grupo Copuno) da servicio de
   autenticación a **toda** la plataforma `app.copuno.com`, presente y futura.
2. **Email + contraseña** como único método expuesto. Magic link y OTP no se pueden desactivar
   en el dashboard → **no se exponen en el frontend** y el registro público está **cerrado**
   ("Allow new users to sign up" OFF). Con altas manuales, la vía residual de magic link solo
   autenticaría al dueño legítimo del buzón — riesgo aceptado.
3. **Confirm email ON**: el alta manual envía invitación y cada usuario fija su contraseña.
   Nadie maneja contraseñas ajenas en claro.
4. **Contraseñas**: mínimo 10 caracteres, letras y dígitos. "Leaked password protection" es de
   plan Pro — limitación aceptada y documentada.
5. **Autorización por módulo** en `public.accesos_modulo`. Claves de módulo = rutas de primer
   nivel del ADR-005 (`partes`, `vehiculos`, `almacen`, `empleado`). Roles por módulo
   (partes: `jefe_obra` | `oficina` | `admin`; el resto definirá los suyos).
6. **El portal en `/` es UX, no seguridad**: pinta las tarjetas según `accesos_modulo`, pero
   cada módulo valida en servidor (middleware sobre sus `/api/*`) que el JWT pertenece a un
   usuario con acceso a ese módulo.
7. **Hook de dominio `@copuno.com`: descartado.** El portal de empleado meterá usuarios sin
   buzón corporativo; la puerta real es el registro cerrado + alta manual.
8. **El flujo de firma queda fuera del perímetro**: [firma-parte.html](../firma-parte.html)
   vive en `copuno.com` (WordPress) y postea directamente a Make, sin tocar `/api/*`. El login
   no lo afecta. (La debilidad del `parteId` como única credencial de firma es un asunto del
   lado Make — familia E de [EDGE_CASES_MAKE](../EDGE_CASES_MAKE.md) — no de este ADR.)

## Consecuencias

### Positivas
- Login único para toda la plataforma por construcción (cumple ADR-005 sin trabajo extra).
- El Free tier deja de ser restricción: un proyecto, no uno por módulo.
- Añadir un módulo = añadir una clave al check de `accesos_modulo` y su middleware. Auth no se
  vuelve a tocar.
- H1 pasa a depender solo del middleware en la app (la infraestructura queda lista).

### Trabajo que genera
- Middleware de validación JWT en [server.js](../../server.js) + pantalla de login en la SPA.
- **Limpieza N1 previa al cruce email↔jefe de obra**: `Persona Autorizada` (Notion) contiene
  hoy 7 entradas mezcla de legacy/pruebas con un solo email interno real. Sin limpiarla, la
  autorización por obra no puede casar usuarios con jefes.
- Operativa de altas/bajas, duración de sesión y ventana de corte: **pendientes de decisión**
  (no bloquean el desarrollo; bloquean el corte a producción).
- Site URL / Redirect URLs: desarrollo contra la URL de Vercel; añadir `https://app.copuno.com`
  cuando el DNS exista (el ADR-005 ya contempla mantener ambas).

### Plan Supabase: seguir en Free por ahora (decidido 2026-07-30)

**No pedir a Copuno que contrate Pro todavía.** Free cubre el caso: los datos de negocio viven
en Notion, así que la BD de Supabase solo guarda cuentas y accesos por módulo (reconstruibles
reinvitando a la gente), el límite de usuarios activos sobra y el proyecto no se suspenderá por
inactividad al usarse a diario.

Lo que Free no da, por valor real decreciente: **control de sesión** (caducidad por inactividad,
sesión única — el argumento más defendible en obra: móviles compartidos o perdidos con sesión de
30 días), **protección de contraseñas filtradas**, copias diarias + retención de logs (poco valor
aquí) y soporte del proveedor.

**Disparador para plantear el upgrade:** el día que el login se active en producción para toda
la plantilla — ahí el control de sesión pasa de "estaría bien" a argumento de seguridad
presentable. Encaja en la conversación del módulo de Vehículos, cuando la plataforma deje de ser
una sola app. La cuenta es del cliente (org Grupo Copuno), así que **contratación y factura son
suyas directas**: no pasan por el retainer. Confirmar el precio vigente antes de citar cifra.

**Lo que sí conviene pedirles ya, y es gratis: SMTP propio.** El SMTP compartido de Supabase
limita a ~2-4 emails/hora, único cuello de botella operativo real (altas masivas de plantilla, o
varios resets de contraseña el mismo día). No se arregla pagando Supabase.

### Riesgo asumido
- **Un origen, una sesión**: un XSS en cualquier módulo comprometería la sesión de toda la
  plataforma. Mitigación: `helmet` ya activo, revisión de prácticas en cada módulo nuevo.
- El nombre del proyecto Supabase ("Partes de Obra") no refleja su alcance real de plataforma.
  Decisión consciente del autor: **no crear un segundo proyecto** cuando llegue otro módulo por
  mucho que el nombre lo sugiera — este ADR es el recordatorio.

## Ejecución

1. ✅ Config de auth en el dashboard (vía Claude en Chrome; **completada de verdad el
   2026-07-29 tarde** — la primera sesión la dejó a medias pese a darse por hecha: el signup
   seguía ON y el mínimo de contraseña en 6): provider Email, password ≥10 con letras y
   dígitos, signup cerrado, Confirm email ON. Sesiones: JWT 3600 s, detección de refresh
   tokens comprometidos ON; time-box/inactivity son de plan Pro.
2. ✅ SQL base aplicado (2026-07-29, SQL Editor) y versionado en
   [supabase/migrations/](../../supabase/migrations/20260729120000_base_auth_perfiles_accesos.sql):
   `perfiles` + `accesos_modulo` + triggers + RLS. Verificado por API: tablas, RLS, CHECK y FKs
   correctos. Pendiente menor: aplicar
   [la revocación de EXECUTE](../../supabase/migrations/20260729200000_revoke_execute_funciones_trigger.sql)
   sobre las funciones de trigger (WARN del advisor) y aclarar el origen de
   `public.rls_auto_enable()` (función no creada por nuestras migraciones).
   Nota: el hook **Before User Created** está disponible en Free — opción viable si algún día
   se quiere cerrar del todo la vía residual de magic link/OTP.
3. ⏳ App: pantalla de login (solo password), middleware JWT en `/api/*` (excepción:
   `/api/health`), inyección del token en [notionService.js](../../src/services/notionService.js).
4. ⏳ Altas piloto y prueba E2E en preview de Vercel.

   **Gotcha operativo (detectado 2026-07-30 en el primer piloto):** los enlaces de invitación y
   de recuperación son de **un solo uso** y caducan con el *Email OTP Expiration* del proyecto,
   **1 hora por defecto**. Un jefe de obra que abra el correo por la tarde se encuentra
   `otp_expired` y no puede entrar. Además, algunos gestores de correo "pre-abren" los enlaces al
   escanearlos y **consumen el token antes de que el usuario pulse**.

   Antes del despliegue a la plantilla:
   - Subir *Email OTP Expiration* (Authentication → Providers → Email) a 24 h.
   - Contar con que la recuperación autoservicio (`¿Has olvidado tu contraseña?`) es la vía
     normal de rescate, no la excepción: **no reinvitar** cuando un enlace caduque.
   - Encaja con el SMTP propio pendiente: cada rescate consume cupo del límite de ~2-4 emails/h
     del SMTP compartido de Free.
5. ⏳ Decidir operativa de altas/bajas, sesión y ventana de corte (punto 3 pendiente).
6. ⏳ `@regression-checker` sobre firma, PDF y sync Notion antes de activar en producción.
