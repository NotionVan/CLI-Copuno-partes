import React, { useEffect, useRef } from 'react'
import { Download, HelpCircle, Loader2, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import MenuCuenta from '../auth/MenuCuenta.jsx'
import './cabecera.css'

// Cabecera de la plataforma. Presentacional: el estado y los handlers viven en
// App.jsx y bajan por props. El hueco "marca │ módulo" está pensado para que
// el día que existan más módulos (ADR-005) el nombre se convierta en
// conmutador sin mover el layout.

function EstadoSistema({ conectividad, syncMode, onInfoSync }) {
	const { status, message } = conectividad
	const texto = status === 'ok' ? 'Conectado' : status === 'error' ? 'Sin conexión' : 'Conectando…'
	const detalle = message && message !== texto ? message : undefined

	const contenido = (
		<>
			<span className="cabecera-estado-punto" aria-hidden="true" />
			{status === 'ok' && <Wifi size={14} aria-hidden="true" />}
			{status === 'error' && <WifiOff size={14} aria-hidden="true" />}
			{status === 'checking' && <Loader2 size={14} className="loading-spinner" aria-hidden="true" />}
			<span className="cabecera-estado-texto">{texto}</span>
			{status === 'ok' && <span className="cabecera-estado-modo">· {syncMode}</span>}
		</>
	)

	// Solo es botón cuando hay conexión: abrir la ayuda de sincronización
	// desde un estado de error no aporta nada.
	if (status === 'ok') {
		return (
			<button
				type="button" className="cabecera-estado ok" onClick={onInfoSync}
				title={`Sincronización en modo ${syncMode} — pulsa para más información`}
				aria-label={`Conectado, sincronización en modo ${syncMode}. Más información`}
			>
				{contenido}
			</button>
		)
	}
	return (
		<div
			className={`cabecera-estado ${status}`} role="status" aria-live="polite"
			title={detalle} aria-label={detalle ? `${texto}: ${detalle}` : texto}
		>
			{contenido}
		</div>
	)
}

export default function Cabecera({
	conectividad, syncMode, cargando, error, refrescando,
	onInicio, onRefrescar, onExportar, onInfoSync
}) {
	const ref = useRef(null)

	// La altura real de la cabecera alimenta --header-offset (filtros sticky y
	// scroll-padding dependen de él). Antes era una estimación fija que
	// divergía del DOM y los filtros quedaban tapados en tablet.
	useEffect(() => {
		const el = ref.current
		if (!el || typeof ResizeObserver === 'undefined') return
		const observador = new ResizeObserver(([entrada]) => {
			const alto = Math.round(entrada.target.getBoundingClientRect().height)
			document.documentElement.style.setProperty('--header-offset', `${alto}px`)
		})
		observador.observe(el)
		return () => observador.disconnect()
	}, [])

	const operativo = !cargando && !error && conectividad.status === 'ok'

	return (
		<header className="cabecera" ref={ref}>
			<div className="container">
				<div className="cabecera-fila">
					<button
						type="button" className="cabecera-marca" onClick={onInicio}
						aria-label="Copuno, ir al inicio" title="Ir al inicio"
					>
						<picture>
							<source media="(max-width: 599px)" srcSet="/isotipo-copuno.png" />
							<img className="cabecera-logo" src="/logo-copuno.png" alt="" width={440} height={109} />
						</picture>
					</button>
					<span className="cabecera-separador" aria-hidden="true" />
					<p className="cabecera-modulo">Gestión de Partes</p>

					<div className="cabecera-utilidades">
						<EstadoSistema conectividad={conectividad} syncMode={syncMode} onInfoSync={onInfoSync} />
						{operativo && (
							<button
								type="button" className="cabecera-accion cabecera-accion--fantasma cabecera-exportar"
								onClick={onExportar} title="Exportar horas a CSV para los cuadrantes de Chorus"
								aria-label="Exportar CSV para Chorus"
							>
								<Download size={16} aria-hidden="true" />
								<span className="cabecera-accion-texto">Exportar CSV</span>
							</button>
						)}
						{!cargando && (
							<button
								type="button" className="cabecera-accion cabecera-accion--suave"
								onClick={onRefrescar} disabled={refrescando}
								title="Refrescar datos desde Notion" aria-label="Refrescar datos"
							>
								<RefreshCw size={16} className={refrescando ? 'spinning' : ''} aria-hidden="true" />
								<span className="cabecera-accion-texto">
									{refrescando ? 'Refrescando…' : 'Refrescar'}
								</span>
							</button>
						)}
						{/* El manual es un HTML estático de public/, no una vista de la app: se
						    abre aparte para poder consultarlo con la app delante. Y va SIEMPRE
						    visible, sin depender de `operativo` — cuando algo falla es justo
						    cuando hace falta. */}
						<a
							className="cabecera-accion cabecera-accion--fantasma cabecera-ayuda"
							href="/manual.html" target="_blank" rel="noopener noreferrer"
							title="Abrir el manual de usuario en una pestaña nueva"
							aria-label="Manual de usuario (se abre en una pestaña nueva)"
						>
							<HelpCircle size={16} aria-hidden="true" />
							<span className="cabecera-accion-texto">Ayuda</span>
						</a>
						<span className="cabecera-separador" aria-hidden="true" />
						<MenuCuenta />
					</div>
				</div>
			</div>
		</header>
	)
}
