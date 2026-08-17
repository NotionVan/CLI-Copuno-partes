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
	DETALLES_HORA: '20882593a25781838da1fe6741abcfd9',
	VEHICULOS: 'fa4028b246494415aee021f3569ce8f8'
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

// El title de una BD Notion puede renombrarse en cualquier momento desde la UI
// (pasó con EMPLEADOS: 'Nombre Completo' → '' y los nombres salían vacíos y la
// búsqueda devolvía 400). Leerlo por TIPO lo hace inmune a renombres.
function titleDe(page) {
	for (const prop of Object.values(page.properties || {})) {
		if (prop.type === 'title') return extractPropertyValue(prop)
	}
	return ''
}

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
		nombre: titleDe(page),
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
		cliente: extractPropertyValue(page.properties['AUX Cliente - texto- ']), // OJO espacio final — así se llama en Notion
		rpHorasTotales: extractPropertyValue(page.properties['RP Horas totales']),
		horasOficial1: extractPropertyValue(page.properties['Horas Oficial 1ª']),
		horasOficial2: extractPropertyValue(page.properties['Horas Oficial 2ª ']),
		horasCapataz: extractPropertyValue(page.properties['Horas Capataz']),
		horasEncargado: extractPropertyValue(page.properties['Horas Encargado ']),
		urlPDF: extractPropertyValue(page.properties['URL PDF']),
		enviadoCliente: extractPropertyValue(page.properties['Enviado a cliente']),
		notas: extractPropertyValue(page.properties['Notas']),
		// 'Vehiculos' (rich_text) es el espejo de texto que consume Make/PDF;
		// 'Vehiculos ' (relation, OJO espacio final) es la fuente de verdad.
		vehiculos: extractPropertyValue(page.properties['Vehiculos']),
		vehiculosIds: (extractPropertyValue(page.properties['Vehiculos ']) || []).map?.(r => r.id) || [],
		firmarUrl: extractPropertyValue(page.properties['Firmar']),
		rectificaAId,
		rectificadoPorIds,
		esRectificativo: Boolean(rectificaAId)
	}
}

function mapVehiculo(page) {
	return {
		id: page.id,
		matricula: extractPropertyValue(page.properties['Matrícula']),
		tipo: extractPropertyValue(page.properties['Tipo']),
		marcaModelo: extractPropertyValue(page.properties['Marca / Modelo']),
		estado: extractPropertyValue(page.properties['Estado'])
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
		// Filtramos por Estado=Activa para no superar el límite de 100 y mostrar
		// solo las obras relevantes en el desplegable de crear/editar parte.
		const data = await client.request('POST', conProps(`/databases/${DATABASES.OBRAS}/query`, PROPS_CATALOGO.OBRAS), {
			filter: { property: 'Estado', status: { equals: 'Activa' } },
			page_size: 100
		})
		return data.results.map(mapObra)
	},

	async empleadosDeObra({ client, obraId }) {
		// C3 resuelto: query filtrada por relación inversa Empleados → Obras (no N+1).
		const data = await client.request('POST', conProps(`/databases/${DATABASES.EMPLEADOS}/query`, PROPS_CATALOGO.EMPLEADOS), {
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
				const jefe = await client.request('GET', conProps(`/pages/${ref.id}`, PROPS_CATALOGO.JEFE_OBRAS))
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
		const data = await client.request('POST', conProps(`/databases/${DATABASES.JEFE_OBRAS}/query`, PROPS_CATALOGO.JEFE_OBRAS), {
			page_size: 100
		})
		return data.results.map(mapJefeObra)
	}
}

const empleados = {
	async listar({ client }) {
		const data = await client.request('POST', conProps(`/databases/${DATABASES.EMPLEADOS}/query`, PROPS_CATALOGO.EMPLEADOS), {
			page_size: 100
		})
		return data.results.map(mapEmpleado)
	},

	/**
	 * Busca por ID COPUNO (number.equals).
	 * Devuelve { resultados, duplicado } — el endpoint decide qué hacer con duplicados.
	 */
	async buscarPorIdCopuno({ client, idCopuno, limite = 20 }) {
		const data = await client.request('POST', conProps(`/databases/${DATABASES.EMPLEADOS}/query`, PROPS_CATALOGO.EMPLEADOS), {
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
		const data = await client.request('POST', conProps(`/databases/${DATABASES.EMPLEADOS}/query`, PROPS_CATALOGO.EMPLEADOS), {
			// 'title' es el ID canónico de la propiedad título: sobrevive a renombres
			filter: { property: 'title', title: { contains: q } },
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
// Los dos estados "cerrados" (bloqueados para edición directa): el firmado
// y el que ya tiene datos enviados/PDF generado.
const PARTE_RECTIFICABLES = ['firmado', 'datos enviados']

/**
 * Propiedades Notion del campo Vehículos de un parte a partir del texto de
 * matrículas y los page IDs de la BD Vehículos. Escribe siempre las dos caras:
 * - 'Vehiculos ' (relation, OJO espacio final): fuente de verdad parte↔flota.
 * - 'Vehiculos' (rich_text): espejo de texto que consume Make → PDF.
 * El texto se normaliza (separador ', ', sin coma final ni caracteres de control).
 */
function buildVehiculosProps(vehiculosTexto, vehiculosIds) {
	const texto = String(vehiculosTexto || '')
		.replace(/[\n\r\t]+/g, ' ')
		.split(',')
		.map(t => t.trim())
		.filter(Boolean)
		.join(', ')
	const ids = Array.isArray(vehiculosIds) ? vehiculosIds.filter(Boolean) : []
	return {
		'Vehiculos': { rich_text: [{ text: { content: texto } }] },
		'Vehiculos ': { relation: ids.map(id => ({ id })) }
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Exportación a CSV para los cuadrantes de Chorus (macro de Copuno)
//
// Contrato del CSV y reglas de negocio: docs/EXPORT_CHORUS_CSV.md
//
// POR QUÉ SE PAGINA: no se puede resolver un mes entero en una sola petición
// HTTP. Atacar `Partes de trabajo` parte a parte cuesta ~300 llamadas (1-2 min).
// Incluso atacando `Detalle Horas` directamente, un mes de 3 obras son ~11 s y el
// crecimiento previsto (de 3 a 140 obras) lo multiplica. Por eso el endpoint
// devuelve UNA página de Notion por llamada y el cliente itera: cada request
// queda muy por debajo del timeout de la función serverless, sea cual sea el plan.
//
// La agregación final por (obra, trabajador, fecha) la hace el cliente cuando ya
// tiene todas las páginas — es la única parte que necesita ver el conjunto entero.
// ────────────────────────────────────────────────────────────────────────────

// Cache de resolución de páginas por ID (empleado/obra). Los mismos IDs se
// repiten muchísimo entre páginas de detalles (en junio 2026: 17 empleados para
// 260 detalles), así que la primera página resuelve casi todo y el resto es
// prácticamente gratis. TTL amplio: son datos maestros que cambian poco y una
// exportación completa puede durar más que el TTL de catálogos (30 s).
const RESOLUCION_TTL_MS = 10 * 60 * 1000
const resolucionCache = new Map()

// IDs de propiedad para `filter_properties`: Notion devuelve TODAS las propiedades
// de cada página salvo que se le pidan explícitamente unas pocas, y estas BDs tienen
// ~60 propiedades. Acotarlas baja el payload de un mes de 410 KB a 37 KB y el tiempo
// de 3,9 s a 0,6 s (medido sobre junio 2026). Los IDs son estables aunque se renombre
// la propiedad; vienen ya URL-encoded tal y como los devuelve la API.
// Obtenerlos con: GET /v1/databases/<id> → .properties['<nombre>'].id
// F2 (BE-1): las queries de catálogo traían ~50-60 propiedades por página cuando
// los mappers usan 3-20. Con filter_properties el payload de partes baja de
// ~935 KB a ~340 KB y la query de 3,5 s a ~2,5 s (medido). La lista de cada BD
// es EXACTAMENTE lo que lee su mapper — ni una menos (un ID omitido = campo
// undefined silencioso). IDs vía GET /v1/databases/<id>, verificados 2026-08-17.
const PROPS_CATALOGO = Object.freeze({
	// mapObra: Obra - Codigo (title), Provincia, Estado
	OBRAS: ['title', 'Z%7BQq', '%60%60%40K'],
	// mapJefeObra/mapFirmanteAutorizado: Persona Autorizada (title), ' Email', Rol
	JEFE_OBRAS: ['title', 'mOK%5E', 'hX%3F%7B'],
	// mapEmpleado: title, ID COPUNO, Categoría, Provincia, Localidad, Teléfono, DNI, Estado, Delegado
	EMPLEADOS: ['title', 'ttZi', '%3AAQe', 'X~zG', 'l%3FMZ', 'dCli', 'wV%5EZ', '%60Qg%5D', '%40%60Ju'],
	// mapParte: Nombre (title), Fecha, Última edición, Estado, AUX Obra, AUX Jefe de Obra,
	// AUX Cliente - texto- , RP Horas totales, Horas O1ª, Horas O2ª , Horas Capataz,
	// Horas Encargado , URL PDF, Enviado a cliente, Notas, Vehiculos, Vehiculos , Firmar,
	// Rectifica a , Rectificado por
	PARTES: ['title', 'FhR%5E', '%60VGH', 'vFUO', 'CsZU', 'Jt%3FS', '%3EaPO', 'qA%7DH', 'Itm_', 'f%3F%5C%5B', 'L_%5DL', 'XeRY', 'VOLq', 'HuYd', 'd%3Cev', 'b%60%3AZ', 'V%5B%3DZ', 'XPMw', 'b~Fc', 'i~K%3E'],
	// partesTrabajo.estado: Estado + Última edición — el GET más poleado de la app
	ESTADO_PARTE: ['vFUO', '%60VGH']
})

const PROPS_EXPORT = Object.freeze({
	PARTES: ['vFUO', 'i~K%3E'], // Estado, 'Rectificado por '
	DETALLES: ['T_%5Bi', 'A%7DJl', '%3BpXM', 'HF%5Dc', 'rerm'], // Cantidad Horas, Fecha, Empleados, Partes de trabajo, AUX Obra del parte
	EMPLEADOS: ['ttZi', 'title'], // ID COPUNO, Nombre Completo
	OBRAS: ['hNqa', 'title'] // Código Obra, Obra - Codigo
})

/** Añade filter_properties a un endpoint (los IDs ya vienen URL-encoded). */
function conProps(endpoint, propIds) {
	const sep = endpoint.includes('?') ? '&' : '?'
	return endpoint + sep + propIds.map(id => `filter_properties=${id}`).join('&')
}

function getResuelto(id) {
	const e = resolucionCache.get(id)
	if (!e) return undefined
	if (Date.now() - e.ts > RESOLUCION_TTL_MS) {
		resolucionCache.delete(id)
		return undefined
	}
	return e.value
}

function setResuelto(id, value) {
	resolucionCache.set(id, { ts: Date.now(), value })
}

/** Resuelve N páginas por ID con concurrencia acotada (evita ráfagas a Notion). */
async function resolverPaginas({ client, ids, mapear, propIds, concurrencia = 5 }) {
	const pendientes = ids.filter(id => getResuelto(id) === undefined)
	for (let i = 0; i < pendientes.length; i += concurrencia) {
		const lote = pendientes.slice(i, i + concurrencia)
		const paginas = await Promise.all(
			lote.map(id => client.request('GET', conProps(`/pages/${id}`, propIds)).catch(() => null))
		)
		lote.forEach((id, idx) => setResuelto(id, paginas[idx] ? mapear(paginas[idx]) : null))
	}
	const salida = new Map()
	ids.forEach(id => salida.set(id, getResuelto(id)))
	return salida
}

/** Primer id de una relación, o null. */
function primeraRelacion(property) {
	const rel = property?.relation
	return Array.isArray(rel) && rel[0] ? rel[0].id : null
}

/** Primer id de una relación que viaja dentro de un rollup array, o null. */
function primeraRelacionEnRollup(property) {
	const array = property?.rollup?.array
	if (!Array.isArray(array)) return null
	for (const item of array) {
		if (Array.isArray(item.relation) && item.relation[0]) return item.relation[0].id
	}
	return null
}

const exportaciones = {
	/**
	 * Contexto del rango, necesario para filtrar y avisar. Se calcula UNA vez
	 * (en la primera página) y el endpoint lo cachea para las siguientes.
	 *
	 * - `rectificadosIds`: partes con `Rectificado por ` relleno. Sus horas las
	 *   sustituye el rectificativo; incluirlos duplicaría la jornada.
	 * - `estados`: recuento por estado para avisar de partes sin firmar.
	 */
	async contextoRango({ client, desde, hasta }) {
		const rectificadosIds = new Set()
		const estados = {}
		let cursor
		do {
			const body = {
				filter: {
					and: [
						{ property: 'Fecha', date: { on_or_after: desde } },
						{ property: 'Fecha', date: { on_or_before: hasta } }
					]
				},
				page_size: 100
			}
			if (cursor) body.start_cursor = cursor
			const data = await client.request(
				'POST',
				conProps(`/databases/${DATABASES.PARTES_TRABAJO}/query`, PROPS_EXPORT.PARTES),
				body
			)
			for (const page of data.results) {
				const estado = page.properties?.Estado?.status?.name || 'Sin estado'
				estados[estado] = (estados[estado] || 0) + 1
				// OJO: el nombre de la propiedad lleva un espacio final.
				const rectificadoPor = page.properties['Rectificado por ']?.relation
				if (Array.isArray(rectificadoPor) && rectificadoPor.length > 0) {
					rectificadosIds.add(page.id)
				}
			}
			cursor = data.has_more ? data.next_cursor : null
		} while (cursor)

		return { rectificadosIds: Array.from(rectificadosIds), estados }
	},

	/**
	 * Devuelve UNA página de filas listas para el CSV.
	 *
	 * Ataca `Detalle Horas` (no `Partes de trabajo`) porque es la única tabla con
	 * el desglose por trabajador, y se puede filtrar por su fórmula `Fecha`.
	 */
	async chorusPagina({ client, desde, hasta, cursor, rectificadosIds = [] }) {
		const rectificados = new Set(rectificadosIds)

		const body = {
			filter: {
				and: [
					{ property: 'Fecha', formula: { date: { on_or_after: desde } } },
					{ property: 'Fecha', formula: { date: { on_or_before: hasta } } }
				]
			},
			page_size: 100
		}
		if (cursor) body.start_cursor = cursor

		const data = await client.request(
			'POST',
			conProps(`/databases/${DATABASES.DETALLES_HORA}/query`, PROPS_EXPORT.DETALLES),
			body
		)

		// Los detalles traen la obra y el empleado por RELACIÓN (id de página), no
		// por código. Hay que resolver esas páginas para leer `Código Obra` e
		// `ID COPUNO`, que son los que casan con Chorus.
		const crudos = data.results.map(page => {
			const p = page.properties
			return {
				parteId: primeraRelacion(p['Partes de trabajo']),
				empleadoId: primeraRelacion(p['Empleados']),
				obraId: primeraRelacionEnRollup(p['AUX Obra del parte']),
				horas: p['Cantidad Horas']?.number ?? null,
				// `Fecha` es una fórmula de tipo date: extractPropertyValue no cubre
				// ese caso (solo string/number/boolean), así que se lee directamente.
				// Notion puede devolverla como 'AAAA-MM-DD' o con hora completa
				// ('AAAA-MM-DDT00:00:00.000+00:00'): se normaliza SIEMPRE a AAAA-MM-DD.
				fecha: (p['Fecha']?.formula?.date?.start || '').slice(0, 10) || null
			}
		})

		const empleadoIds = [...new Set(crudos.map(d => d.empleadoId).filter(Boolean))]
		const obraIds = [...new Set(crudos.map(d => d.obraId).filter(Boolean))]

		const [mapaEmpleados, mapaObras] = await Promise.all([
			resolverPaginas({
				client,
				ids: empleadoIds,
				propIds: PROPS_EXPORT.EMPLEADOS,
				// `ID COPUNO` puede venir vacío: se conserva null a propósito para
				// poder reportarlo como incidencia (extractPropertyValue lo volvería 0).
				mapear: page => ({
					idCopuno: page.properties['ID COPUNO']?.number ?? null,
					nombre: titleDe(page)
				})
			}),
			resolverPaginas({
				client,
				ids: obraIds,
				propIds: PROPS_EXPORT.OBRAS,
				mapear: page => ({
					codigo: page.properties['Código Obra']?.number ?? null,
					nombre: page.properties['Obra - Codigo']?.title?.[0]?.plain_text || ''
				})
			})
		])

		const filas = []
		const incidencias = []
		let descartadasRectificadas = 0
		let descartadasPrueba = 0

		for (const d of crudos) {
			if (d.parteId && rectificados.has(d.parteId)) {
				descartadasRectificadas++
				continue
			}
			const empleado = d.empleadoId ? mapaEmpleados.get(d.empleadoId) : null
			const obra = d.obraId ? mapaObras.get(d.obraId) : null

			// Obras de prueba: su código no existe en Chorus y la macro solo daría
			// un "no encontrado". Se descartan por nombre, no por código hardcodeado.
			if (obra && /prueba/i.test(obra.nombre || '')) {
				descartadasPrueba++
				continue
			}

			const faltan = []
			if (!obra || obra.codigo === null) faltan.push('código de obra')
			if (!empleado || empleado.idCopuno === null) faltan.push('ID trabajador')
			if (d.horas === null) faltan.push('horas')
			if (!d.fecha) faltan.push('fecha')

			if (faltan.length > 0) {
				incidencias.push({
					obra: obra?.nombre || '(sin obra)',
					trabajador: empleado?.nombre || '(sin trabajador)',
					fecha: d.fecha || '',
					falta: faltan.join(', ')
				})
				continue
			}

			filas.push({
				codigo_obra: obra.codigo,
				id_trabajador: empleado.idCopuno,
				horas: d.horas,
				fecha: d.fecha // ISO; el formato dd/mm/aaaa se aplica al serializar
			})
		}

		return {
			filas,
			incidencias,
			descartadas: { rectificadas: descartadasRectificadas, prueba: descartadasPrueba },
			leidos: crudos.length,
			cursor: data.has_more ? data.next_cursor : null,
			done: !data.has_more
		}
	}
}

const vehiculos = {
	/**
	 * Búsqueda de vehículos por matrícula (title contains) para el
	 * autocompletado del campo Vehículos del parte. Sin datos económicos.
	 */
	async buscar({ client, q, limite = 20 }) {
		const data = await client.request('POST', `/databases/${DATABASES.VEHICULOS}/query`, {
			filter: { property: 'Matrícula', title: { contains: q } },
			page_size: limite
		})
		return data.results.map(mapVehiculo)
	},

	/**
	 * Resuelve las matrículas (título de la BD Vehículos) de una lista de page IDs,
	 * preservando el orden. Un ID ilegible aporta '' (no rompe el resto).
	 */
	async matriculasPorIds({ client, ids }) {
		const matriculas = []
		for (const id of (Array.isArray(ids) ? ids : [])) {
			try {
				const page = await client.request('GET', `/pages/${id}`)
				matriculas.push(String(extractPropertyValue(page.properties['Matrícula']) || '').trim())
			} catch (e) {
				console.error(`No se pudo leer la matrícula del vehículo ${id}:`, e.message)
				matriculas.push('')
			}
		}
		return matriculas
	}
}

const partesTrabajo = {
	async listar({ client }) {
		const data = await client.request('POST', conProps(`/databases/${DATABASES.PARTES_TRABAJO}/query`, PROPS_CATALOGO.PARTES), {
			page_size: 100,
			sorts: [{ property: 'Fecha', direction: 'descending' }]
		})
		return data.results.map(mapParte)
	},

	/** Devuelve la página Notion cruda — necesario para enviar-datos que manda el payload completo a Make. */
	async obtenerPagina({ client, parteId }) {
		return client.request('GET', `/pages/${parteId}`)
	},

	/**
	 * Re-deriva el espejo de texto 'Vehiculos' (rich_text) a partir de la relación
	 * 'Vehiculos ' (fuente de verdad) justo antes de generar el PDF. Cubre el caso de
	 * que la relación se edite a mano en Notion sin pasar por la app (el rich_text que
	 * escribe el servidor se quedaría stale). Solo actúa si HAY relación: si está vacía
	 * se respeta el texto existente (no borra datos de partes antiguos texto-sin-relación).
	 * Devuelve { texto, actualizado }; muta `parteData.properties['Vehiculos']` en memoria
	 * si reescribe, para que el payload a Make lleve el valor correcto.
	 */
	async sincronizarEspejoVehiculos({ client, parteData }) {
		const rel = extractPropertyValue(parteData.properties['Vehiculos '])
		const ids = Array.isArray(rel) ? rel.map(r => r.id).filter(Boolean) : []
		const textoActual = String(extractPropertyValue(parteData.properties['Vehiculos']) || '')
		if (ids.length === 0) {
			return { texto: textoActual, actualizado: false }
		}
		const matriculas = await vehiculos.matriculasPorIds({ client, ids })
		const textoEsperado = matriculas.filter(Boolean).join(', ')
		if (textoEsperado === textoActual) {
			return { texto: textoActual, actualizado: false }
		}
		await client.request('PATCH', `/pages/${parteData.id}`, {
			properties: { 'Vehiculos': { rich_text: [{ text: { content: textoEsperado } }] } }
		})
		parteData.properties['Vehiculos'] = {
			type: 'rich_text',
			rich_text: textoEsperado ? [{ type: 'text', text: { content: textoEsperado }, plain_text: textoEsperado }] : []
		}
		return { texto: textoEsperado, actualizado: true }
	},

	async estado({ client, parteId }) {
		// Solo Estado + Última edición: la página completa son ~60 propiedades y este
		// GET es el más frecuente de la app (polling del modal de detalles).
		const page = await client.request('GET', conProps(`/pages/${parteId}`, PROPS_CATALOGO.ESTADO_PARTE))
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
				vehiculos: extractPropertyValue(parteData.properties['Vehiculos']),
				vehiculosIds: (() => {
					const rel = extractPropertyValue(parteData.properties['Vehiculos '])
					return Array.isArray(rel) ? rel.map(r => r.id) : []
				})(),
				personaAutorizada: extractPropertyValue(parteData.properties['Persona Autorizada']),
				firmarUrl: extractPropertyValue(parteData.properties['Firmar']),
				horasTotales: extractPropertyValue(parteData.properties['RP Horas totales'])
			},
			empleados: detallesData.results.map(mapDetalle)
		}
	},

	async crear({ client, obra, obraId, fecha, jefeObraId, notas, vehiculos, vehiculosIds, empleados = [], empleadosHoras = {} }) {
		const parteData = await client.request('POST', '/pages', {
			parent: { database_id: DATABASES.PARTES_TRABAJO },
			properties: {
				'Nombre': { title: [{ text: { content: `Parte temporal - ${obra}` } }] },
				'Fecha': { date: { start: fecha } },
				'Obras': { relation: [{ id: obraId }] },
				'Persona Autorizada': { relation: [{ id: jefeObraId }] },
				'Notas': { rich_text: [{ text: { content: notas || '' } }] },
				...buildVehiculosProps(vehiculos, vehiculosIds)
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
				const horasCrudas = Number(empleadosHoras[empleadoId] ?? 8)
				// ?? y no ||: un 0 explícito es legítimo (asistió sin trabajar) y no debe convertirse en jornada de 8 h (UX-23)
				const horas = Number.isFinite(horasCrudas) ? Math.min(24, Math.max(0, horasCrudas)) : 8
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

	async actualizar({ client, parteId, obraId, fecha, personaAutorizadaId, notas, vehiculos, vehiculosIds, empleados = [], empleadosHoras = {} }) {
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
			'Notas': { rich_text: [{ text: { content: notas || '' } }] },
			...buildVehiculosProps(vehiculos, vehiculosIds)
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
				const horasCrudas = Number(empleadosHoras[empleadoId] ?? 8)
				// ?? y no ||: un 0 explícito es legítimo (asistió sin trabajar) y no debe convertirse en jornada de 8 h (UX-23)
				const horas = Number.isFinite(horasCrudas) ? Math.min(24, Math.max(0, horasCrudas)) : 8
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
			const err = new Error('Solo los partes firmados o con datos enviados pueden rectificarse')
			err.status = 409
			err.meta = { estado }
			throw err
		}

		// Guard contra rectificativos duplicados: si el original ya tiene un rectificativo
		// asociado, rechazar con 409 para evitar crear dos de la misma fuente.
		const rectificadoPorExistente = extractPropertyValue(original.properties['Rectificado por '])
		if (Array.isArray(rectificadoPorExistente) && rectificadoPorExistente.length > 0) {
			const err = new Error('Este parte ya tiene un rectificativo asociado')
			err.status = 409
			err.meta = { estado, rectificadoPorId: rectificadoPorExistente[0].id }
			throw err
		}

		const obraRel = extractPropertyValue(original.properties['Obras'])
		const personaRel = extractPropertyValue(original.properties['Persona Autorizada'])
		const obraId = Array.isArray(obraRel) && obraRel[0] ? obraRel[0].id : null
		const jefeObraId = Array.isArray(personaRel) && personaRel[0] ? personaRel[0].id : null
		const fecha = extractPropertyValue(original.properties['Fecha'])
		const notasOriginal = extractPropertyValue(original.properties['Notas'])
		// ID del parte original al que rectifica — debe quedar SIEMPRE referenciado en las Notas.
		const idOriginal = original.properties['ID']?.unique_id?.number ?? null
		// Prefijo en una sola línea: el salto de línea (\n) rompía el JSON que
		// Make serializa aguas abajo ("Bad control character at position N"). Ver DEUDA_TECNICA M4.
		const prefijoRectificativo = idOriginal != null
			? `PARTE RECTIFICATIVO DEL PARTE #${idOriginal}`
			: 'PARTE RECTIFICATIVO'
		// Las notas del original pueden traer su propio prefijo "PARTE RECTIFICATIVO..."
		// (rectificativo de un rectificativo): se descarta para no encadenar prefijos,
		// dejando como referencia el ID del parte rectificado actual.
		// Cualquier carácter de control (\n, \r, \t) se colapsa a espacio: rompía el JSON
		// que Make serializa aguas abajo ("Bad control character"). Ver DEUDA_TECNICA M4.
		const notasLimpias = (notasOriginal || '')
			.replace(/[\n\r\t]+/g, ' ')
			.replace(/^PARTE RECTIFICATIVO[^—]*—?\s*/, '')
			.replace(/\s+/g, ' ')
			.trim()
		const notasRectificativo = notasLimpias
			? `${prefijoRectificativo} — ${notasLimpias}`
			: prefijoRectificativo
		const obraTexto = extractPropertyValue(original.properties['AUX Obra']) || 'Obra'

		// Vehículos del original: se copian al rectificativo — relación 'Vehiculos '
		// (fuente de verdad) y espejo de texto 'Vehiculos' (props pueden no existir
		// en partes antiguos; extractPropertyValue devuelve '' en ese caso).
		const vehiculosOriginal = String(extractPropertyValue(original.properties['Vehiculos']) || '')
		const vehiculosRelOriginal = extractPropertyValue(original.properties['Vehiculos '])
		const vehiculosIdsOriginal = Array.isArray(vehiculosRelOriginal) ? vehiculosRelOriginal.map(r => r.id) : []

		const propsNuevo = {
			'Nombre': { title: [{ text: { content: `Parte rectificativo - ${obraTexto}` } }] },
			'Notas': { rich_text: [{ text: { content: notasRectificativo } }] },
			...buildVehiculosProps(vehiculosOriginal, vehiculosIdsOriginal),
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
	vehiculos,
	partesTrabajo,
	exportaciones
}
