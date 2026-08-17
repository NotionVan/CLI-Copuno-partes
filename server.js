require('dotenv').config()
const express = require('express')
const rateLimit = require('express-rate-limit')
const morgan = require('morgan')
const helmet = require('helmet')
const compression = require('compression')
const { v4: uuidv4 } = require('uuid')
const cors = require('cors')
const axios = require('axios')
const path = require('path')
const mockStore = require('./mock/mockData')
const data = require('./src-server/services/data')
const { extractPropertyValue } = require('./src-server/services/notion')
const { createIdempotencyStore } = require('./src-server/lib/idempotency')

const app = express()
const PORT = process.env.PORT || 3001

// Configuración de Notion (sin fallback: exigir variable de entorno)
const NOTION_TOKEN = process.env.NOTION_TOKEN
const USE_MOCK_DATA = process.env.USE_MOCK_DATA === 'true' || (NOTION_TOKEN || '').toLowerCase() === 'mock' || !NOTION_TOKEN
const PARTES_DATOS_WEBHOOK_URL = process.env.PARTES_DATOS_WEBHOOK_URL || process.env.PARTE_DATOS_WEBHOOK_URL || ''
const PARTES_WEBHOOK_TIMEOUT_MS = Number(process.env.PARTES_WEBHOOK_TIMEOUT_MS || 10000)
const PARTES_WEBHOOK_CONFIGURED = Boolean(PARTES_DATOS_WEBHOOK_URL)
const PARTE_ESTADO_BORRADOR = 'borrador'

// Texto libre que viaja a Notion y que Make serializa aguas abajo: los caracteres
// de control (\n\r\t) rompen ese JSON ("Bad control character"). Ver DEUDA_TECNICA M4/I6.
const sanearTextoPlano = (valor) => String(valor || '').replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim()
// IDs para propiedades relation de Notion: solo strings con pinta de UUID (con o sin guiones).
const sanearIdsRelacion = (valor) => Array.isArray(valor)
	? valor.filter(id => typeof id === 'string' && /^[0-9a-f-]{32,36}$/i.test(id)).slice(0, 50)
	: []
const PARTE_ESTADO_PROCESANDO = 'Procesando'
const PARTE_ESTADO_DATOS_ENVIADOS = 'Datos Enviados'

// Middleware
// Confiar en proxy para IP real (útil en despliegues detrás de CDN/Reverse Proxy)
app.set('trust proxy', 1)

// Seguridad y performance
app.use(helmet())
app.use(compression())

// CORS: si se definen orígenes permitidos, restringir; en otro caso permitir (dev)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
if (ALLOWED_ORIGINS.length > 0) {
	app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }))
} else {
	app.use(cors())
}

// Request ID para trazabilidad
app.use((req, res, next) => {
	req.id = req.headers['x-request-id'] || uuidv4()
	res.setHeader('x-request-id', req.id)
	next()
})

// Access logging (morgan) con tiempos y filtrado de rutas de ruido
morgan.token('id', (req) => req.id)
const logFormat = ':id :remote-addr - :method :url :status :res[content-length] - :response-time ms'
app.use(morgan(logFormat, {
	skip: (req) => {
		const p = req.path || ''
		// Reducir ruido: evitar logs de assets estáticos y health
		return p.startsWith('/assets') || p.endsWith('.js') || p.endsWith('.css') || p.endsWith('.map') || p === '/api/health'
	}
}))
app.use(express.json())
app.use(express.static(path.join(__dirname, 'dist')))

// Verificar token al iniciar o activar modo mock
if (!NOTION_TOKEN && !USE_MOCK_DATA) {
	console.error('ERROR: Falta la variable de entorno NOTION_TOKEN. Configure su token de Notion antes de iniciar el servidor.')
	// Finalizar proceso para evitar ejecutar sin credenciales válidas
	process.exit(1)
}

if (USE_MOCK_DATA) {
	console.warn('⚠️  Ejecutando en modo MOCK: se utilizarán datos simulados para todas las peticiones.')
}

// Inicializar la capa de abstracción de datos (ADR-002).
// Todos los endpoints consumen `data.*` — ninguno llama a Notion directamente.
data.init({
	notionToken: NOTION_TOKEN,
	useMock: USE_MOCK_DATA,
	mockStore,
	timeoutMs: 10000
})

// Store de idempotencia para POST enviar-datos (futuro ADR-004).
// Defensa contra doble-click y reintentos de red. TTL 10 min.
const enviarDatosIdempotency = createIdempotencyStore({ ttlMs: 10 * 60 * 1000 })

// Rate limiting para /api con valores configurables
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000) // 15 minutos
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 1000) // 1000 req por ventana (NAT compartido)
const apiLimiter = rateLimit({
	windowMs: RATE_LIMIT_WINDOW_MS,
	max: RATE_LIMIT_MAX,
	standardHeaders: true,
	legacyHeaders: false,
	skip: (req) => (req.path === '/health') // no limitar health
})
app.use('/api', apiLimiter)

// Autenticación de plataforma (ADR-006): JWT de Supabase en todo /api/*
// salvo /api/health. Sin SUPABASE_URL, se desactiva (modo desarrollo).
const { authMiddleware } = require('./src-server/middleware/auth')
app.use('/api', authMiddleware)

// Cache simple en memoria para catálogos (TTL configurable)
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 30 * 1000) // 30 segundos para reducir requests innecesarios a Notion
const cache = new Map()
const setCache = (key, data) => cache.set(key, { data, ts: Date.now() })
const getCache = (key) => {
	const e = cache.get(key)
	if (!e) return null
	if (Date.now() - e.ts > CACHE_TTL_MS) {
		cache.delete(key)
		return null
	}
	return e.data
}
// Invalidación tras escrituras (BE-3): sin esto, un GET que caiga en esta misma
// instancia durante el TTL sirve el listado SIN el parte recién creado/editado —
// el síntoma intermitente de "la app no actualiza". Acepta claves exactas o
// prefijos terminados en ':' (p. ej. 'empleados-por-obra:').
const invalidateCache = (...claves) => {
	for (const clave of claves) {
		if (clave.endsWith(':')) {
			for (const k of cache.keys()) if (k.startsWith(clave)) cache.delete(k)
		} else {
			cache.delete(clave)
		}
	}
}
const invalidarPartes = () => invalidateCache('partes-trabajo', 'datos-completos', 'export-chorus-ctx:')
const invalidarEmpleados = () => invalidateCache('empleados', 'datos-completos', 'buscar-id:', 'buscar-q:', 'empleados-por-obra:')

// Sanitización de datos económicos en respuestas API
const ECONOMIC_KEY_SUBSTRINGS = ['importe', 'precio', 'coste', 'tarifa', 'eur', 'euro']
const ECONOMIC_VALUE_REGEX = /(€|eur|euros)/i
function sanitizeEconomic(value) {
	if (Array.isArray(value)) {
		return value.map(sanitizeEconomic)
	}
	if (value && typeof value === 'object') {
		const out = {}
		for (const [k, v] of Object.entries(value)) {
			const kl = String(k).toLowerCase()
			const keyHits = ECONOMIC_KEY_SUBSTRINGS.some(s => kl.includes(s))
			if (keyHits) continue // eliminar claves económicas
			const sv = sanitizeEconomic(v)
			// Si el valor es string económico, redáctalo
			if (typeof sv === 'string' && ECONOMIC_VALUE_REGEX.test(sv)) {
				out[k] = '[redacted]'
			} else {
				out[k] = sv
			}
		}
		return out
	}
	if (typeof value === 'string') {
		return ECONOMIC_VALUE_REGEX.test(value) ? '[redacted]' : value
	}
	return value
}

// Interceptor para res.json que sanea datos económicos (excepto health)
app.use((req, res, next) => {
	const originalJson = res.json.bind(res)
	res.json = (data) => {
		const shouldSanitize = req.path.startsWith('/api/') && req.path !== '/api/health'
		const payload = shouldSanitize ? sanitizeEconomic(data) : data
		return originalJson(payload)
	}
	next()
})

// Rutas de la API

// Health check
app.get('/api/health', (req, res) => {
	const { version } = require('./package.json')
	if (USE_MOCK_DATA) {
		return res.json({ ...mockStore.getHealthStatus(), version, mode: 'mock' })
	}
	res.json({
		status: 'ok',
		version,
		timestamp: new Date().toISOString(),
		notionToken: NOTION_TOKEN ? 'configured' : 'missing',
		mode: 'live'
	})
})

// Obtener todas las obras — refactorizado a data.js (ADR-002)
app.get('/api/obras', async (req, res) => {
	try {
		const cached = getCache('obras')
		if (cached) return res.json(cached)
		const obras = await data.obras.listar()
		setCache('obras', obras)
		res.json(obras)
	} catch (error) {
		console.error('Error al obtener obras:', error.message)
		res.status(500).json({
			error: 'Error al obtener obras',
			details: error.message
		})
	}
})

// Obtener todos los jefes de obra — refactorizado a data.js (ADR-002)
app.get('/api/jefes-obra', async (req, res) => {
	try {
		const cached = getCache('jefes')
		if (cached) return res.json(cached)
		const jefesObra = await data.jefesObra.listar()
		setCache('jefes', jefesObra)
		res.json(jefesObra)
	} catch (error) {
		console.error('Error al obtener jefes de obra:', error.message)
		res.status(500).json({
			error: 'Error al obtener jefes de obra',
			details: error.message
		})
	}
})

// F4: Firmantes autorizados para una obra concreta — refactorizado a data.js (ADR-002)
app.get('/api/obras/:obraId/firmantes-autorizados', async (req, res) => {
	try {
		const { obraId } = req.params
		const firmantes = await data.obras.firmantesAutorizados(obraId)
		res.json(firmantes)
	} catch (error) {
		if (error.status === 404) {
			return res.status(404).json({ error: 'Obra no encontrada' })
		}
		console.error('Error al obtener firmantes autorizados:', error.message)
		res.status(500).json({
			error: 'Error al obtener firmantes autorizados',
			details: error.message
		})
	}
})

// Obtener todos los empleados — refactorizado a data.js (ADR-002)
app.get('/api/empleados', async (req, res) => {
	try {
		const cached = getCache('empleados')
		if (cached) return res.json(cached)
		const empleados = await data.empleados.listar()
		setCache('empleados', empleados)
		res.json(empleados)
	} catch (error) {
		console.error('Error al obtener empleados:', error.message)
		res.status(500).json({
			error: 'Error al obtener empleados',
			details: error.message
		})
	}
})

// F2/F5: búsqueda de empleados — refactorizado a data.js (ADR-002).
// Acepta ?id=NNNN (por ID COPUNO) o ?q=texto (por nombre). Si ambos, prevalece id.
app.get('/api/empleados/buscar', async (req, res) => {
	try {
		const limite = Math.min(Math.max(Number(req.query.limite) || 20, 1), 50)

		// F2: búsqueda por ID Copuno
		const idRaw = req.query.id
		if (idRaw !== undefined && idRaw !== '') {
			const idNum = Number(idRaw)
			if (!Number.isInteger(idNum) || idNum <= 0) {
				return res.status(400).json({ error: 'ID Copuno inválido', details: 'Debe ser un entero positivo' })
			}

			// N4: cache corta para búsquedas por ID (reduce lecturas Notion en flujo multi-obra)
			const cacheKeyId = `buscar-id:${idNum}`
			const cachedId = getCache(cacheKeyId)
			if (cachedId) return res.json(cachedId)

			const { resultados, duplicado } = await data.empleados.buscarPorIdCopuno(idNum, { limite })

			if (resultados.length === 0) {
				return res.status(404).json({ error: 'Empleado no encontrado', idCopuno: idNum })
			}

			if (duplicado) {
				console.warn(JSON.stringify({
					reqId: req.id,
					event: 'id_copuno_duplicado',
					idCopuno: idNum,
					count: resultados.length,
					empleadoIds: resultados.map(r => r.id)
				}))
			}

			setCache(cacheKeyId, resultados)
			return res.json(resultados)
		}

		// F5: búsqueda por nombre (mínimo 3 chars)
		const q = String(req.query.q || '').trim()
		if (q.length < 3) {
			return res.json([])
		}

		// N4: cache corta para búsquedas por nombre
		const cacheKeyQ = `buscar-q:${q.toLowerCase()}:${limite}`
		const cachedQ = getCache(cacheKeyQ)
		if (cachedQ) return res.json(cachedQ)

		const resultados = await data.empleados.buscarPorNombre(q, { limite })
		setCache(cacheKeyQ, resultados)
		res.json(resultados)
	} catch (error) {
		console.error('Error al buscar empleados:', error.message)
		res.status(500).json({
			error: 'Error al buscar empleados',
			details: error.message
		})
	}
})

// Búsqueda de vehículos por matrícula (autocompletado del campo Vehículos del parte)
app.get('/api/vehiculos/buscar', async (req, res) => {
	try {
		const limite = Math.min(Math.max(Number(req.query.limite) || 20, 1), 50)
		const q = String(req.query.q || '').trim()
		if (q.length < 2) {
			return res.json([])
		}
		const cacheKey = `vehiculos-q:${q.toLowerCase()}:${limite}`
		const cached = getCache(cacheKey)
		if (cached) return res.json(cached)

		const resultados = await data.vehiculos.buscar(q, { limite })
		setCache(cacheKey, resultados)
		res.json(resultados)
	} catch (error) {
		console.error('Error al buscar vehículos:', error.message)
		res.status(500).json({ error: 'Error al buscar vehículos', details: error.message })
	}
})

// Exportación de partes al CSV que consume la macro de los cuadrantes de Chorus.
// Contrato y reglas de negocio: docs/EXPORT_CHORUS_CSV.md
//
// Devuelve UNA página de Notion por llamada; el cliente itera con `cursor` hasta
// `done` y compone el CSV. Así ninguna petición se acerca al timeout serverless,
// independientemente del plan de Vercel y del número de obras activas.
const FECHA_ISO_RE = /^\d{4}-\d{2}-\d{2}$/

app.get('/api/exportaciones/chorus', async (req, res) => {
	try {
		const desde = String(req.query.desde || '').trim()
		const hasta = String(req.query.hasta || '').trim()
		const cursor = String(req.query.cursor || '').trim() || undefined

		if (!FECHA_ISO_RE.test(desde) || !FECHA_ISO_RE.test(hasta)) {
			return res.status(400).json({ error: 'Parámetros "desde" y "hasta" requeridos en formato AAAA-MM-DD' })
		}
		if (desde > hasta) {
			return res.status(400).json({ error: 'La fecha de inicio no puede ser posterior a la de fin' })
		}

		// El contexto del rango (partes rectificados + estados) es constante para
		// toda la exportación: se calcula en la primera página y se cachea para las
		// siguientes. TTL propio: una exportación larga supera el TTL de catálogos.
		const ctxKey = `export-chorus-ctx:${desde}:${hasta}`
		let contexto = getCache(ctxKey)
		if (!contexto) {
			contexto = await data.exportaciones.contextoRango({ desde, hasta })
			setCache(ctxKey, contexto)
		}

		const pagina = await data.exportaciones.chorusPagina({
			desde,
			hasta,
			cursor,
			rectificadosIds: contexto.rectificadosIds
		})

		res.json({
			...pagina,
			// Solo en la primera página: permite avisar en la UI antes de descargar.
			estados: cursor ? undefined : contexto.estados
		})
	} catch (error) {
		console.error('Error al exportar CSV de Chorus:', error.message)
		res.status(500).json({ error: 'Error al generar la exportación', details: error.message })
	}
})

// Opciones válidas de Estado de empleados — refactorizado a data.js (ADR-002)
app.get('/api/empleados/estado-opciones', async (req, res) => {
	try {
		const resultado = await data.empleados.opcionesEstado()
		res.json(resultado)
	} catch (error) {
		console.error('Error al obtener opciones de Estado:', error.message)
		res.status(500).json({ error: 'Error al obtener opciones de Estado', details: error.message })
	}
})

// Actualizar estado de un empleado — refactorizado a data.js (ADR-002)
app.put('/api/empleados/:empleadoId/estado', async (req, res) => {
	try {
		const { empleadoId } = req.params
		const { estado } = req.body

		if (!estado || typeof estado !== 'string') {
			return res.status(400).json({ error: 'Parámetro "estado" requerido' })
		}

		const result = await data.empleados.actualizarEstado(empleadoId, estado)
		invalidarEmpleados()
		res.json(result)
	} catch (error) {
		if (error.status === 404) return res.status(404).json({ error: error.message })
		if (error.status === 400) return res.status(400).json({ error: error.message })
		console.error('Error al actualizar estado del empleado:', error.message)
		res.status(500).json({ error: 'Error al actualizar estado del empleado', details: error.message })
	}
})

// Empleados de una obra específica — refactorizado a data.js (ADR-002).
// C3 ya resuelto: query filtrada por relación inversa (sin N+1).
app.get('/api/obras/:obraId/empleados', async (req, res) => {
	try {
		const { obraId } = req.params
		const empleadosDetalles = await data.obras.empleadosDeObra(obraId)
		res.json(empleadosDetalles)
	} catch (error) {
		console.error('Error al obtener empleados de la obra:', error.message)
		res.status(500).json({
			error: 'Error al obtener empleados de la obra',
			details: error.message
		})
	}
})

// Obtener todos los partes de trabajo — refactorizado a data.js (ADR-002)
app.get('/api/partes-trabajo', async (req, res) => {
	try {
		const cached = getCache('partes-trabajo')
		if (cached) return res.json(cached)
		const partesTrabajo = await data.partesTrabajo.listar()
		setCache('partes-trabajo', partesTrabajo)
		res.json(partesTrabajo)
	} catch (error) {
		console.error('Error al obtener partes de trabajo:', error.message)
		res.status(500).json({
			error: 'Error al obtener partes de trabajo',
			details: error.message
		})
	}
})

// Crear un nuevo parte de trabajo — refactorizado a data.js (ADR-002)
app.post('/api/partes-trabajo', async (req, res) => {
	try {
		const { obra, obraId, fecha, jefeObraId, notas, vehiculos, vehiculosIds, empleados, empleadosHoras } = req.body

		if (!obra || !obraId || !fecha || !jefeObraId) {
			return res.status(400).json({
				error: 'Faltan campos requeridos',
				required: ['obra', 'obraId', 'fecha', 'jefeObraId']
			})
		}

		const result = await data.partesTrabajo.crear({ obra, obraId, fecha, jefeObraId, notas, vehiculos: sanearTextoPlano(vehiculos), vehiculosIds: sanearIdsRelacion(vehiculosIds), empleados, empleadosHoras })
		invalidarPartes()

		// Mock devuelve una página Notion-like directamente; live devuelve { parteData, ... }
		if (USE_MOCK_DATA) {
			return res.json(result)
		}

		const { parteData, nombreFinal, detallesCreados, erroresDetalles, asignadosObraIds } = result
		const empleadosNoAsignados = (empleados || []).filter(id => !asignadosObraIds.includes(id))

		console.log(JSON.stringify({
			reqId: req.id,
			event: 'parte_creado',
			parteId: parteData.id,
			nombreFinal,
			empleadosPretendidos: empleados?.length || 0,
			empleadosNoAsignadosObra: empleadosNoAsignados.length,
			empleadosNoAsignadosIds: empleadosNoAsignados,
			detallesCreados: detallesCreados.length,
			errores: erroresDetalles
		}))

		res.json({
			...parteData,
			empleadosCreados: empleados?.length || 0,
			detallesCreados: detallesCreados.length,
			erroresDetalles: erroresDetalles.length,
			mensaje: `Parte creado exitosamente. ${detallesCreados.length} empleados asignados.`
		})
	} catch (error) {
		console.error('Error al crear parte de trabajo:', error.message)
		res.status(500).json({
			error: 'Error al crear parte de trabajo',
			details: error.message
		})
	}
})

// Obtener detalles de empleados de un parte específico — refactorizado a data.js (ADR-002)
app.get('/api/partes-trabajo/:parteId/empleados', async (req, res) => {
	try {
		const { parteId } = req.params
		const empleados = await data.partesTrabajo.empleados(parteId)
		res.json(empleados)
	} catch (error) {
		console.error('Error al obtener detalles de empleados del parte:', error.message)
		res.status(500).json({
			error: 'Error al obtener detalles de empleados del parte',
			details: error.message
		})
	}
})

// Obtener detalles completos de un parte específico — refactorizado a data.js (ADR-002)
app.get('/api/partes-trabajo/:parteId/detalles', async (req, res) => {
	try {
		const { parteId } = req.params
		const resultado = await data.partesTrabajo.detalles(parteId)
		res.json(resultado)
	} catch (error) {
		if (error.status === 404) return res.status(404).json({ error: error.message })
		console.error('Error al obtener detalles completos del parte:', error.message)
		res.status(500).json({
			error: 'Error al obtener detalles completos del parte',
			details: error.message
		})
	}
})

// Obtener solo el estado y última edición de un parte — refactorizado a data.js (ADR-002)
app.get('/api/partes-trabajo/:parteId/estado', async (req, res) => {
	try {
		const { parteId } = req.params
		const resultado = await data.partesTrabajo.estado(parteId)
		res.json(resultado)
	} catch (error) {
		if (error.status === 404) return res.status(404).json({ error: error.message })
		console.error('Error al obtener estado del parte:', error.message)
		res.status(500).json({ error: 'Error al obtener estado del parte', details: error.message })
	}
})

// H3: endpoint SSE eliminado — sustituido por polling client-side en App.jsx.
// El endpoint GET /api/partes-trabajo/:id/estado (línea anterior) cubre la misma necesidad.

app.post('/api/partes-trabajo/:parteId/enviar-datos', async (req, res) => {
	const { parteId } = req.params
	if (!parteId) {
		return res.status(400).json({ error: 'ID de parte requerido' })
	}

	// Idempotencia: header Idempotency-Key si lo envía el cliente,
	// o `enviar-datos:${parteId}` por defecto (mata doble-click sin tocar frontend).
	const idemKey = String(req.headers['idempotency-key'] || `enviar-datos:${parteId}`)
	const cached = enviarDatosIdempotency.get(idemKey)
	if (cached) {
		if (cached.status === 'in_flight') {
			return res.status(409).json({
				error: 'Solicitud en curso para este parte. Espera unos segundos antes de reintentar.',
				idempotencyKey: idemKey
			})
		}
		// status === 'complete' — replay de la respuesta original
		return res.status(cached.statusCode || 200).json({
			...cached.body,
			replayed: true,
			idempotencyKey: idemKey
		})
	}
	enviarDatosIdempotency.markInFlight(idemKey)

	// Helper local para responder + cachear de forma uniforme.
	const respond = (statusCode, body) => {
		enviarDatosIdempotency.markComplete(idemKey, { statusCode, body })
		return res.status(statusCode).json(body)
	}
	// Si algo lanza más abajo, hay que liberar el lock para que se pueda reintentar.
	const release = () => enviarDatosIdempotency.delete(idemKey)

	if (USE_MOCK_DATA) {
		try {
			const resultado = mockStore.sendParteDatos(parteId)
			return respond(200, {
				status: 'ok',
				parteId,
				nuevoEstado: resultado.parte.estado,
				modo: 'mock'
			})
		} catch (error) {
			const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'INVALID_STATE' ? 409 : 400
			return respond(status, {
				error: error.message,
				estado: error.meta?.estado
			})
		}
	}

	let parteData
	try {
		parteData = await data.partesTrabajo.obtenerPagina(parteId)
	} catch (error) {
		console.error('Error al recuperar parte antes de enviar datos:', {
			message: error.message,
			status: error.status
		})
		// 404 es permanente (cachear); otros son transitorios (liberar para reintento).
		if (error.status === 404) {
			return respond(404, {
				error: 'No se pudo recuperar el parte desde Notion',
				details: error.message
			})
		}
		release()
		return res.status(500).json({
			error: 'No se pudo recuperar el parte desde Notion',
			details: error.message
		})
	}

	if (!parteData || !parteData.properties) {
		return respond(404, { error: 'Parte no encontrado en Notion' })
	}

	const estadoActual = extractPropertyValue(parteData.properties['Estado']) || ''
	if (String(estadoActual).toLowerCase() !== PARTE_ESTADO_BORRADOR) {
		return respond(409, {
			error: 'Solo los partes en estado Borrador pueden enviarse',
			estado: estadoActual
		})
	}

	// Re-derivar el espejo de texto 'Vehiculos' desde la relación (fuente de verdad)
	// justo antes de generar el PDF: cubre el caso de que la relación se editara a mano
	// en Notion sin pasar por la app. No bloqueante — si falla, se usa el texto que ya había.
	try {
		const sync = await data.partesTrabajo.sincronizarEspejoVehiculos(parteData)
		if (sync.actualizado) {
			console.info(`[enviar-datos] Espejo Vehiculos re-derivado para ${parteId}: "${sync.texto}"`)
		}
	} catch (error) {
		console.error(`[enviar-datos] No se pudo re-derivar el espejo Vehiculos (${parteId}):`, error.message)
	}

	const buttonEntries = Object.entries(parteData.properties || {}).filter(([, prop]) => prop?.type === 'button')
	const safeButton = buttonEntries.find(([, prop]) => prop?.button?.type === 'checked') || buttonEntries[0] || []
	const [buttonName, buttonProperty] = safeButton
	const payload = {
		parteId,
		notionPageId: parteData.id,
		page_id: parteData.id,
		property_id: buttonProperty?.id || null,
		property_name: buttonName || null,
		source: {
			type: 'copuno-app',
			action: 'enviar-datos',
			triggeredAt: new Date().toISOString()
		},
		data: {
			...parteData,
			// asegurar copia superficial para evitar mutaciones accidentales
			properties: { ...parteData.properties }
		}
	}

	// C2: marcar "Procesando" ANTES de llamar a Make para cerrar la ventana de reintento.
	// Si el webhook falla, el parte sigue en "Procesando" (no en Borrador) — no se puede
	// reenviar accidentalmente. La oficina lo reconcilia cambiando el estado a mano en Notion.
	try {
		await data.partesTrabajo.actualizarEstado(parteId, {
			estadoProperty: parteData.properties['Estado'],
			nuevoEstado: PARTE_ESTADO_PROCESANDO
		})
	invalidarPartes()
	} catch (error) {
		console.error('Error al marcar parte como Procesando:', {
			message: error.message,
			status: error.status
		})
		// Fallo antes de tocar Make → el parte sigue en Borrador. Transitorio: liberar lock.
		release()
		return res.status(500).json({
			error: 'No se pudo reservar el parte para el envío. Inténtalo de nuevo.',
			details: error.response?.data?.message || error.message
		})
	}

	if (PARTES_WEBHOOK_CONFIGURED) {
		try {
			console.info('[Webhook] Enviando payload partes:', JSON.stringify({
				page_id: payload.page_id,
				property_id: payload.property_id,
				property_name: payload.property_name
			}))
			await axios.post(PARTES_DATOS_WEBHOOK_URL, payload, {
				timeout: PARTES_WEBHOOK_TIMEOUT_MS
			})
		} catch (error) {
			console.error('Error al invocar el webhook de partes:', {
				message: error.message,
				status: error.response?.status
			})
			if (error.response?.data) {
				console.error('Respuesta recibida del webhook:', error.response.data)
			}
			// Make usa webhook instant:true → responde 200 inmediatamente y procesa en background.
			// Si axios falla/timeout, Make NO recibió la petición → revertir a Borrador es seguro.
			// El jefe puede reintentar desde el móvil sin intervención de oficina.
			release()
			try {
				await data.partesTrabajo.actualizarEstado(parteId, {
					estadoProperty: parteData.properties['Estado'],
					nuevoEstado: PARTE_ESTADO_BORRADOR.charAt(0).toUpperCase() + PARTE_ESTADO_BORRADOR.slice(1)
				})
			invalidarPartes()
			} catch (revertError) {
				console.error('Error al revertir estado a Borrador tras fallo de webhook:', {
					message: revertError.message,
					parteId
				})
				// Si la reversión falla, el parte queda en Procesando — mismo comportamiento
				// anterior. El log permite identificarlo para reconciliación manual.
				return res.status(error.response?.status || 502).json({
					error: 'No se pudo enviar los datos y tampoco revertir el estado. El parte queda en "Procesando" — cámbialo manualmente a "Borrador" en Notion para poder reintentar.',
					details: error.response?.data?.error || error.response?.data?.message || error.message
				})
			}
			return res.status(error.response?.status || 502).json({
				error: 'No se pudo enviar los datos al webhook. El parte ha vuelto a "Borrador" — puedes intentarlo de nuevo.',
				details: error.response?.data?.error || error.response?.data?.message || error.message
			})
		}
	} else {
		console.warn('Webhook no configurado. Registrando payload localmente para diagnóstico.')
		console.info('Payload parte enviado (simulado):', JSON.stringify(payload, null, 2))
	}

	try {
		await data.partesTrabajo.actualizarEstado(parteId, {
			estadoProperty: parteData.properties['Estado'],
			nuevoEstado: PARTE_ESTADO_DATOS_ENVIADOS
		})
	invalidarPartes()
	} catch (error) {
		console.error('Error al actualizar estado del parte tras enviar datos:', {
			message: error.message,
			status: error.status
		})
		// El webhook YA se disparó y el parte está en "Procesando" — no en Borrador.
		// Reintentar no reenviaría Make (bloqueado por PARTE_NO_EDITABLES).
		// Cacheamos el error como permanente; la oficina cambia el estado a mano en Notion.
		return respond(500, {
			error: 'Datos enviados a Make, pero falló la actualización del estado en Notion. El parte queda en "Procesando" — cámbialo manualmente a "Datos Enviados" en Notion.',
			details: error.response?.data?.message || error.message
		})
	}

	return respond(200, {
		status: 'ok',
		parteId,
		nuevoEstado: PARTE_ESTADO_DATOS_ENVIADOS,
		modo: PARTES_WEBHOOK_CONFIGURED ? 'webhook' : 'simulado'
	})
})
// Actualizar un parte de trabajo existente — refactorizado a data.js (ADR-002)
app.put('/api/partes-trabajo/:parteId', async (req, res) => {
	try {
		const { parteId } = req.params
		const { obraId, fecha, personaAutorizadaId, notas, vehiculos, vehiculosIds, empleados, empleadosHoras } = req.body

		if (!obraId || !fecha || !personaAutorizadaId) {
			return res.status(400).json({
				error: 'Faltan campos requeridos',
				required: ['obraId', 'fecha', 'personaAutorizadaId']
			})
		}

		// Validar horas antes de tocar Notion
		if (empleados && empleadosHoras) {
			for (const empId of empleados) {
				const horasVal = empleadosHoras[empId]
				if (horasVal !== undefined) {
					const num = Number(horasVal)
					if (!Number.isFinite(num) || num < 0 || num > 24) {
						return res.status(400).json({
							error: `Horas inválidas para empleado ${empId}`,
							details: 'Las horas deben estar entre 0 y 24'
						})
					}
				}
			}
		}

		const result = await data.partesTrabajo.actualizar(parteId, {
			obraId, fecha, personaAutorizadaId, notas, vehiculos: sanearTextoPlano(vehiculos), vehiculosIds: sanearIdsRelacion(vehiculosIds), empleados, empleadosHoras
		})
		invalidarPartes()

		// Mock devuelve una página Notion-like directamente
		if (USE_MOCK_DATA) {
			return res.json(result)
		}

		const { parteActualizado, estadoAnterior, necesitaCambioEstado, detallesCreados, erroresDetalles, asignadosObraIds } = result

		if (necesitaCambioEstado) {
			console.log(JSON.stringify({ reqId: req.id, event: 'parte_estado_borrador', parteId, estadoAnterior }))
		}
		const noAsignados = (empleados || []).filter(id => !asignadosObraIds.includes(id))
		console.log(JSON.stringify({
			reqId: req.id,
			event: 'detalles_actualizados',
			parteId,
			pretendidos: empleados?.length || 0,
			creados: detallesCreados.length,
			errores: erroresDetalles,
			empleadosNoAsignadosObra: noAsignados.length,
			empleadosNoAsignadosIds: noAsignados
		}))

		let mensaje = `Parte actualizado exitosamente. ${detallesCreados.length} empleados asignados.`
		if (necesitaCambioEstado) {
			mensaje += ` ⚠️ El estado ha cambiado de "${estadoAnterior}" a "Borrador". Deberás enviar los datos nuevamente.`
		}

		res.json({
			...parteActualizado,
			empleadosActualizados: empleados?.length || 0,
			detallesCreados: detallesCreados.length,
			erroresDetalles: erroresDetalles.length,
			estadoCambiado: necesitaCambioEstado,
			estadoAnterior: necesitaCambioEstado ? estadoAnterior : null,
			estadoNuevo: necesitaCambioEstado ? 'Borrador' : null,
			mensaje
		})
	} catch (error) {
		if (error.status === 409) {
			return res.status(409).json({ error: error.message, estado: error.meta?.estado })
		}
		console.error('Error al actualizar parte de trabajo:', error.message)
		res.status(500).json({
			error: 'Error al actualizar parte de trabajo',
			details: error.message
		})
	}
})

// Crear un parte rectificativo a partir de uno firmado — refactorizado a data.js (ADR-002).
// Copia cabecera + detalles del original a un parte nuevo en Borrador, enlazado vía `Rectifica a`.
app.post('/api/partes-trabajo/:parteId/rectificar', async (req, res) => {
	try {
		const { parteId } = req.params
		const result = await data.partesTrabajo.rectificar(parteId)
		invalidarPartes()

		if (USE_MOCK_DATA) {
			return res.json(result)
		}

		const { parteData, nombreFinal, parteOriginalId, detallesCopiados, erroresDetalles } = result

		console.log(JSON.stringify({
			reqId: req.id,
			event: 'parte_rectificado',
			parteOriginalId,
			parteNuevoId: parteData.id,
			nombreFinal,
			detallesCopiados: detallesCopiados.length,
			errores: erroresDetalles
		}))

		res.json({
			...parteData,
			parteOriginalId,
			detallesCopiados: detallesCopiados.length,
			erroresDetalles: erroresDetalles.length,
			mensaje: `Parte rectificativo creado. ${detallesCopiados.length} empleados copiados.`
		})
	} catch (error) {
		if (error.status === 409) {
			return res.status(409).json({
				error: error.message,
				estado: error.meta?.estado,
				rectificadoPorId: error.meta?.rectificadoPorId
			})
		}
		if (error.status === 404) {
			return res.status(404).json({ error: error.message })
		}
		console.error('Error al rectificar parte de trabajo:', error.message)
		res.status(500).json({
			error: 'Error al rectificar parte de trabajo',
			details: error.message
		})
	}
})

// Obtener datos completos — refactorizado a data.js (ADR-002).
// Usa data.* directamente en vez de llamadas HTTP internas a sí mismo.
app.get('/api/datos-completos', async (req, res) => {
	try {
		const [obras, jefesObra, empleados, partesTrabajo] = await Promise.all([
			data.obras.listar(),
			data.jefesObra.listar(),
			data.empleados.listar(),
			data.partesTrabajo.listar()
		])
		res.json({ obras, jefesObra, empleados, partesTrabajo })
	} catch (error) {
		console.error('Error al obtener datos completos:', error.message)
		res.status(500).json({
			error: 'Error al obtener datos completos',
			details: error.message
		})
	}
})

// Ruta para servir la aplicación React (solo para rutas que no sean API)
// Mantener rutas de API por encima y servir SPA para el resto
app.get(/^(?!\/api\/).*/, (req, res) => {
	res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

// Solo arrancar listen() si server.js se ejecuta directamente (node server.js).
// Cuando se importa desde tests (require('../../server')), exporta la app sin escuchar.
if (require.main === module) {
	app.listen(PORT, () => {
		console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`)
		console.log(`📊 API disponible en http://localhost:${PORT}/api`)
		console.log(`🔍 Health check: http://localhost:${PORT}/api/health`)
		console.log(`🔑 Token de Notion: ${NOTION_TOKEN ? 'Configurado' : 'FALTANTE'}`)
		if (USE_MOCK_DATA) {
			console.log('🧪 Modo datos simulados ACTIVO (USE_MOCK_DATA)')
		}
	})
}

module.exports = app

