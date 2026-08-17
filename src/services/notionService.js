import axios from 'axios'
import { supabase } from '../lib/supabase'

// Configuración de la API: usar proxy de Vite en dev y same-origin en prod
// Mantener baseURL vacía y usar rutas absolutas '/api/...'
const API_BASE_URL = ''

// Configuración de axios con interceptores
const apiClient = axios.create({
	baseURL: API_BASE_URL,
	// P9: 60 s era una condena en red de obra; 20 s cubre el peor caso real
	timeout: 20000,
	headers: {
		'Content-Type': 'application/json'
	}
})

// Interceptor para requests
apiClient.interceptors.request.use(
	async (config) => {
		// ADR-006: adjuntar el JWT de la sesión a toda llamada /api/*
		// (getSession refresca el token solo si ha caducado)
		if (supabase) {
			const { data } = await supabase.auth.getSession()
			if (data?.session?.access_token) {
				config.headers.Authorization = `Bearer ${data.session.access_token}`
			}
		}
		if (import.meta.env.DEV) {
			console.log(`🌐 Request: ${config.method?.toUpperCase()} ${config.url}`)
		}
		return config
	},
	(error) => {
		if (import.meta.env.DEV) {
			console.error('❌ Error en request:', error)
		}
		return Promise.reject(error)
	}
)

// Interceptor para responses
apiClient.interceptors.response.use(
	(response) => {
		if (import.meta.env.DEV) {
			console.log(`✅ Response: ${response.status} ${response.config.url}`)
		}
		return response
	},
	(error) => {
		if (import.meta.env.DEV) {
			console.error('❌ Error en response:', {
				status: error.response?.status,
				message: error.response?.data?.error || error.message,
				url: error.config?.url
			})
		}
		// ADR-006: un 401 puede ser un token caducado (recuperable) o una sesión
		// muerta. Se intenta refrescar primero y solo se cierra sesión si falla:
		// desconectar a la primera echaría al jefe de obra con el parte a medias.
		// Sin recargar la página — AuthGate reacciona al cambio de sesión.
		if (error.response?.status === 401 && supabase) {
			supabase.auth.refreshSession().then(({ error: err }) => {
				if (err) supabase.auth.signOut()
			})
		}
		return Promise.reject(error)
	}
)

// Función para validar conectividad
export const checkConnectivity = async () => {
	try {
		const response = await apiClient.get('/api/health')
		return {
			status: 'ok',
			data: response.data
		}
	} catch (error) {
		return {
			status: 'error',
			message: describirError(error)
		}
	}
}

// El servidor no siempre responde con `error` en texto: si llega un objeto (o
// HTML, cuando cae la función entera) el mensaje acababa siendo "[object
// Object]" y ocultaba el fallo real. Aquí se compone algo accionable.
const describirError = (error) => {
	const detalle = error.response?.data?.error
	if (typeof detalle === 'string') return detalle
	if (detalle) return JSON.stringify(detalle)
	const estado = error.response?.status
	if (estado) return `El servidor respondió ${estado}`
	return error.message || 'Error desconocido'
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
			return property.rollup || ''
		case 'formula':
			return property.formula?.string || property.formula?.number || property.formula?.boolean || ''
		case 'status':
			return property.status?.name || ''
		case 'unique_id':
			return property.unique_id?.prefix + property.unique_id?.number || ''
		case 'files':
			return property.files || []
		default:
			return `[${property.type}]`
	}
}

// UX-41: los mensajes técnicos («rate limit», «timeout of 20000ms exceeded»,
// «Token de Notion inválido») provocaban llamadas a oficina y sensación de
// producto frágil. El detalle técnico va a consola; a pantalla, qué hacer.
const handleApiError = (error, operation) => {
	const errorMessage = error.response?.data?.details || error.response?.data?.error || error.message
	console.error(`Error en ${operation}:`, errorMessage)

	const status = error.response?.status
	const esTimeout = error.code === 'ECONNABORTED' || /timeout/i.test(error.message || '')
	const esRed = !error.response && (error.code === 'ERR_NETWORK' || esTimeout || error.message === 'Network Error')

	let msg
	if (esRed) {
		msg = 'No hay conexión ahora mismo. Comprueba la cobertura e inténtalo de nuevo — lo que habías rellenado sigue aquí.'
	} else if (status === 503 || status === 429) {
		msg = 'El sistema está ocupado. Espera unos segundos y vuelve a intentarlo.'
	} else if (status === 401 || status === 403) {
		msg = 'Tu sesión no es válida. Cierra sesión y vuelve a entrar; si se repite, avisa a oficina.'
	} else if (status === 404) {
		msg = 'No se encontró lo que buscabas. Actualiza los datos y vuelve a intentarlo.'
	} else if (status === 409) {
		const estado = error.response?.data?.estado
		msg = estado
			? `Este parte está en estado "${estado}" y no se puede editar. Actualiza para ver el estado actual.`
			: 'Este parte ya no se puede editar. Puede que otro usuario haya cambiado su estado. Actualiza los datos.'
	} else {
		msg = 'Hay un problema en el sistema. Vuelve a intentarlo; si se repite, avisa a oficina.'
	}
	const err = new Error(msg)
	err.status = status
	throw err
}

// Obtener todas las obras
export const getObras = async () => {
	try {
		const response = await apiClient.get('/api/obras')
		return response.data
	} catch (error) {
		handleApiError(error, 'obtener obras')
	}
}

// Obtener todos los jefes de obra
export const getJefesObra = async () => {
	try {
		const response = await apiClient.get('/api/jefes-obra')
		return response.data
	} catch (error) {
		handleApiError(error, 'obtener jefes de obra')
	}
}

// Obtener firmantes autorizados de una obra (F4)
export const getFirmantesAutorizados = async (obraId) => {
	try {
		const response = await apiClient.get(`/api/obras/${obraId}/firmantes-autorizados`)
		return response.data
	} catch (error) {
		if (error.response?.status === 404) return []
		handleApiError(error, 'obtener firmantes autorizados de la obra')
	}
}

// Obtener todos los empleados
export const getEmpleados = async () => {
	try {
		const response = await apiClient.get('/api/empleados')
		return response.data
	} catch (error) {
		handleApiError(error, 'obtener empleados')
	}
}

// F5: búsqueda incremental de empleados por nombre (server-side)
export const buscarVehiculos = async (q, limite = 20) => {
	try {
		const response = await apiClient.get('/api/vehiculos/buscar', { params: { q, limite } })
		return response.data
	} catch (error) {
		console.error('Error al buscar vehículos:', error)
		throw new Error(error.response?.data?.error || 'Error al buscar vehículos')
	}
}

export const buscarEmpleados = async (q, limite = 20) => {
	try {
		if (!q || q.length < 3) return []
		const response = await apiClient.get('/api/empleados/buscar', { params: { q, limite } })
		return response.data
	} catch (error) {
		handleApiError(error, 'buscar empleados')
	}
}

// F2: búsqueda por ID Copuno. Devuelve array (puede haber múltiples si hay duplicados en Notion) o [] si 404.
export const buscarEmpleadoPorId = async (idCopuno) => {
	try {
		const idNum = Number(idCopuno)
		if (!Number.isInteger(idNum) || idNum <= 0) return []
		const response = await apiClient.get('/api/empleados/buscar', { params: { id: idNum } })
		return response.data
	} catch (error) {
		if (error.response?.status === 404) return []
		handleApiError(error, 'buscar empleado por ID Copuno')
	}
}

// Obtener empleados de una obra específica
export const getEmpleadosObra = async (obraId) => {
	try {
		const response = await apiClient.get(`/api/obras/${obraId}/empleados`)
		return response.data
	} catch (error) {
		handleApiError(error, 'obtener empleados de la obra')
	}
}

// Obtener opciones de la propiedad Estado de empleados (dinámico)
export const getOpcionesEstadoEmpleados = async () => {
  try {
    const response = await apiClient.get('/api/empleados/estado-opciones')
    return response.data
  } catch (error) {
    handleApiError(error, 'obtener opciones de estado de empleados')
  }
}

// Actualizar estado de un empleado
export const actualizarEstadoEmpleado = async (empleadoId, nuevoEstado) => {
  try {
    const response = await apiClient.put(`/api/empleados/${empleadoId}/estado`, { estado: nuevoEstado })
    return response.data
  } catch (error) {
    handleApiError(error, 'actualizar estado del empleado')
  }
}

// Obtener todos los partes de trabajo
export const getPartesTrabajo = async () => {
	try {
		const response = await apiClient.get('/api/partes-trabajo')
		return response.data
	} catch (error) {
		handleApiError(error, 'obtener partes de trabajo')
	}
}

// Obtener estado actual de un parte (para polling client-side)
export const getParteEstado = async (parteId) => {
  try {
    const response = await apiClient.get(`/api/partes-trabajo/${parteId}/estado`)
    return response.data
  } catch (error) {
    handleApiError(error, 'obtener estado del parte')
  }
}

// Obtener detalles de empleados de un parte específico
export const getDetallesEmpleados = async (parteId) => {
	try {
		const response = await apiClient.get(`/api/partes-trabajo/${parteId}/empleados`)
		return response.data
	} catch (error) {
		handleApiError(error, 'obtener detalles de empleados del parte')
	}
}

// Obtener detalles completos de un parte específico
export const getDetallesCompletosParte = async (parteId) => {
	try {
		const response = await apiClient.get(`/api/partes-trabajo/${parteId}/detalles`)
		return response.data
	} catch (error) {
		handleApiError(error, 'obtener detalles completos del parte')
	}
}

// Enviar datos de un parte al webhook y actualizar su estado
export const enviarDatosParte = async (parteId) => {
  try {
    const response = await apiClient.post(`/api/partes-trabajo/${parteId}/enviar-datos`)
    return response.data
  } catch (error) {
    handleApiError(error, 'enviar datos del parte')
  }
}

// Crear un parte rectificativo a partir de uno firmado
export const rectificarParte = async (parteId) => {
  try {
    const response = await apiClient.post(`/api/partes-trabajo/${parteId}/rectificar`)
    return response.data
  } catch (error) {
    handleApiError(error, 'rectificar parte de trabajo')
  }
}

// Crear un nuevo parte de trabajo
export const crearParteTrabajo = async (datos) => {
	try {
		// Validar datos requeridos
		const requiredFields = ['obra', 'obraId', 'fecha', 'jefeObraId']
		const missingFields = requiredFields.filter(field => !datos[field])
		
		if (missingFields.length > 0) {
			throw new Error(`Faltan campos requeridos: ${missingFields.join(', ')}`)
		}

		// Preparar datos para enviar
		const datosEnvio = {
			...datos,
			empleados: datos.empleados || [],
			empleadosHoras: datos.empleadosHoras || {}
		}

		const response = await apiClient.post('/api/partes-trabajo', datosEnvio)
		return response.data
	} catch (error) {
		handleApiError(error, 'crear parte de trabajo')
	}
}

// Actualizar un parte de trabajo existente
export const actualizarParteTrabajo = async (parteId, datos) => {
	try {
		// Validar datos requeridos
		const requiredFields = ['obraId', 'fecha', 'personaAutorizadaId']
		const missingFields = requiredFields.filter(field => !datos[field])
		
		if (missingFields.length > 0) {
			throw new Error(`Faltan campos requeridos: ${missingFields.join(', ')}`)
		}

		// Preparar datos para enviar
		const datosEnvio = {
			...datos,
			empleados: datos.empleados || [],
			empleadosHoras: datos.empleadosHoras || {}
		}

		const response = await apiClient.put(`/api/partes-trabajo/${parteId}`, datosEnvio)
		return response.data
	} catch (error) {
		handleApiError(error, 'actualizar parte de trabajo')
	}
}

// Obtener datos completos para la aplicación
// ────────────────────────────────────────────────────────────────────────────
// Exportación CSV para los cuadrantes de Chorus
// Contrato y reglas: docs/EXPORT_CHORUS_CSV.md
// ────────────────────────────────────────────────────────────────────────────

/**
 * Descarga TODAS las páginas del rango y devuelve las filas crudas + avisos.
 * Se pagina en el cliente a propósito: cada request queda lejos del timeout
 * serverless, y así el volumen puede crecer con el nº de obras sin romperse.
 *
 * @param {string}   desde      AAAA-MM-DD
 * @param {string}   hasta      AAAA-MM-DD
 * @param {Function} onProgreso Callback({ filas, paginas }) para la barra de progreso.
 */
export const exportarChorus = async (desde, hasta, onProgreso) => {
	const filas = []
	const incidencias = []
	const descartadas = { rectificadas: 0, prueba: 0 }
	let estados = null
	let cursor
	let paginas = 0

	do {
		const params = { desde, hasta }
		if (cursor) params.cursor = cursor
		const { data } = await apiClient.get('/api/exportaciones/chorus', { params })

		filas.push(...data.filas)
		incidencias.push(...data.incidencias)
		descartadas.rectificadas += data.descartadas?.rectificadas || 0
		descartadas.prueba += data.descartadas?.prueba || 0
		if (data.estados) estados = data.estados
		cursor = data.cursor
		paginas++
		if (onProgreso) onProgreso({ filas: filas.length, paginas })
	} while (cursor)

	return { filas, incidencias, descartadas, estados }
}

/**
 * Agrega por (obra, trabajador, fecha) y serializa al CSV que espera la macro.
 *
 * La agregación es obligatoria (regla 1 del contrato): el CSV es canónico y la
 * macro SUSTITUYE el valor de la celda. Si llegaran dos filas de la misma
 * combinación, la macro las dejaría en "partes pendientes" para revisión manual.
 */
export const componerCsvChorus = (filas) => {
	const agregado = new Map()
	for (const f of filas) {
		// Defensivo: el servidor ya normaliza, pero si llegara una fecha con hora
		// ('AAAA-MM-DDT00:00…') la clave de agregación y el formato se romperían.
		const fecha = String(f.fecha).slice(0, 10)
		const clave = `${f.codigo_obra}|${f.id_trabajador}|${fecha}`
		const previo = agregado.get(clave)
		if (previo) previo.horas += f.horas
		else agregado.set(clave, { ...f, fecha })
	}

	const ordenadas = Array.from(agregado.values()).sort((a, b) =>
		a.fecha.localeCompare(b.fecha) ||
		a.codigo_obra - b.codigo_obra ||
		a.id_trabajador - b.id_trabajador
	)

	const aDdMmAaaa = (iso) => {
		const [y, m, d] = iso.split('-')
		return `${d}/${m}/${y}`
	}

	const lineas = ['codigo_obra,id_trabajador,horas,fecha']
	for (const f of ordenadas) {
		lineas.push(`${f.codigo_obra},${f.id_trabajador},${f.horas},${aDdMmAaaa(f.fecha)}`)
	}
	// BOM para que Excel abra el CSV con la codificación correcta.
	return { contenido: '﻿' + lineas.join('\r\n') + '\r\n', total: ordenadas.length }
}

export const getDatosCompletos = async () => {
	// F3 (P6/BE-4b): UNA petición — el servidor hace el Promise.all en una sola
	// lambda, con cache e invalidación tras escrituras. Antes eran 4 peticiones
	// paralelas (4 lambdas frías) precedidas de un health redundante.
	// Fallback al camino de 4 llamadas: un fallo del endpoint consolidado no
	// puede dejar la app peor que antes.
	try {
		const response = await apiClient.get('/api/datos-completos')
		const { obras, jefesObra, empleados, partesTrabajo } = response.data || {}
		if (Array.isArray(obras) && Array.isArray(partesTrabajo)) {
			return { obras, jefesObra: jefesObra || [], empleados: empleados || [], partesTrabajo }
		}
		throw new Error('Respuesta incompleta de /datos-completos')
	} catch (error) {
		console.warn('datos-completos falló; usando el camino de 4 llamadas:', error?.message)
		const [obras, jefesObra, empleados, partesTrabajo] = await Promise.all([
			getObras(),
			getJefesObra(),
			getEmpleados(),
			getPartesTrabajo()
		])
		return { obras, jefesObra, empleados, partesTrabajo }
	}
}

// Función para reintentar operaciones
export const retryOperation = async (operation, maxRetries = 3, delay = 1000) => {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await operation()
		} catch (error) {
			// P9: un 4xx (validación, auth, rate limit propio) no se arregla
			// reintentando — repetir el lote solo amplifica la congestión.
			const status = error?.status || error?.response?.status
			if (status >= 400 && status < 500) throw error
			if (attempt === maxRetries) {
				throw error
			}
			console.log(`Reintento ${attempt}/${maxRetries} en ${delay}ms...`)
			await new Promise(resolve => setTimeout(resolve, delay))
			delay *= 2 // Backoff exponencial
		}
	}
} 
