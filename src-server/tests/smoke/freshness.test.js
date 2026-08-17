/**
 * src-server/tests/smoke/freshness.test.js
 *
 * F6 — freshness-check de GET /api/partes-trabajo (server.js).
 *
 * smoke.test.js fuerza CACHE_TTL_MS=0, lo que desactiva por completo la rama
 * del freshness-check: este archivo la ejercita con un TTL corto real.
 * node --test lanza cada archivo en su propio proceso, así que este entorno
 * no interfiere con el de smoke.test.js (mismo patrón que auth.test.js).
 *
 * Se monkey-patchea el singleton de data.js (el server resuelve
 * data.partesTrabajo.* en runtime) para contar llamadas y controlar la
 * respuesta del check sin tocar Notion.
 */

process.env.USE_MOCK_DATA = 'true'
process.env.NOTION_TOKEN = 'mock'
process.env.CACHE_TTL_MS = '1000'       // foto fresca: 1 s (margen anti-flaky: un hipo de GC entre dos GET "inmediatos" no puede expirarla)
process.env.PARTES_TTL_DURO_MS = '4000' // techo de vida de la foto: 4 s
process.env.SUPABASE_URL = ''           // sin auth (se prueba en auth.test.js)

const test = require('node:test')
const assert = require('node:assert/strict')
const request = require('supertest')

const app = require('../../../server')
const data = require('../../services/data')

const espera = (ms) => new Promise((r) => setTimeout(r, ms))

test('F6: freshness-check del listado de partes', async (t) => {
	const listarOriginal = data.partesTrabajo.listar
	const checkOriginal = data.partesTrabajo.hayCambiosDesde
	let llamadasListar = 0
	let llamadasCheck = 0
	let checkImpl = async () => true
	data.partesTrabajo.listar = async (args) => { llamadasListar++; return listarOriginal(args) }
	data.partesTrabajo.hayCambiosDesde = async (args) => { llamadasCheck++; return checkImpl(args) }
	t.after(() => {
		data.partesTrabajo.listar = listarOriginal
		data.partesTrabajo.hayCambiosDesde = checkOriginal
	})

	// ── Foto fresca: el segundo GET sale del cache sin tocar datos ──
	const r1 = await request(app).get('/api/partes-trabajo')
	assert.equal(r1.status, 200)
	assert.equal(llamadasListar, 1)
	const r2 = await request(app).get('/api/partes-trabajo')
	assert.equal(r2.status, 200)
	assert.equal(llamadasListar, 1, 'dentro del TTL no debe repetirse la query')
	assert.equal(llamadasCheck, 0, 'dentro del TTL no debe haber check')
	assert.deepEqual(r2.body.map(p => p.id), r1.body.map(p => p.id))

	// ── Foto expirada + sin cambios: check barato, foto extendida ──
	await espera(1400)
	checkImpl = async () => false
	const r3 = await request(app).get('/api/partes-trabajo')
	assert.equal(r3.status, 200)
	assert.equal(llamadasCheck, 1, 'foto expirada debe disparar el check')
	assert.equal(llamadasListar, 1, 'sin cambios NO debe repetirse la query completa')
	assert.deepEqual(r3.body.map(p => p.id), r1.body.map(p => p.id))
	// La extensión de TTL es real: el siguiente GET inmediato ni siquiera checkea
	const r4 = await request(app).get('/api/partes-trabajo')
	assert.equal(r4.status, 200)
	assert.equal(llamadasCheck, 1, 'TTL extendido: sin check en el GET inmediato')

	// ── Foto expirada + con cambios: query completa y foto nueva ──
	await espera(1400)
	checkImpl = async () => true
	const r5 = await request(app).get('/api/partes-trabajo')
	assert.equal(r5.status, 200)
	assert.equal(llamadasCheck, 2)
	assert.equal(llamadasListar, 2, 'con cambios debe relanzarse la query completa')

	// ── Check con 429: se sirve la foto stale en vez de fallar ──
	await espera(1400)
	checkImpl = async () => { const e = new Error('rate limited'); e.status = 429; throw e }
	const r6 = await request(app).get('/api/partes-trabajo')
	assert.equal(r6.status, 200, 'un 429 en el check no puede convertirse en error')
	assert.equal(llamadasCheck, 3)
	assert.equal(llamadasListar, 2, 'con 429 se sirve la foto stale, sin query completa')
	assert.deepEqual(r6.body.map(p => p.id), r5.body.map(p => p.id))

	// ── TTL duro: pasada la vida máxima, query completa SIN check ──
	// (cubre el residuo de los partes archivados, invisibles para el check)
	await espera(4200)
	checkImpl = async () => { throw new Error('el check no debería llamarse pasado el TTL duro') }
	const r7 = await request(app).get('/api/partes-trabajo')
	assert.equal(r7.status, 200)
	assert.equal(llamadasCheck, 3, 'pasado el TTL duro no hay check')
	assert.equal(llamadasListar, 3, 'pasado el TTL duro, query completa directa')
})

test('F6: la ventana ?desde&hasta esquiva cache y freshness', async () => {
	const listarOriginal = data.partesTrabajo.listar
	let llamadas = 0
	data.partesTrabajo.listar = async (args) => { llamadas++; return listarOriginal(args) }
	try {
		await request(app).get('/api/partes-trabajo?desde=2026-08-01&hasta=2026-08-31')
		await request(app).get('/api/partes-trabajo?desde=2026-08-01&hasta=2026-08-31')
		assert.equal(llamadas, 2, 'las consultas con ventana no se cachean')
	} finally {
		data.partesTrabajo.listar = listarOriginal
	}
})
