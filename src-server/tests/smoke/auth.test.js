/**
 * src-server/tests/smoke/auth.test.js
 *
 * Tests del middleware de autenticación (ADR-006) con SUPABASE_URL activa —
 * el caso que smoke.test.js neutraliza a propósito.
 *
 * Técnica: par de claves ES256 generado en el test, `fetch` global mockeado
 * para servir el JWKS, y tokens firmados a mano. Sin red, sin Supabase real.
 *
 * OJO: auth.js lee SUPABASE_URL al cargarse → fijar el entorno ANTES del
 * require, y NO importar server.js aquí (arrastraría su propia captura).
 *
 * Ejecución: incluido en `npm run test:smoke`.
 */

process.env.SUPABASE_URL = 'https://test.supabase.co'

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'ES256', use: 'sig' }
global.fetch = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) })

const { authMiddleware } = require('../../middleware/auth')

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')

function firmarToken(payload, kid = 'test-key') {
	const cabecera = b64({ alg: 'ES256', typ: 'JWT', kid })
	const cuerpo = b64(payload)
	const firma = crypto.sign('sha256', Buffer.from(`${cabecera}.${cuerpo}`), {
		key: privateKey,
		dsaEncoding: 'ieee-p1363'
	})
	return `${cabecera}.${cuerpo}.${firma.toString('base64url')}`
}

const ahora = () => Math.floor(Date.now() / 1000)
const payloadValido = () => ({
	sub: 'usuario-1',
	email: 'test@copuno.com',
	iss: 'https://test.supabase.co/auth/v1',
	aud: 'authenticated',
	exp: ahora() + 3600
})

// Ejecuta el middleware y devuelve { paso: bool, status, usuario }
function ejecutar(token, path = '/obras') {
	return new Promise((resolve) => {
		const req = { path, headers: token ? { authorization: `Bearer ${token}` } : {} }
		const res = {
			status(codigo) {
				return { json: (body) => resolve({ paso: false, status: codigo, body }) }
			}
		}
		authMiddleware(req, res, () => resolve({ paso: true, usuario: req.usuario }))
	})
}

test('auth: token ES256 válido pasa y expone req.usuario', async () => {
	const r = await ejecutar(firmarToken(payloadValido()))
	assert.equal(r.paso, true)
	assert.equal(r.usuario.email, 'test@copuno.com')
	assert.equal(r.usuario.id, 'usuario-1')
})

test('auth: sin token responde 401', async () => {
	const r = await ejecutar(null)
	assert.equal(r.paso, false)
	assert.equal(r.status, 401)
})

test('auth: token caducado responde 401', async () => {
	const r = await ejecutar(firmarToken({ ...payloadValido(), exp: ahora() - 60 }))
	assert.equal(r.status, 401)
})

test('auth: emisor de otro proyecto responde 401', async () => {
	const r = await ejecutar(firmarToken({ ...payloadValido(), iss: 'https://otro.supabase.co/auth/v1' }))
	assert.equal(r.status, 401)
})

test('auth: audiencia distinta de authenticated responde 401', async () => {
	const r = await ejecutar(firmarToken({ ...payloadValido(), aud: 'anon' }))
	assert.equal(r.status, 401)
})

test('auth: firma manipulada responde 401', async () => {
	const token = firmarToken(payloadValido())
	const r = await ejecutar(token.slice(0, -6) + 'AAAAAA')
	assert.equal(r.status, 401)
})

test('auth: kid desconocido responde 401', async () => {
	const r = await ejecutar(firmarToken(payloadValido(), 'kid-inexistente'))
	assert.equal(r.status, 401)
})

test('auth: /health queda exento incluso sin token', async () => {
	const r = await ejecutar(null, '/health')
	assert.equal(r.paso, true)
})
