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

const app = express()
const PORT = process.env.PORT || 3001

// Configuración de Notion (sin fallback: exigir variable de entorno)
const NOTION_TOKEN = process.env.NOTION_TOKEN
const USE_MOCK_DATA = process.env.USE_MOCK_DATA === 'true' || (NOTION_TOKEN || '').toLowerCase() === 'mock' || !NOTION_TOKEN
const PARTES_DATOS_WEBHOOK_URL = process.env.PARTES_DATOS_WEBHOOK_URL || process.env.PARTE_DATOS_WEBHOOK_URL || ''
const PARTES_WEBHOOK_TIMEOUT_MS = Number(process.env.PARTES_WEBHOOK_TIMEOUT_MS || 10000)
const PARTES_WEBHOOK_CONFIGURED = Boolean(PARTES_DATOS_WEBHOOK_URL)
const PARTE_ESTADO_BORRADOR = 'borrador'
const PARTE_ESTADO_DATOS_ENVIADOS = 'Datos Enviados'
const NOTION_API = 'https://api.notion.com/v1'

// Configuración de bases de datos corregida
const DATABASES = {
	OBRAS: '20882593a257810083d6dc8ec0a99d58',
	JEFE_OBRAS: '20882593a25781b4a3b9e0ff5589ea4e',
	EMPLEADOS: '20882593a257814db882c4b70cb0cbab',
	PARTES_TRABAJO: '20882593a25781258595e15abb37e87a',
	DETALLES_HORA: '20882593a25781838da1fe6741abcfd9'
}

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

// Middleware de logging
// (Se reemplaza el logging manual por morgan)

// Verificar token al iniciar o activar modo mock
if (!NOTION_TOKEN && !USE_MOCK_DATA) {
	console.error('ERROR: Falta la variable de entorno NOTION_TOKEN. Configure su token de Notion antes de iniciar el servidor.')
	// Finalizar proceso para evitar ejecutar sin credenciales válidas
	process.exit(1)
}

if (USE_MOCK_DATA) {
	console.warn('⚠️  Ejecutando en modo MOCK: se utilizarán datos simulados para todas las peticiones.')
}

// Rate limiting para /api con valores configurables
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000) // 15 minutos
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 100) // 100 req por ventana
const apiLimiter = rateLimit({
	windowMs: RATE_LIMIT_WINDOW_MS,
	max: RATE_LIMIT_MAX,
	standardHeaders: true,
	legacyHeaders: false,
	skip: (req) => (req.path === '/health') // no limitar health
})
app.use('/api', apiLimiter)

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

// Headers para Notion
const getNotionHeaders = () => ({
	'Authorization': `Bearer ${NOTION_TOKEN}`,
	'Notion-Version': '2022-06-28',
	'Content-Type': 'application/json'
})

// Función para validar respuesta de Notion
const validateNotionResponse = (response) => {
	if (!response || !response.data) {
		throw new Error('Respuesta inválida de Notion API')
	}
	return response.data
}

// Función para extraer valores de propiedades de Notion
const extractPropertyValue = (property) => {
	if (!property || !property.type) {
		return ''
	}

	switch (property.type) {
		case 'title':
			return property.title?.[0]?.plain_text || ''
		case 'rich_text':
			return property.rich_text?.[0]?.plain_text || ''
		case 'number':
			return property.number || 0
		case 'select':
			return property.select?.name || ''
		case 'multi_select':
			return property.multi_select?.map(opt => opt.name).join(', ') || ''
		case 'date':
			return property.date?.start || ''
		case 'checkbox':
			return property.checkbox || false
		case 'url':
			return property.url || ''
		case 'email':
			return property.email || ''
		case 'phone_number':
			return property.phone_number || ''
		case 'relation':
			return property.relation || []
		case 'rollup':
			// Manejar rollups de diferentes tipos
			if (property.rollup?.type === 'array') {
				const array = property.rollup.array
				if (array && array.length > 0) {
					const firstItem = array[0]
					if (firstItem.type === 'title') {
						return firstItem.title?.[0]?.plain_text || ''
					} else if (firstItem.type === 'rich_text') {
						return firstItem.rich_text?.[0]?.plain_text || ''
					} else if (firstItem.type === 'date') {
						return firstItem.date?.start || ''
					} else if (firstItem.type === 'select') {
						return firstItem.select?.name || ''
					} else if (firstItem.type === 'number') {
						return firstItem.number || 0
					}
				}
			}
			return ''
		case 'formula':
			return property.formula?.string || property.formula?.number || property.formula?.boolean || ''
		case 'status':
			return property.status?.name || ''
		case 'unique_id':
			return property.unique_id?.prefix + property.unique_id?.number || ''
		case 'files':
			return property.files || []
		case 'created_time':
			return property.created_time || ''
		case 'last_edited_time':
			return property.last_edited_time || ''
		default:
			return `[${property.type}]`
	}
}

const buildEstadoUpdatePayload = (estadoProperty, nuevoEstado) => {
	const estadoNombre = String(nuevoEstado || '').trim()
	if (!estadoNombre) {
		throw new Error('Nombre de estado inválido')
	}
	const tipo = estadoProperty?.type
	if (tipo === 'select') {
		return { select: { name: estadoNombre } }
	}
	if (tipo === 'multi_select') {
		return { multi_select: [{ name: estadoNombre }] }
	}
	return { status: { name: estadoNombre } }
}

// Función para hacer requests a Notion con manejo de errores
const makeNotionRequest = async (method, endpoint, data = null) => {
	if (USE_MOCK_DATA) {
		throw new Error(`Notion API no disponible en modo mock: ${method} ${endpoint}`)
	}
	try {
		const config = {
			method,
			url: `${NOTION_API}${endpoint}`,
			headers: getNotionHeaders(),
			timeout: 10000
		}

		if (data) {
			config.data = data
		}

		const response = await axios(config)
		return validateNotionResponse(response)
	} catch (error) {
		console.error(`Error en request a Notion (${method} ${endpoint}):`, {
			status: error.response?.status,
			message: error.response?.data?.message || error.message,
			code: error.response?.data?.code
		})

		if (error.response?.status === 401) {
			throw new Error('Token de Notion inválido o expirado')
		} else if (error.response?.status === 403) {
			throw new Error('Sin permisos para acceder a la base de datos')
		} else if (error.response?.status === 404) {
			throw new Error('Base de datos no encontrada')
		} else if (error.response?.status === 409) {
			throw new Error('Conflicto al crear el registro. Puede ser un duplicado o problema de permisos.')
		} else if (error.response?.status === 429) {
			throw new Error('Límite de rate limit excedido')
		} else {
			throw new Error(`Error de conectividad con Notion: ${error.message}`)
		}
	}
}

// Rutas de la API

// Health check
app.get('/api/health', (req, res) => {
	if (USE_MOCK_DATA) {
		return res.json({ ...mockStore.getHealthStatus(), mode: 'mock' })
	}
	res.json({
		status: 'ok',
		timestamp: new Date().toISOString(),
		notionToken: NOTION_TOKEN ? 'configured' : 'missing',
		mode: 'live'
	})
})

// Obtener todas las obras
app.get('/api/obras', async (req, res) => {
	try {
		if (USE_MOCK_DATA) {
			const obras = mockStore.getObras()
			return res.json(obras)
		}
		const cached = getCache('obras')
		if (cached) return res.json(cached)
		const data = await makeNotionRequest('POST', `/databases/${DATABASES.OBRAS}/query`, {
			page_size: 100
		})

		const obras = data.results.map(page => ({
			id: page.id,
			nombre: extractPropertyValue(page.properties['Obra - Codigo']),
			provincia: extractPropertyValue(page.properties['Provincia']),
			estado: extractPropertyValue(page.properties['Estado'])
		}))

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

// Obtener todos los jefes de obra
app.get('/api/jefes-obra', async (req, res) => {
	try {
		if (USE_MOCK_DATA) {
			return res.json(mockStore.getJefesObra())
		}
		const cached = getCache('jefes')
		if (cached) return res.json(cached)
		const data = await makeNotionRequest('POST', `/databases/${DATABASES.JEFE_OBRAS}/query`, {
			page_size: 100
		})

		const jefesObra = data.results.map(page => ({
			id: page.id,
			nombre: extractPropertyValue(page.properties['Persona Autorizada']),
			email: extractPropertyValue(page.properties[' Email'])
		}))

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

// Obtener todos los empleados
app.get('/api/empleados', async (req, res) => {
	try {
		if (USE_MOCK_DATA) {
			return res.json(mockStore.getEmpleados())
		}
		const cached = getCache('empleados')
		if (cached) return res.json(cached)
		const data = await makeNotionRequest('POST', `/databases/${DATABASES.EMPLEADOS}/query`, {
			page_size: 100
		})

		const empleados = data.results.map(page => ({
			id: page.id,
			nombre: extractPropertyValue(page.properties['Nombre Completo']),
			categoria: extractPropertyValue(page.properties['Categoría']),
			provincia: extractPropertyValue(page.properties['Provincia']),
			localidad: extractPropertyValue(page.properties['Localidad']),
			telefono: extractPropertyValue(page.properties['Teléfono']),
			dni: extractPropertyValue(page.properties['DNI']),
			estado: extractPropertyValue(page.properties['Estado']),
			delegado: extractPropertyValue(page.properties['Delegado'])
		}))

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

// Obtener opciones válidas de la propiedad Estado de empleados (dinámico desde Notion)
app.get('/api/empleados/estado-opciones', async (req, res) => {
	try {
		if (USE_MOCK_DATA) {
			return res.json(mockStore.getEstadoOpciones())
		}
		const db = await makeNotionRequest('GET', `/databases/${DATABASES.EMPLEADOS}`)
		const prop = db.properties?.['Estado']
		if (!prop) {
			return res.json({ type: 'unknown', options: [] })
		}

		let options = []
		let type = prop.type
		if (prop.type === 'status') {
			options = (prop.status?.options || []).map(o => ({ name: o.name, color: o.color }))
		} else if (prop.type === 'select') {
			options = (prop.select?.options || []).map(o => ({ name: o.name, color: o.color }))
		} else if (prop.type === 'checkbox') {
			options = [
				{ name: 'true', color: 'green' },
				{ name: 'false', color: 'red' }
			]
		}

		res.json({ type, options })
	} catch (error) {
		console.error('Error al obtener opciones de Estado:', error.message)
		res.status(500).json({ error: 'Error al obtener opciones de Estado', details: error.message })
	}
})

// Actualizar estado de un empleado
app.put('/api/empleados/:empleadoId/estado', async (req, res) => {
	try {
		const { empleadoId } = req.params
		const { estado } = req.body

		if (!estado || typeof estado !== 'string') {
			return res.status(400).json({ error: 'Parámetro "estado" requerido' })
		}

		if (USE_MOCK_DATA) {
			try {
				const empleado = mockStore.updateEmpleadoEstado(empleadoId, estado)
				return res.json({ ok: true, empleadoId: empleado.id, estado: empleado.estado })
			} catch (error) {
				return res.status(404).json({ error: error.message })
			}
		}

		// Obtener la página del empleado para detectar el tipo de la propiedad Estado
		const empleadoPage = await makeNotionRequest('GET', `/pages/${empleadoId}`)
		const propEstado = empleadoPage.properties?.['Estado']
		if (!propEstado) {
			return res.status(400).json({ error: 'La propiedad "Estado" no existe en el empleado' })
		}

		// Preparar payload según el tipo de la propiedad
		let estadoPayload
		if (propEstado.type === 'status') {
			estadoPayload = { status: { name: estado } }
		} else if (propEstado.type === 'select') {
			estadoPayload = { select: { name: estado } }
		} else if (propEstado.type === 'checkbox') {
			const value = /^(on|activo|true|sí|si)$/i.test(estado)
			estadoPayload = { checkbox: value }
		} else {
			return res.status(400).json({ error: `Tipo de propiedad Estado no soportado: ${propEstado.type}` })
		}

		const updated = await makeNotionRequest('PATCH', `/pages/${empleadoId}`, {
			properties: { 'Estado': estadoPayload }
		})

		res.json({ ok: true, empleadoId, estado })
	} catch (error) {
		console.error('Error al actualizar estado del empleado:', error.message)
		res.status(500).json({ error: 'Error al actualizar estado del empleado', details: error.message })
	}
})

// Obtener empleados de una obra específica
app.get('/api/obras/:obraId/empleados', async (req, res) => {
	try {
		const { obraId } = req.params

		if (USE_MOCK_DATA) {
			return res.json(mockStore.getEmpleadosPorObra(obraId))
		}

		// Obtener la obra específica para ver sus empleados relacionados
		const obraData = await makeNotionRequest('GET', `/pages/${obraId}`)

		// Extraer los IDs de empleados relacionados
		const empleadosRelacionados = extractPropertyValue(obraData.properties['Empleados'])

		if (!empleadosRelacionados || empleadosRelacionados.length === 0) {
			return res.json([])
		}

		// Obtener los detalles de cada empleado relacionado
		const empleadosDetalles = []

		for (const empleadoRef of empleadosRelacionados) {
			try {
				const empleadoData = await makeNotionRequest('GET', `/pages/${empleadoRef.id}`)

				empleadosDetalles.push({
					id: empleadoData.id,
					nombre: extractPropertyValue(empleadoData.properties['Nombre Completo']),
					categoria: extractPropertyValue(empleadoData.properties['Categoría']),
					provincia: extractPropertyValue(empleadoData.properties['Provincia']),
					localidad: extractPropertyValue(empleadoData.properties['Localidad']),
					telefono: extractPropertyValue(empleadoData.properties['Teléfono']),
					dni: extractPropertyValue(empleadoData.properties['DNI']),
					estado: extractPropertyValue(empleadoData.properties['Estado']),
					delegado: extractPropertyValue(empleadoData.properties['Delegado'])
				})
			} catch (error) {
				console.error(`Error al obtener empleado ${empleadoRef.id}:`, error.message)
			}
		}

		res.json(empleadosDetalles)
	} catch (error) {
		console.error('Error al obtener empleados de la obra:', error.message)
		res.status(500).json({
			error: 'Error al obtener empleados de la obra',
			details: error.message
		})
	}
})

// Obtener todos los partes de trabajo
app.get('/api/partes-trabajo', async (req, res) => {
	try {
		if (USE_MOCK_DATA) {
			return res.json(mockStore.getPartesTrabajo())
		}
		const data = await makeNotionRequest('POST', `/databases/${DATABASES.PARTES_TRABAJO}/query`, {
			page_size: 100,
			sorts: [
				{
					property: 'Fecha',
					direction: 'descending'
				}
			]
		})

		const partesTrabajo = data.results.map(page => ({
			id: page.id,
			nombre: extractPropertyValue(page.properties['Nombre']),
			fecha: extractPropertyValue(page.properties['Fecha']),
			ultimaEdicion: extractPropertyValue(page.properties['Última edición']),
			estado: extractPropertyValue(page.properties['Estado']),
			obra: extractPropertyValue(page.properties['AUX Obra']),
			personaAutorizada: extractPropertyValue(page.properties['AUX Jefe de Obra']),
			cliente: extractPropertyValue(page.properties['AUX Cliente - texto-']),
			rpHorasTotales: extractPropertyValue(page.properties['RP Horas totales']),
			horasOficial1: extractPropertyValue(page.properties['Horas Oficial 1ª']),
			horasOficial2: extractPropertyValue(page.properties['Horas Oficial 2ª ']),
			horasCapataz: extractPropertyValue(page.properties['Horas Capataz']),
			horasEncargado: extractPropertyValue(page.properties['Horas Encargado ']),
			urlPDF: extractPropertyValue(page.properties['URL PDF']),
			enviadoCliente: extractPropertyValue(page.properties['Enviado a cliente']),
			notas: extractPropertyValue(page.properties['Notas']),
			firmarUrl: extractPropertyValue(page.properties['Firmar'])
		}))

		res.json(partesTrabajo)
	} catch (error) {
		console.error('Error al obtener partes de trabajo:', error.message)
		res.status(500).json({
			error: 'Error al obtener partes de trabajo',
			details: error.message
		})
	}
})

// Crear un nuevo parte de trabajo
app.post('/api/partes-trabajo', async (req, res) => {
	try {
		const { obra, obraId, fecha, jefeObraId, notas, empleados, empleadosHoras } = req.body

		if (!obra || !obraId || !fecha || !jefeObraId) {
			return res.status(400).json({
				error: 'Faltan campos requeridos',
				required: ['obra', 'obraId', 'fecha', 'jefeObraId']
			})
		}

		if (USE_MOCK_DATA) {
			try {
				const parte = mockStore.createParteTrabajo({
					obra,
					obraId,
					fecha,
					jefeObraId,
					notas,
					empleados,
					empleadosHoras
				})
				return res.json(parte)
			} catch (error) {
				return res.status(400).json({
					error: 'Error al crear parte de trabajo',
					details: error.message
				})
			}
		}

		// Crear el parte de trabajo con nombre temporal
		const parteData = await makeNotionRequest('POST', '/pages', {
			parent: { database_id: DATABASES.PARTES_TRABAJO },
			properties: {
				'Nombre': {
					title: [
						{
							text: {
								content: `Parte temporal - ${obra}`
							}
						}
					]
				},
				'Fecha': {
					date: {
						start: fecha
					}
				},
				'Obras': {
					relation: [
						{
							id: obraId
						}
					]
				},
				'Persona Autorizada': {
					relation: [
						{
							id: jefeObraId
						}
					]
				},
				'Notas': {
					rich_text: [
						{
							text: {
								content: notas || ''
							}
						}
					]
				}
			}
		})

		// Obtener el ID único de Notion del parte recién creado
		const parteCompleto = await makeNotionRequest('GET', `/pages/${parteData.id}`)
		const notionId = extractPropertyValue(parteCompleto.properties['ID'])

		// Construir el nombre final: Parte + espacio + NombreObra + ID
		const nombreFinal = `Parte ${obra}${notionId}`

		// Actualizar el nombre del parte con el formato correcto
		await makeNotionRequest('PATCH', `/pages/${parteData.id}`, {
			properties: {
				'Nombre': {
					title: [
						{
							text: {
								content: nombreFinal
							}
						}
					]
				}
			}
		})

		console.log(`✅ Parte creado con nombre: ${nombreFinal}`)

		// Crear detalles de horas para cada empleado seleccionado
		let detallesCreados = []
		let erroresDetalles = []

		if (empleados && empleados.length > 0) {
			for (const empleadoId of empleados) {
				try {
					const horas = empleadosHoras[empleadoId] || 8

					const detalleData = await makeNotionRequest('POST', '/pages', {
						parent: { database_id: DATABASES.DETALLES_HORA },
						properties: {
							'Detalle': {
								title: [
									{
										text: {
											content: `Detalle Horas`
										}
									}
								]
							},
							'Partes de trabajo': {
								relation: [
									{
										id: parteData.id
									}
								]
							},
							'Empleados': {
								relation: [
									{
										id: empleadoId
									}
								]
							},
							'Cantidad Horas': {
								number: horas
							}
						}
					})

					detallesCreados.push(detalleData)

					// Pausa entre requests para evitar rate limiting
					await new Promise(resolve => setTimeout(resolve, 100))

				} catch (error) {
					console.error(`Error al crear detalle para empleado ${empleadoId}:`, error.message)
					erroresDetalles.push({ empleadoId, error: error.message })
				}
			}

			// Log de resultados
			console.log(`✅ Detalles creados: ${detallesCreados.length}/${empleados.length}`)
			if (erroresDetalles.length > 0) {
				console.log(`❌ Errores en detalles:`, erroresDetalles)
			}
		}

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

// Obtener detalles de empleados de un parte específico
app.get('/api/partes-trabajo/:parteId/empleados', async (req, res) => {
	try {
		const { parteId } = req.params

		if (USE_MOCK_DATA) {
			return res.json(mockStore.getDetallesEmpleados(parteId))
		}

		// Obtener detalles de horas para este parte
		const data = await makeNotionRequest('POST', `/databases/${DATABASES.DETALLES_HORA}/query`, {
			filter: {
				property: 'Partes de trabajo',
				relation: {
					contains: parteId
				}
			},
			page_size: 100
		})

		const detallesEmpleados = data.results.map(detalle => ({
			id: detalle.id,
			empleadoId: extractPropertyValue(detalle.properties['Empleados']),
			empleadoNombre: extractPropertyValue(detalle.properties['Aux Empleado']),
			categoria: extractPropertyValue(detalle.properties['AUX_Categoria']),
			horas: extractPropertyValue(detalle.properties['Cantidad Horas']),
			fecha: extractPropertyValue(detalle.properties['Fecha']),
			detalle: extractPropertyValue(detalle.properties['Detalle'])
		}))

		res.json(detallesEmpleados)
	} catch (error) {
		console.error('Error al obtener detalles de empleados del parte:', error.message)
		res.status(500).json({
			error: 'Error al obtener detalles de empleados del parte',
			details: error.message
		})
	}
})

// Obtener detalles completos de un parte específico
app.get('/api/partes-trabajo/:parteId/detalles', async (req, res) => {
	try {
		const { parteId } = req.params

		if (USE_MOCK_DATA) {
			try {
				return res.json(mockStore.getParteDetallesCompletos(parteId))
			} catch (error) {
				return res.status(404).json({ error: error.message })
			}
		}

		// Obtener el parte específico
		const parteData = await makeNotionRequest('GET', `/pages/${parteId}`)

		// Extraer la Persona Autorizada
		const personaAutorizada = extractPropertyValue(parteData.properties['Persona Autorizada'])

		// Obtener detalles de empleados
		const detallesData = await makeNotionRequest('POST', `/databases/${DATABASES.DETALLES_HORA}/query`, {
			filter: {
				property: 'Partes de trabajo',
				relation: {
					contains: parteId
				}
			},
			page_size: 100
		})

		const detallesEmpleados = detallesData.results.map(detalle => ({
			id: detalle.id,
			empleadoId: extractPropertyValue(detalle.properties['Empleados']),
			empleadoNombre: extractPropertyValue(detalle.properties['Aux Empleado']),
			categoria: extractPropertyValue(detalle.properties['AUX_Categoria']),
			horas: extractPropertyValue(detalle.properties['Cantidad Horas']),
			fecha: extractPropertyValue(detalle.properties['Fecha']),
			detalle: extractPropertyValue(detalle.properties['Detalle'])
		}))

		res.json({
			parte: {
				id: parteData.id,
				nombre: extractPropertyValue(parteData.properties['Nombre']),
				fecha: extractPropertyValue(parteData.properties['Fecha']),
				obra: extractPropertyValue(parteData.properties['AUX Obra']),
				estado: extractPropertyValue(parteData.properties['Estado']),
				ultimaEdicion: extractPropertyValue(parteData.properties['Última edición']),
				notas: extractPropertyValue(parteData.properties['Notas']),
				personaAutorizada: personaAutorizada,
				firmarUrl: extractPropertyValue(parteData.properties['Firmar']),
				horasTotales: extractPropertyValue(parteData.properties['RP Horas totales'])
			},
			empleados: detallesEmpleados
		})
	} catch (error) {
		console.error('Error al obtener detalles completos del parte:', error.message)
		res.status(500).json({
			error: 'Error al obtener detalles completos del parte',
			details: error.message
		})
	}
})

// Obtener solo el estado y última edición de un parte (consulta puntual)
app.get('/api/partes-trabajo/:parteId/estado', async (req, res) => {
	try {
		const { parteId } = req.params
		if (USE_MOCK_DATA) {
			try {
				return res.json(mockStore.getParteEstado(parteId))
			} catch (error) {
				return res.status(404).json({ error: error.message })
			}
		}
		const parteData = await makeNotionRequest('GET', `/pages/${parteId}`)
		res.json({
			estado: extractPropertyValue(parteData.properties['Estado']),
			ultimaEdicion: extractPropertyValue(parteData.properties['Última edición'])
		})
	} catch (error) {
		console.error('Error al obtener estado del parte:', error.message)
		res.status(500).json({ error: 'Error al obtener estado del parte', details: error.message })
	}
})

// Stream de estado del parte (SSE): emite cambios en tiempo (casi) real
app.get('/api/partes-trabajo/:parteId/estado/stream', async (req, res) => {
	const { parteId } = req.params
	res.writeHead(200, {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache',
		Connection: 'keep-alive'
	})

	let closed = false
	req.on('close', () => { closed = true })

	let lastEstado = null
	let lastEdit = null

	if (USE_MOCK_DATA) {
		try {
			const snapshot = mockStore.getParteEstado(parteId)
			res.write(`data: ${JSON.stringify(snapshot)}\n\n`)
		} catch (error) {
			res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`)
		}

		const interval = setInterval(() => {
			if (closed) {
				clearInterval(interval)
				return
			}
			res.write(': heartbeat\n\n')
		}, 2000) // Reducido de 5s a 2s para mayor frecuencia

		return
	}

	const send = (obj) => {
		res.write(`data: ${JSON.stringify(obj)}\n\n`)
	}

	// Smart Polling en SSE: ajusta frecuencia según cambios detectados
	let lastChangeTime = Date.now()
	let currentInterval = 3000 // Empezar en modo rápido
	let intervalId = null

	const getSmartInterval = () => {
		const timeSinceChange = Date.now() - lastChangeTime
		if (timeSinceChange < 30000) return 3000 // Modo rápido: cambios recientes (<30s)
		if (timeSinceChange < 120000) return 8000 // Modo normal: sin cambios <2min
		return 15000 // Modo lento: sin cambios >2min
	}

	// Función de sondeo
	const poll = async () => {
		try {
			const parteData = await makeNotionRequest('GET', `/pages/${parteId}`)
			const estado = extractPropertyValue(parteData.properties['Estado'])
			const ultimaEdicion = extractPropertyValue(parteData.properties['Última edición'])

			if (estado !== lastEstado || ultimaEdicion !== lastEdit) {
				lastEstado = estado
				lastEdit = ultimaEdicion
				lastChangeTime = Date.now() // Actualizar tiempo del último cambio
				send({ estado, ultimaEdicion })

				// Reiniciar polling con intervalo rápido
				const newInterval = getSmartInterval()
				if (newInterval !== currentInterval) {
					currentInterval = newInterval
					if (intervalId) clearInterval(intervalId)
					intervalId = setInterval(pollLoop, currentInterval)
				}
			} else {
				// Sin cambios, verificar si necesitamos ajustar intervalo
				const newInterval = getSmartInterval()
				if (newInterval !== currentInterval) {
					currentInterval = newInterval
					if (intervalId) clearInterval(intervalId)
					intervalId = setInterval(pollLoop, currentInterval)
				}
				// latidos para mantener vivo el stream
				res.write(': heartbeat\n\n')
			}
		} catch (e) {
			res.write(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`)
		}
	}

	const pollLoop = async () => {
		if (closed) {
			if (intervalId) clearInterval(intervalId)
			return
		}
		await poll()
	}

	// Primer envío inmediato
	await poll()
	// Iniciar polling adaptativo
	intervalId = setInterval(pollLoop, currentInterval)
})
app.post('/api/partes-trabajo/:parteId/enviar-datos', async (req, res) => {
	const { parteId } = req.params
	if (!parteId) {
		return res.status(400).json({ error: 'ID de parte requerido' })
	}

	if (USE_MOCK_DATA) {
		try {
			const resultado = mockStore.sendParteDatos(parteId)
			return res.json({
				status: 'ok',
				parteId,
				nuevoEstado: resultado.parte.estado,
				modo: 'mock'
			})
		} catch (error) {
			const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'INVALID_STATE' ? 409 : 400
			return res.status(status).json({
				error: error.message,
				estado: error.meta?.estado
			})
		}
	}

	let parteData
	try {
		parteData = await makeNotionRequest('GET', `/pages/${parteId}`)
	} catch (error) {
		console.error('Error al recuperar parte antes de enviar datos:', {
			message: error.message,
			status: error.response?.status
		})
		const status = error.response?.status === 404 ? 404 : 500
		return res.status(status).json({
			error: 'No se pudo recuperar el parte desde Notion',
			details: error.response?.data?.message || error.message
		})
	}

	if (!parteData || !parteData.properties) {
		return res.status(404).json({ error: 'Parte no encontrado en Notion' })
	}

	const estadoActual = extractPropertyValue(parteData.properties['Estado']) || ''
	if (String(estadoActual).toLowerCase() !== PARTE_ESTADO_BORRADOR) {
		return res.status(409).json({
			error: 'Solo los partes en estado Borrador pueden enviarse',
			estado: estadoActual
		})
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
			return res.status(error.response?.status || 502).json({
				error: 'No se pudo enviar los datos al webhook configurado',
				details: error.response?.data?.error || error.response?.data?.message || error.message
			})
		}
	} else {
		console.warn('Webhook no configurado. Registrando payload localmente para diagnóstico.')
		console.info('Payload parte enviado (simulado):', JSON.stringify(payload, null, 2))
	}

	try {
		await makeNotionRequest('PATCH', `/pages/${parteId}`, {
			properties: {
				'Estado': buildEstadoUpdatePayload(parteData.properties['Estado'], PARTE_ESTADO_DATOS_ENVIADOS)
			}
		})
	} catch (error) {
		console.error('Error al actualizar estado del parte tras enviar datos:', {
			message: error.message,
			status: error.response?.status
		})
		return res.status(500).json({
			error: 'Datos enviados, pero falló la actualización del estado en Notion',
			details: error.response?.data?.message || error.message
		})
	}

	res.json({
		status: 'ok',
		parteId,
		nuevoEstado: PARTE_ESTADO_DATOS_ENVIADOS,
		modo: PARTES_WEBHOOK_CONFIGURED ? 'webhook' : 'simulado'
	})
})
// Actualizar un parte de trabajo existente
app.put('/api/partes-trabajo/:parteId', async (req, res) => {
	try {
		const { parteId } = req.params
		const { obraId, fecha, personaAutorizadaId, notas, empleados, empleadosHoras } = req.body

		if (!obraId || !fecha || !personaAutorizadaId) {
			return res.status(400).json({
				error: 'Faltan campos requeridos',
				required: ['obraId', 'fecha', 'personaAutorizadaId']
			})
		}

		if (USE_MOCK_DATA) {
			try {
				const parte = mockStore.updateParteTrabajo(parteId, {
					obraId,
					fecha,
					personaAutorizadaId,
					notas,
					empleados,
					empleadosHoras
				})
				return res.json(parte)
			} catch (error) {
				if (error.code === 'NOT_EDITABLE') {
					return res.status(409).json({
						error: error.message,
						estado: error.meta?.estado
					})
				}
				return res.status(400).json({
					error: 'Error al actualizar parte de trabajo',
					details: error.message
				})
			}
		}

		// Validar que el parte sea editable según su estado actual
		let estadoAnterior = null
		let necesitaCambioEstado = false
		try {
			const parteActual = await makeNotionRequest('GET', `/pages/${parteId}`)
			const estadoParte = extractPropertyValue(parteActual.properties['Estado'])
			estadoAnterior = estadoParte

			const noEditables = ['firmado', 'datos enviados', 'enviado']
			if (estadoParte && noEditables.includes(String(estadoParte).toLowerCase())) {
				return res.status(409).json({
					error: 'El parte no es editable por su estado actual',
					estado: estadoParte
				})
			}

			// Si el estado es "Listo para firmar", marcar que necesita cambio a "Borrador"
			if (estadoParte && String(estadoParte).toLowerCase() === 'listo para firmar') {
				necesitaCambioEstado = true
				console.log(`⚠️ Parte ${parteId} está en "Listo para firmar", se cambiará a "Borrador" al editar`)
			}
		} catch (e) {
			console.warn('Aviso: no se pudo validar el estado del parte antes de editar:', e.message)
		}

		// Validar horas por empleado si vienen definidas
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

		// Obtener la obra para el nombre
		const obraData = await makeNotionRequest('GET', `/pages/${obraId}`)
		const nombreObra = extractPropertyValue(obraData.properties['Obra'])

		// Preparar propiedades para actualizar
		const propertiesToUpdate = {
			'Fecha': {
				date: {
					start: fecha
				}
			},
			'Obras': {
				relation: [
					{
						id: obraId
					}
				]
			},
			'Persona Autorizada': {
				relation: [
					{
						id: personaAutorizadaId
					}
				]
			},
			'Notas': {
				rich_text: [
					{
						text: {
							content: notas || ''
						}
					}
				]
			}
		}

		// Si el parte estaba en "Listo para firmar", cambiar el estado a "Borrador"
		if (necesitaCambioEstado) {
			propertiesToUpdate['Estado'] = {
				status: {
					name: 'Borrador'
				}
			}
			console.log(`✅ Cambiando estado del parte ${parteId} de "${estadoAnterior}" a "Borrador"`)
		}

		// Actualizar el parte de trabajo
		const parteActualizado = await makeNotionRequest('PATCH', `/pages/${parteId}`, {
			properties: propertiesToUpdate
		})

		// Obtener detalles existentes para este parte
		const detallesExistentes = await makeNotionRequest('POST', `/databases/${DATABASES.DETALLES_HORA}/query`, {
			filter: {
				property: 'Partes de trabajo',
				relation: {
					contains: parteId
				}
			},
			page_size: 100
		})

		// Archivar detalles existentes (en lugar de eliminarlos)
		for (const detalle of detallesExistentes.results) {
			try {
				await makeNotionRequest('PATCH', `/pages/${detalle.id}`, {
					archived: true
				})
				// Pausa entre requests para evitar rate limiting
				await new Promise(resolve => setTimeout(resolve, 100))
			} catch (error) {
				console.error(`Error al archivar detalle ${detalle.id}:`, error.message)
			}
		}

		// Crear nuevos detalles de horas para cada empleado seleccionado
		let detallesCreados = []
		let erroresDetalles = []

		if (empleados && empleados.length > 0) {
			for (const empleadoId of empleados) {
				try {
					const horas = empleadosHoras[empleadoId] || 8

					const detalleData = await makeNotionRequest('POST', '/pages', {
						parent: { database_id: DATABASES.DETALLES_HORA },
						properties: {
							'Detalle': {
								title: [
									{
										text: {
											content: `Detalle Horas`
										}
									}
								]
							},
							'Partes de trabajo': {
								relation: [
									{
										id: parteId
									}
								]
							},
							'Empleados': {
								relation: [
									{
										id: empleadoId
									}
								]
							},
							'Cantidad Horas': {
								number: horas
							}
						}
					})

					detallesCreados.push(detalleData)

					// Pausa entre requests para evitar rate limiting
					await new Promise(resolve => setTimeout(resolve, 100))

				} catch (error) {
					console.error(`Error al crear detalle para empleado ${empleadoId}:`, error.message)
					erroresDetalles.push({ empleadoId, error: error.message })
				}
			}

			// Log de resultados
			console.log(`✅ Detalles actualizados: ${detallesCreados.length}/${empleados.length}`)
			if (erroresDetalles.length > 0) {
				console.log(`❌ Errores en detalles:`, erroresDetalles)
			}
		}

		// Construir mensaje de respuesta
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
			mensaje: mensaje
		})
	} catch (error) {
		console.error('Error al actualizar parte de trabajo:', error.message)
		res.status(500).json({
			error: 'Error al actualizar parte de trabajo',
			details: error.message
		})
	}
})

// Obtener datos completos
app.get('/api/datos-completos', async (req, res) => {
	try {
		if (USE_MOCK_DATA) {
			return res.json({
				obras: mockStore.getObras(),
				jefesObra: mockStore.getJefesObra(),
				empleados: mockStore.getEmpleados(),
				partesTrabajo: mockStore.getPartesTrabajo()
			})
		}
		const [obrasRes, jefesObraRes, empleadosRes, partesTrabajoRes] = await Promise.all([
			axios.get(`${req.protocol}://${req.get('host')}/api/obras`),
			axios.get(`${req.protocol}://${req.get('host')}/api/jefes-obra`),
			axios.get(`${req.protocol}://${req.get('host')}/api/empleados`),
			axios.get(`${req.protocol}://${req.get('host')}/api/partes-trabajo`)
		])

		res.json({
			obras: obrasRes.data,
			jefesObra: jefesObraRes.data,
			empleados: empleadosRes.data,
			partesTrabajo: partesTrabajoRes.data
		})
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

app.listen(PORT, () => {
	console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`)
	console.log(`📊 API disponible en http://localhost:${PORT}/api`)
	console.log(`🔍 Health check: http://localhost:${PORT}/api/health`)
	console.log(`🔑 Token de Notion: ${NOTION_TOKEN ? 'Configurado' : 'FALTANTE'}`)
	if (USE_MOCK_DATA) {
		console.log('🧪 Modo datos simulados ACTIVO (USE_MOCK_DATA)')
	}
}) 
