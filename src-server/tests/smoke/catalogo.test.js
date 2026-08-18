// v1.13.0 — empleados.listarTodos: paginación completa del catálogo.
// Verifica con un cliente fake que el bucle de start_cursor recorre todas las
// páginas, respeta el orden y se detiene en has_more=false.
const { test } = require('node:test')
const assert = require('node:assert')

const notion = require('../../services/notion')

// Página Notion mínima que mapEmpleado sabe mapear
const pagina = (i) => ({
	id: `emp-${i}`,
	properties: {
		'Nombre Completo': { type: 'title', title: [{ plain_text: `Empleado ${i}` }] },
		'ID COPUNO': { type: 'number', number: i }
	}
})

function fakeClient(paginas) {
	const llamadas = []
	return {
		llamadas,
		async request(method, endpoint, body) {
			llamadas.push({ method, endpoint, body })
			const idx = body?.start_cursor ? Number(body.start_cursor) : 0
			return {
				results: paginas[idx],
				has_more: idx < paginas.length - 1,
				next_cursor: idx < paginas.length - 1 ? String(idx + 1) : null
			}
		}
	}
}

test('listarTodos recorre todas las páginas y concatena en orden', async () => {
	const paginas = [
		Array.from({ length: 100 }, (_, i) => pagina(i)),
		Array.from({ length: 100 }, (_, i) => pagina(100 + i)),
		Array.from({ length: 33 }, (_, i) => pagina(200 + i))
	]
	const client = fakeClient(paginas)
	const res = await notion.empleados.listarTodos({ client })

	assert.strictEqual(res.length, 233)
	assert.strictEqual(client.llamadas.length, 3)
	// Orden preservado de principio a fin
	assert.strictEqual(res[0].id, 'emp-0')
	assert.strictEqual(res[232].id, 'emp-232')
	assert.strictEqual(res[150].idCopuno, 150)
	// La 1ª llamada va sin cursor; las siguientes con el next_cursor recibido
	assert.strictEqual(client.llamadas[0].body.start_cursor, undefined)
	assert.strictEqual(client.llamadas[1].body.start_cursor, '1')
	assert.strictEqual(client.llamadas[2].body.start_cursor, '2')
	// filter_properties activo (dieta de payload también en el catálogo completo)
	assert.ok(client.llamadas[0].endpoint.includes('filter_properties='))
})

test('listarTodos con una sola página no repite llamadas', async () => {
	const client = fakeClient([Array.from({ length: 7 }, (_, i) => pagina(i))])
	const res = await notion.empleados.listarTodos({ client })
	assert.strictEqual(res.length, 7)
	assert.strictEqual(client.llamadas.length, 1)
})

test('listarTodos con BD vacía devuelve []', async () => {
	const client = fakeClient([[]])
	const res = await notion.empleados.listarTodos({ client })
	assert.deepStrictEqual(res, [])
})

// P4 — retry de 429 dentro del paginado
test('listarTodos reintenta una página que devuelve 429 y completa el catálogo', async () => {
	const paginas = [
		Array.from({ length: 100 }, (_, i) => pagina(i)),
		Array.from({ length: 40 }, (_, i) => pagina(100 + i))
	]
	let fallosPendientes = 1
	const llamadas = []
	const client = {
		async request(method, endpoint, body) {
			llamadas.push(body?.start_cursor)
			const idx = body?.start_cursor ? Number(body.start_cursor) : 0
			if (idx === 1 && fallosPendientes > 0) {
				fallosPendientes--
				const err = new Error('rate limited')
				err.status = 429
				err.retryAfter = 0.001
				throw err
			}
			return {
				results: paginas[idx],
				has_more: idx < paginas.length - 1,
				next_cursor: idx < paginas.length - 1 ? String(idx + 1) : null
			}
		}
	}
	const res = await notion.empleados.listarTodos({ client })
	assert.strictEqual(res.length, 140)
	// 3 llamadas: página 0, página 1 (429), página 1 (reintento)
	assert.deepStrictEqual(llamadas, [undefined, '1', '1'])
})

test('listarTodos propaga un 429 que persiste tras el reintento', async () => {
	const client = {
		async request() {
			const err = new Error('rate limited')
			err.status = 429
			err.retryAfter = 0.001
			throw err
		}
	}
	await assert.rejects(() => notion.empleados.listarTodos({ client }), (e) => e.status === 429)
})

