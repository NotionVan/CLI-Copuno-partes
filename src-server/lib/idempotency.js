/**
 * src-server/lib/idempotency.js
 *
 * Idempotencia en operaciones críticas (futuro ADR-004).
 *
 * USO TÍPICO:
 *
 *   const store = createIdempotencyStore({ ttlMs: 10 * 60 * 1000 })
 *
 *   const cached = store.get(key)
 *   if (cached) {
 *     if (cached.status === 'in_flight') return res.status(409).json({...})
 *     return res.status(cached.statusCode).json(cached.body)
 *   }
 *   store.markInFlight(key)
 *   try {
 *     const result = await doSomething()
 *     store.markComplete(key, { statusCode: 200, body: result })
 *     res.json(result)
 *   } catch (err) {
 *     store.delete(key) // permite reintento limpio
 *     throw err
 *   }
 *
 * LIMITACIONES:
 * - Memoria del proceso. En Vercel serverless cada instancia tiene su propio store
 *   (no garantiza dedupe entre instancias). Suficiente para mitigar doble-click
 *   del mismo cliente que cae siempre en la misma instancia caliente.
 * - Para garantía cross-instance hace falta Redis o equivalente (proyecto aparte).
 *
 * Esta implementación cubre el 95% del riesgo real con coste cero de infra.
 */

const DEFAULT_TTL_MS = 10 * 60 * 1000 // 10 minutos
const DEFAULT_GC_INTERVAL_MS = 60 * 1000 // limpieza cada minuto

function createIdempotencyStore({ ttlMs = DEFAULT_TTL_MS, gcIntervalMs = DEFAULT_GC_INTERVAL_MS } = {}) {
	const store = new Map()

	function gc() {
		const now = Date.now()
		for (const [key, entry] of store) {
			if (now - entry.ts > ttlMs) store.delete(key)
		}
	}

	// Limpieza periódica para evitar leaks. unref para no bloquear el exit del proceso.
	const timer = setInterval(gc, gcIntervalMs)
	if (timer.unref) timer.unref()

	return {
		/**
		 * Devuelve la entrada existente para `key`, o null si no existe / expiró.
		 * Forma de la entrada: { status: 'in_flight' | 'complete', statusCode?, body?, ts }.
		 */
		get(key) {
			if (!key) return null
			const entry = store.get(key)
			if (!entry) return null
			if (Date.now() - entry.ts > ttlMs) {
				store.delete(key)
				return null
			}
			return entry
		},

		markInFlight(key) {
			if (!key) return
			store.set(key, { status: 'in_flight', ts: Date.now() })
		},

		markComplete(key, { statusCode, body }) {
			if (!key) return
			store.set(key, { status: 'complete', statusCode, body, ts: Date.now() })
		},

		delete(key) {
			if (!key) return
			store.delete(key)
		},

		// Expuesto para tests
		_size() { return store.size },
		_stop() { clearInterval(timer) }
	}
}

module.exports = { createIdempotencyStore }
