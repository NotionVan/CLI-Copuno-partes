# Changelog v1.13.4 — S1: cabeceras de seguridad en el documento HTML

**Fecha:** 2026-08-18

## El defecto

`helmet` se aplica en Express, es decir **solo a `/api/*`**. Los archivos estáticos
—incluido el `index.html` que carga y ejecuta toda la aplicación— los sirve la
plataforma de despliegue directamente, sin pasar por Express.

Verificado contra producción:

```
curl -sI https://app.copuno.com/        → solo strict-transport-security
curl -sI https://app.copuno.com/api/health → CSP, X-Frame-Options, HSTS completo
```

El documento que ejecuta el JavaScript, mantiene la sesión y desde el que se firma un
parte **no tenía protección anti-enmarcado**. Un tercero podía cargar la aplicación en
un marco invisible sobre otra página y provocar pulsaciones no intencionadas
(*clickjacking*) sobre acciones como Enviar datos.

## El arreglo

Cuatro cabeceras aplicadas a todas las rutas en `vercel.json`:

| Cabecera | Valor | Qué evita |
|---|---|---|
| `X-Frame-Options` | `SAMEORIGIN` | Enmarcado desde otro dominio |
| `X-Content-Type-Options` | `nosniff` | Que el navegador reinterprete el tipo de un recurso |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Fuga de rutas internas al navegar fuera |
| `Permissions-Policy` | cámara, micrófono y ubicación denegados | Acceso a periféricos que la app no usa |

## Lo que NO entra, y por qué

**Política de contenido (CSP) para el HTML.** Es la protección más valiosa que falta,
pero exige declarar los orígenes permitidos —el proveedor de identidad
(`*.supabase.co`) y la telemetría de plataforma— y verificar que nada se rompe. A seis
días de la congelación previa a la demostración, el riesgo de dejar la aplicación sin
poder iniciar sesión por una directiva mal cerrada supera al beneficio.

Queda anotado como **S2** en deuda técnica, con los orígenes ya identificados:
`connect-src 'self' https://cuwtneprjbvumfjycnmn.supabase.co`.

## Verificación

Cabeceras comprobadas en producción tras el despliegue. Suite 66/66.
