/**
 * src-server/services/data.js
 *
 * Interfaz neutra de acceso a datos (ADR-002).
 *
 * Los endpoints en server.js consumen ESTE módulo, no Notion directamente.
 * Hoy delega 100% en notion.js. Cuando se ejecute ADR-003 (migración a Supabase),
 * esta capa cambiará su implementación interna sin que los endpoints lo noten.
 *
 * MODOS DE FUNCIONAMIENTO:
 *
 * - `live`  (por defecto, requiere NOTION_TOKEN): delega en notion.js.
 * - `mock`  (USE_MOCK_DATA=true o NOTION_TOKEN=mock): delega en mock/mockData.js.
 *
 * El modo se decide al inicializar (`init()`), no en cada llamada — el coste
 * de detección no debe repetirse por petición.
 *
 * REGLA DE ORO: este archivo NO expone conceptos puramente Notion
 * (propiedades, filtros `rich_text.contains`, `relation.contains`, etc.).
 * Si en una operación necesitas filtrar/buscar, la API de data.js debe
 * recibir parámetros de dominio (idCopuno, obraId, q) y traducirlos
 * internamente al backend que toque.
 */

const notion = require('./notion')

let state = {
	mode: null, // 'live' | 'mock'
	notionClient: null,
	mockStore: null
}

/**
 * Inicializa el módulo. Llamar UNA VEZ al arrancar el servidor.
 *
 * @param {Object}  opts
 * @param {string}  [opts.notionToken]   Token de Notion (modo live).
 * @param {boolean} [opts.useMock=false] Forzar modo mock.
 * @param {number}  [opts.timeoutMs]     Timeout HTTP para Notion.
 * @param {Object}  [opts.mockStore]     Instancia del mock (mock/mockData.js).
 */
function init({ notionToken, useMock = false, timeoutMs, mockStore } = {}) {
	if (useMock) {
		if (!mockStore) {
			throw new Error('data.init: useMock=true requiere mockStore')
		}
		state = { mode: 'mock', notionClient: null, mockStore }
		return
	}

	if (!notionToken) {
		throw new Error('data.init: notionToken requerido cuando useMock=false')
	}
	state = {
		mode: 'live',
		notionClient: notion.createClient({ token: notionToken, timeoutMs }),
		mockStore: null
	}
}

function requireInit() {
	if (!state.mode) {
		throw new Error('data.js no inicializado — llamar a data.init({...}) al arrancar el servidor')
	}
}

function getMode() {
	return state.mode
}

// ────────────────────────────────────────────────────────────────────────────
// API por dominio
//
// Cada función decide internamente si delega en notion.js o en mockStore.
// Los endpoints reciben SIEMPRE la misma forma de respuesta — la paridad
// mock ↔ live debe mantenerse.
// ────────────────────────────────────────────────────────────────────────────

const obras = {
	async listar() {
		requireInit()
		if (state.mode === 'mock') return state.mockStore.getObras()
		return notion.obras.listar({ client: state.notionClient })
	},

	async empleadosDeObra(obraId) {
		requireInit()
		if (state.mode === 'mock') return state.mockStore.getEmpleadosPorObra(obraId)
		return notion.obras.empleadosDeObra({ client: state.notionClient, obraId })
	},

	/**
	 * Devuelve firmantes autorizados de una obra.
	 * Lanza Error con `.status = 404` si la obra no existe.
	 */
	async firmantesAutorizados(obraId) {
		requireInit()
		if (state.mode === 'mock') {
			return state.mockStore.getFirmantesPorObra
				? state.mockStore.getFirmantesPorObra(obraId)
				: []
		}
		return notion.obras.firmantesAutorizados({ client: state.notionClient, obraId })
	}
}

const jefesObra = {
	async listar() {
		requireInit()
		if (state.mode === 'mock') return state.mockStore.getJefesObra()
		return notion.jefesObra.listar({ client: state.notionClient })
	}
}

const empleados = {
	async listar() {
		requireInit()
		if (state.mode === 'mock') return state.mockStore.getEmpleados()
		return notion.empleados.listar({ client: state.notionClient })
	},

	/**
	 * Busca por ID Copuno.
	 * Devuelve { resultados: Empleado[], duplicado: boolean }.
	 * Si no encuentra, `resultados` es [] (no lanza error — el endpoint decide el 404).
	 */
	async buscarPorIdCopuno(idCopuno, { limite = 20 } = {}) {
		requireInit()
		if (state.mode === 'mock') {
			const matches = (state.mockStore.getEmpleados() || []).filter(e => e.idCopuno === idCopuno)
			return { resultados: matches, duplicado: matches.length > 1 }
		}
		return notion.empleados.buscarPorIdCopuno({
			client: state.notionClient,
			idCopuno,
			limite
		})
	},

	/**
	 * Busca por substring en nombre (case-insensitive en mock,
	 * delegado a Notion title.contains en live).
	 */
	async buscarPorNombre(q, { limite = 20 } = {}) {
		requireInit()
		if (state.mode === 'mock') {
			const todos = state.mockStore.getEmpleados() || []
			return todos
				.filter(e => (e.nombre || '').toLowerCase().includes(q.toLowerCase()))
				.slice(0, limite)
		}
		return notion.empleados.buscarPorNombre({
			client: state.notionClient,
			q,
			limite
		})
	},

	/**
	 * Opciones válidas de la propiedad Estado.
	 * Forma: { type: 'status'|'select'|'checkbox'|'unknown', options: [{name, color}] }.
	 */
	async opcionesEstado() {
		requireInit()
		if (state.mode === 'mock') return state.mockStore.getEstadoOpciones()
		return notion.empleados.opcionesEstado({ client: state.notionClient })
	},

	/**
	 * Lee la página del empleado, detecta el tipo real de la propiedad Estado y la actualiza.
	 * Devuelve { ok, empleadoId, estado }.
	 * Lanza Error con .status = 404 si el empleado no existe en mock,
	 * o .status = 400 si el tipo de propiedad no es soportado.
	 */
	async actualizarEstado(empleadoId, estado) {
		requireInit()
		if (state.mode === 'mock') {
			try {
				const emp = state.mockStore.updateEmpleadoEstado(empleadoId, estado)
				return { ok: true, empleadoId: emp.id, estado: emp.estado }
			} catch (e) {
				const err = new Error(e.message)
				err.status = 404
				throw err
			}
		}
		return notion.empleados.actualizarEstado({ client: state.notionClient, empleadoId, estado })
	}
}

const vehiculos = {
	/**
	 * Búsqueda de vehículos por matrícula para autocompletado.
	 * Devuelve [{id, matricula, tipo, marcaModelo, estado}].
	 */
	async buscar(q, { limite = 20 } = {}) {
		requireInit()
		if (state.mode === 'mock') {
			const todos = state.mockStore.getVehiculos ? state.mockStore.getVehiculos() : []
			return todos
				.filter(v => (v.matricula || '').toLowerCase().includes(q.toLowerCase()))
				.slice(0, limite)
		}
		return notion.vehiculos.buscar({ client: state.notionClient, q, limite })
	}
}

const exportaciones = {
	/**
	 * Contexto del rango: partes rectificados (a excluir) y recuento por estado
	 * (para avisar de partes sin firmar). Ver docs/EXPORT_CHORUS_CSV.md.
	 */
	async contextoRango({ desde, hasta }) {
		requireInit()
		if (state.mode === 'mock') return { rectificadosIds: [], estados: {} }
		return notion.exportaciones.contextoRango({ client: state.notionClient, desde, hasta })
	},

	/**
	 * Una página de filas del CSV de Chorus. El cliente itera con `cursor` hasta
	 * `done`, para que ninguna petición se acerque al timeout serverless.
	 */
	async chorusPagina({ desde, hasta, cursor, rectificadosIds }) {
		requireInit()
		if (state.mode === 'mock') {
			return { filas: [], incidencias: [], descartadas: { rectificadas: 0, prueba: 0 }, leidos: 0, cursor: null, done: true }
		}
		return notion.exportaciones.chorusPagina({
			client: state.notionClient, desde, hasta, cursor, rectificadosIds
		})
	}
}

const partesTrabajo = {
	async listar() {
		requireInit()
		if (state.mode === 'mock') return state.mockStore.getPartesTrabajo()
		return notion.partesTrabajo.listar({ client: state.notionClient })
	},

	/**
	 * Devuelve la página Notion cruda del parte.
	 * Solo tiene implementación live — el mock path en enviar-datos se maneja en server.js.
	 */
	async obtenerPagina(parteId) {
		requireInit()
		return notion.partesTrabajo.obtenerPagina({ client: state.notionClient, parteId })
	},

	/**
	 * Re-deriva el espejo de texto Vehiculos desde la relación antes de enviar a Make.
	 * Solo live (en mock no hay relación real que consultar). Muta parteData en memoria.
	 */
	async sincronizarEspejoVehiculos(parteData) {
		requireInit()
		if (state.mode === 'mock') return { texto: '', actualizado: false }
		return notion.partesTrabajo.sincronizarEspejoVehiculos({ client: state.notionClient, parteData })
	},

	/**
	 * Devuelve { estado, ultimaEdicion } del parte.
	 * Lanza Error con .status = 404 si no existe (mock) o Notion devuelve 404 (live).
	 */
	async estado(parteId) {
		requireInit()
		if (state.mode === 'mock') {
			try {
				return state.mockStore.getParteEstado(parteId)
			} catch (e) {
				const err = new Error(e.message)
				err.status = 404
				throw err
			}
		}
		return notion.partesTrabajo.estado({ client: state.notionClient, parteId })
	},

	/** Devuelve array de detalles de empleados (DetallesHora) del parte. */
	async empleados(parteId) {
		requireInit()
		if (state.mode === 'mock') return state.mockStore.getDetallesEmpleados(parteId)
		return notion.partesTrabajo.empleados({ client: state.notionClient, parteId })
	},

	/**
	 * Devuelve { parte, empleados } con todo el detalle del parte.
	 * Lanza Error con .status = 404 si no existe.
	 */
	async detalles(parteId) {
		requireInit()
		if (state.mode === 'mock') {
			try {
				return state.mockStore.getParteDetallesCompletos(parteId)
			} catch (e) {
				const err = new Error(e.message)
				err.status = 404
				throw err
			}
		}
		return notion.partesTrabajo.detalles({ client: state.notionClient, parteId })
	},

	/**
	 * Crea un nuevo parte con sus detalles de horas.
	 * Devuelve { parteData, nombreFinal, detallesCreados, erroresDetalles, asignadosObraIds }.
	 */
	async crear(params) {
		requireInit()
		if (state.mode === 'mock') return state.mockStore.createParteTrabajo(params)
		return notion.partesTrabajo.crear({ client: state.notionClient, ...params })
	},

	/**
	 * Actualiza un parte existente, archivando los detalles anteriores y creando los nuevos.
	 * Devuelve { parteActualizado, estadoAnterior, necesitaCambioEstado, detallesCreados, erroresDetalles, asignadosObraIds }.
	 * Lanza Error con .status = 409 si el parte no es editable.
	 */
	async actualizar(parteId, params) {
		requireInit()
		if (state.mode === 'mock') {
			try {
				return state.mockStore.updateParteTrabajo(parteId, params)
			} catch (e) {
				if (e.code === 'NOT_EDITABLE') {
					const err = new Error(e.message)
					err.status = 409
					err.meta = e.meta
					throw err
				}
				throw e
			}
		}
		return notion.partesTrabajo.actualizar({ client: state.notionClient, parteId, ...params })
	},

	/**
	 * Crea un parte rectificativo a partir de un parte firmado.
	 * Devuelve { parteData, nombreFinal, parteOriginalId, detallesCopiados, erroresDetalles }.
	 * Lanza Error con .status = 409 si el original no es rectificable, .status = 404 si no existe.
	 */
	async rectificar(parteOriginalId) {
		requireInit()
		if (state.mode === 'mock') {
			try {
				return state.mockStore.rectificarParte(parteOriginalId)
			} catch (e) {
				if (e.code === 'NOT_RECTIFICABLE') {
					const err = new Error(e.message)
					err.status = 409
					err.meta = e.meta
					throw err
				}
				const err = new Error(e.message)
				err.status = 404
				throw err
			}
		}
		return notion.partesTrabajo.rectificar({ client: state.notionClient, parteOriginalId })
	},

	/**
	 * Actualiza solo el Estado del parte.
	 * `estadoProperty` es el objeto property Notion (necesario para detectar tipo status/select/multi_select).
	 */
	async actualizarEstado(parteId, { estadoProperty, nuevoEstado }) {
		requireInit()
		return notion.partesTrabajo.actualizarEstado({
			client: state.notionClient,
			parteId,
			estadoProperty,
			nuevoEstado
		})
	}
}

module.exports = {
	init,
	getMode,
	obras,
	jefesObra,
	empleados,
	vehiculos,
	partesTrabajo,
	exportaciones
}
