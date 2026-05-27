/**
 * src-server/tests/smoke/smoke.test.js
 *
 * Tests de humo sobre los 3 flujos críticos + idempotencia (futuro ADR-007).
 *
 * - Usa `node:test` (builtin desde Node 18), no requiere Jest/Vitest.
 * - Corre en USE_MOCK_DATA=true → no toca Notion ni Make reales.
 * - Cubre: GET catálogos básicos, validación de inputs, ciclo crear→enviar,
 *   bloqueo por estado, idempotencia replay.
 *
 * NO cubre (deliberado): paginación, casos edge de Notion API, frontend.
 * Esto es red de seguridad para refactorizar tranquilo, no cobertura completa.
 *
 * Ejecución: `npm run test:smoke`.
 */

process.env.USE_MOCK_DATA = 'true'
process.env.NOTION_TOKEN = 'mock'

const test = require('node:test')
const assert = require('node:assert/strict')
const request = require('supertest')

const app = require('../../../server')

test('GET /api/health responde 200 con status ok', async () => {
	const res = await request(app).get('/api/health')
	assert.equal(res.status, 200)
	assert.equal(res.body.status, 'ok')
})

test('GET /api/obras devuelve array no vacío con forma esperada', async () => {
	const res = await request(app).get('/api/obras')
	assert.equal(res.status, 200)
	assert.ok(Array.isArray(res.body))
	assert.ok(res.body.length > 0, 'el mock debería tener al menos una obra')
	const obra = res.body[0]
	for (const key of ['id', 'nombre', 'provincia', 'estado']) {
		assert.ok(key in obra, `falta campo "${key}" en obra`)
	}
})

test('GET /api/jefes-obra devuelve array con forma esperada', async () => {
	const res = await request(app).get('/api/jefes-obra')
	assert.equal(res.status, 200)
	assert.ok(Array.isArray(res.body))
	assert.ok(res.body.length > 0)
	const jefe = res.body[0]
	assert.ok('id' in jefe && 'nombre' in jefe && 'email' in jefe)
})

test('GET /api/empleados/buscar?id=999 devuelve 404 cuando no existe', async () => {
	const res = await request(app).get('/api/empleados/buscar?id=999')
	assert.equal(res.status, 404)
	assert.equal(res.body.idCopuno, 999)
})

test('GET /api/empleados/buscar?id=abc devuelve 400 (ID inválido)', async () => {
	const res = await request(app).get('/api/empleados/buscar?id=abc')
	assert.equal(res.status, 400)
})

test('POST /api/partes-trabajo crea parte y devuelve id', async () => {
	const res = await request(app)
		.post('/api/partes-trabajo')
		.send({
			obra: 'Reforma Sede Central',
			obraId: 'obra-1',
			fecha: '2026-05-26',
			jefeObraId: 'jefe-1',
			empleados: ['empleado-1'],
			empleadosHoras: { 'empleado-1': 8 }
		})
	assert.equal(res.status, 200)
	assert.ok(res.body.id, 'el parte creado debería tener id')
})

test('POST /api/partes-trabajo sin campos requeridos devuelve 400', async () => {
	const res = await request(app)
		.post('/api/partes-trabajo')
		.send({ obra: 'Solo nombre' })
	assert.equal(res.status, 400)
	assert.ok(Array.isArray(res.body.required))
})

test('POST enviar-datos: ciclo completo + idempotencia replay', async () => {
	// 1) Crear parte
	const crear = await request(app)
		.post('/api/partes-trabajo')
		.send({
			obra: 'Reforma Sede Central',
			obraId: 'obra-1',
			fecha: '2026-05-26',
			jefeObraId: 'jefe-1',
			empleados: ['empleado-1'],
			empleadosHoras: { 'empleado-1': 8 }
		})
	assert.equal(crear.status, 200)
	const parteId = crear.body.id

	// 2) Enviar datos (1ª)
	const r1 = await request(app).post(`/api/partes-trabajo/${parteId}/enviar-datos`)
	assert.equal(r1.status, 200)
	assert.equal(r1.body.status, 'ok')
	assert.equal(r1.body.replayed, undefined, '1ª llamada no debe ser replay')

	// 3) Enviar datos (2ª, misma key por defecto → debe ser replay)
	const r2 = await request(app).post(`/api/partes-trabajo/${parteId}/enviar-datos`)
	assert.equal(r2.status, 200)
	assert.equal(r2.body.replayed, true, '2ª llamada debe ser replay idempotente')
	assert.ok(r2.body.idempotencyKey)
})

test('PUT /api/partes-trabajo bloquea edición si estado no editable', async () => {
	// Crear y enviar (pasa a estado "Datos Enviados" → bloqueado para edición)
	const crear = await request(app)
		.post('/api/partes-trabajo')
		.send({
			obra: 'Reforma Sede Central',
			obraId: 'obra-1',
			fecha: '2026-05-26',
			jefeObraId: 'jefe-1',
			empleados: ['empleado-1'],
			empleadosHoras: { 'empleado-1': 8 }
		})
	const parteId = crear.body.id
	await request(app).post(`/api/partes-trabajo/${parteId}/enviar-datos`)

	// Intentar editar → debería rebotar
	const editar = await request(app)
		.put(`/api/partes-trabajo/${parteId}`)
		.send({
			obraId: 'obra-1',
			fecha: '2026-05-26',
			personaAutorizadaId: 'jefe-1',
			empleados: ['empleado-1'],
			empleadosHoras: { 'empleado-1': 6 }
		})
	assert.equal(editar.status, 409)
})
