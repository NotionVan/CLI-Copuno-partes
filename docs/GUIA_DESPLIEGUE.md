# 🚀 Guía Completa de Despliegue - Copuno Gestión de Partes

**Versión:** 1.0.2
**Fecha:** 8 de Noviembre de 2025
**Aplicación:** Copuno - Sistema de Gestión de Partes de Trabajo

---

## 📋 Tabla de Contenidos

1. [Resumen Ejecutivo](#resumen-ejecutivo)
2. [Arquitectura de la Aplicación](#arquitectura-de-la-aplicación)
3. [Pre-requisitos](#pre-requisitos)
4. [🌟 Opción 1: Vercel (Recomendado)](#opción-1-vercel-recomendado)
5. [🚂 Opción 2: Railway](#opción-2-railway)
6. [🖥️ Opción 3: VPS Personalizado](#opción-3-vps-personalizado)
7. [Configuración de Subdominio](#configuración-de-subdominio)
8. [Variables de Entorno](#variables-de-entorno)
9. [SSL y Seguridad](#ssl-y-seguridad)
10. [Verificación Post-Despliegue](#verificación-post-despliegue)
11. [Monitoreo y Mantenimiento](#monitoreo-y-mantenimiento)
12. [Troubleshooting](#troubleshooting)

---

## 📊 Resumen Ejecutivo

### Configuración Actual del Proyecto

```
Stack:
- Frontend: React 18 + Vite 4
- Backend: Node.js + Express 4
- Database: Notion API
- Puerto: 3001
- Build: /dist
```

### Opciones de Despliegue Comparadas

| Plataforma | Dificultad | Precio | SSL | Subdominio | Deploy Auto | Recomendado |
|------------|-----------|--------|-----|------------|-------------|-------------|
| **Vercel** | ⭐ Fácil | Gratis* | ✅ Auto | ✅ Sí | ✅ GitHub | ⭐⭐⭐⭐⭐ |
| **Railway** | ⭐⭐ Media | $5/mes | ✅ Auto | ✅ Sí | ✅ GitHub | ⭐⭐⭐⭐ |
| **VPS** | ⭐⭐⭐⭐ Alta | $5-10/mes | ⚠️ Manual | ✅ Sí | ❌ Manual | ⭐⭐⭐ |

*Gratis hasta 100GB bandwidth/mes

---

## 🏗️ Arquitectura de la Aplicación

```
┌──────────────────────────────────────────────────┐
│  Usuario                                         │
│  └─> https://partes.clientedominio.com          │
└──────────────────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────┐
│  CDN / Load Balancer                             │
│  (Vercel/Railway/Nginx)                          │
└──────────────────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────┐
│  Frontend (React SPA - /dist)                    │
│  ├─ Rutas: /, /consulta, /crear                 │
│  └─ Assets estáticos (JS, CSS, images)          │
└──────────────────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────┐
│  Backend API (Express - server.js)               │
│  ├─ GET  /api/health                             │
│  ├─ GET  /api/obras                              │
│  ├─ GET  /api/empleados                          │
│  ├─ GET  /api/partes-trabajo                     │
│  ├─ POST /api/partes-trabajo                     │
│  ├─ PUT  /api/partes-trabajo/:id                 │
│  └─ POST /api/partes-trabajo/:id/enviar-datos   │
└──────────────────────────────────────────────────┘
            │                       │
            ▼                       ▼
┌──────────────────────┐  ┌──────────────────────┐
│  Notion API          │  │  Make.com Webhook    │
│  (Base de Datos)     │  │  (Generación PDF)    │
└──────────────────────┘  └──────────────────────┘
```

---

## ✅ Pre-requisitos

### 1. Verificar que el Build Funciona Localmente

```bash
# Navegar al directorio del proyecto
cd "Copuno - Gestión de partes"

# Limpiar build anterior (si existe)
rm -rf dist

# Instalar dependencias
npm install

# Build de producción
npm run build

# Verificar que se creó /dist
ls -la dist/

# Debe contener:
# - index.html
# - assets/ (JS, CSS bundleados)

# Probar el servidor localmente
npm run start

# Abrir navegador: http://localhost:3001
# Verificar:
# ✅ Frontend carga
# ✅ API responde: http://localhost:3001/api/health
```

### 2. Preparar Repositorio Git

```bash
# Si aún no has iniciado git
git init
git add .
git commit -m "feat: initial commit - Copuno v1.3.0"

# Crear repositorio en GitHub
# https://github.com/new
# Nombre sugerido: copuno-gestion-partes

# Conectar con GitHub
git remote add origin https://github.com/TU_USUARIO/copuno-gestion-partes.git
git branch -M main
git push -u origin main
```

### 3. Recopilar Credenciales

Necesitarás tener a mano:

```
✅ Token de Notion API
   Ejemplo: ntn_YOUR_NOTION_TOKEN_HERE

✅ URL del Webhook de Make.com
   Ejemplo: https://hook.eu2.make.com/YOUR_WEBHOOK_ID_HERE

✅ Dominio del cliente
   Para configurar: partes.DOMINIO-CLIENTE.com
   (o el subdominio que prefieras)
```

---

## 🌟 Opción 1: Vercel (Recomendado)

### ¿Por qué Vercel?

| Ventaja | Descripción |
|---------|-------------|
| 💰 **Gratis** | Hasta 100GB bandwidth/mes (suficiente para 1000+ usuarios) |
| ⚡ **Deploy Automático** | Push a GitHub = Deploy automático en 2 minutos |
| 🔒 **SSL Automático** | Certificado Let's Encrypt configurado automáticamente |
| 🌍 **CDN Global** | 40+ edge locations worldwide = carga ultra-rápida |
| 📊 **Analytics** | Métricas de uso incluidas |
| ↩️ **Rollback Fácil** | Volver a versión anterior en 1 click |
| 🎯 **Dominio Simple** | Configurar subdominio en 5 minutos |

### Paso 1: Verificar Configuración de Vercel

Ya tienes `vercel.json` configurado. Vamos a verificarlo:

```bash
cat vercel.json
```

Debería contener:
```json
{
  "version": 2,
  "builds": [
    {
      "src": "server.js",
      "use": "@vercel/node"
    },
    {
      "src": "package.json",
      "use": "@vercel/static-build",
      "config": {
        "distDir": "dist"
      }
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "server.js"
    },
    {
      "src": "/(.*)",
      "dest": "/dist/$1"
    }
  ],
  "env": {
    "NODE_ENV": "production"
  }
}
```

✅ **Ya lo tienes configurado correctamente**

### Paso 2: Deploy desde la Web (Método Más Fácil)

#### 2.1 Crear Cuenta en Vercel

1. Ve a: **https://vercel.com**
2. Click en **"Sign Up"**
3. Selecciona **"Continue with GitHub"**
4. Autoriza a Vercel para acceder a tus repositorios

#### 2.2 Importar Proyecto

```
1. En el dashboard de Vercel:
   Click en "Add New..." → "Project"

2. Buscar repositorio:
   Busca "copuno-gestion-partes"
   (o el nombre que le hayas puesto)

3. Click en "Import"
```

#### 2.3 Configurar Proyecto

```
Framework Preset: Vite
Root Directory: ./
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

✅ Vercel detecta esto automáticamente si tienes `vercel.json`

#### 2.4 Configurar Variables de Entorno

En la sección "Environment Variables", agregar:

```bash
# Variable 1
Name: NOTION_TOKEN
Value: ntn_YOUR_NOTION_TOKEN_HERE
Environment: Production, Preview, Development

# Variable 2
Name: PORT
Value: 3001
Environment: Production, Preview, Development

# Variable 3
Name: PARTES_DATOS_WEBHOOK_URL
Value: https://hook.eu2.make.com/YOUR_WEBHOOK_ID_HERE
Environment: Production, Preview, Development

# Variable 4
Name: PARTES_WEBHOOK_TIMEOUT_MS
Value: 10000
Environment: Production, Preview, Development

# Variable 5
Name: NODE_ENV
Value: production
Environment: Production
```

#### 2.5 Deploy

```
Click en "Deploy"

Vercel hará:
✅ npm install
✅ npm run build
✅ Deploy a CDN global
✅ Configurar SSL
✅ Generar URL temporal

Tiempo estimado: 2-3 minutos
```

#### 2.6 Verificar Deploy

```bash
# URL temporal de Vercel (algo como):
https://copuno-gestion-partes-abc123.vercel.app

# Verificar health check
curl https://copuno-gestion-partes-abc123.vercel.app/api/health

# Respuesta esperada:
{
  "status": "ok",
  "timestamp": "2025-10-15T...",
  "notionToken": "configured",
  "mode": "live"
}

# Abrir en navegador
https://copuno-gestion-partes-abc123.vercel.app

# Verificar:
✅ Frontend carga correctamente
✅ Puedes navegar entre páginas
✅ Crear parte funciona
✅ Consultar partes funciona
```

### Paso 3: Configurar Subdominio del Cliente

#### 3.1 En Vercel

```
1. Ve a tu proyecto en Vercel
2. Click en "Settings" → "Domains"
3. Click en "Add Domain"
4. Ingresa el subdominio deseado:

   Opciones sugeridas:
   - partes.CLIENTE.com
   - copuno.CLIENTE.com
   - gestion.CLIENTE.com
   - app.CLIENTE.com

   Ejemplo: partes.copuno.com

5. Click en "Add"
```

#### 3.2 Vercel te Dará Instrucciones DNS

Vercel mostrará algo como:

```
Configure DNS:
Tipo: CNAME
Nombre: partes
Valor: cname.vercel-dns.com
TTL: 3600
```

#### 3.3 Configurar DNS del Cliente

Necesitarás acceso al panel de DNS del dominio del cliente (GoDaddy, Cloudflare, Namecheap, etc.)

**Ejemplo en Cloudflare:**

```
1. Login en Cloudflare
2. Seleccionar dominio: CLIENTE.com
3. Ir a "DNS" → "Records"
4. Click en "Add record"

Configuración:
┌──────────────────────────────────────────┐
│ Type: CNAME                              │
│ Name: partes                             │
│ Target: cname.vercel-dns.com             │
│ Proxy status: DNS only (gris)            │
│ TTL: Auto                                │
└──────────────────────────────────────────┘

5. Click en "Save"
```

**Ejemplo en GoDaddy:**

```
1. Login en GoDaddy
2. My Products → DNS
3. Manage DNS de CLIENTE.com
4. Add → CNAME

Configuración:
┌──────────────────────────────────────────┐
│ Type: CNAME                              │
│ Host: partes                             │
│ Points to: cname.vercel-dns.com          │
│ TTL: 1 Hour                              │
└──────────────────────────────────────────┘

5. Save
```

#### 3.4 Verificar Propagación DNS

```bash
# Esperar 5-30 minutos para propagación DNS

# Verificar desde terminal
nslookup partes.CLIENTE.com

# Debe resolver a algo como:
# cname.vercel-dns.com

# Verificar globalmente:
https://dnschecker.org/#CNAME/partes.CLIENTE.com

# Cuando esté verde en la mayoría de ubicaciones, está listo
```

#### 3.5 Verificar SSL

```bash
# Vercel configura SSL automáticamente en ~5 minutos

# Verificar:
curl -I https://partes.CLIENTE.com

# Debe mostrar:
HTTP/2 200
strict-transport-security: max-age=63072000

# Abrir en navegador:
https://partes.CLIENTE.com

# Verificar candado de seguridad 🔒
```

### Paso 4: Configurar Deploy Automático (Ya Configurado)

```
Vercel ya configuró:

✅ Push a 'main' → Deploy a producción automático
✅ Push a otras ramas → Preview deployment
✅ Pull Requests → Preview deployment automático

No necesitas hacer nada más
```

### Paso 5: Monitoreo y Logs

```
Dashboard de Vercel:
https://vercel.com/TU_USUARIO/copuno-gestion-partes

Secciones útiles:
📊 Deployments: Historial de deploys
📈 Analytics: Métricas de uso
🔍 Logs: Logs en tiempo real
⚙️ Settings: Configuración y variables
```

---

## 🚂 Opción 2: Railway

### ¿Por qué Railway?

- ✅ Optimizado para backend Node.js + Express
- ✅ $5/mes con $5 de crédito gratis inicial
- ✅ Logs en tiempo real excelentes
- ✅ Deploy automático desde GitHub
- ✅ SSL automático
- ✅ PostgreSQL incluido (si lo necesitas en el futuro)

### Paso 1: Crear Cuenta en Railway

```
1. Ve a: https://railway.app
2. Click en "Start a New Project"
3. Selecciona "Login with GitHub"
4. Autoriza Railway
```

### Paso 2: Crear Proyecto desde GitHub

```
1. En Railway:
   Click en "New Project"

2. Selecciona:
   "Deploy from GitHub repo"

3. Busca tu repo:
   "copuno-gestion-partes"

4. Click en el repo
```

### Paso 3: Configurar Variables de Entorno

```
En Railway → Settings → Variables:

Click en "+ New Variable" para cada una:

NOTION_TOKEN = ntn_YOUR_NOTION_TOKEN_HERE
PORT = 3001
PARTES_DATOS_WEBHOOK_URL = https://hook.eu2.make.com/YOUR_WEBHOOK_ID_HERE
PARTES_WEBHOOK_TIMEOUT_MS = 10000
NODE_ENV = production
```

### Paso 4: Configurar Build (Opcional)

Railway detecta Node.js automáticamente, pero puedes crear `railway.json`:

```json
{
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm install && npm run build"
  },
  "deploy": {
    "startCommand": "npm run start",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### Paso 5: Deploy

```
Railway hace deploy automáticamente:

✅ Detecta Node.js
✅ npm install
✅ npm run build
✅ npm run start

Ver logs en tiempo real:
Railway → Deployments → Click en deploy → Logs
```

### Paso 6: Configurar Dominio

```
1. En Railway → Settings → Networking
2. Click en "Custom Domain"
3. Ingresa: partes.CLIENTE.com
4. Railway te da un CNAME:

   partes.CLIENTE.com → [tu-proyecto].up.railway.app
```

Configurar en DNS del cliente (igual que Vercel):

```
Tipo: CNAME
Nombre: partes
Valor: [tu-proyecto].up.railway.app
TTL: 3600
```

### Paso 7: Health Checks

```
Railway → Settings → Healthcheck:

Path: /api/health
Port: 3001
Interval: 60s
Timeout: 30s
```

---

## 🖥️ Opción 3: VPS Personalizado (Avanzado)

### ¿Cuándo usar VPS?

- ✅ Necesitas control total del servidor
- ✅ Múltiples aplicaciones en un servidor
- ✅ Requisitos específicos de seguridad
- ⚠️ Requiere conocimientos de Linux y devops

### Proveedores Recomendados

| Proveedor | Precio | RAM | vCPU | Disco | Recomendado |
|-----------|--------|-----|------|-------|-------------|
| **Hetzner** | €4.15/mes | 2GB | 1 | 20GB SSD | ⭐⭐⭐⭐⭐ |
| **DigitalOcean** | $6/mes | 1GB | 1 | 25GB SSD | ⭐⭐⭐⭐ |
| **Linode** | $5/mes | 1GB | 1 | 25GB SSD | ⭐⭐⭐⭐ |
| **Vultr** | $5/mes | 1GB | 1 | 25GB SSD | ⭐⭐⭐ |

### Script de Instalación Automática

Crea este script en tu VPS para instalación rápida:

```bash
#!/bin/bash
# install-copuno.sh - Script de instalación automatizada

set -e

echo "🚀 Instalando Copuno - Gestión de Partes"

# Actualizar sistema
echo "📦 Actualizando sistema..."
apt update && apt upgrade -y

# Instalar Node.js 18
echo "📦 Instalando Node.js 18..."
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# Verificar instalación
node --version
npm --version

# Instalar PM2
echo "📦 Instalando PM2..."
npm install -g pm2

# Instalar Nginx
echo "📦 Instalando Nginx..."
apt install -y nginx

# Instalar Certbot para SSL
echo "🔒 Instalando Certbot..."
apt install -y certbot python3-certbot-nginx

# Crear usuario para la aplicación
echo "👤 Creando usuario copuno..."
useradd -m -s /bin/bash copuno || true
usermod -aG sudo copuno

# Clonar repositorio
echo "📥 Clonando repositorio..."
mkdir -p /var/www
cd /var/www
git clone https://github.com/TU_USUARIO/copuno-gestion-partes.git
cd copuno-gestion-partes

# Instalar dependencias
echo "📦 Instalando dependencias..."
npm install

# Build
echo "🔨 Building aplicación..."
npm run build

# Configurar variables de entorno
echo "⚙️ Configurando variables de entorno..."
cat > .env <<EOF
NOTION_TOKEN=ntn_YOUR_NOTION_TOKEN_HERE
PORT=3001
PARTES_DATOS_WEBHOOK_URL=https://hook.eu2.make.com/YOUR_WEBHOOK_ID_HERE
PARTES_WEBHOOK_TIMEOUT_MS=10000
NODE_ENV=production
EOF

# Iniciar con PM2
echo "🚀 Iniciando aplicación con PM2..."
pm2 start server.js --name copuno-partes
pm2 startup
pm2 save

# Configurar Nginx
echo "⚙️ Configurando Nginx..."
cat > /etc/nginx/sites-available/copuno <<'NGINX'
server {
    listen 80;
    server_name partes.CLIENTE.com;

    access_log /var/log/nginx/copuno-access.log;
    error_log /var/log/nginx/copuno-error.log;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX

# Activar sitio
ln -s /etc/nginx/sites-available/copuno /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx

# Configurar firewall
echo "🔒 Configurando firewall..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "✅ Instalación completada!"
echo "📝 Próximos pasos:"
echo "1. Editar /etc/nginx/sites-available/copuno y cambiar CLIENTE.com por tu dominio"
echo "2. Ejecutar: sudo nginx -t && sudo systemctl restart nginx"
echo "3. Configurar SSL: sudo certbot --nginx -d partes.CLIENTE.com"
echo "4. Verificar: pm2 status"
```

Guardar como `install-copuno.sh` y ejecutar:

```bash
chmod +x install-copuno.sh
sudo ./install-copuno.sh
```

---

## 🌐 Configuración de Subdominio

### Registros DNS a Crear

#### Opción A: CNAME (Recomendado para Vercel/Railway)

```dns
Tipo: CNAME
Nombre: partes
Valor: cname.vercel-dns.com (o el que te dé la plataforma)
TTL: 3600 (1 hora)

Resultado: partes.CLIENTE.com → cname.vercel-dns.com
```

#### Opción B: A Record (Para VPS)

```dns
Tipo: A
Nombre: partes
Valor: [IP de tu VPS]
TTL: 3600

Resultado: partes.CLIENTE.com → 123.45.67.89
```

### Verificación de DNS

```bash
# Método 1: nslookup
nslookup partes.CLIENTE.com

# Método 2: dig
dig partes.CLIENTE.com

# Método 3: Online
# https://dnschecker.org/#CNAME/partes.CLIENTE.com
```

---

## 🔐 Variables de Entorno

### Variables Requeridas

```bash
# Token de autenticación de Notion
NOTION_TOKEN=ntn_YOUR_NOTION_TOKEN_HERE

# Puerto del servidor
PORT=3001

# Webhook de Make.com
PARTES_DATOS_WEBHOOK_URL=https://hook.eu2.make.com/YOUR_WEBHOOK_ID_HERE

# Timeout del webhook
PARTES_WEBHOOK_TIMEOUT_MS=10000

# Entorno
NODE_ENV=production
```

### Variables Opcionales (Seguridad)

```bash
# CORS - Orígenes permitidos
ALLOWED_ORIGINS=https://partes.CLIENTE.com,https://www.CLIENTE.com

# Rate limiting (requests por ventana)
RATE_LIMIT_WINDOW_MS=900000  # 15 minutos
RATE_LIMIT_MAX=100           # 100 requests

# Cache TTL (optimizado en v1.0.0)
CACHE_TTL_MS=5000  # 5 segundos (recomendado para Smart Polling)
```

---

## 🔒 SSL y Seguridad

### Vercel / Railway
✅ **Automático** - Let's Encrypt configurado automáticamente

### VPS (Manual con Certbot)

```bash
# Obtener certificado
sudo certbot --nginx -d partes.CLIENTE.com

# Preguntas interactivas:
# Email: tu@email.com
# Aceptar términos: Y
# Compartir email: N
# Redirect HTTP → HTTPS: 2 (Sí)

# Verificar renovación automática
sudo certbot renew --dry-run

# El certificado se renueva automáticamente cada 90 días
```

---

## ✅ Verificación Post-Despliegue

### Checklist Completo

```bash
# 1. Health Check
curl https://partes.CLIENTE.com/api/health

# Respuesta esperada:
{
  "status": "ok",
  "timestamp": "2025-10-15T...",
  "notionToken": "configured",
  "mode": "live"
}

# 2. Frontend
# Abrir navegador: https://partes.CLIENTE.com
✅ Página principal carga
✅ Navegación funciona
✅ No hay errores en consola
✅ Indicador de sincronización visible en header (v1.0.0+)
✅ Badge de modo de sync aparece ("RÁPIDO", "NORMAL", o "LENTO")

# 3. Crear Parte
✅ Formulario carga correctamente
✅ Puede seleccionar obra
✅ Puede seleccionar empleados
✅ Puede crear parte exitosamente

# 4. Consultar Partes
✅ Lista de partes carga
✅ Filtros funcionan
✅ Ver detalles funciona

# 5. Editar Parte
✅ Modal de edición abre
✅ Puede modificar datos
✅ Guardar funciona

# 6. SSL/HTTPS
✅ Candado de seguridad visible
✅ Certificado válido
✅ No warnings de seguridad

# 7. Performance
✅ Tiempo de carga < 3s
✅ API responde < 1s
✅ No errores 500
```

---

## 📊 Monitoreo y Mantenimiento

### Logs

#### Vercel
```bash
# CLI
vercel logs [deployment-url]

# Dashboard
https://vercel.com/[cuenta]/[proyecto]/deployments
```

#### Railway
```
Dashboard → Deployments → Logs
Logs en tiempo real automáticos
```

#### VPS
```bash
# PM2
pm2 logs copuno-partes
pm2 logs copuno-partes --lines 100
pm2 logs copuno-partes --err

# Nginx
sudo tail -f /var/log/nginx/copuno-access.log
sudo tail -f /var/log/nginx/copuno-error.log
```

### Uptime Monitoring (Opcional)

#### UptimeRobot (Gratis)
```
1. https://uptimerobot.com
2. Add New Monitor
   - Type: HTTP(s)
   - URL: https://partes.CLIENTE.com/api/health
   - Interval: 5 minutes
   - Alert: email
```

---

## 🔧 Troubleshooting

### Problema: "NOTION_TOKEN missing"

**Causa:** Variable de entorno no configurada

**Solución:**
```bash
# Verificar variables
# Vercel: Settings → Environment Variables
# Railway: Settings → Variables
# VPS: cat /var/www/copuno-gestion-partes/.env

# Agregar variable faltante
```

### Problema: Error 404 en rutas

**Causa:** SPA routing no configurado

**Solución:**
```javascript
// En server.js debe estar:
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})
```

### Problema: CORS error

**Solución:**
```bash
# Agregar variable de entorno
ALLOWED_ORIGINS=https://partes.CLIENTE.com
```

### Problema: SSL no funciona

**VPS:**
```bash
sudo certbot --nginx -d partes.CLIENTE.com --force-renewal
```

**Vercel/Railway:**
- Verificar que DNS apunte correctamente
- Esperar 5-10 minutos para SSL automático

---

## 🎯 Recomendación Final para Tu Caso

### 🏆 Mejor Opción: **Vercel**

**Por qué:**
1. ✅ **Gratis** - Sin costo para el cliente
2. ✅ **SSL automático** - No te preocupas por certificados
3. ✅ **Deploy automático** - Push a GitHub = deploy
4. ✅ **Subdominio simple** - Solo configurar CNAME
5. ✅ **Rollback fácil** - Si algo falla, volver atrás en 1 click
6. ✅ **Analytics incluido** - Ver uso y performance
7. ✅ **CDN global** - Rápido desde cualquier ubicación

**Tiempo de deployment:** 15-20 minutos

**Pasos resumidos:**
```
1. Push código a GitHub ✓
2. Conectar Vercel con GitHub ✓
3. Configurar variables de entorno ✓
4. Deploy automático ✓
5. Agregar dominio personalizado ✓
6. Configurar CNAME en DNS ✓
7. ✅ Listo
```

---

**Documento actualizado:** 8 de Noviembre de 2025
**Versión:** 1.0.1
**Próxima revisión:** Según necesidad
