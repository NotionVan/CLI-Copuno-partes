# Configuración de Entorno

Este proyecto usa variables de entorno para credenciales y ajustes de runtime. El servidor carga automáticamente un archivo `.env` en el directorio raíz (dotenv).

## Variables requeridas

- `NOTION_TOKEN`: Token de integración interna de Notion con acceso a las BDs usadas por la app. No lo publiques ni lo subas a Git.

## Variables opcionales

- `PORT`: Puerto de escucha del servidor (por defecto `3001`).
- `ALLOWED_ORIGINS`: Lista separada por comas de orígenes permitidos para CORS (p. ej. `https://tudominio.com,https://app.tudominio.com`). Si no se define, en desarrollo se permite cualquier origen.
- `USE_MOCK_DATA`: Activa el modo mock (valores `true/false`). Si es `true` o no hay `NOTION_TOKEN`, el backend usa datos locales y NO llama a Notion.
- `PARTES_DATOS_WEBHOOK_URL`: URL a la que se enviarán los datos de un parte cuando se pulse "Enviar Datos". Si no se define, el backend simula el envío y escribe el payload en los logs para facilitar pruebas.
- `PARTES_WEBHOOK_TIMEOUT_MS`: Tiempo máximo de espera (ms) para el webhook (por defecto `10000`).
- `RATE_LIMIT_WINDOW_MS`: Ventana de rate limit en milisegundos (por defecto `900000`, 15 min).
- `RATE_LIMIT_MAX`: Máximo de peticiones por IP en cada ventana (por defecto `100`).
- `CACHE_TTL_MS`: **[v1.0.0+]** Tiempo de vida del cache en milisegundos (por defecto `5000`, 5 segundos). Optimizado para Smart Polling. Valores recomendados: `2000` (muy rápido), `5000` (balanceado), `10000` (conservador).

## Pasos para configurar

1) Crea una integración interna en Notion (Settings → Integrations → New integration) y copia el token.
2) Comparte cada base de datos con la integración (Share → Invite → tu integración → Can edit).
3) Crea un archivo `.env` en la raíz del proyecto con el contenido:

```
NOTION_TOKEN=YOUR_NOTION_TOKEN
PORT=3001
CACHE_TTL_MS=5000
# ALLOWED_ORIGINS=https://tudominio.com,https://app.tudominio.com
```

## Rotación de tokens

Si un token se ha expuesto o quieres rotarlo:
- Genera un nuevo token en Notion.
- Actualiza `.env` con el nuevo valor.
- Revoca/borra el token antiguo en Notion.
- Reinicia el servidor.

## Configuración en Vercel

Para despliegues en Vercel, las variables de entorno se configuran desde el Dashboard:

### Paso a paso:

1. **Acceder al proyecto en Vercel**
   - Ir a [vercel.com](https://vercel.com)
   - Seleccionar tu proyecto

2. **Configurar variables**
   - Ir a **Settings** → **Environment Variables**
   - Añadir cada variable con su valor
   - Seleccionar los entornos: **Production**, **Preview**, **Development**

### Variables requeridas en Vercel:

```
NOTION_TOKEN = ntn_XXXXXXXXXX
PARTES_DATOS_WEBHOOK_URL = https://hook.eu2.make.com/XXXXXXXXXX
NODE_ENV = production
CACHE_TTL_MS = 5000
```

### Variables opcionales recomendadas:

```
ALLOWED_ORIGINS = https://partesobra.copuno.com
RATE_LIMIT_WINDOW_MS = 900000
RATE_LIMIT_MAX = 100
PARTES_WEBHOOK_TIMEOUT_MS = 10000
```

### Desde la CLI de Vercel:

```bash
# Añadir variable
vercel env add NOTION_TOKEN production

# Listar variables
vercel env ls

# Eliminar variable
vercel env rm NOTION_TOKEN production
```

**Importante**: Después de añadir o modificar variables de entorno en Vercel, es necesario re-desplegar:
```bash
vercel --prod
```

## Buenas prácticas

- Nunca publiques el token en commits, issues o documentación pública.
- Mantén `.env` fuera del control de versiones (ya está incluido en `.gitignore`).
- Usa `ALLOWED_ORIGINS` en producción para restringir CORS.
- En Vercel, las variables de entorno están encriptadas y son seguras.
- Configura siempre `ALLOWED_ORIGINS` cuando despliegues a un dominio personalizado.
- Usa valores diferentes para Production, Preview y Development si es necesario.
