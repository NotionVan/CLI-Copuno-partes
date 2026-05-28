/**
 * src-server/tests/smoke/smoke.test.js
 *
 * Tests de humo sobre los 3 flujos críticos + idempotencia (ADR-007).
 *
 * - Usa `node:test` (builtin desde Node 18), no requiere Jest/Vitest.
 * - Corre en USE_MOCK_DATA=true → no toca Notion ni Make reales.
 * - Cubre: GET catálogos, validación de inputs, ciclo crear→enviar,
 *   bloqueo por estado, idempotencia replay, búsqueda empleados,
 *   detalles de parte, actualización de parte, horas inválidas.
 *
 * NO cubre (deliberado): paginación, casos edge de Notion API, frontend.
 * Esto es red de seguridad para refactorizar tranquilo, no cobertura completa.
 *
 * Ejecución: `npm run test:smoke`.
 */

process.env.USE_MOCK_DATA = 'true'
process.env.NOTION_TOKEN = 'mock'
// Desactivar el cache de catálogos para que cada test lea estado fresco del mock.
process.env.CACHE_TTL_MS = '0'

const test = require('node:test')
const assert = require('node:assert/strict')
const request = require('supertest')

const app = require('../../../server')

// ─── Catálogos ────────────────────────────────────────────────────────────────

test('GET /api/health responde 200 con status ok', async () => {
	const res = await request(app).get('/api/health')
	assert.equal(res.status, 200)
	assert.equal(res.body.status, 'ok')
})

test('GET /api/obras devuelve array no vacío con forma esperada', async () => {
	const res = await request(app).get('/api/obras')
	assert.equal(res.status, 200)
	assert.ok(Array.isArray(res.body))
	assert.ok(res.body.length > 0)
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

test('GET /api/empleados devuelve array con forma esperada', async () => {
	const res = await request(app).get('/api/empleados')
	assert.equal(res.status, 200)
	assert.ok(Array.isArray(res.body))
	assert.ok(res.body.length > 0)
	const emp = res.body[0]
	for (const key of ['id', 'nombre', 'categoria', 'estado']) {
		assert.ok(key in emp, `falta campo "${key}" en empleado`)
	}
})

test('GET /api/empleados/estado-opciones devuelve type y options', async () => {
	const res = await request(app).get('/api/empleados/estado-opciones')
	assert.equal(res.status, 200)
	assert.ok(res.body.type, 'debe tener campo type')
	assert.ok(Array.isArray(res.body.options), 'options debe ser array')
	assert.ok(res.body.options.length > 0)
})

test('GET /api/datos-completos devuelve las 4 colecciones', async () => {
	const res = await request(app).get('/api/datos-completos')
	assert.equal(res.status, 200)
	for (const key of ['obras', 'jefesObra', 'empleados', 'partesTrabajo']) {
		assert.ok(Array.isArray(res.body[key]), `falta colección "${key}"`)
	}
})

// ─── Empleados de obra ────────────────────────────────────────────────────────

test('GET /api/obras/:id/empleados devuelve empleados filtrados por obra', async () => {
	const res = await request(app).get('/api/obras/obra-1/empleados')
	assert.equal(res.status, 200)
	assert.ok(Array.isArray(res.body))
	assert.ok(res.body.length > 0, 'obra-1 debería tener empleados en el mock')
	res.body.forEach(emp => {
		assert.equal(emp.obraId, 'obra-1', 'todos los empleados deben ser de obra-1')
	})
})

test('GET /api/obras/:id/firmantes-autorizados devuelve array (puede ser vacío en mock)', async () => {
	const res = await request(app).get('/api/obras/obra-1/firmantes-autorizados')
	assert.equal(res.status, 200)
	assert.ok(Array.isArray(res.body))
})

// ─── Búsqueda de empleados ────────────────────────────────────────────────────

test('GET /api/empleados/buscar?q=ana devuelve resultados que coinciden', async () => {
	const res = await request(app).get('/api/empleados/buscar?q=ana')
	assert.equal(res.status, 200)
	assert.ok(Array.isArray(res.body))
	assert.ok(res.body.length > 0, 'mock tiene "Ana Gómez"')
	res.body.forEach(emp => {
		assert.match(emp.nombre.toLowerCase(), /ana/, 'nombre debe contener "ana"')
	})
})

test('GET /api/empleados/buscar?q=xy devuelve array vacío si no hay coincidencias', async () => {
	const res = await request(app).get('/api/empleados/buscar?q=zzznombreimposible')
	assert.equal(res.status, 200)
	assert.ok(Array.isArray(res.body))
	assert.equal(res.body.length, 0)
})

test('GET /api/empleados/buscar?q=ab devuelve 200 array vacío (q < 3 chars)', async () => {
	const res = await request(app).get('/api/empleados/buscar?q=ab')
	assert.equal(res.status, 200)
	assert.ok(Array.isArray(res.body))
	assert.equal(res.body.length, 0)
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

// ─── Estado de empleado ───────────────────────────────────────────────────────

test('PUT /api/empleados/:id/estado actualiza estado correctamente', async () => {
	const res = await request(app)
		.put('/api/empleados/empleado-1/estado')
		.send({ estado: 'En pausa' })
	assert.equal(res.status, 200)
	assert.equal(res.body.ok, true)
	assert.equal(res.body.estado, 'En pausa')
})

test('PUT /api/empleados/:id/estado devuelve 404 si empleado no existe', async () => {
	const res = await request(app)
		.put('/api/empleados/no-existe/estado')
		.send({ estado: 'Activo' })
	assert.equal(res.status, 404)
})

// ─── Partes de trabajo — lectura ──────────────────────────────────────────────

test('GET /api/partes-trabajo devuelve array ordenado por fecha descendente', async () => {
	const res = await request(app).get('/api/partes-trabajo')
	assert.equal(res.status, 200)
	assert.ok(Array.isArray(res.body))
	assert.ok(res.body.length > 0)
	const parte = res.body[0]
	for (const key of ['id', 'nombre', 'fecha', 'estado']) {
		assert.ok(key in parte, `falta campo "${key}" en parte`)
	}
	// verificar orden descendente
	for (let i = 1; i < res.body.length; i++) {
		assert.ok(
			new Date(res.body[i - 1].fecha) >= new Date(res.body[i].fecha),
			'partes deben estar ordenados por fecha descendente'
		)
	}
})

test('GET /api/partes-trabajo/:id/estado devuelve estado y ultimaEdicion', async () => {
	const res = await request(app).get('/api/partes-trabajo/parte-1/estado')
	assert.equal(res.status, 200)
	assert.ok('estado' in res.body)
	assert.ok('ultimaEdicion' in res.body)
})

test('GET /api/partes-trabajo/:id/estado devuelve 404 si no existe', async () => {
	const res = await request(app).get('/api/partes-trabajo/no-existe/estado')
	assert.equal(res.status, 404)
})

test('GET /api/partes-trabajo/:id/detalles devuelve parte + empleados', async () => {
	const res = await request(app).get('/api/partes-trabajo/parte-1/detalles')
	assert.equal(res.status, 200)
	assert.ok(res.body.parte, 'debe tener campo parte')
	assert.ok(Array.isArray(res.body.empleados), 'debe tener array empleados')
	assert.ok(res.body.empleados.length > 0, 'parte-1 tiene detalles en el mock')
	const det = res.body.empleados[0]
	for (const key of ['empleadoId', 'empleadoNombre', 'horas']) {
		assert.ok(key in det, `falta campo "${key}" en detalle`)
	}
})

test('GET /api/partes-trabajo/:id/detalles devuelve 404 si no existe', async () => {
	const res = await request(app).get('/api/partes-trabajo/no-existe/detalles')
	assert.equal(res.status, 404)
})

test('GET /api/partes-trabajo/:id/empleados devuelve array de detalles', async () => {
	const res = await request(app).get('/api/partes-trabajo/parte-1/empleados')
	assert.equal(res.status, 200)
	assert.ok(Array.isArray(res.body))
	assert.ok(res.body.length > 0)
})

// ─── Creación de parte ────────────────────────────────────────────────────────

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

// ─── Actualización de parte ───────────────────────────────────────────────────

test('PUT /api/partes-trabajo actualiza parte en estado Borrador', async () => {
	// Crear parte fresco
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

	const editar = await request(app)
		.put(`/api/partes-trabajo/${parteId}`)
		.send({
			obraId: 'obra-1',
			fecha: '2026-05-27',
			personaAutorizadaId: 'jefe-2',
			empleados: ['empleado-2'],
			empleadosHoras: { 'empleado-2': 6 }
		})
	assert.equal(editar.status, 200)
	assert.ok(editar.body.id, 'respuesta debe tener id')
})

test('PUT /api/partes-trabajo devuelve 400 si horas fuera de rango [0,24]', async () => {
	const crear = await request(app)
		.post('/api/partes-trabajo')
		.send({
			obra: 'Reforma Sede Central',
			obraId: 'obra-1',
			fecha: '2026-05-26',
			jefeObraId: 'jefe-1'
		})
	const parteId = crear.body.id

	const editar = await request(app)
		.put(`/api/partes-trabajo/${parteId}`)
		.send({
			obraId: 'obra-1',
			fecha: '2026-05-27',
			personaAutorizadaId: 'jefe-1',
			empleados: ['empleado-1'],
			empleadosHoras: { 'empleado-1': 25 }
		})
	assert.equal(editar.status, 400)
})

test('PUT /api/partes-trabajo bloquea edición si estado no editable', async () => {
	// Crear y enviar (pasa a "Datos Enviados" → bloqueado)
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

// ─── Enviar datos + idempotencia ──────────────────────────────────────────────

test('POST enviar-datos: ciclo completo + idempotencia replay', async () => {
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

	// 1ª llamada — procesa normalmente
	const r1 = await request(app).post(`/api/partes-trabajo/${parteId}/enviar-datos`)
	assert.equal(r1.status, 200)
	assert.equal(r1.body.status, 'ok')
	assert.equal(r1.body.replayed, undefined, '1ª llamada no debe ser replay')

	// 2ª llamada — misma key por defecto → replay idempotente
	const r2 = await request(app).post(`/api/partes-trabajo/${parteId}/enviar-datos`)
	assert.equal(r2.status, 200)
	assert.equal(r2.body.replayed, true, '2ª llamada debe ser replay')
	assert.ok(r2.body.idempotencyKey)
})

test('POST enviar-datos con Idempotency-Key explícita hace replay por esa key', async () => {
	const crear = await request(app)
		.post('/api/partes-trabajo')
		.send({
			obra: 'Reforma Sede Central',
			obraId: 'obra-1',
			fecha: '2026-05-26',
			jefeObraId: 'jefe-1'
		})
	const parteId = crear.body.id
	const customKey = `test-key-${parteId}`

	const r1 = await request(app)
		.post(`/api/partes-trabajo/${parteId}/enviar-datos`)
		.set('Idempotency-Key', customKey)
	assert.equal(r1.status, 200)
	assert.equal(r1.body.replayed, undefined)

	const r2 = await request(app)
		.post(`/api/partes-trabajo/${parteId}/enviar-datos`)
		.set('Idempotency-Key', customKey)
	assert.equal(r2.status, 200)
	assert.equal(r2.body.replayed, true)
	assert.equal(r2.body.idempotencyKey, customKey)
})

test('POST enviar-datos devuelve 404 si parte no existe', async () => {
	const res = await request(app).post('/api/partes-trabajo/no-existe/enviar-datos')
	assert.equal(res.status, 404)
})

// ─── Rectificativos ───────────────────────────────────────────────────────────

test('POST rectificar: crea parte Borrador copiando detalles del firmado', async () => {
	// parte-2 está en estado Firmado en el mock, con detalles asociados.
	const res = await request(app).post('/api/partes-trabajo/parte-2/rectificar')
	assert.equal(res.status, 200)
	assert.ok(res.body.id, 'debe devolver el id del nuevo parte')
	assert.notEqual(res.body.id, 'parte-2', 'el rectificativo es un parte nuevo')
	assert.equal(res.body.parteOriginalId, 'parte-2')
	assert.ok(res.body.detallesCopiados >= 1, 'debe copiar al menos un detalle')

	// El nuevo parte aparece en Borrador y enlazado al original.
	const lista = await request(app).get('/api/partes-trabajo')
	const nuevo = lista.body.find(p => p.id === res.body.id)
	assert.ok(nuevo, 'el rectificativo aparece en el listado')
	assert.equal(nuevo.estado, 'Borrador')
	assert.equal(nuevo.rectificaAId, 'parte-2')
	assert.equal(nuevo.esRectificativo, true)

	// El original queda marcado como rectificado.
	const original = lista.body.find(p => p.id === 'parte-2')
	assert.ok(original.rectificadoPorIds.includes(res.body.id))
})

test('POST rectificar devuelve 409 si el parte no está firmado', async () => {
	// parte-1 está en Borrador en el mock → no rectificable.
	const res = await request(app).post('/api/partes-trabajo/parte-1/rectificar')
	assert.equal(res.status, 409)
	assert.ok(res.body.estado)
})

test('POST rectificar devuelve 404 si el parte no existe', async () => {
	const res = await request(app).post('/api/partes-trabajo/no-existe/rectificar')
	assert.equal(res.status, 404)
})
