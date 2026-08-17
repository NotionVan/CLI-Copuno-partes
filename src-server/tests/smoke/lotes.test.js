/**
 * src-server/tests/smoke/lotes.test.js
 *
 * F7 (BE-10) — helpers de escritura en lotes de notion.js.
 *
 * Los endpoints en mock no ejercitan notion.js (data.js bifurca a mockStore),
 * así que los lotes se prueban directamente sobre los helpers exportados y
 * sobre partesTrabajo.crear con un client falso. Sin red, sin Notion.
 */

process.env.USE_MOCK_DATA = 'true'
process.env.NOTION_TOKEN = 'mock'
process.env.SUPABASE_URL = ''

const test = require('node:test')
const assert = require('node:assert/strict')

const notion = require('../../services/notion')

const espera = (ms) => new Promise((r) => setTimeout(r, ms))

test('enLotes preserva el orden con latencias desordenadas', async () => {
	const items = [50, 5, 30, 1, 20, 10, 40]
	const res = await notion.enLotes(items, 3, async (ms) => { await espera(ms); return ms * 2 })
	assert.deepEqual(res.map(r => r.value), items.map(i => i * 2))
	assert.ok(res.every(r => r.ok))
})

test('enLotes nunca supera la concurrencia y respeta la barrera entre tandas', async () => {
	let enVuelo = 0
	let maxEnVuelo = 0
	const tandaDe = []
	const res = await notion.enLotes([0, 1, 2, 3, 4, 5, 6], 3, async (i) => {
		enVuelo++
		maxEnVuelo = Math.max(maxEnVuelo, enVuelo)
		tandaDe[i] = Math.floor(i / 3)
		await espera(10)
		enVuelo--
		return i
	})
	assert.equal(res.length, 7)
	assert.ok(maxEnVuelo <= 3, `en vuelo llegó a ${maxEnVuelo}`)
})

test('enLotes aísla el fallo por ítem sin abortar el resto', async () => {
	const res = await notion.enLotes(['a', 'b', 'c', 'd'], 2, async (x) => {
		if (x === 'b') throw new Error('boom-' + x)
		return x.toUpperCase()
	})
	assert.deepEqual(res.map(r => r.ok), [true, false, true, true])
	assert.equal(res[1].item, 'b')
	assert.equal(res[1].error.message, 'boom-b')
	assert.equal(res[2].value, 'C')
})

test('conReintento429 reintenta una vez ante 429 y respeta Retry-After', async () => {
	let intentos = 0
	const inicio = Date.now()
	const valor = await notion.conReintento429(async () => {
		intentos++
		if (intentos === 1) {
			const e = new Error('rate'); e.status = 429; e.retryAfter = 1
			throw e
		}
		return 'ok'
	})
	assert.equal(valor, 'ok')
	assert.equal(intentos, 2)
	assert.ok(Date.now() - inicio >= 1000, 'debe esperar al menos Retry-After')
})

test('conReintento429 no reintenta errores que no son 429', async () => {
	let intentos = 0
	await assert.rejects(
		notion.conReintento429(async () => { intentos++; const e = new Error('500'); e.status = 500; throw e }),
		/500/
	)
	assert.equal(intentos, 1)
})

// ─── partesTrabajo.crear con client falso ────────────────────────────────────

// Página Notion mínima que devuelve el POST de creación del parte
const paginaParte = (conId) => ({
	id: 'parte-1',
	properties: {
		'ID': conId ? { type: 'unique_id', unique_id: { prefix: null, number: 777 } } : { type: 'unique_id', unique_id: { prefix: null, number: null } },
		'Nombre': { type: 'title', title: [] }
	}
})

function clientFalso({ postDevuelveId }) {
	const llamadas = []
	return {
		llamadas,
		async request(method, endpoint, body) {
			llamadas.push({ method, endpoint })
			if (method === 'POST' && endpoint === '/pages' && body?.parent?.database_id === notion.DATABASES.PARTES_TRABAJO) {
				return paginaParte(postDevuelveId)
			}
			if (method === 'GET' && endpoint.startsWith('/pages/parte-1')) {
				return paginaParte(true) // el fallback siempre encuentra el ID
			}
			if (method === 'PATCH') return { id: 'parte-1' }
			if (method === 'POST' && endpoint === '/pages') return { id: 'detalle-' + llamadas.length }
			throw new Error('petición inesperada: ' + method + ' ' + endpoint)
		}
	}
}

test('crear usa el unique_id del POST sin releer la página (D6)', async () => {
	const client = clientFalso({ postDevuelveId: true })
	const r = await notion.partesTrabajo.crear({
		client, obra: 'TEST', obraId: 'obra-1', fecha: '2026-08-17', jefeObraId: 'jefe-1',
		empleados: ['e1', 'e2'], empleadosHoras: { e1: 8, e2: 7.5 }
	})
	assert.equal(r.nombreFinal, 'Parte TEST777')
	const gets = client.llamadas.filter(l => l.method === 'GET')
	assert.equal(gets.length, 0, 'con ID en el POST no debe haber GET de releer')
	assert.equal(r.detallesCreados.length, 2)
	assert.equal(r.erroresDetalles.length, 0)
})

test('crear cae al GET de releer si el POST no trae el unique_id (fallback D6)', async () => {
	const client = clientFalso({ postDevuelveId: false })
	const r = await notion.partesTrabajo.crear({
		client, obra: 'TEST', obraId: 'obra-1', fecha: '2026-08-17', jefeObraId: 'jefe-1',
		empleados: [], empleadosHoras: {}
	})
	assert.equal(r.nombreFinal, 'Parte TEST777')
	const gets = client.llamadas.filter(l => l.method === 'GET')
	assert.equal(gets.length, 1, 'sin ID en el POST debe releer la página')
})

test('actualizar aborta SIN recrear nada si falla el archivado (fail-fast F7)', async () => {
	const llamadas = []
	const client = {
		async request(method, endpoint, body) {
			llamadas.push({ method, endpoint, body })
			if (method === 'GET') {
				return { id: 'parte-1', properties: { 'Estado': { type: 'status', status: { name: 'Borrador' } } } }
			}
			if (method === 'PATCH' && endpoint === '/pages/parte-1') return { id: 'parte-1' }
			if (method === 'POST' && endpoint.includes('/query')) {
				return { results: [{ id: 'detalle-viejo-1' }, { id: 'detalle-viejo-2' }] }
			}
			if (method === 'PATCH' && endpoint === '/pages/detalle-viejo-2' && body?.archived === true) {
				const e = new Error('conflict'); e.status = 500; throw e
			}
			if (method === 'PATCH') return { id: endpoint.replace('/pages/', '') }
			if (method === 'POST' && endpoint === '/pages') {
				throw new Error('NO debe crearse ningún detalle si el archivado falló')
			}
			throw new Error('petición inesperada: ' + method + ' ' + endpoint)
		}
	}
	await assert.rejects(
		notion.partesTrabajo.actualizar({
			client, parteId: 'parte-1', obraId: 'obra-1', fecha: '2026-08-17',
			personaAutorizadaId: 'jefe-1', empleados: ['e1'], empleadosHoras: { e1: 8 }
		}),
		/No se pudieron actualizar las horas del parte\. No se ha cambiado nada/
	)
	const creaciones = llamadas.filter(l => l.method === 'POST' && l.endpoint === '/pages')
	assert.equal(creaciones.length, 0, 'fail-fast: cero detalles nuevos tras archivado fallido')
	// Y el detalle que SÍ llegó a archivarse fue restaurado (rollback)
	const desarchivados = llamadas.filter(l => l.method === 'PATCH' && l.body?.archived === false)
	assert.deepEqual(desarchivados.map(l => l.endpoint), ['/pages/detalle-viejo-1'])
})

test('archivarDetallesConRollback corta tandas al primer fallo y desarchiva lo archivado', async () => {
	// 7 detalles, concurrencia 3: tanda1 d1-d3 ok · tanda2 d4 FALLA, d5-d6 ok ·
	// tanda3 d7 NO debe intentarse. Rollback: d1-d3 + d5-d6 desarchivados.
	// (Escenario del hallazgo del regression-checker: sin corte+rollback, el
	// parte quedaba con casi todas sus horas ocultas y un mensaje que mentía.)
	const eventos = []
	const client = {
		async request(method, endpoint, body) {
			const id = endpoint.replace('/pages/', '')
			eventos.push({ id, archived: body?.archived })
			if (id === 'd4' && body?.archived === true) {
				const e = new Error('boom'); e.status = 500; throw e
			}
			return { id }
		}
	}
	const detalles = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'].map(id => ({ id }))
	const res = await notion.archivarDetallesConRollback({ client, detalles })
	assert.equal(res.ok, false)
	assert.deepEqual(res.noRestaurados, [])
	const intentosArchivar = eventos.filter(e => e.archived === true).map(e => e.id)
	assert.ok(!intentosArchivar.includes('d7'), 'la tanda posterior al fallo no debe lanzarse')
	const desarchivados = eventos.filter(e => e.archived === false).map(e => e.id).sort()
	assert.deepEqual(desarchivados, ['d1', 'd2', 'd3', 'd5', 'd6'], 'todo lo archivado debe restaurarse')
})

test('archivarDetallesConRollback reporta los que no pudo restaurar', async () => {
	const client = {
		async request(method, endpoint, body) {
			const id = endpoint.replace('/pages/', '')
			if (id === 'd2' && body?.archived === true) { const e = new Error('boom'); e.status = 500; throw e }
			if (id === 'd1' && body?.archived === false) { const e = new Error('rollback-roto'); e.status = 500; throw e }
			return { id }
		}
	}
	const res = await notion.archivarDetallesConRollback({ client, detalles: [{ id: 'd1' }, { id: 'd2' }] })
	assert.equal(res.ok, false)
	assert.deepEqual(res.noRestaurados, ['d1'])
})

test('matriculasPorIds mantiene orden y devuelve "" en el fallo puntual', async () => {
	const client = {
		async request(method, endpoint) {
			if (endpoint.includes('veh-2')) throw new Error('404')
			const mat = endpoint.includes('veh-1') ? '1111-AAA' : '3333-CCC'
			return { properties: { 'Matrícula': { type: 'title', title: [{ plain_text: mat }] } } }
		}
	}
	const res = await notion.vehiculos.matriculasPorIds({ client, ids: ['veh-1', 'veh-2', 'veh-3'] })
	assert.deepEqual(res, ['1111-AAA', '', '3333-CCC'])
})
