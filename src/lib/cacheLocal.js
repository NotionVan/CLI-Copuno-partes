// Cache local de la sesión (F4/P5): guarda la última foto de los catálogos para
// pintarla al instante en la siguiente apertura y revalidar en segundo plano
// (stale-while-revalidate). Reglas de diseño, decididas en la auditoría 2026-08:
//
//  - La clave incluye la versión del build: cada deploy invalida TODAS las
//    caches locales por sí solo (kill-switch gratuito vía bump de versión).
//  - NUNCA se persiste el índice de empleados: lleva DNI y teléfono y las
//    tablets de obra son dispositivos compartidos. Tampoco datos económicos
//    (el servidor ya los sanea, cinturón doble).
//  - La revalidación corre SIEMPRE al abrir: esto es pintar-antes, no
//    dejar-de-consultar. La verdad sigue siendo el servidor.

const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
const CLAVE = `copuno:datos:v${VERSION}`
const CLAVE_PREFIJO = 'copuno:datos:'
// Más de 24 h es una foto demasiado vieja para ser útil (y evita resucitar
// datos de una tablet que estuvo semanas apagada).
const MAX_EDAD_MS = 24 * 60 * 60 * 1000

export function leerCacheLocal() {
	try {
		const crudo = localStorage.getItem(CLAVE)
		if (!crudo) return null
		const { ts, datos } = JSON.parse(crudo)
		if (!ts || Date.now() - ts > MAX_EDAD_MS) return null
		if (!Array.isArray(datos?.obras) || !Array.isArray(datos?.partesTrabajo)) return null
		// Los empleados no se persisten: el shape completo se restaura con lista vacía
		// y la revalidación inmediata la rellena.
		return { obras: datos.obras, jefesObra: datos.jefesObra || [], empleados: [], partesTrabajo: datos.partesTrabajo }
	} catch {
		return null
	}
}

export function guardarCacheLocal(datos) {
	try {
		// Purga versiones anteriores (cada deploy deja la suya huérfana).
		for (let i = localStorage.length - 1; i >= 0; i--) {
			const k = localStorage.key(i)
			if (k && k.startsWith(CLAVE_PREFIJO) && k !== CLAVE) localStorage.removeItem(k)
		}
		const { obras, jefesObra, partesTrabajo } = datos || {}
		if (!Array.isArray(obras) || !Array.isArray(partesTrabajo)) return
		localStorage.setItem(CLAVE, JSON.stringify({
			ts: Date.now(),
			datos: { obras, jefesObra, partesTrabajo } // sin empleados, a propósito
		}))
	} catch {
		// localStorage lleno o bloqueado: la app funciona igual, solo pierde el atajo.
	}
}

export function limpiarCacheLocal() {
	try {
		for (let i = localStorage.length - 1; i >= 0; i--) {
			const k = localStorage.key(i)
			if (k && k.startsWith(CLAVE_PREFIJO)) localStorage.removeItem(k)
		}
	} catch { /* nada que limpiar */ }
}
