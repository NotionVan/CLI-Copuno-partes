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
	}
}

module.exports = {
	init,
	getMode,
	obras,
	jefesObra,
	empleados
}
