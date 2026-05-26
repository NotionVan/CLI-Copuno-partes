# Guía de Despliegue en Vercel

Esta guía detalla el proceso completo para desplegar la aplicación de Gestión de Partes en Vercel, tanto en una URL pública temporal como en el dominio personalizado del cliente.

## Tabla de Contenidos

- [Requisitos Previos](#requisitos-previos)
- [Preparación del Proyecto](#preparación-del-proyecto)
- [Variables de Entorno](#variables-de-entorno)
- [Despliegue Inicial (URL Pública)](#despliegue-inicial-url-pública)
- [Configuración de Dominio Personalizado](#configuración-de-dominio-personalizado)
- [Verificación Post-Despliegue](#verificación-post-despliegue)
- [Monitoreo y Logs](#monitoreo-y-logs)
- [Troubleshooting](#troubleshooting)

---

## Requisitos Previos

### 1. Cuenta de Vercel
- Crear cuenta gratuita en [vercel.com](https://vercel.com)
- Conectar con tu cuenta de GitHub/GitLab/Bitbucket

### 2. Herramientas
```bash
# Instalar Vercel CLI (opcional pero recomendado)
npm install -g vercel
```

### 3. Datos Necesarios
- Token de Notion API
- URL del webhook de Make.com
- Acceso al DNS del dominio (para configuración personalizada)

---

## Preparación del Proyecto

El proyecto ya está configurado con los siguientes archivos:

### 1. `vercel.json`
Configuración principal de Vercel en la raíz del proyecto:

```json
{
  "version": 2,
  "builds": [
    {
      "src": "package.json",
      "use": "@vercel/static-build",
      "config": { "distDir": "dist" }
    },
    {
      "src": "server.js",
      "use": "@vercel/node"
    }
  ],
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "/server.js"
    },
    {
      "source": "/(.*)",
      "destination": "/dist/index.html"
    }
  ],
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }]
    },
    {
      "source": "/assets/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    }
  ],
  "regions": ["cdg1"]
}
```

### 2. `.vercelignore`
Archivos que se excluyen del despliegue (ya configurado).

### 3. `package.json`
Script `vercel-build` añadido para el build automático.

---

## Variables de Entorno

### Configuración en Vercel Dashboard

1. Acceder a tu proyecto en Vercel
2. Ir a **Settings** → **Environment Variables**
3. Añadir las siguientes variables:

#### Variables REQUERIDAS

| Variable | Valor | Entorno | Descripción |
|----------|-------|---------|-------------|
| `NOTION_TOKEN` | `ntn_...` | Production, Preview, Development | Token de integración de Notion |
| `PARTES_DATOS_WEBHOOK_URL` | `https://hook.eu2.make.com/...` | Production, Preview | URL del webhook de Make.com |
| `NODE_ENV` | `production` | Production | Entorno de ejecución |

#### Variables OPCIONALES (Recomendadas)

| Variable | Valor por Defecto | Descripción |
|----------|-------------------|-------------|
| `PORT` | `3001` | Puerto (Vercel lo asigna automáticamente) |
| `CACHE_TTL_MS` | `5000` | TTL de caché en milisegundos |
| `PARTES_WEBHOOK_TIMEOUT_MS` | `10000` | Timeout del webhook |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Ventana de rate limiting (15 min) |
| `RATE_LIMIT_MAX` | `100` | Máximo de peticiones por ventana |

#### Variables de SEGURIDAD (Para Dominio Personalizado)

| Variable | Valor | Cuándo configurar |
|----------|-------|-------------------|
| `ALLOWED_ORIGINS` | `https://partesobra.copuno.com` | Al configurar dominio personalizado |

### Configuración mediante CLI

```bash
# Añadir variable de entorno
vercel env add NOTION_TOKEN production

# Listar variables
vercel env ls

# Eliminar variable
vercel env rm NOTION_TOKEN production
```

---

## Despliegue Inicial (URL Pública)

### Opción 1: Desde el Dashboard de Vercel (Recomendado)

1. **Importar Proyecto**
   - Ir a [vercel.com/new](https://vercel.com/new)
   - Seleccionar "Import Git Repository"
   - Elegir el repositorio del proyecto
   - Click en "Import"

2. **Configurar Build**
   - **Framework Preset**: Vite
   - **Root Directory**: `./`
   - **Build Command**: `npm run vercel-build` (detectado automáticamente)
   - **Output Directory**: `dist` (detectado automáticamente)

3. **Configurar Variables de Entorno**
   - Añadir todas las variables listadas en la sección anterior
   - Marcar los entornos apropiados (Production, Preview, Development)

4. **Deploy**
   - Click en "Deploy"
   - Esperar a que termine el build (2-3 minutos)
   - Vercel generará una URL pública: `https://copuno-gestion-partes-xxx.vercel.app`

### Opción 2: Desde la CLI

```bash
# Navegar al directorio del proyecto
cd /ruta/al/proyecto

# Login en Vercel
vercel login

# Primer despliegue (modo interactivo)
vercel

# Seguir las instrucciones:
# - Set up and deploy? Yes
# - Which scope? Tu cuenta
# - Link to existing project? No
# - Project name? copuno-gestion-partes
# - Directory? ./
# - Build settings? Yes

# Desplegar a producción
vercel --prod
```

---

## Configuración de Dominio Personalizado

Una vez validado el despliegue en la URL pública, configurar el subdominio personalizado.

### 1. Añadir Dominio en Vercel

1. En el proyecto de Vercel, ir a **Settings** → **Domains**
2. Click en "Add Domain"
3. Introducir: `partesobra.copuno.com`
4. Vercel mostrará los registros DNS a configurar

### 2. Configurar DNS

Vercel proporcionará uno de estos métodos:

#### Método A: CNAME (Recomendado)
```
Type: CNAME
Name: gestionpartes
Value: cname.vercel-dns.com
```

#### Método B: A Record
```
Type: A
Name: gestionpartes
Value: 76.76.21.21
```

**Instrucciones para el administrador del dominio:**

1. Acceder al panel de control del proveedor DNS (ej: GoDaddy, Cloudflare, etc.)
2. Ir a la sección de gestión DNS para `copuno.com`
3. Añadir el registro CNAME según se indica
4. Guardar cambios

**Tiempo de propagación:** 24-48 horas (usualmente 10-30 minutos)

### 3. Actualizar Variables de Entorno

Una vez configurado el dominio:

```bash
# Actualizar ALLOWED_ORIGINS para restringir acceso
vercel env add ALLOWED_ORIGINS production
# Valor: https://partesobra.copuno.com,https://copuno-gestion-partes.vercel.app
```

O desde el Dashboard:
- Settings → Environment Variables
- Editar `ALLOWED_ORIGINS`
- Añadir: `https://partesobra.copuno.com,https://copuno-gestion-partes.vercel.app`

### 4. Re-desplegar

```bash
# Forzar nuevo despliegue con las nuevas variables
vercel --prod
```

---

## Verificación Post-Despliegue

### 1. Checklist de Funcionalidad

- [ ] **Página principal carga correctamente**
  ```bash
  curl -I https://partesobra.copuno.com
  # Debe retornar: HTTP/2 200
  ```

- [ ] **API responde**
  ```bash
  curl https://partesobra.copuno.com/api/health
  # Debe retornar: {"status":"ok","mode":"production"}
  ```

- [ ] **Assets se cargan**
  - Abrir DevTools → Network
  - Verificar que CSS, JS e imágenes cargan con 200

- [ ] **Conexión con Notion funciona**
  - Crear un nuevo parte
  - Verificar que se sincroniza con Notion

- [ ] **Webhook funciona**
  - Exportar un parte
  - Verificar en Make.com que se recibe el payload

### 2. Pruebas de Seguridad

- [ ] **HTTPS activo**
  ```bash
  curl -I https://partesobra.copuno.com | grep "HTTP/2"
  ```

- [ ] **Headers de seguridad presentes**
  ```bash
  curl -I https://partesobra.copuno.com | grep -E "(X-Frame-Options|X-Content-Type-Options|Strict-Transport-Security)"
  ```

- [ ] **Rate limiting funciona**
  ```bash
  # Hacer 101 peticiones rápidas
  for i in {1..101}; do curl https://partesobra.copuno.com/api/health; done
  # La petición 101 debe retornar 429 Too Many Requests
  ```

- [ ] **CORS configurado correctamente**
  ```bash
  curl -H "Origin: https://malicious-site.com" \
       -H "Access-Control-Request-Method: POST" \
       -X OPTIONS https://partesobra.copuno.com/api/partes
  # No debe retornar Access-Control-Allow-Origin si ALLOWED_ORIGINS está configurado
  ```

### 3. Pruebas de Performance

- [ ] **Lighthouse Score > 90**
  - Abrir Chrome DevTools → Lighthouse
  - Ejecutar audit en producción

- [ ] **TTL de caché funciona**
  - Verificar que los datos se actualizan según `CACHE_TTL_MS`

- [ ] **SSE (Server-Sent Events) funciona**
  - Abrir la aplicación
  - Verificar que los updates en tiempo real funcionan

---

## Monitoreo y Logs

### Acceder a Logs en Tiempo Real

#### Desde Dashboard
1. Ir a tu proyecto en Vercel
2. Click en **Deployments**
3. Seleccionar el despliegue activo
4. Click en **Functions** → **View Logs**

#### Desde CLI
```bash
# Ver logs en tiempo real
vercel logs https://partesobra.copuno.com --follow

# Ver logs de una función específica
vercel logs --output=raw --follow
```

### Métricas Importantes

- **Respuesta API**: Debería estar entre 100-500ms
- **Build Time**: ~2-3 minutos
- **Function Duration**: < 10s (límite de Vercel)
- **Bandwidth**: Monitorear según plan

### Alertas Recomendadas

Configurar en **Settings → Integrations**:
- Slack/Discord para notificaciones de despliegue
- Sentry para tracking de errores
- Uptime monitoring (ej: UptimeRobot, Pingdom)

---

## Troubleshooting

### Problema: Build Falla

**Error**: `Command "npm run vercel-build" exited with 1`

**Solución**:
```bash
# Verificar que el build funciona localmente
npm run build

# Verificar versiones de Node
# Vercel usa Node 18 por defecto
# Si necesitas otra versión, añadir en package.json:
{
  "engines": {
    "node": "18.x"
  }
}
```

### Problema: API retorna 500

**Error**: Internal Server Error al llamar `/api/*`

**Soluciones**:
1. Verificar logs en Vercel Dashboard
2. Verificar que `NOTION_TOKEN` está configurado
3. Verificar que las IDs de bases de datos son correctas
4. Comprobar que el webhook de Make.com responde

```bash
# Test del webhook
curl -X POST https://hook.eu2.make.com/YOUR_WEBHOOK_ID \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

### Problema: CORS Error

**Error**: `Access to fetch at '...' from origin '...' has been blocked by CORS`

**Solución**:
```bash
# Verificar que ALLOWED_ORIGINS incluye el dominio correcto
vercel env ls

# Si no está configurado, añadirlo
vercel env add ALLOWED_ORIGINS production
# Valor: https://partesobra.copuno.com
```

### Problema: Assets 404

**Error**: CSS/JS no se cargan (404)

**Solución**:
1. Verificar que `dist/` contiene los archivos
2. Verificar rutas en `vercel.json`
3. Limpiar caché de Vercel:
   ```bash
   vercel --force
   ```

### Problema: Dominio Personalizado No Resuelve

**Error**: DNS_PROBE_FINISHED_NXDOMAIN

**Soluciones**:
1. Verificar configuración DNS:
   ```bash
   nslookup partesobra.copuno.com
   dig partesobra.copuno.com
   ```
2. Esperar propagación DNS (hasta 48h)
3. Limpiar caché DNS local:
   ```bash
   # Mac
   sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder

   # Windows
   ipconfig /flushdns
   ```

### Problema: Rate Limiting Muy Restrictivo

**Error**: 429 Too Many Requests con uso normal

**Solución**:
```bash
# Aumentar límite
vercel env add RATE_LIMIT_MAX production
# Valor sugerido: 200-500

# O aumentar ventana de tiempo
vercel env add RATE_LIMIT_WINDOW_MS production
# Valor sugerido: 900000 (15 min)
```

---

## Comandos Útiles

```bash
# Ver información del proyecto
vercel inspect

# Listar despliegues
vercel ls

# Remover despliegue antiguo
vercel remove [deployment-url]

# Ver estadísticas de uso
vercel billing

# Cambiar configuración del proyecto
vercel project ls
vercel project rm copuno-gestion-partes

# Rollback a versión anterior
vercel rollback [deployment-url]

# Alias para crear URL personalizada
vercel alias set [deployment-url] partesobra.copuno.com
```

---

## Notas Importantes

### Límites del Plan Gratuito de Vercel
- **Bandwidth**: 100 GB/mes
- **Serverless Function Duration**: 10 segundos
- **Serverless Function Size**: 50 MB
- **Builds**: Ilimitados
- **Dominios**: Ilimitados

### Buenas Prácticas
1. **No commitear .env** - Siempre usar variables de entorno de Vercel
2. **Usar Preview Deployments** - Cada push a una rama crea un preview automático
3. **Configurar ALLOWED_ORIGINS** - Especialmente en producción
4. **Monitorear logs regularmente** - Detectar errores temprano
5. **Mantener dependencias actualizadas** - Vercel soporta las últimas versiones

### Seguridad
- Vercel proporciona HTTPS automático con certificados Let's Encrypt
- Todas las variables de entorno están encriptadas
- Las funciones serverless están aisladas
- Headers de seguridad están configurados vía Helmet.js

---

## Soporte y Recursos

- **Documentación Vercel**: https://vercel.com/docs
- **Notion API**: https://developers.notion.com
- **Make.com Webhooks**: https://www.make.com/en/help/tools/webhooks
- **Vite Deploy Guide**: https://vitejs.dev/guide/static-deploy.html

---

**Última actualización**: 2026-05-26
**Versión del proyecto**: 1.0.2
