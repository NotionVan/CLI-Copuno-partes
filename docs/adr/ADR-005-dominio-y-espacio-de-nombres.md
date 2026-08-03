# ADR-005 — Dominio propio y espacio de nombres de la plataforma

- **Fecha:** 2026-07-28
- **Estado:** Vigente — **dominio ejecutado (2026-08-03); espacio de nombres NO ejecutado** (ver "Estado de ejecución" al final)
- **Autor:** Javi Collado
- **Relacionado con:** [ADR-003](./ADR-003-supabase-destino-migracion.md) (Supabase como destino, incluye auth)
- **Extendido por:** [ADR-006](./ADR-006-autenticacion-unica-autorizacion-por-modulo.md) (2026-07-29: confirma `app`, un único proyecto Supabase para toda la plataforma y autorización por módulo — el portal en `/` muestra a cada usuario sus módulos)

---

## Contexto

La aplicación de gestión de partes se sirve hoy desde la URL por defecto de Vercel:
`https://copuno-gestion-partes.vercel.app/`.

Se había documentado `partesobra.copuno.com` como dominio de producción (README, CLAUDE.md,
[INSTRUCCIONES_DNS_DOMINIO.md](../INSTRUCCIONES_DNS_DOMINIO.md)), pero **ese subdominio nunca
llegó a darse de alta**: a 2026-07-28 resuelve `NXDOMAIN`. La documentación describía una
intención, no un hecho. Consecuencia práctica: no hay usuarios, marcadores ni integraciones
apuntando a él, así que la decisión se toma en terreno limpio.

Al mismo tiempo confluyen dos cosas que obligan a decidir el espacio de nombres **ahora** y no
cuando ya haya tres apps desplegadas:

1. **El sistema va a crecer.** El módulo de vehículos/flota está en fase de propuesta, y hay
   más candidatos en el horizonte (almacén, portal del empleado, exportaciones).
2. **Va a haber login propio con Supabase Auth** (email + contraseña). La sesión se materializa
   en cookies/almacenamiento **ligados al origen**, y el origen lo define el dominio. Elegir mal
   aquí significa o bien re-loguearse en cada módulo, o bien montar SSO entre subdominios.

## Opciones evaluadas

### A) Un subdominio por aplicación

```
partes.copuno.com
vehiculos.copuno.com
almacen.copuno.com
```

- ✅ Aislamiento total entre apps; cada una puede desplegarse y caerse por separado.
- ❌ Cada app nueva = alta DNS con el cliente (dependencia externa, días de espera) + certificado.
- ❌ **Sesión no compartida.** Con Supabase Auth, cada subdominio es un origen distinto: el usuario
  se loguearía una vez por módulo. Compartir sesión exigiría cookies de dominio padre
  (`.copuno.com`) y configuración específica — trabajo extra y superficie de riesgo, ya que
  `copuno.com` aloja además la web corporativa.
- ❌ Nombres cerrados en el tiempo: `partes.` no admite que el módulo crezca de alcance.

### B) Un dominio único con rutas por módulo — **elegida**

```
app.copuno.com/partes
app.copuno.com/vehiculos
app.copuno.com/almacen
```

- ✅ Un solo registro DNS y un solo certificado, **para siempre**. Añadir un módulo no requiere
  volver a pedirle nada al cliente.
- ✅ **Un solo origen ⇒ una sola sesión de Supabase.** El usuario se loguea una vez y navega entre
  módulos. Es el encaje natural con el login por email/contraseña previsto.
- ✅ Un único punto donde vive el menú/portal de la plataforma (`app.copuno.com/`).
- ✅ `ALLOWED_ORIGINS`, CORS y las Redirect URLs de Supabase se configuran una vez con un valor.
- ✅ El nombre `app` no envejece: no compromete la plataforma a un dominio funcional concreto.
- ❌ Acoplamiento de despliegue: todos los módulos comparten proyecto/hosting, o exigen que el
  routing por ruta se resuelva en la capa de hosting. Asumible — el volumen de Copuno no justifica
  aislamiento operativo entre módulos.

### C) Dominio funcional (`intranet.` / `operaciones.copuno.com`)

Misma arquitectura que B, distinto rótulo. Descartado por preferencia de neutralidad: `intranet`
sugiere red interna (falso, es una app pública autenticada) y `operaciones` presupone un
departamento.

## Decisión

**`app.copuno.com` como único dominio de la plataforma interna de Copuno, con un módulo por ruta
de primer nivel.**

- La app actual pasa a vivir en **`app.copuno.com/partes`**.
- `app.copuno.com/` queda reservado como portal/selector de módulos (y, con Supabase, como
  destino de login).
- **Se abandona `partesobra.copuno.com`.** No se pide, no se configura, no se redirige: nunca
  existió, no hay nada que preservar.
- La URL `*.vercel.app` sigue funcionando y se mantiene como acceso de respaldo y para previews;
  no se comunica a los usuarios finales.

### Convención de nombres para módulos futuros

Una palabra, minúsculas, sin tildes ni ñ, sin guiones bajos, en español y en singular o plural
según se lea mejor en voz alta: `/partes`, `/vehiculos`, `/almacen`. El criterio de desempate es
que un jefe de obra pueda dictarla por teléfono sin deletrear.

## Consecuencias

### Positivas
- Escalar la plataforma deja de depender del calendario del administrador DNS del cliente.
- El login único con Supabase sale gratis por construcción, no como funcionalidad a desarrollar.
- Desaparece la discrepancia histórica de dominios en la documentación
  (`gestionpartes.` vs `partesobra.` vs Vercel), que ya estaba catalogada como gotcha.

### Negativas / trabajo que genera
- **La app hoy se sirve en `/`, no en `/partes`.** Moverla exige tocar el `base` de Vite, el
  catch-all SPA de [server.js](../../server.js) y las rutas de assets en
  [vercel.json](../../vercel.json). Es trabajo real, no un alias DNS.
- Hay que revisar toda referencia hardcodeada a la URL de la app antes del corte, con atención
  especial al **flujo de firma**: la propiedad `Firmar` de Notion es una fórmula que construye una
  URL externa (`copuno.com/es/notion/?parteId=...`) y los escenarios Make escriben sobre ella. Un
  cambio de dominio sin verificar ese tramo puede romper la firma digital, que es flujo crítico.
- `ALLOWED_ORIGINS` debe fijarse a `https://app.copuno.com` en Vercel al completar el corte.
- Al integrar Supabase Auth, **Site URL y Redirect URLs** deben apuntar a `https://app.copuno.com`.
  Conviene dejar también la URL de Vercel en Redirect URLs mientras se desarrolla.

### Riesgo asumido
Un incidente en la plataforma afecta a todos los módulos a la vez. Aceptado: con un solo
desarrollador y el volumen actual, el aislamiento operativo entre módulos costaría más de lo que
protege.

## Ejecución

1. **Cliente:** crear el registro `CNAME app → cname.vercel-dns.com` en el panel DNS de
   `copuno.com`. Instrucciones en [INSTRUCCIONES_DNS_DOMINIO.md](../INSTRUCCIONES_DNS_DOMINIO.md).
2. **Javi:** añadir el dominio en Vercel → Settings → Domains y esperar la emisión del certificado.
3. **Javi:** migrar la app de `/` a `/partes` (Vite `base`, catch-all, assets) y verificar.
4. **Javi:** fijar `ALLOWED_ORIGINS=https://app.copuno.com`.
5. **Javi:** pasar `@regression-checker` sobre firma, PDF y sync Notion antes de dar el corte por
   bueno.
6. **Javi:** actualizar README, CLAUDE.md y AGENTS.md con el dominio real (ya no con el previsto).

---

## Estado de ejecución (2026-08-03)

| Paso | Estado |
|---|---|
| 1. CNAME en el panel del cliente | ✅ hecho por el administrador (≈30/07) |
| 2. Alta del dominio en Vercel + certificado | ✅ **03/08 09:20** — Let's Encrypt, `https://app.copuno.com` responde 200 |
| 3. Migrar la app de `/` a `/partes` | ⬜ **NO hecha** — ver abajo |
| 4. `ALLOWED_ORIGINS` | ⬜ pendiente, va con la activación del login |
| 5. `@regression-checker` (firma, PDF, sync) | ⬜ pendiente |
| 6. Actualizar README / CLAUDE.md / AGENTS.md | ✅ 03/08 |

**Lo que hay hoy**: `app.copuno.com/` sirve la app de partes; **`app.copuno.com/partes` devuelve
404**. Es decir, el dominio de este ADR existe pero **su espacio de nombres todavía no**. Cuidado
al citar la URL: durante meses la doc dio por buenos dos subdominios que nunca se crearon, y el
mismo error se repite un nivel más abajo si se reparte `/partes` antes de que exista.

### Por qué la migración a `/partes` sigue sin hacerse — y cuándo tocará

No es pereza: **con un solo módulo, migrar no le da nada al usuario y sí cuesta**. El trabajo real
(además de lo ya listado en "Negativas"):

1. **Introducir enrutado, que hoy no existe.** `react-router-dom` está en `package.json` pero **no
   se usa**: no hay `BrowserRouter` en el código. `vercel.json` manda todo lo que no es `/api/*` al
   mismo `index.html` y el frontend pinta siempre la misma pantalla. Servir en `/partes` no es
   reescribir una ruta: es meter enrutado de verdad.
2. **`base` de Vite y rutas de assets**, o los `.js`/`.css` se piden desde la raíz y la página sale
   en blanco — el fallo clásico de este cambio.
3. **Enlaces ya repartidos.** Bartomeu tiene la URL desde el 28/07 y el resto la recibirá al activar
   el login. Migrar sin dejar `/` redirigiendo a `/partes` rompe lo que la gente tenga guardado.
4. **Verificar el flujo de firma** (`firma-parte.html` + fórmula `Firmar` de Notion + escenarios
   Make), que es crítico y vive fuera de la app.

**Momento natural: cuando entre el segundo módulo** (vehículos/flota). Ahí `/partes` deja de ser
cosmética —hace falta distinguir módulos— y el portal de `/` pasa a tener contenido. Hacerlo antes
es pagar el coste sin cobrar el beneficio.

### El portal de `/`: qué es y qué no

`app.copuno.com/` queda reservado como **selector de módulos**, y el [ADR-006](./ADR-006-autenticacion-unica-autorizacion-por-modulo.md)
ya define de dónde saca lo que muestra: la tabla `accesos_modulo` dice a qué módulos entra cada
usuario, y el portal pinta una tarjeta por cada uno.

Dos precisiones que conviene no perder:

- **El portal es UX, no seguridad** (punto 6 del ADR-006). Ocultar una tarjeta no protege nada:
  cada módulo debe validar en su propio servidor que el JWT pertenece a alguien con acceso. Hoy el
  middleware **solo valida el JWT** y no mira `accesos_modulo` (`src-server/middleware/auth.js`
  lo deja anotado como pendiente) — con un solo módulo da igual, con dos no.
- **No es un "router" en el sentido de infraestructura.** Todos los módulos comparten origen, así
  que es una pantalla de la propia aplicación, no un proxy ni un servicio aparte. Lo que hace que
  esto funcione es justamente lo que decidió este ADR: **un solo origen ⇒ una sola sesión**.
