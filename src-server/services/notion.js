/**
 * src-server/services/notion.js
 *
 * Capa de plomería contra la API de Notion (ADR-002).
 *
 * RESPONSABILIDADES:
 * - Wrapper único de axios contra api.notion.com.
 * - Extracción tipada de propiedades Notion → valores JS planos.
 * - Construcción de payloads de actualización (estado, etc.).
 * - Mapeo página Notion → DTOs por dominio (obras, empleados, jefes, partes, detalles).
 * - Manejo homogéneo de errores 401/403/404/409/429/5xx.
 *
 * NO RESPONSABILIDADES (las asume data.js o los endpoints):
 * - Decidir qué endpoint expone qué.
 * - Validar inputs HTTP.
 * - Cache (vive en server.js de momento).
 * - Lógica de negocio (estados que bloquean edición, etc.).
 *
 * REGLA DE ORO (ADR-002): cuando un endpoint refactorizado a data.js
 * necesite tocar Notion, lo hace SIEMPRE vía data.js → notion.js.
 * Nunca vía axios directo. Los endpoints aún-no-refactorizados pueden
 * seguir usando axios directo hasta que les toque.
 */

const axios = require('axios')

const NOTION_API = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'
const DEFAULT_TIMEOUT_MS = 10000

// IDs de las bases de datos Notion. Hardcoded igual que en server.js.
// Si en el futuro se mueven a env vars, este sería el único sitio a tocar.
const DATABASES = Object.freeze({
	OBRAS: '20882593a257810083d6dc8ec0a99d58',
	JEFE_OBRAS: '20882593a25781b4a3b9e0ff5589ea4e',
	EMPLEADOS: '20882593a257814db882c4b70cb0cbab',
	PARTES_TRABAJO: '20882593a25781258595e15abb37e87a',
	DETALLES_HORA: '20882593a25781838da1fe6741abcfd9'
})

// ────────────────────────────────────────────────────────────────────────────
// Cliente HTTP
// ────────────────────────────────────────────────────────────────────────────

function getHeaders(token) {
	return {
		Authorization: `Bearer ${token}`,
		'Notion-Version': NOTION_VERSION,
		'Content-Type': 'application/json'
	}
}

/**
 * Crea un cliente Notion con token + opciones (timeout).
 * Devuelve un objeto con `request(method, endpoint, data?)`.
 * Lanza Error con `.status` y `.code` mapeados.
 */
function createClient({ token, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
	if (!token) {
		throw new Error('Token de Notion no proporcionado al crear el cliente')
	}

	async function request(method, endpoint, data = null) {
		const config = {
			method,
			url: `${NOTION_API}${endpoint}`,
			headers: getHeaders(token),
			timeout: timeoutMs
		}
		if (data) config.data = data

		let response
		try {
			response = await axios(config)
		} catch (error) {
			throw mapNotionError(error, { method, endpoint })
		}

		if (!response || !response.data) {
			const err = new Error('Respuesta inválida de Notion API')
			err.code = 'INVALID_RESPONSE'
			throw err
		}
		return response.data
	}

	return { request }
}

function mapNotionError(error, { method, endpoint }) {
	const status = error.response?.status
	const notionMessage = error.response?.data?.message || error.message
	const notionCode = error.response?.data?.code

	// Log centralizado — mantiene el formato que ya usaba server.js
	console.error(`Error en request a Notion (${method} ${endpoint}):`, {
		status,
		message: notionMessage,
		code: notionCode
	})

	let mapped
	if (status === 401) mapped = new Error('Token de Notion inválido o expirado')
	else if (status === 403) mapped = new Error('Sin permisos para acceder a la base de datos')
	else if (status === 404) mapped = new Error('Base de datos no encontrada')
	else if (status === 409) mapped = new Error('Conflicto al crear el registro. Puede ser un duplicado o problema de permisos.')
	else if (status === 429) mapped = new Error('Límite de rate limit excedido')
	else mapped = new Error(`Error de conectividad con Notion: ${error.message}`)

	mapped.status = status
	mapped.code = notionCode
	mapped.cause = error
	return mapped
}

// ────────────────────────────────────────────────────────────────────────────
// Extracción de propiedades Notion → valores JS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Convierte una propiedad Notion en su valor JS plano.
 * Idéntico a `extractPropertyValue` original en server.js — extraído sin cambios
 * de comportamiento para garantizar paridad byte-a-byte en endpoints refactorizados.
 */
function extractPropertyValue(property) {
	if (!property || !property.type) return ''

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
			if (property.rollup?.type === 'array') {
				const array = property.rollup.array
				if (array && array.length > 0) {
					const firstItem = array[0]
					if (firstItem.type === 'title') return firstItem.title?.[0]?.plain_text || ''
					if (firstItem.type === 'rich_text') return firstItem.rich_text?.[0]?.plain_text || ''
					if (firstItem.type === 'date') return firstItem.date?.start || ''
					if (firstItem.type === 'select') return firstItem.select?.name || ''
					if (firstItem.type === 'number') return firstItem.number || 0
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

/**
 * Construye el payload para actualizar una propiedad de tipo estado
 * según su tipo real en Notion (status / select / multi_select).
 * Extraído sin cambios de `buildEstadoUpdatePayload` original.
 */
function buildEstadoUpdatePayload(estadoProperty, nuevoEstado) {
	const estadoNombre = String(nuevoEstado || '').trim()
	if (!estadoNombre) throw new Error('Nombre de estado inválido')
	const tipo = estadoProperty?.type
	if (tipo === 'select') return { select: { name: estadoNombre } }
	if (tipo === 'multi_select') return { multi_select: [{ name: estadoNombre }] }
	return { status: { name: estadoNombre } }
}

// ────────────────────────────────────────────────────────────────────────────
// Mappers Notion page → DTO de dominio
//
// Cada mapper toma una página Notion cruda y devuelve un objeto JS plano
// con la forma exacta que los endpoints actuales devuelven al frontend.
// Cambiar la forma de salida = breaking change para el frontend.
// ────────────────────────────────────────────────────────────────────────────

function mapObra(page) {
	return {
		id: page.id,
		nombre: extractPropertyValue(page.properties['Obra - Codigo']),
		provincia: extractPropertyValue(page.properties['Provincia']),
		estado: extractPropertyValue(page.properties['Estado'])
	}
}

function mapJefeObra(page) {
	return {
		id: page.id,
		nombre: extractPropertyValue(page.properties['Persona Autorizada']),
		email: extractPropertyValue(page.properties[' Email'])
	}
}

function mapFirmanteAutorizado(page) {
	return {
		id: page.id,
		nombre: extractPropertyValue(page.properties['Persona Autorizada']),
		email: extractPropertyValue(page.properties[' Email']),
		rol: extractPropertyValue(page.properties['Rol']) || 'Otros'
	}
}

function mapEmpleado(page) {
	return {
		id: page.id,
		idCopuno: page.properties['ID COPUNO']?.number ?? null,
		nombre: extractPropertyValue(page.properties['Nombre Completo']),
		categoria: extractPropertyValue(page.properties['Categoría']),
		provincia: extractPropertyValue(page.properties['Provincia']),
		localidad: extractPropertyValue(page.properties['Localidad']),
		telefono: extractPropertyValue(page.properties['Teléfono']),
		dni: extractPropertyValue(page.properties['DNI']),
		estado: extractPropertyValue(page.properties['Estado']),
		delegado: extractPropertyValue(page.properties['Delegado'])
	}
}

function mapParte(page) {
	// Vínculo de rectificación (props pueden no existir todavía en Notion;
	// extractPropertyValue devuelve '' en ese caso → seguro).
	const rectificaA = extractPropertyValue(page.properties['Rectifica a '])
	const rectificadoPor = extractPropertyValue(page.properties['Rectificado por '])
	const rectificaAId = Array.isArray(rectificaA) && rectificaA[0] ? rectificaA[0].id : null
	const rectificadoPorIds = Array.isArray(rectificadoPor) ? rectificadoPor.map(r => r.id) : []

	return {
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
		firmarUrl: extractPropertyValue(page.properties['Firmar']),
		rectificaAId,
		rectificadoPorIds,
		esRectificativo: Boolean(rectificaAId)
	}
}

function mapDetalle(page) {
	return {
		id: page.id,
		empleadoId: extractPropertyValue(page.properties['Empleados']),
		empleadoNombre: extractPropertyValue(page.properties['Aux Empleado']),
		categoria: extractPropertyValue(page.properties['AUX_Categoria']),
		horas: extractPropertyValue(page.properties['Cantidad Horas']),
		fecha: extractPropertyValue(page.properties['Fecha']),
		detalle: extractPropertyValue(page.properties['Detalle'])
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Operaciones por dominio
//
// Cada función recibe `{ client }` (cliente creado con createClient) y los
// parámetros propios. Devuelven DTOs ya mapeados — los endpoints no manipulan
// jamás `page.properties.*` directamente.
// ────────────────────────────────────────────────────────────────────────────

const obras = {
	async listar({ client }) {
		const data = await client.request('POST', `/databases/${DATABASES.OBRAS}/query`, {
			page_size: 100
		})
		return data.results.map(mapObra)
	},

	async empleadosDeObra({ client, obraId }) {
		// C3 resuelto: query filtrada por relación inversa Empleados → Obras (no N+1).
		const data = await client.request('POST', `/databases/${DATABASES.EMPLEADOS}/query`, {
			filter: { property: 'Obras', relation: { contains: obraId } },
			page_size: 100
		})
		return data.results.map(mapEmpleado)
	},

	async firmantesAutorizados({ client, obraId }) {
		// Lee la obra → relación Persona Autorizada → expande cada jefe.
		// Mantiene la lectura secuencial original (no es hot path).
		let obraData
		try {
			obraData = await client.request('GET', `/pages/${obraId}`)
		} catch (e) {
			if (e.status === 404) {
				const err = new Error('Obra no encontrada')
				err.status = 404
				throw err
			}
			throw e
		}

		const relaciones = extractPropertyValue(obraData.properties['Persona Autorizada'])
		if (!relaciones || relaciones.length === 0) return []

		const firmantes = []
		for (const ref of relaciones) {
			try {
				const jefe = await client.request('GET', `/pages/${ref.id}`)
				firmantes.push(mapFirmanteAutorizado(jefe))
			} catch (e) {
				console.error(`Error al leer firmante ${ref.id}:`, e.message)
			}
		}
		return firmantes
	}
}

const jefesObra = {
	async listar({ client }) {
		const data = await client.request('POST', `/databases/${DATABASES.JEFE_OBRAS}/query`, {
			page_size: 100
		})
		return data.results.map(mapJefeObra)
	}
}

const empleados = {
	async listar({ client }) {
		const data = await client.request('POST', `/databases/${DATABASES.EMPLEADOS}/query`, {
			page_size: 100
		})
		return data.results.map(mapEmpleado)
	},

	/**
	 * Busca por ID COPUNO (number.equals).
	 * Devuelve { resultados, duplicado } — el endpoint decide qué hacer con duplicados.
	 */
	async buscarPorIdCopuno({ client, idCopuno, limite = 20 }) {
		const data = await client.request('POST', `/databases/${DATABASES.EMPLEADOS}/query`, {
			filter: { property: 'ID COPUNO', number: { equals: idCopuno } },
			page_size: limite
		})
		return {
			resultados: data.results.map(mapEmpleado),
			duplicado: data.results.length > 1
		}
	},

	/**
	 * Busca por nombre (title.contains).
	 * El endpoint valida que `q.length >= 3` antes de llamar.
	 */
	async buscarPorNombre({ client, q, limite = 20 }) {
		const data = await client.request('POST', `/databases/${DATABASES.EMPLEADOS}/query`, {
			filter: { property: 'Nombre Completo', title: { contains: q } },
			page_size: limite
		})
		return data.results.map(mapEmpleado)
	},

	/**
	 * Devuelve las opciones de la propiedad 'Estado' de EMPLEADOS,
	 * detectando dinámicamente si es status / select / checkbox.
	 */
	async opcionesEstado({ client }) {
		const db = await client.request('GET', `/databases/${DATABASES.EMPLEADOS}`)
		const prop = db.properties?.['Estado']
		if (!prop) return { type: 'unknown', options: [] }

		const type = prop.type
		let options = []
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
		return { type, options }
	},

	/**
	 * Lee la página del empleado, detecta el tipo real de la propiedad Estado
	 * y aplica el PATCH correspondiente.
	 * Lanza Error con .status = 400 si el tipo no es soportado o la prop no existe.
	 */
	async actualizarEstado({ client, empleadoId, estado }) {
		const empleadoPage = await client.request('GET', `/pages/${empleadoId}`)
		const propEstado = empleadoPage.properties?.['Estado']
		if (!propEstado) {
			const err = new Error('La propiedad "Estado" no existe en el empleado')
			err.status = 400
			throw err
		}

		let estadoPayload
		if (propEstado.type === 'status') {
			estadoPayload = { status: { name: estado } }
		} else if (propEstado.type === 'select') {
			estadoPayload = { select: { name: estado } }
		} else if (propEstado.type === 'checkbox') {
			estadoPayload = { checkbox: /^(on|activo|true|sí|si)$/i.test(estado) }
		} else {
			const err = new Error(`Tipo de propiedad Estado no soportado: ${propEstado.type}`)
			err.status = 400
			throw err
		}

		await client.request('PATCH', `/pages/${empleadoId}`, {
			properties: { 'Estado': estadoPayload }
		})
		return { ok: true, empleadoId, estado }
	}
}

const PARTE_NO_EDITABLES = ['firmado', 'datos enviados', 'procesando']

// Estados desde los que se puede emitir un parte rectificativo.
// Solo el documento ya firmado (artefacto inmutable) es rectificable.
const PARTE_RECTIFICABLES = ['firmado']

const partesTrabajo = {
	async listar({ client }) {
		const data = await client.request('POST', `/databases/${DATABASES.PARTES_TRABAJO}/query`, {
			page_size: 100,
			sorts: [{ property: 'Fecha', direction: 'descending' }]
		})
		return data.results.map(mapParte)
	},

	/** Devuelve la página Notion cruda — necesario para enviar-datos que manda el payload completo a Make. */
	async obtenerPagina({ client, parteId }) {
		return client.request('GET', `/pages/${parteId}`)
	},

	async estado({ client, parteId }) {
		const page = await client.request('GET', `/pages/${parteId}`)
		return {
			estado: extractPropertyValue(page.properties['Estado']),
			ultimaEdicion: extractPropertyValue(page.properties['Última edición'])
		}
	},

	async empleados({ client, parteId }) {
		const data = await client.request('POST', `/databases/${DATABASES.DETALLES_HORA}/query`, {
			filter: { property: 'Partes de trabajo', relation: { contains: parteId } },
			page_size: 100
		})
		return data.results.map(mapDetalle)
	},

	async detalles({ client, parteId }) {
		const [parteData, detallesData] = await Promise.all([
			client.request('GET', `/pages/${parteId}`),
			client.request('POST', `/databases/${DATABASES.DETALLES_HORA}/query`, {
				filter: { property: 'Partes de trabajo', relation: { contains: parteId } },
				page_size: 100
			})
		])
		return {
			parte: {
				id: parteData.id,
				nombre: extractPropertyValue(parteData.properties['Nombre']),
				fecha: extractPropertyValue(parteData.properties['Fecha']),
				obra: extractPropertyValue(parteData.properties['AUX Obra']),
				estado: extractPropertyValue(parteData.properties['Estado']),
				ultimaEdicion: extractPropertyValue(parteData.properties['Última edición']),
				notas: extractPropertyValue(parteData.properties['Notas']),
				personaAutorizada: extractPropertyValue(parteData.properties['Persona Autorizada']),
				firmarUrl: extractPropertyValue(parteData.properties['Firmar']),
				horasTotales: extractPropertyValue(parteData.properties['RP Horas totales'])
			},
			empleados: detallesData.results.map(mapDetalle)
		}
	},

	async crear({ client, obra, obraId, fecha, jefeObraId, notas, empleados = [], empleadosHoras = {} }) {
		const parteData = await client.request('POST', '/pages', {
			parent: { database_id: DATABASES.PARTES_TRABAJO },
			properties: {
				'Nombre': { title: [{ text: { content: `Parte temporal - ${obra}` } }] },
				'Fecha': { date: { start: fecha } },
				'Obras': { relation: [{ id: obraId }] },
				'Persona Autorizada': { relation: [{ id: jefeObraId }] },
				'Notas': { rich_text: [{ text: { content: notas || '' } }] }
			}
		})

		const parteCompleto = await client.request('GET', `/pages/${parteData.id}`)
		const notionId = extractPropertyValue(parteCompleto.properties['ID'])
		const nombreFinal = `Parte ${obra}${notionId}`

		await client.request('PATCH', `/pages/${parteData.id}`, {
			properties: { 'Nombre': { title: [{ text: { content: nombreFinal } }] } }
		})

		// F1: IDs asignados a la obra para diagnóstico en logs del endpoint
		let asignadosObraIds = []
		try {
			const obraPage = await client.request('GET', `/pages/${obraId}`)
			const rel = extractPropertyValue(obraPage.properties['Empleados'])
			if (Array.isArray(rel)) asignadosObraIds = rel.map(r => r.id)
		} catch (_) { /* no bloquear la creación si falla */ }

		const detallesCreados = []
		const erroresDetalles = []
		for (const empleadoId of empleados) {
			try {
				const horas = empleadosHoras[empleadoId] || 8
				const detalle = await client.request('POST', '/pages', {
					parent: { database_id: DATABASES.DETALLES_HORA },
					properties: {
						'Detalle': { title: [{ text: { content: 'Detalle Horas' } }] },
						'Partes de trabajo': { relation: [{ id: parteData.id }] },
						'Empleados': { relation: [{ id: empleadoId }] },
						'Cantidad Horas': { number: horas }
					}
				})
				detallesCreados.push(detalle)
				await new Promise(r => setTimeout(r, 100))
			} catch (err) {
				console.error(`Error al crear detalle para empleado ${empleadoId}:`, err.message)
				erroresDetalles.push({ empleadoId, error: err.message })
			}
		}

		return { parteData, nombreFinal, detallesCreados, erroresDetalles, asignadosObraIds }
	},

	async actualizar({ client, parteId, obraId, fecha, personaAutorizadaId, notas, empleados = [], empleadosHoras = {} }) {
		const parteActual = await client.request('GET', `/pages/${parteId}`)
		const estadoParte = extractPropertyValue(parteActual.properties['Estado'])

		if (estadoParte && PARTE_NO_EDITABLES.includes(String(estadoParte).toLowerCase())) {
			const err = new Error('El parte no es editable por su estado actual')
			err.status = 409
			err.meta = { estado: estadoParte }
			throw err
		}

		const necesitaCambioEstado = estadoParte && String(estadoParte).toLowerCase() === 'listo para firmar'

		const obraData = await client.request('GET', `/pages/${obraId}`)
		const relEmpleadosObra = extractPropertyValue(obraData.properties['Empleados'])
		const asignadosObraIds = Array.isArray(relEmpleadosObra) ? relEmpleadosObra.map(r => r.id) : []

		const propertiesToUpdate = {
			'Fecha': { date: { start: fecha } },
			'Obras': { relation: [{ id: obraId }] },
			'Persona Autorizada': { relation: [{ id: personaAutorizadaId }] },
			'Notas': { rich_text: [{ text: { content: notas || '' } }] }
		}
		if (necesitaCambioEstado) {
			propertiesToUpdate['Estado'] = { status: { name: 'Borrador' } }
		}

		const parteActualizado = await client.request('PATCH', `/pages/${parteId}`, {
			properties: propertiesToUpdate
		})

		const detallesExistentes = await client.request('POST', `/databases/${DATABASES.DETALLES_HORA}/query`, {
			filter: { property: 'Partes de trabajo', relation: { contains: parteId } },
			page_size: 100
		})
		for (const detalle of detallesExistentes.results) {
			try {
				await client.request('PATCH', `/pages/${detalle.id}`, { archived: true })
				await new Promise(r => setTimeout(r, 100))
			} catch (err) {
				console.error(`Error al archivar detalle ${detalle.id}:`, err.message)
			}
		}

		const detallesCreados = []
		const erroresDetalles = []
		for (const empleadoId of empleados) {
			try {
				const horas = empleadosHoras[empleadoId] || 8
				const detalle = await client.request('POST', '/pages', {
					parent: { database_id: DATABASES.DETALLES_HORA },
					properties: {
						'Detalle': { title: [{ text: { content: 'Detalle Horas' } }] },
						'Partes de trabajo': { relation: [{ id: parteId }] },
						'Empleados': { relation: [{ id: empleadoId }] },
						'Cantidad Horas': { number: horas }
					}
				})
				detallesCreados.push(detalle)
				await new Promise(r => setTimeout(r, 100))
			} catch (err) {
				console.error(`Error al crear detalle para empleado ${empleadoId}:`, err.message)
				erroresDetalles.push({ empleadoId, error: err.message })
			}
		}

		return {
			parteActualizado,
			estadoAnterior: estadoParte,
			necesitaCambioEstado,
			detallesCreados,
			erroresDetalles,
			asignadosObraIds
		}
	},

	async actualizarEstado({ client, parteId, estadoProperty, nuevoEstado }) {
		const payload = buildEstadoUpdatePayload(estadoProperty, nuevoEstado)
		return client.request('PATCH', `/pages/${parteId}`, {
			properties: { 'Estado': payload }
		})
	},

	/**
	 * Crea un parte rectificativo a partir de uno firmado.
	 * Copia cabecera (obra, fecha, persona autorizada, notas) y todos los
	 * Detalle Horas del original a un parte nuevo en estado Borrador, y enlaza
	 * el nuevo parte al original vía la relación reflexiva `Rectifica a`.
	 * Lanza Error con .status = 409 si el original no es rectificable.
	 */
	async rectificar({ client, parteOriginalId }) {
		const original = await client.request('GET', `/pages/${parteOriginalId}`)
		const estado = extractPropertyValue(original.properties['Estado'])

		if (!PARTE_RECTIFICABLES.includes(String(estado).toLowerCase())) {
			const err = new Error('Solo los partes firmados pueden rectificarse')
			err.status = 409
			err.meta = { estado }
			throw err
		}

		const obraRel = extractPropertyValue(original.properties['Obras'])
		const personaRel = extractPropertyValue(original.properties['Persona Autorizada'])
		const obraId = Array.isArray(obraRel) && obraRel[0] ? obraRel[0].id : null
		const jefeObraId = Array.isArray(personaRel) && personaRel[0] ? personaRel[0].id : null
		const fecha = extractPropertyValue(original.properties['Fecha'])
		const notasOriginal = extractPropertyValue(original.properties['Notas'])
		const notasRectificativo = notasOriginal
			? `PARTE RECTIFICATIVO\n${notasOriginal}`
			: 'PARTE RECTIFICATIVO'
		const obraTexto = extractPropertyValue(original.properties['AUX Obra']) || 'Obra'

		const propsNuevo = {
			'Nombre': { title: [{ text: { content: `Parte rectificativo - ${obraTexto}` } }] },
			'Notas': { rich_text: [{ text: { content: notasRectificativo } }] },
			'Rectifica a ': { relation: [{ id: parteOriginalId }] }
		}
		if (fecha) propsNuevo['Fecha'] = { date: { start: fecha } }
		if (obraId) propsNuevo['Obras'] = { relation: [{ id: obraId }] }
		if (jefeObraId) propsNuevo['Persona Autorizada'] = { relation: [{ id: jefeObraId }] }

		const parteData = await client.request('POST', '/pages', {
			parent: { database_id: DATABASES.PARTES_TRABAJO },
			properties: propsNuevo
		})

		const parteCompleto = await client.request('GET', `/pages/${parteData.id}`)
		const notionId = extractPropertyValue(parteCompleto.properties['ID'])
		const nombreFinal = `Parte ${obraTexto}${notionId}`

		await client.request('PATCH', `/pages/${parteData.id}`, {
			properties: { 'Nombre': { title: [{ text: { content: nombreFinal } }] } }
		})

		// Copiar los Detalle Horas del original al rectificativo.
		const detallesOriginal = await client.request('POST', `/databases/${DATABASES.DETALLES_HORA}/query`, {
			filter: { property: 'Partes de trabajo', relation: { contains: parteOriginalId } },
			page_size: 100
		})

		const detallesCopiados = []
		const erroresDetalles = []
		for (const detalle of detallesOriginal.results) {
			try {
				const empleadoRel = extractPropertyValue(detalle.properties['Empleados'])
				const empleadoId = Array.isArray(empleadoRel) && empleadoRel[0] ? empleadoRel[0].id : null
				if (!empleadoId) continue
				const horas = detalle.properties['Cantidad Horas']?.number ?? 8
				const nuevo = await client.request('POST', '/pages', {
					parent: { database_id: DATABASES.DETALLES_HORA },
					properties: {
						'Detalle': { title: [{ text: { content: 'Detalle Horas' } }] },
						'Partes de trabajo': { relation: [{ id: parteData.id }] },
						'Empleados': { relation: [{ id: empleadoId }] },
						'Cantidad Horas': { number: horas }
					}
				})
				detallesCopiados.push(nuevo)
				await new Promise(r => setTimeout(r, 100))
			} catch (err) {
				console.error(`Error al copiar detalle ${detalle.id} al rectificativo:`, err.message)
				erroresDetalles.push({ detalleId: detalle.id, error: err.message })
			}
		}

		return { parteData, nombreFinal, parteOriginalId, detallesCopiados, erroresDetalles }
	}
}

module.exports = {
	// Constantes
	DATABASES,
	NOTION_API,
	NOTION_VERSION,

	// Cliente
	createClient,

	// Helpers de propiedades (expuestos para endpoints aún-no-refactorizados
	// que los necesiten temporalmente desde server.js)
	extractPropertyValue,
	buildEstadoUpdatePayload,

	// Mappers
	mapObra,
	mapJefeObra,
	mapFirmanteAutorizado,
	mapEmpleado,
	mapParte,
	mapDetalle,

	// Operaciones por dominio
	obras,
	jefesObra,
	empleados,
	partesTrabajo
}
