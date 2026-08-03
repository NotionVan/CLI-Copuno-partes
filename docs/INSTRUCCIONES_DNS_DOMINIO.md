# Instrucciones DNS — app.copuno.com

**Destinatario:** administrador del dominio `copuno.com`
**Solicita:** Javi Collado (NotionVan)
**Fecha:** 2026-07-28
**Decisión de fondo:** [ADR-005](./adr/ADR-005-dominio-y-espacio-de-nombres.md)

> Este documento es el que se envía al cliente. Sustituye a la versión anterior, que pedía
> `partesobra.copuno.com` — subdominio que nunca llegó a crearse (a 2026-07-28 resuelve
> `NXDOMAIN`) y que queda **descartado**.

---

## Qué hay que hacer

Crear **un único registro DNS** en `copuno.com`:

| Campo | Valor |
|---|---|
| Tipo | `CNAME` |
| Nombre / Host | `app` |
| Valor / Destino | `cname.vercel-dns.com` |
| TTL | `3600` (o el que ofrezca el panel por defecto) |

Resultado: `app.copuno.com` → `cname.vercel-dns.com`

Eso es todo. No hay que tocar ningún otro registro.

---

## Estado actual del DNS (verificado 2026-07-28)

- **Servidores DNS:** `dns1.servidoresdns10.com` / `dns2.servidoresdns10.com`
  → el panel es el de **Hostalia / Acens**.
- `copuno.com` (apex) → `2.139.200.104` — web corporativa. **No se toca.**
- `www.copuno.com` → CNAME al apex. **No se toca.**
- **No hay registros CAA** → Vercel podrá emitir el certificado SSL sin configuración adicional.
- `app.copuno.com` → no existe. Libre.

El cambio es **puramente aditivo**: se añade un subdominio nuevo. La web principal de Copuno y
el correo (`@copuno.com`) no se ven afectados en absoluto, porque no se modifica ningún registro
existente ni los `MX`.

---

## Por qué `app` y no `partes`

La aplicación de partes de trabajo es el primer módulo de una plataforma interna que va a crecer
(vehículos/flota, y lo que venga después). Con un único subdominio, cada módulo nuevo es una ruta:

```
app.copuno.com/partes        ← gestión de partes de trabajo
app.copuno.com/vehiculos     ← módulo de flota (en preparación)
app.copuno.com/almacen       ← futuro
```

Ventajas para Copuno:

- **Una sola petición de DNS, hoy, y nunca más.** Los módulos futuros no requieren volver a
  tocar la configuración del dominio.
- **Un solo usuario y contraseña para todo.** El acceso se va a implementar con login propio por
  email y contraseña; al compartir dominio, el trabajador se identifica una vez y entra a todos
  los módulos. Con subdominios separados tendría que loguearse en cada uno.
- **Un solo certificado SSL**, renovado automáticamente por Vercel.

---

## Cómo hacerlo en el panel de Hostalia / Acens

1. Entrar al panel de control → **Dominios** → `copuno.com` → **Gestión DNS** (o "Editar zona DNS").
2. **Añadir registro.**
3. Rellenar:
   - Tipo: `CNAME`
   - Host / Nombre: `app`
   - Apunta a / Destino: `cname.vercel-dns.com`
   - TTL: `3600`
4. Guardar.

Si el panel exige el punto final en el destino, escribir `cname.vercel-dns.com.` (con punto).
Si el panel no acepta `CNAME` y obliga a un registro `A`, avisar a Javi: existe alternativa con
IP fija, pero el `CNAME` es preferible porque sobrevive a cambios de infraestructura de Vercel.

---

## Verificación

La propagación suele tardar entre 5 minutos y 2 horas (máximo 24-48 h).

```bash
nslookup app.copuno.com
```

Debe devolver `cname.vercel-dns.com` o una IP de Vercel (`76.76.21.x`).

Cuando resuelva, Javi completa el alta en Vercel y confirma que
**https://app.copuno.com** carga con candado (SSL válido).

---

## Preguntas frecuentes

**¿Afecta a la web de copuno.com?**
No. Solo se añade un subdominio nuevo; no se modifica ningún registro existente.

**¿Afecta al correo @copuno.com?**
No. El correo depende de los registros `MX`, que no se tocan.

**¿Se puede deshacer?**
Sí, borrando el registro. El efecto es inmediato salvo caché de TTL.

**¿Hay coste?**
No. El subdominio está incluido en el dominio ya contratado, y el certificado SSL lo emite
Vercel gratuitamente.

---

## Checklist

- [x] Registro `CNAME app → cname.vercel-dns.com` creado en el panel de Hostalia/Acens *(el administrador, ≈30/07)*
- [x] `nslookup app.copuno.com` resuelve *(verificado 02/08)*
- [x] Dominio añadido en Vercel → Settings → Domains *(03/08 09:20)*
- [x] Certificado SSL emitido (candado en el navegador) *(03/08, ~30 s después; Let's Encrypt, válido hasta el 01/11/2026)*
- [x] README / CLAUDE.md / AGENTS.md actualizados con el dominio real *(03/08)*
- [ ] `ALLOWED_ORIGINS=https://app.copuno.com` en Vercel ⬅️ **pendiente**, va con la activación del login
- [ ] `@regression-checker` sobre firma, PDF y sync Notion
- [ ] **App migrada de `/` a `/partes`** ⬅️ **no hecha y no urgente** — ver "Estado del espacio de nombres" abajo

---

## Estado del espacio de nombres (03/08/2026)

**El dominio está listo; el espacio de nombres del ADR-005, no.** Hoy:

| URL | Responde |
|---|---|
| `https://app.copuno.com/` | ✅ 200 — la app de partes |
| `https://app.copuno.com/partes` | ❌ 404 |

La app **no tiene router**: `react-router-dom` está en `package.json` pero no se usa; `vercel.json`
manda todo lo que no sea `/api/*` al mismo `index.html`, y el frontend renderiza siempre la misma
pantalla. Servir en `/partes` no es cambiar un enlace: hay que introducir enrutado real.

**Mientras haya un solo módulo, migrar no aporta nada al usuario y sí tiene coste** (enlaces que la
gente ya haya guardado, `firma-parte.html`, `ALLOWED_ORIGINS`, documentación). El momento natural
de hacerlo es **cuando entre el segundo módulo** (vehículos), que es cuando el portal en `/` empieza
a tener sentido. Hasta entonces: **repartir la URL raíz**.
