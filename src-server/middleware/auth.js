const { createRemoteJWKSet, jwtVerify, decodeProtectedHeader } = require('jose')

// Middleware de autenticación de plataforma (ADR-006).
// Verifica en LOCAL el JWT de Supabase Auth de cada petición /api/* — sin
// llamada de red por petición (el JWKS del proyecto se descarga una vez y se
// cachea). Sin SUPABASE_URL configurada, la app funciona sin auth (modo
// desarrollo, mismo patrón que la simulación del webhook Make).

const SUPABASE_URL = process.env.SUPABASE_URL || ''
// Proyectos con JWT legacy (HS256) firman con secreto compartido en vez de JWKS
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || ''

const RUTAS_PUBLICAS = new Set(['/health'])

let jwks = null
let secretKey = null
let avisoDado = false

function authMiddleware(req, res, next) {
	if (RUTAS_PUBLICAS.has(req.path)) return next()

	if (!SUPABASE_URL) {
		if (!avisoDado) {
			console.warn('⚠️ SUPABASE_URL sin configurar — /api/* SIN autenticación (solo desarrollo)')
			avisoDado = true
		}
		return next()
	}

	const cabecera = req.headers.authorization || ''
	const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null
	if (!token) {
		return res.status(401).json({ error: 'No autenticado' })
	}

	verificar(token)
		.then((payload) => {
			// Disponible para autorización por módulo (accesos_modulo) más adelante
			req.usuario = { id: payload.sub, email: payload.email }
			next()
		})
		.catch(() => res.status(401).json({ error: 'Sesión inválida o caducada' }))
}

async function verificar(token) {
	const emisor = `${SUPABASE_URL}/auth/v1`
	const opciones = { issuer: emisor, audience: 'authenticated' }
	const { alg } = decodeProtectedHeader(token)

	if (alg === 'HS256') {
		if (!SUPABASE_JWT_SECRET) throw new Error('JWT HS256 sin SUPABASE_JWT_SECRET')
		if (!secretKey) secretKey = new TextEncoder().encode(SUPABASE_JWT_SECRET)
		const { payload } = await jwtVerify(token, secretKey, opciones)
		return payload
	}

	if (!jwks) jwks = createRemoteJWKSet(new URL(`${emisor}/.well-known/jwks.json`))
	const { payload } = await jwtVerify(token, jwks, opciones)
	return payload
}

module.exports = { authMiddleware }
