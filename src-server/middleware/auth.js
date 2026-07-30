const crypto = require('crypto')

// Middleware de autenticación de plataforma (ADR-006).
// Verifica en LOCAL el JWT de Supabase Auth de cada petición /api/* — sin
// llamada de red por petición (el JWKS del proyecto se descarga una vez y se
// cachea). Sin SUPABASE_URL configurada, la app funciona sin auth (modo
// desarrollo, mismo patrón que la simulación del webhook Make).
//
// Verificación con el `crypto` de Node y sin librerías: `jose` v6 es ESM puro
// y este servidor es CommonJS — en el Node de Vercel el require tumbaba el
// proceso entero y caían hasta las rutas públicas.

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '')
// Proyectos con JWT legacy (HS256) firman con secreto compartido en vez de JWKS
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || ''

const RUTAS_PUBLICAS = new Set(['/health'])
const JWKS_TTL_MS = 10 * 60 * 1000

// Cinturón para el corte a producción (ADR-006): con AUTH_OBLIGATORIA=true,
// arrancar sin SUPABASE_URL es un error de configuración, no un modo — si la
// variable desapareciera de Vercel, la app caería con error visible en vez de
// servir /api/* sin autenticación en silencio (reabriría H1). Mismo patrón
// fail-fast que NOTION_TOKEN en server.js. Añadir AUTH_OBLIGATORIA=true a
// Production JUNTO con SUPABASE_URL el día del corte.
if (process.env.AUTH_OBLIGATORIA === 'true' && !SUPABASE_URL) {
	console.error('❌ AUTH_OBLIGATORIA=true pero falta SUPABASE_URL — abortando para no servir la API sin autenticación')
	process.exit(1)
}

let jwksCache = { claves: null, ts: 0 }
let avisoDado = false

function b64urlToBuffer(str) {
	return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function parseJson(b64) {
	return JSON.parse(b64urlToBuffer(b64).toString('utf8'))
}

async function obtenerClave(kid) {
	const caducado = Date.now() - jwksCache.ts > JWKS_TTL_MS
	const desconocida = !jwksCache.claves || !jwksCache.claves.has(kid)
	if (caducado || desconocida) {
		const res = await fetch(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`)
		if (!res.ok) throw new Error(`JWKS ${res.status}`)
		const { keys } = await res.json()
		jwksCache = {
			claves: new Map(keys.map((k) => [k.kid, crypto.createPublicKey({ key: k, format: 'jwk' })])),
			ts: Date.now()
		}
	}
	const clave = jwksCache.claves.get(kid)
	if (!clave) throw new Error('kid desconocido')
	return clave
}

async function verificar(token) {
	const partes = token.split('.')
	if (partes.length !== 3) throw new Error('JWT malformado')
	const [cabeceraB64, payloadB64, firmaB64] = partes

	const cabecera = parseJson(cabeceraB64)
	const payload = parseJson(payloadB64)
	const firmados = Buffer.from(`${cabeceraB64}.${payloadB64}`)
	const firma = b64urlToBuffer(firmaB64)

	if (cabecera.alg === 'HS256') {
		if (!SUPABASE_JWT_SECRET) throw new Error('JWT HS256 sin SUPABASE_JWT_SECRET')
		const esperada = crypto.createHmac('sha256', SUPABASE_JWT_SECRET).update(firmados).digest()
		// timingSafeEqual exige longitudes iguales
		if (firma.length !== esperada.length || !crypto.timingSafeEqual(firma, esperada)) {
			throw new Error('firma inválida')
		}
	} else {
		const clave = await obtenerClave(cabecera.kid)
		// ES256 usa firma cruda R||S (IEEE P1363), no DER
		const opciones = cabecera.alg === 'ES256'
			? { key: clave, dsaEncoding: 'ieee-p1363' }
			: { key: clave }
		const algHash = cabecera.alg === 'ES384' ? 'sha384' : cabecera.alg === 'ES512' ? 'sha512' : 'sha256'
		if (!crypto.verify(algHash, firmados, opciones, firma)) {
			throw new Error('firma inválida')
		}
	}

	const ahora = Math.floor(Date.now() / 1000)
	if (payload.exp && payload.exp < ahora) throw new Error('token caducado')
	if (payload.nbf && payload.nbf > ahora + 5) throw new Error('token aún no válido')
	if (payload.iss !== `${SUPABASE_URL}/auth/v1`) throw new Error('emisor inesperado')
	const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
	if (!aud.includes('authenticated')) throw new Error('audiencia inesperada')

	return payload
}

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
		.catch((err) => {
			console.warn('Auth: token rechazado —', err.message)
			res.status(401).json({ error: 'Sesión inválida o caducada' })
		})
}

module.exports = { authMiddleware }
