import React, { useState, useEffect, useRef } from 'react'
import { Search, Plus, FileText, Calendar, Users, Building, Loader2, Wifi, WifiOff, Home, ArrowLeft, Clock, User, Send, PenSquare, RotateCcw, X, Truck, Download, AlertTriangle } from 'lucide-react'
import { getDatosCompletos, crearParteTrabajo, actualizarParteTrabajo, checkConnectivity, retryOperation, getDetallesEmpleados, getEmpleadosObra, getDetallesCompletosParte, actualizarEstadoEmpleado, getOpcionesEstadoEmpleados, getPartesTrabajo, getParteEstado, enviarDatosParte, rectificarParte, getFirmantesAutorizados, buscarEmpleados, buscarEmpleadoPorId, buscarVehiculos, exportarChorus, componerCsvChorus } from './services/notionService'

// F4: helpers para agrupar firmantes por rol en el selector
const ROLES_ORDEN = ['Encargado', 'Jefe de Obra', 'Jefe de Producción', 'Otros']

const agruparFirmantesPorRol = (firmantes) => {
	const grupos = {}
	for (const rol of ROLES_ORDEN) grupos[rol] = []
	for (const f of firmantes) {
		const rol = ROLES_ORDEN.includes(f.rol) ? f.rol : 'Otros'
		grupos[rol].push(f)
	}
	return grupos
}
import './App.css'
import Cabecera from './components/Cabecera.jsx'

const formatearHorasTexto = (valor) => {
	if (valor === undefined || valor === null) return 'Sin horas registradas'

	if (typeof valor === 'number' && Number.isFinite(valor)) {
		return `${valor} Horas`
	}

	const valorComoNumero = Number(String(valor).replace(',', '.'))
	if (!Number.isNaN(valorComoNumero)) {
		return `${valorComoNumero} Horas`
	}

	const textoLimpio = String(valor).replace(/\s*h\s*$/i, '').trim()
	return textoLimpio || 'Sin horas registradas'
}


// Campo de vehículos con autocompletado de matrículas desde la BD Vehículos
// de Notion (mismo patrón de sugerencias en vivo que el buscador de empleados).
// Desde v1.7.0 el valor es una lista de vehículos seleccionados [{id, matricula}]
// que el servidor persiste como relación Notion (fuente de verdad) + espejo de
// texto para el pipeline Make/PDF. Solo se pueden añadir vehículos de la flota.
function CampoVehiculos({ value, onChange }) {
	const seleccionados = Array.isArray(value) ? value : []
	const [termino, setTermino] = useState('')
	const [sugerencias, setSugerencias] = useState([])
	const [buscando, setBuscando] = useState(false)
	const timerRef = useRef(null)

	useEffect(() => {
		if (termino.trim().length < 2) {
			setSugerencias([])
			return
		}
		if (timerRef.current) clearTimeout(timerRef.current)
		timerRef.current = setTimeout(async () => {
			try {
				setBuscando(true)
				const resultados = await buscarVehiculos(termino.trim(), 10)
				// No sugerir vehículos ya seleccionados
				const yaIds = new Set(seleccionados.map(s => s.id))
				setSugerencias((resultados || []).filter(v => v.matricula && !yaIds.has(v.id)))
			} catch (e) {
				console.error('Error buscando vehículos:', e)
				setSugerencias([])
			} finally {
				setBuscando(false)
			}
		}, 300)
		return () => timerRef.current && clearTimeout(timerRef.current)
	}, [termino]) // eslint-disable-line react-hooks/exhaustive-deps

	const seleccionar = (vehiculo) => {
		onChange([...seleccionados, { id: vehiculo.id, matricula: vehiculo.matricula }])
		setTermino('')
		setSugerencias([])
	}

	const quitar = (id) => {
		onChange(seleccionados.filter(s => s.id !== id))
	}

	return (
		<div className="form-group">
			<label className="form-label">Vehículos (matrículas):</label>
			{seleccionados.length > 0 && (
				<div className="filtros-activos" style={{ marginBottom: '8px' }}>
					{seleccionados.map(s => (
						<span key={s.id} className="filtro-chip">
							{s.matricula}
							<button
								type="button"
								onClick={() => quitar(s.id)}
								style={{ marginLeft: '6px', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 'bold' }}
								aria-label={`Quitar ${s.matricula}`}
							>
								×
							</button>
						</span>
					))}
				</div>
			)}
			<div className="empleados-search">
				<Search size={18} />
				<input
					type="text"
					className="empleados-search-input"
					value={termino}
					onChange={(e) => setTermino(e.target.value)}
					onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
					enterKeyHint="search"
					autoCapitalize="characters"
					autoCorrect="off"
					spellCheck={false}
					autoComplete="off"
					placeholder="Escribe una matrícula para buscar en la flota"
				/>
				{buscando && <Loader2 size={16} className="loading-spinner" />}
			</div>
			{sugerencias.length > 0 && (
				<div className="empleados-lista empleados-lista-compacta">
					{sugerencias.map(v => (
						<div key={v.id} className="empleado-item">
							<span className="empleado-info">
								<div className="empleado-nombre-estado">
									<strong>{v.matricula}</strong>
									<span className="categoria">
										{[v.tipo, v.marcaModelo].filter(Boolean).join(' · ') || '—'}
										{v.estado && !/operativ|activ/i.test(v.estado) ? ` · ⚠️ ${v.estado}` : ''}
									</span>
								</div>
							</span>
							<button type="button" className="btn btn-success" onClick={() => seleccionar(v)}>
								<Plus size={14} /> Añadir
							</button>
						</div>
					))}
				</div>
			)}
		</div>
	)
}

// Reconstruye la lista [{id, matricula}] de un parte a partir de la relación
// (vehiculosIds) y el espejo de texto (matrículas separadas por comas). El
// servidor escribe ambos a la vez, así que el orden coincide; si divergen
// (edición manual en Notion), se conservan los IDs con matrícula posicional
// o un placeholder.
function vehiculosDelParte(parte) {
	const ids = Array.isArray(parte?.vehiculosIds) ? parte.vehiculosIds : []
	const matriculas = String(parte?.vehiculos || '').split(',').map(t => t.trim()).filter(Boolean)
	return ids.map((id, i) => ({ id, matricula: matriculas[i] || `Vehículo ${i + 1}` }))
}

// ────────────────────────────────────────────────────────────────────────────
// Exportación de partes al CSV de los cuadrantes de Chorus.
// Contrato del CSV y reglas de negocio: docs/EXPORT_CHORUS_CSV.md
// ────────────────────────────────────────────────────────────────────────────

const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

const hoyISO = () => {
	const d = new Date()
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Por defecto: día 1 del mes en curso → hoy. Petición expresa de Tomeu, para
// evitar mezclar meses y cerrar por error un mes ya cargado en Chorus.
const primerDiaDelMesISO = () => {
	const d = new Date()
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

const mesAnyo = (iso) => iso.slice(0, 7) // 'AAAA-MM'

/** Partes_MM-AAAA.csv; si el rango cruza meses, Partes_MM-AAAA_a_MM-AAAA.csv */
const nombreFicheroCsv = (desde, hasta) => {
	const fmt = (iso) => `${iso.slice(5, 7)}-${iso.slice(0, 4)}`
	return mesAnyo(desde) === mesAnyo(hasta)
		? `Partes_${fmt(desde)}.csv`
		: `Partes_${fmt(desde)}_a_${fmt(hasta)}.csv`
}

function ModalExportarCsv({ onCerrar }) {
	const [desde, setDesde] = useState(primerDiaDelMesISO())
	const [hasta, setHasta] = useState(hoyISO())
	const [exportando, setExportando] = useState(false)
	const [progreso, setProgreso] = useState(null)
	const [error, setError] = useState(null)
	const [resultado, setResultado] = useState(null)
	// Confirmación explícita cuando el rango abarca más de un mes natural.
	const [confirmandoMeses, setConfirmandoMeses] = useState(false)

	const rangoInvalido = desde > hasta
	const cruzaMeses = mesAnyo(desde) !== mesAnyo(hasta)

	const descargar = (contenido, nombre) => {
		const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8;' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = nombre
		document.body.appendChild(a)
		a.click()
		document.body.removeChild(a)
		URL.revokeObjectURL(url)
	}

	const ejecutarExportacion = async () => {
		setConfirmandoMeses(false)
		setExportando(true)
		setError(null)
		setResultado(null)
		setProgreso({ filas: 0, paginas: 0 })
		try {
			const { filas, incidencias, descartadas, estados } = await exportarChorus(
				desde, hasta, (p) => setProgreso(p)
			)
			if (filas.length === 0) {
				setError('No hay horas registradas en el rango seleccionado.')
				return
			}
			const { contenido, total } = componerCsvChorus(filas)
			descargar(contenido, nombreFicheroCsv(desde, hasta))

			const sinFirmar = Object.entries(estados || {})
				.filter(([nombre]) => ['Borrador', 'Procesando', 'Listo para firmar'].includes(nombre))
				.reduce((suma, [, n]) => suma + n, 0)

			setResultado({
				total,
				horas: filas.reduce((s, f) => s + f.horas, 0),
				incidencias,
				descartadas,
				sinFirmar,
				nombre: nombreFicheroCsv(desde, hasta)
			})
		} catch (e) {
			setError(e.response?.data?.error || e.message || 'Error al generar la exportación')
		} finally {
			setExportando(false)
			setProgreso(null)
		}
	}

	const onPulsarExportar = () => {
		if (rangoInvalido) return
		// Aviso + confirmación antes de continuar si se mezclan meses.
		if (cruzaMeses) setConfirmandoMeses(true)
		else ejecutarExportacion()
	}

	return (
		<div className="modal-overlay" onClick={() => !exportando && onCerrar()}>
			<div className="modal-content export-modal" onClick={(e) => e.stopPropagation()}>
				<div className="modal-header">
					<h3><Download size={18} /> Exportar partes a CSV</h3>
					<button className="btn-close-modal" onClick={onCerrar} disabled={exportando}>
						<X size={18} />
					</button>
				</div>

				<div className="modal-body">
					<p className="modal-intro">
						Genera el CSV de horas para los cuadrantes de Chorus.
					</p>

					<div className="export-rango">
						<label>
							<span>Desde</span>
							<input type="date" value={desde} disabled={exportando}
								onChange={(e) => setDesde(e.target.value)} />
						</label>
						<label>
							<span>Hasta</span>
							<input type="date" value={hasta} disabled={exportando}
								onChange={(e) => setHasta(e.target.value)} />
						</label>
					</div>

					{rangoInvalido && (
						<div className="export-aviso export-aviso-error">
							<AlertTriangle size={15} />
							<span>La fecha de inicio es posterior a la de fin.</span>
						</div>
					)}

					{cruzaMeses && !rangoInvalido && !resultado && (
						<div className="export-aviso export-aviso-warn">
							<AlertTriangle size={15} />
							<span>El rango abarca <strong>meses distintos</strong>. Se pedirá confirmación.</span>
						</div>
					)}

					{exportando && (
						<div className="export-progreso">
							<Loader2 size={16} className="loading-spinner" />
							<span>
								Leyendo partes… {progreso?.filas || 0} líneas
								{progreso?.paginas ? ` (${progreso.paginas} bloques)` : ''}
							</span>
						</div>
					)}

					{error && (
						<div className="export-aviso export-aviso-error">
							<AlertTriangle size={15} />
							<span>{error}</span>
						</div>
					)}

					{resultado && (
						<div className="export-resultado">
							<p className="export-ok">
								✅ <strong>{resultado.nombre}</strong> descargado — {resultado.total} líneas, {resultado.horas} horas.
							</p>
							<ul className="export-detalle">
								{resultado.descartadas.rectificadas > 0 && (
									<li>{resultado.descartadas.rectificadas} línea(s) de partes rectificados excluidas (cuentan las del rectificativo).</li>
								)}
								{resultado.descartadas.prueba > 0 && (
									<li>{resultado.descartadas.prueba} línea(s) de obras de prueba excluidas.</li>
								)}
								{resultado.sinFirmar > 0 && (
									<li className="export-detalle-warn">
										⚠️ {resultado.sinFirmar} parte(s) del rango aún no están firmados. Si se firman después, vuelve a exportar: la macro sustituye las horas.
									</li>
								)}
								{resultado.incidencias.length > 0 && (
									<li className="export-detalle-warn">
										⚠️ {resultado.incidencias.length} línea(s) sin exportar por datos incompletos:
										<ul>
											{resultado.incidencias.slice(0, 5).map((inc, i) => (
												<li key={i}>{inc.trabajador} · {inc.obra} · falta {inc.falta}</li>
											))}
											{resultado.incidencias.length > 5 && <li>…y {resultado.incidencias.length - 5} más.</li>}
										</ul>
									</li>
								)}
							</ul>
						</div>
					)}
				</div>

				<div className="modal-confirm-actions">
					<button className="btn btn-secondary" onClick={onCerrar} disabled={exportando}>
						{resultado ? 'Cerrar' : 'Cancelar'}
					</button>
					<button className="btn btn-primary" onClick={onPulsarExportar}
						disabled={exportando || rangoInvalido}>
						{exportando ? 'Generando…' : resultado ? 'Exportar de nuevo' : 'Exportar CSV'}
					</button>
				</div>

				{confirmandoMeses && (
					<div className="modal-overlay modal-overlay-anidado" onClick={() => setConfirmandoMeses(false)}>
						<div className="modal-confirm" onClick={(e) => e.stopPropagation()}>
							<h4><AlertTriangle size={18} /> El rango mezcla meses</h4>
							<p>
								Vas a exportar horas de <strong>{MESES_ES[Number(desde.slice(5, 7)) - 1]} {desde.slice(0, 4)}</strong> a{' '}
								<strong>{MESES_ES[Number(hasta.slice(5, 7)) - 1]} {hasta.slice(0, 4)}</strong>.
							</p>
							<p>
								Un CSV con varios meses puede reabrir un mes ya cerrado en Chorus. Lo habitual es
								exportar un mes completo cada vez.
							</p>
							<div className="modal-confirm-actions">
								<button className="btn btn-secondary" onClick={() => setConfirmandoMeses(false)}>
									Revisar fechas
								</button>
								<button className="btn btn-primary" onClick={ejecutarExportacion}>
									Exportar de todos modos
								</button>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	)
}

function App() {
	const [activeSection, setActiveSection] = useState('main') // Forzar pantalla principal
	const [datos, setDatos] = useState({
		obras: [],
		jefesObra: [],
		empleados: [],
		partesTrabajo: []
	})
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState(null)
	const [connectivity, setConnectivity] = useState({ status: 'checking', message: '' })
	const [estadoOptions, setEstadoOptions] = useState({ type: 'status', options: [] })
	const [syncMode, setSyncMode] = useState('rápido') // Estado del modo de sincronización
	const [refrescando, setRefrescando] = useState(false) // Estado para el botón de refrescar
	const [mostrarInfoSync, setMostrarInfoSync] = useState(false) // Estado para el popup de info de sincronización
	const [mostrarExportar, setMostrarExportar] = useState(false) // Modal de exportación CSV para Chorus
	const [hayActualizacion, setHayActualizacion] = useState(false)

	// Smart Polling: ajusta frecuencia según actividad
	const partesPollRef = useRef(null)
	const lastParteChangeRef = useRef(Date.now())
	const currentPollIntervalRef = useRef(3000) // Empezar en modo rápido
	const lastPartesHashRef = useRef('')

	const getSmartPollInterval = () => {
		const timeSinceChange = Date.now() - lastParteChangeRef.current
		if (timeSinceChange < 30000) {
			setSyncMode('rápido')
			return 3000 // Modo rápido: cambios recientes (<30s)
		}
		if (timeSinceChange < 120000) {
			setSyncMode('normal')
			return 8000 // Modo normal: sin cambios <2min
		}
		setSyncMode('lento')
		return 15000 // Modo lento: sin cambios >2min
	}

	const hashPartes = (partes) => {
		// Hash simple basado en IDs, estados y última edición
		return partes.map(p => `${p.id}-${p.estado}-${p.ultimaEdicion}`).join('|')
	}

	const startPartesPolling = () => {
		if (partesPollRef.current) return

		const poll = async () => {
			try {
				if (editandoParte) return

				const partes = await getPartesTrabajo()
				const newHash = hashPartes(partes)

				// Detectar cambios
				if (newHash !== lastPartesHashRef.current) {
					lastPartesHashRef.current = newHash
					lastParteChangeRef.current = Date.now()
					setDatos(prev => ({ ...prev, partesTrabajo: partes }))
				} else {
					// Sin cambios, solo actualizar datos
					setDatos(prev => ({ ...prev, partesTrabajo: partes }))
				}

				// Ajustar intervalo si cambió
				const newInterval = getSmartPollInterval()
				if (newInterval !== currentPollIntervalRef.current) {
					currentPollIntervalRef.current = newInterval
					stopPartesPolling()
					startPartesPolling()
				}
			} catch (e) { /* noop */ }
		}

		poll() // Primera ejecución inmediata
		partesPollRef.current = setInterval(poll, currentPollIntervalRef.current)
	}

	const stopPartesPolling = () => {
		if (partesPollRef.current) {
			clearInterval(partesPollRef.current)
			partesPollRef.current = null
		}
	}

	// Smart Polling para opciones de estado
	const estadoOptionsPollRef = useRef(null)
	const lastEstadoChangeRef = useRef(Date.now())
	const lastEstadoHashRef = useRef('')

	const hashEstadoOptions = (opts) => {
		return JSON.stringify(opts?.options?.map(o => o.name) || [])
	}

	const startEstadoPolling = () => {
		if (estadoOptionsPollRef.current) return

		const poll = async () => {
			try {
				const opts = await getOpcionesEstadoEmpleados()
				const newHash = hashEstadoOptions(opts)

				if (newHash !== lastEstadoHashRef.current) {
					lastEstadoHashRef.current = newHash
					lastEstadoChangeRef.current = Date.now()
					setEstadoOptions(opts || { type: 'status', options: [] })
				}

				// Ajustar intervalo basado en actividad
				const timeSinceChange = Date.now() - lastEstadoChangeRef.current
				let newInterval = timeSinceChange < 60000 ? 10000 : 30000 // 10s si cambios recientes, 30s si no

				if (estadoOptionsPollRef.current) {
					clearInterval(estadoOptionsPollRef.current)
					estadoOptionsPollRef.current = setInterval(poll, newInterval)
				}
			} catch (e) {
				setEstadoOptions({ type: 'status', options: [] })
			}
		}

		// F3: sin poll() inmediato — cargarOpcionesEstado() ya se llama en el
		// montaje y al volver a la pestaña; esto duplicaba la petición.
		estadoOptionsPollRef.current = setInterval(poll, 10000)
	}

	const stopEstadoPolling = () => {
		if (estadoOptionsPollRef.current) {
			clearInterval(estadoOptionsPollRef.current)
			estadoOptionsPollRef.current = null
		}
	}

	useEffect(() => {
		cargarDatos()
		cargarOpcionesEstado()
		startEstadoPolling()
		startPartesPolling()

		const onVis = () => {
			if (document.visibilityState === 'hidden') {
				stopPartesPolling()
				stopEstadoPolling()
			} else {
				// refresco inmediato al volver y reanudar
				getPartesTrabajo().then(partes => setDatos(prev => ({ ...prev, partesTrabajo: partes }))).catch(() => { })
				cargarOpcionesEstado()
				startPartesPolling()
				startEstadoPolling()
			}
		}
		document.addEventListener('visibilitychange', onVis)
		return () => {
			stopPartesPolling()
			stopEstadoPolling()
			document.removeEventListener('visibilitychange', onVis)
		}
	}, [])

	// Exponer versión del build en window para facilitar diagnóstico desde consola.
	useEffect(() => {
		if (typeof __APP_VERSION__ !== 'undefined') {
			window.__APP_VERSION__ = __APP_VERSION__
		}
	}, [])

	// Comprobación de actualizaciones: compara la versión embebida en build con la que devuelve el servidor
	useEffect(() => {
		const buildVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null
		if (!buildVersion) return

		const comprobarVersion = async () => {
			try {
				const res = await fetch('/api/health', { cache: 'no-store' })
				if (!res.ok) return
				const data = await res.json()
				if (data.version && data.version !== buildVersion) {
					setHayActualizacion(true)
				}
			} catch {
				// sin conexión, ignorar
			}
		}

		comprobarVersion()
		const intervalo = setInterval(comprobarVersion, 60 * 1000) // cada 1 min
		return () => clearInterval(intervalo)
	}, [])

	const cargarOpcionesEstado = async () => {
		try {
			const opts = await getOpcionesEstadoEmpleados()
			setEstadoOptions(opts || { type: 'status', options: [] })
		} catch (e) {
			setEstadoOptions({ type: 'status', options: [] })
		}
	}

	const cargarDatos = async () => {
		try {
			setLoading(true)
			setError(null)
			// F3: sin health previo bloqueante — la conectividad se deriva del propio
			// resultado de la carga (un round-trip menos en el camino crítico).
			setConnectivity({ status: 'checking', message: 'Actualizando...' })

			const datosCompletos = await retryOperation(async () => {
				return await getDatosCompletos()
			}, 2, 1000)

			console.log('📊 Datos cargados:', datosCompletos)
			console.log('🏗️ Obras cargadas:', datosCompletos.obras.length)
			console.log('👥 Empleados cargados:', datosCompletos.empleados.length)
			console.log('👨‍💼 Jefes de obra cargados:', datosCompletos.jefesObra.length)

			setDatos(datosCompletos)
			setConnectivity({ status: 'ok', message: 'Conectado' })
		} catch (err) {
			console.error('Error al cargar datos:', err)
			setError(err.message)
			setConnectivity({ status: 'error', message: err.message })
		} finally {
			setLoading(false)
		}
	}

	const refrescarPartes = async () => {
		try {
			const partes = await getPartesTrabajo()
			setDatos(prev => ({ ...prev, partesTrabajo: partes }))
			return partes
		} catch (error) {
			console.error('Error al refrescar partes:', error)
			throw error
		}
	}

	const refrescarTodosDatos = async () => {
		try {
			setRefrescando(true)
			setError(null)

			// Verificar conectividad
			const connectivityCheck = await checkConnectivity()
			setConnectivity({
				status: connectivityCheck.status,
				message: connectivityCheck.status === 'ok' ? 'Conectado' : connectivityCheck.message
			})

			if (connectivityCheck.status === 'error') {
				throw new Error(`Problema de conectividad: ${connectivityCheck.message}`)
			}

			// Cargar todos los datos
			const datosCompletos = await retryOperation(async () => {
				return await getDatosCompletos()
			}, 3, 1000)

			setDatos(datosCompletos)
			setConnectivity({ status: 'ok', message: 'Conectado' })

			// También refrescar opciones de estado
			await cargarOpcionesEstado()

			console.log('✅ Datos refrescados correctamente')
		} catch (err) {
			console.error('Error al refrescar datos:', err)
			setError(err.message)
			setConnectivity({ status: 'error', message: err.message })
		} finally {
			setRefrescando(false)
		}
	}

	const volverInicio = () => {
		setActiveSection('main')
	}

	return (
		<div className="app">
			<Cabecera
				conectividad={connectivity}
				syncMode={syncMode}
				cargando={loading}
				error={error}
				refrescando={refrescando}
				onInicio={volverInicio}
				onRefrescar={refrescarTodosDatos}
				onExportar={() => setMostrarExportar(true)}
				onInfoSync={() => setMostrarInfoSync(true)}
			/>

			{hayActualizacion && (
				<div className="update-banner">
					<span>Hay una nueva versión disponible.</span>
					<button className="update-banner-btn" onClick={() => window.location.reload()}>
						Actualizar ahora
					</button>
					<button className="update-banner-close" onClick={() => setHayActualizacion(false)} title="Cerrar">
						<X size={14} />
					</button>
				</div>
			)}

			<main className="main">
				<div className="container">
					{/* Debug info - Comentado para ocultar */}
					{/* {!loading && !error && import.meta.env.MODE === 'development' && (
						<div className="debug-info">
							<strong>Debug:</strong> Obras: {datos.obras.length} |
							Empleados: {datos.empleados.length} |
							Jefes: {datos.jefesObra.length} |
							Partes: {datos.partesTrabajo.length} |
							Estado opts: {estadoOptions.options?.length || 0}
						</div>
					)} */}

					{/* Contenido principal */}
					<div className="content">
						{/* F3 (P2): el menú principal es estático — se pinta SIEMPRE, sin
						    esperar a Notion. Solo Consulta/Crear dependen de datos. */}
						{activeSection === 'main' ? (
							<PantallaPrincipal onNavigate={setActiveSection} />
						) : loading ? (
							<div className="loading-container">
								<Loader2 size={48} className="loading-spinner" />
								<p className="loading-text">Cargando partes y obras...</p>
							</div>
						) : error ? (
							<div className="error-container">
								<div className="error-header">
									<WifiOff size={48} className="error-icon" />
									<h3 className="error-title">Error de Conectividad</h3>
								</div>
								<p className="error-text">{error}</p>
								<div className="error-actions">
									<button className="btn btn-primary" onClick={cargarDatos}>
										<Wifi size={20} />
										Reintentar Conexión
									</button>
									<button className="btn btn-secondary" onClick={() => window.location.reload()}>
										Recargar Página
									</button>
								</div>
							</div>
						) : (
							<>
								{activeSection === 'consulta' ? (
									<ConsultaPartes datos={datos} onVolver={() => setActiveSection('main')} estadoOptions={estadoOptions} onRefrescarPartes={refrescarPartes} />
								) : activeSection === 'crear' ? (
									<CrearParte datos={datos} estadoOptions={estadoOptions} onParteCreado={cargarDatos} onVolver={() => setActiveSection('main')} />
								) : null}
							</>
						)}
					</div>
				</div>
			</main>

			{mostrarExportar && <ModalExportarCsv onCerrar={() => setMostrarExportar(false)} />}

			{/* Modal de información de sincronización */}
			{mostrarInfoSync && (
				<div className="modal-overlay" onClick={() => setMostrarInfoSync(false)}>
					<div className="modal-content sync-info-modal" onClick={(e) => e.stopPropagation()}>
						<div className="modal-header">
							<h2>Sincronización Automática Inteligente</h2>
							<button className="btn-close-modal" onClick={() => setMostrarInfoSync(false)}>
								×
							</button>
						</div>
						<div className="modal-body">
							<p className="modal-intro">
								El sistema ajusta automáticamente la frecuencia de sincronización según la actividad detectada:
							</p>

							<div className="sync-modes-info">
								<div className="sync-mode-card rapido">
									<div className="sync-mode-header">
										<Clock size={20} />
										<h3>Modo RÁPIDO</h3>
										<span className="sync-badge rapido">Cada 3 segundos</span>
									</div>
									<p>Se activa cuando hay cambios recientes (últimos 30 segundos). Ideal para detectar actualizaciones rápidamente cuando hay actividad.</p>
								</div>

								<div className="sync-mode-card normal">
									<div className="sync-mode-header">
										<Clock size={20} />
										<h3>Modo NORMAL</h3>
										<span className="sync-badge normal">Cada 8 segundos</span>
									</div>
									<p>Se activa cuando no hay cambios entre 30 segundos y 2 minutos. Velocidad moderada para mantener datos actualizados.</p>
								</div>

								<div className="sync-mode-card lento">
									<div className="sync-mode-header">
										<Clock size={20} />
										<h3>Modo LENTO</h3>
										<span className="sync-badge lento">Cada 15 segundos</span>
									</div>
									<p>Se activa cuando no hay cambios por más de 2 minutos. Ahorra recursos cuando no hay actividad reciente.</p>
								</div>
							</div>

							<div className="sync-info-footer">
								<p>
									<strong>Modo actual:</strong> <span className={`current-mode ${syncMode}`}>{syncMode.toUpperCase()}</span>
								</p>
								<p className="sync-tip">
									💡 Usa el botón "Refrescar" para actualizar manualmente en cualquier momento
								</p>
							</div>
						</div>
					</div>
				</div>
			)}
			<Footer />
		</div>
	)
}

// Componente para la pantalla principal
function PantallaPrincipal({ onNavigate }) {
	return (
		<div className="pantalla-principal">
			<div className="welcome-section">
				<div className="welcome-content">
					<h1 className="welcome-title">Bienvenido a Copuno</h1>
					<p className="welcome-subtitle">Sistema de Gestión de Partes de Trabajo</p>
					<p className="welcome-description">
						Selecciona una opción para comenzar a gestionar los partes de trabajo
					</p>
				</div>
			</div>

			<div className="main-actions">
				<div className="action-card" onClick={() => onNavigate('crear')}>
					<div className="action-icon">
						<Plus size={40} />
					</div>
					<h3 className="action-title">Crear Nuevo Parte</h3>
					<p className="action-description">
						Crea un nuevo parte de trabajo con empleados, horas y detalles
					</p>
				</div>

				<div className="action-card" onClick={() => onNavigate('consulta')}>
					<div className="action-icon">
						<Search size={40} />
					</div>
					<h3 className="action-title">Consultar Partes</h3>
					<p className="action-description">
						Busca y visualiza los partes de trabajo existentes
					</p>
				</div>
			</div>
		</div>
	)
}

// Componente para consultar partes existentes
function ConsultaPartes({ datos, onVolver, estadoOptions, onRefrescarPartes }) {
	const [filtroObra, setFiltroObra] = useState('')
	const [filtroFecha, setFiltroFecha] = useState('')
	const [filtroEstado, setFiltroEstado] = useState('')
	const [filtroPersonaAutorizada, setFiltroPersonaAutorizada] = useState('')
	const [filtroVehiculo, setFiltroVehiculo] = useState('')
	const [fechaInput, setFechaInput] = useState('')
	const [parteSeleccionado, setParteSeleccionado] = useState(null)
	const [detallesEmpleados, setDetallesEmpleados] = useState([])
	const [loadingDetalles, setLoadingDetalles] = useState(false)
	const [editandoParte, setEditandoParte] = useState(null)
	const [empleadosObra, setEmpleadosObra] = useState([])
	const [loadingEmpleados, setLoadingEmpleados] = useState(false)
	const [mostrarEmpleadosObra, setMostrarEmpleadosObra] = useState(false)
	const [loadingEmpleadosParte, setLoadingEmpleadosParte] = useState(false)
	// F4: firmantes autorizados de la obra del parte en edición + toggle búsqueda libre
	const [firmantesObra, setFirmantesObra] = useState([])
	const [loadingFirmantes, setLoadingFirmantes] = useState(false)
	const [busquedaLibreJefesEdicion, setBusquedaLibreJefesEdicion] = useState(false)
	// F5: toggle búsqueda libre de empleados en edición
	const [busquedaLibreEmpleadosEdicion, setBusquedaLibreEmpleadosEdicion] = useState(false)
	// Añadir empleado por ID Copuno o nombre directamente en edición (sugerencias, igual que en creación)
	const [busquedaIdEdicion, setBusquedaIdEdicion] = useState('')
	const [buscandoIdEdicion, setBuscandoIdEdicion] = useState(false)
	const [errorBusquedaIdEdicion, setErrorBusquedaIdEdicion] = useState('')
	const [resultadosBusquedaEdicion, setResultadosBusquedaEdicion] = useState([])
	const [empleadosAñadidosDetalleEdicion, setEmpleadosAñadidosDetalleEdicion] = useState({})
	const [guardandoCambios, setGuardandoCambios] = useState(false)
	const [mensajeUI, setMensajeUI] = useState({ tipo: '', texto: '' })
	// Estado local para reflejar selección de estado inmediatamente en UI
	const [estadoLocal, setEstadoLocal] = useState({})
	const [enviandoParteId, setEnviandoParteId] = useState(null)
	const [rectificandoParteId, setRectificandoParteId] = useState(null)
	const [confirmRectificar, setConfirmRectificar] = useState(null) // parte pendiente de confirmar

	// Función para limpiar todos los filtros
	const limpiarFiltros = () => {
		setFiltroObra('')
		setFiltroFecha('')
		setFechaInput('')
		setFiltroEstado('')
		setFiltroPersonaAutorizada('')
		setFiltroVehiculo('')
	}

	// Mapea color de Notion a un color CSS visible
	const mapNotionColorToHex = (color) => {
		switch ((color || '').toLowerCase()) {
			case 'gray': return '#6b7280'
			case 'brown': return '#92400e'
			case 'orange': return '#f97316'
			case 'yellow': return '#eab308'
			case 'green': return '#16a34a'
			case 'blue': return '#2563eb'
			case 'purple': return '#7c3aed'
			case 'pink': return '#db2777'
			case 'red': return '#dc2626'
			default: return '#64748b'
		}
	}

	const getEstadoOptionByName = (name) => {
		return (estadoOptions.options || []).find(opt => opt.name === name)
	}

	const normalizeEstadoForApi = (valor) => {
		if (estadoOptions.type === 'checkbox') {
			if (typeof valor === 'boolean') return valor
			const v = String(valor).toLowerCase()
			return v === 'on' || v === 'true' || v === 'sí' || v === 'si'
		}
		return valor
	}

	// Función para verificar si un parte puede ser editado
	const puedeEditarParte = (estado) => {
		const estadosNoEditables = ['firmado', 'datos enviados', 'enviado']
		return !estadosNoEditables.includes(estado?.toLowerCase())
	}

	const esEstadoBorrador = (estado) => String(estado || '').toLowerCase() === 'borrador'

	const esEstadoListoFirmar = (estado) => String(estado || '').toLowerCase() === 'listo para firmar'

	// Función para verificar si el PDF debe estar disponible (solo después de firmar)
	const tienePDFDisponible = (estado) => {
		const estadosConPDF = ['firmado', 'enviado']
		return estadosConPDF.includes(String(estado || '').toLowerCase())
	}

	// Función para obtener el mensaje de estado no editable
	const getMensajeEstadoNoEditable = (estado) => {
		const estadoLower = estado?.toLowerCase()
		if (estadoLower === 'firmado') {
			return 'Este parte está firmado y no puede ser modificado'
		} else if (estadoLower === 'datos enviados') {
			return 'Este parte tiene los datos enviados y no puede ser modificado'
		} else if (estadoLower === 'enviado') {
			return 'Este parte ha sido enviado y no puede ser modificado'
		}
		return 'Este parte no puede ser modificado'
	}

	// Función para normalizar fechas para comparación
	const normalizarFecha = (fecha) => {
		if (!fecha) return ''
		// Si la fecha viene de Notion, puede tener formato ISO
		const fechaObj = new Date(fecha)
		if (isNaN(fechaObj.getTime())) return fecha
		return fechaObj.toISOString().split('T')[0]
	}

	// Función para formatear fechas en formato español
	const formatearFecha = (fecha) => {
		if (!fecha) return 'Sin fecha'
		try {
			const fechaObj = new Date(fecha)
			if (isNaN(fechaObj.getTime())) return fecha

			// Formatear en DD-MM-YYYY HH:MM (hora de España)
			const dia = fechaObj.getDate().toString().padStart(2, '0')
			const mes = (fechaObj.getMonth() + 1).toString().padStart(2, '0')
			const año = fechaObj.getFullYear()
			const hora = fechaObj.getHours().toString().padStart(2, '0')
			const minutos = fechaObj.getMinutes().toString().padStart(2, '0')

			return `${dia}-${mes}-${año} ${hora}:${minutos}`
		} catch (error) {
			return fecha
		}
	}

	const formatearFechaFiltro = (fecha) => {
		if (!fecha) return ''
		try {
			const fechaObj = new Date(fecha)
			if (isNaN(fechaObj.getTime())) return fecha
			return fechaObj
				.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
				.replace('.', '')
		} catch (error) {
			return fecha
		}
	}

	// Función para calcular sumatorios de horas por categoría
	const calcularSumatoriosHoras = (detalles) => {
		const categorias = {
			'Oficial 1ª': 0,
			'Oficial 2ª': 0,
			'Oficial': 0,
			'Encargado': 0,
			'Capataz': 0,
			'Peón': 0,
			'Otros': 0
		}

		detalles.forEach(detalle => {
			const horas = detalle.horas || 0
			const categoria = detalle.categoria || ''
			const catLower = categoria.toLowerCase()

			// Normalizar categoría para agrupar variantes
			if (catLower.includes('oficial 1') || catLower.includes('of. 1') || catLower.includes('of 1')) {
				categorias['Oficial 1ª'] += horas
			} else if (catLower.includes('oficial 2') || catLower.includes('of. 2') || catLower.includes('of 2')) {
				categorias['Oficial 2ª'] += horas
			} else if (catLower.includes('oficial') || catLower.includes('of.')) {
				categorias['Oficial'] += horas
			} else if (catLower.includes('encargado')) {
				categorias['Encargado'] += horas
			} else if (catLower.includes('capataz')) {
				categorias['Capataz'] += horas
			} else if (catLower.includes('peon') || catLower.includes('peón')) {
				categorias['Peón'] += horas
			} else {
				// Capturar todas las demás categorías (Albañil, Montador, Ferralla, etc.)
				categorias['Otros'] += horas
			}
		})

		// Calcular total
		const total = Object.values(categorias).reduce((sum, horas) => sum + horas, 0)

		return { categorias, total }
	}

	const handleEnviarDatos = async (parte) => {
		if (!parte || enviandoParteId) return
		setEnviandoParteId(parte.id)
		try {
			const resultado = await enviarDatosParte(parte.id)
			setMensajeUI({ tipo: 'success', texto: 'Enviado. En un par de minutos el parte pasará a "Datos Enviados" y quedará esperando la firma.' })

			let partesActualizados = null
			if (typeof onRefrescarPartes === 'function') {
				try {
					partesActualizados = await onRefrescarPartes()
				} catch (refreshError) {
					console.error('Error al refrescar partes tras enviar datos:', refreshError)
				}
			}

			const nuevoEstado = resultado?.nuevoEstado || 'Datos Enviados'
			setParteSeleccionado((prev) => {
				if (!prev || prev.id !== parte.id) return prev
				const actualizado = partesActualizados?.find((p) => p.id === parte.id)
				return {
					...prev,
					estado: nuevoEstado,
					ultimaEdicion: actualizado?.ultimaEdicion || prev.ultimaEdicion
				}
			})
		} catch (error) {
			console.error('Error al enviar datos del parte:', error)
			setMensajeUI({ tipo: 'error', texto: error.message || 'No se pudo enviar los datos del parte.' })
		} finally {
			setEnviandoParteId(null)
		}
	}

	const esRectificable = (estado) => ['firmado', 'datos enviados'].includes(String(estado || '').toLowerCase())

	// Paso 1: mostrar modal de confirmación antes de rectificar.
	const handleRectificar = (parte) => {
		if (!parte || rectificandoParteId) return
		setConfirmRectificar(parte)
	}

	// Paso 2: ejecutar la rectificación tras confirmar en el modal.
	const ejecutarRectificar = async (parte) => {
		setConfirmRectificar(null)
		setRectificandoParteId(parte.id)
		try {
			const nuevo = await rectificarParte(parte.id)
			setMensajeUI({ tipo: 'success', texto: 'Parte rectificativo creado. Corrige los datos y vuelve a enviarlo a firmar.' })

			// Refrescar la lista en background (para que los badges aparezcan).
			if (typeof onRefrescarPartes === 'function') {
				onRefrescarPartes().catch(err => console.error('Error al refrescar partes tras rectificar:', err))
			}

			// Abrir el rectificativo en edición usando su id directamente,
			// sin esperar al refresh (el cache podría devolver la lista vieja).
			setParteSeleccionado(null)
			await iniciarEdicion({ id: nuevo.id, nombre: nuevo.nombre || parte.nombre, obra: parte.obra, fecha: parte.fecha })
		} catch (error) {
			console.error('Error al rectificar el parte:', error)
			setMensajeUI({ tipo: 'error', texto: error.message || 'No se pudo crear el parte rectificativo.' })
		} finally {
			setRectificandoParteId(null)
		}
	}

	// Función para obtener fecha y hora actual en formato YYYY-MM-DDTHH:MM
	const getCurrentDateTime = () => {
		const now = new Date()
		const year = now.getFullYear()
		const month = String(now.getMonth() + 1).padStart(2, '0')
		const day = String(now.getDate()).padStart(2, '0')
		const hours = String(now.getHours()).padStart(2, '0')
		const minutes = String(now.getMinutes()).padStart(2, '0')
		return `${year}-${month}-${day}T${hours}:${minutes}`
	}

	// Helper para extraer un id de relación Notion en diferentes formatos
	const extractRelacionId = (valor) => {
		if (!valor) return ''
		if (Array.isArray(valor) && valor.length > 0) return valor[0]?.id || ''
		if (typeof valor === 'object' && valor.id) return valor.id
		if (typeof valor === 'string') return valor
		return ''
	}

	// Función para cargar empleados de una obra
	const cargarEmpleadosObra = async (obraId) => {
		if (!obraId) {
			setEmpleadosObra([])
			return
		}

		setLoadingEmpleados(true)
		try {
			const empleados = await getEmpleadosObra(obraId)
			setEmpleadosObra(empleados)
		} catch (error) {
			console.error('Error al cargar empleados de la obra:', error)
			setEmpleadosObra([])
		} finally {
			setLoadingEmpleados(false)
		}
	}

	// F4: cargar firmantes autorizados de una obra
	const cargarFirmantesObra = async (obraId) => {
		if (!obraId) {
			setFirmantesObra([])
			return
		}
		setLoadingFirmantes(true)
		try {
			const firmantes = await getFirmantesAutorizados(obraId)
			setFirmantesObra(firmantes || [])
		} catch (e) {
			console.error('Error al cargar firmantes de la obra:', e)
			setFirmantesObra([])
		} finally {
			setLoadingFirmantes(false)
		}
	}

	// Función para iniciar edición de un parte
	const iniciarEdicion = async (parte) => {
		// Encontrar la obra correspondiente
		const obraEncontrada = datos.obras.find(obra => obra.nombre === parte.obra)
		const obraId = obraEncontrada?.id || ''

		// Obtener detalles completos del parte
		try {
			setLoadingEmpleadosParte(true)
			const detallesCompletos = await getDetallesCompletosParte(parte.id)
			console.log('Detalles completos del parte:', detallesCompletos)

			// Extraer la Persona Autorizada
			let personaAutorizadaId = ''
			if (detallesCompletos.parte.personaAutorizada) {
				// Si es un array de objetos con id
				if (Array.isArray(detallesCompletos.parte.personaAutorizada) && detallesCompletos.parte.personaAutorizada.length > 0) {
					personaAutorizadaId = detallesCompletos.parte.personaAutorizada[0].id
				}
				// Si es un objeto con id
				else if (typeof detallesCompletos.parte.personaAutorizada === 'object' && detallesCompletos.parte.personaAutorizada.id) {
					personaAutorizadaId = detallesCompletos.parte.personaAutorizada.id
				}
				// Si es un string directo
				else if (typeof detallesCompletos.parte.personaAutorizada === 'string') {
					personaAutorizadaId = detallesCompletos.parte.personaAutorizada
				}
			}

			// Extraer empleados y horas
			const empleadosActuales = []
			const horasActuales = {}

			detallesCompletos.empleados.forEach(detalle => {
				console.log('Procesando detalle:', detalle)

				// Extraer empleadoId del formato que devuelve la API
				let empleadoId = null

				if (detalle.empleadoId) {
					// Si es un array de objetos con id
					if (Array.isArray(detalle.empleadoId) && detalle.empleadoId.length > 0) {
						empleadoId = detalle.empleadoId[0].id
					}
					// Si es un objeto con id
					else if (typeof detalle.empleadoId === 'object' && detalle.empleadoId.id) {
						empleadoId = detalle.empleadoId.id
					}
					// Si es un string directo
					else if (typeof detalle.empleadoId === 'string') {
						empleadoId = detalle.empleadoId
					}
				}

				console.log('EmpleadoId procesado:', empleadoId)

				if (empleadoId) {
					empleadosActuales.push(empleadoId)
					// ?? y no ||: un detalle con 0 horas debe mostrarse como 0, no como 8 (UX-23)
					horasActuales[empleadoId] = detalle.horas ?? 8
				}
			})

			console.log('Debug cargar empleados:', {
				empleadosActuales: empleadosActuales,
				horasActuales: horasActuales,
				personaAutorizadaId: personaAutorizadaId
			})

			setEditandoParte({
				id: parte.id,
				nombre: parte.nombre,
				fecha: parte.fecha ? new Date(parte.fecha).toISOString().slice(0, 16) : getCurrentDateTime(),
				provinciaSeleccionada: obraEncontrada?.provincia || '',
				obraId: obraId,
				obra: parte.obra,
				personaAutorizadaId: personaAutorizadaId,
				notas: detallesCompletos.parte.notas || '',
				vehiculosSel: vehiculosDelParte(detallesCompletos.parte),
				empleados: empleadosActuales,
				empleadosHoras: horasActuales
			})

			// Cargar empleados y firmantes de la obra (F4)
			if (obraId) {
				await Promise.all([cargarEmpleadosObra(obraId), cargarFirmantesObra(obraId)])
			}
		} catch (error) {
			console.error('Error al cargar detalles completos del parte:', error)

			// Fallback: usar datos básicos del parte
			setEditandoParte({
				id: parte.id,
				nombre: parte.nombre,
				fecha: parte.fecha ? new Date(parte.fecha).toISOString().slice(0, 16) : getCurrentDateTime(),
				provinciaSeleccionada: obraEncontrada?.provincia || '',
				obraId: obraId,
				obra: parte.obra,
				personaAutorizadaId: '',
				notas: parte.notas || '',
				vehiculosSel: vehiculosDelParte(parte),
				empleados: [],
				empleadosHoras: {}
			})

			// Cargar empleados y firmantes de la obra (F4)
			if (obraId) {
				await Promise.all([cargarEmpleadosObra(obraId), cargarFirmantesObra(obraId)])
			}
		} finally {
			setLoadingEmpleadosParte(false)
		}
	}

	// Función para obtener provincias únicas (en edición)
	const getProvinciasUnicasEdicion = () => {
		const provincias = datos.obras
			.map(obra => obra.provincia)
			.filter(provincia => provincia)
		return [...new Set(provincias)].sort()
	}

	// Función para filtrar obras por provincia (en edición)
	const getObrasFiltradasEdicion = () => {
		if (!editandoParte?.provinciaSeleccionada) {
			return datos.obras
		}
		return datos.obras.filter(obra => obra.provincia === editandoParte.provinciaSeleccionada)
	}

	// Función para obtener empleados no asignados al parte
	const getEmpleadosNoAsignados = () => {
		if (!editandoParte || !empleadosObra.length) return []

		const empleadosAsignados = editandoParte.empleados || []
		return empleadosObra.filter(empleado => !empleadosAsignados.includes(empleado.id))
	}

	// Función para obtener empleados asignados al parte
	const getEmpleadosAsignados = () => {
		if (!editandoParte) return []

		const empleadosAsignados = editandoParte.empleados || []
		if (empleadosAsignados.length === 0) return []

		const indice = new Map()
		const registrarEmpleados = (lista) => {
			; (lista || []).forEach(empleado => {
				if (!empleado || !empleado.id) return
				indice.set(empleado.id, empleado)
			})
		}

		registrarEmpleados(datos.empleados)
		registrarEmpleados(empleadosObra)
		registrarEmpleados(Object.values(empleadosAñadidosDetalleEdicion))

		const detallesNormalizados = (detallesEmpleados || [])
			.map(detalle => {
				const relacion = Array.isArray(detalle.empleadoId)
					? detalle.empleadoId[0]?.id
					: detalle.empleadoId
				if (!relacion) return null
				return {
					id: relacion,
					nombre: detalle.empleadoNombre || 'Empleado sin nombre',
					categoria: detalle.categoria || 'Sin categoría'
				}
			})
			.filter(Boolean)

		registrarEmpleados(detallesNormalizados)

		return empleadosAsignados
			.map(id => {
				const empleado = indice.get(id)
				if (empleado) return empleado
				return {
					id,
					nombre: 'Empleado no disponible',
					categoria: 'Sin categoría'
				}
			})
	}

	// Función para cancelar edición
	const cancelarEdicion = () => {
		setEditandoParte(null)
		setEmpleadosObra([])
		setMostrarEmpleadosObra(false)
		setFirmantesObra([])
		setBusquedaLibreJefesEdicion(false)
		setBusquedaLibreEmpleadosEdicion(false)
		setBusquedaIdEdicion('')
		setErrorBusquedaIdEdicion('')
		setResultadosBusquedaEdicion([])
		setEmpleadosAñadidosDetalleEdicion({})
	}

	// Búsqueda incremental con debounce para añadir empleados en edición (mismo patrón que en creación):
	// - Si el texto son 3-6 dígitos: intenta primero ID Copuno; si no hay resultados, cae a búsqueda por nombre.
	// - Si no es numérico: búsqueda directa por nombre/apellidos.
	useEffect(() => {
		if (!editandoParte || busquedaIdEdicion.trim().length < 3) {
			setResultadosBusquedaEdicion([])
			return
		}
		setBuscandoIdEdicion(true)
		const t = setTimeout(async () => {
			try {
				const texto = busquedaIdEdicion.trim()
				const esIdCopuno = /^\d{3,6}$/.test(texto)
				let resultados = []
				if (esIdCopuno) {
					resultados = await buscarEmpleadoPorId(texto)
					if (!resultados || resultados.length === 0) {
						resultados = await buscarEmpleados(texto, 20)
					}
				} else {
					resultados = await buscarEmpleados(texto, 20)
				}
				setResultadosBusquedaEdicion(resultados || [])
				setErrorBusquedaIdEdicion((resultados || []).length === 0 ? `Sin resultados para "${texto}"` : '')
			} catch (error) {
				console.error('Error al buscar empleado:', error)
				setResultadosBusquedaEdicion([])
				setErrorBusquedaIdEdicion('Error al buscar el empleado. Inténtalo de nuevo.')
			} finally {
				setBuscandoIdEdicion(false)
			}
		}, 300)
		return () => clearTimeout(t)
	}, [busquedaIdEdicion, editandoParte])

	// Candidatos de la búsqueda que aún no están asignados al parte
	const getCandidatosBusquedaEdicion = () => {
		const empleadosAsignados = editandoParte?.empleados || []
		return resultadosBusquedaEdicion.filter(empleado => !empleadosAsignados.includes(empleado.id))
	}

	// Añade al parte en edición un empleado encontrado por la búsqueda (ID o nombre)
	const añadirEmpleadoPorBusquedaEdicion = (empleado) => {
		setEmpleadosAñadidosDetalleEdicion(prev => ({ ...prev, [empleado.id]: empleado }))
		toggleEmpleado(empleado.id)
		setBusquedaIdEdicion('')
		setResultadosBusquedaEdicion([])
	}

	// Función para guardar cambios
	const guardarCambios = async () => {
		if (!editandoParte) return

		setGuardandoCambios(true)

		try {
			// Validar datos requeridos
			if (!editandoParte.obraId || !editandoParte.fecha || !editandoParte.personaAutorizadaId) {
				setMensajeUI({ tipo: 'error', texto: 'Completa obra, fecha y persona autorizada para continuar.' })
				return
			}

			// Encontrar la obra seleccionada
			const obraSeleccionada = datos.obras.find(obra => obra.id === editandoParte.obraId)
			if (!obraSeleccionada) {
				setMensajeUI({ tipo: 'error', texto: 'La obra seleccionada no es válida.' })
				return
			}

			// Preparar datos para actualizar
			const datosActualizacion = {
				obraId: editandoParte.obraId,
				fecha: editandoParte.fecha,
				personaAutorizadaId: editandoParte.personaAutorizadaId,
				notas: editandoParte.notas || '',
				vehiculos: (editandoParte.vehiculosSel || []).map(v => v.matricula).join(', '),
				vehiculosIds: (editandoParte.vehiculosSel || []).map(v => v.id),
				empleados: editandoParte.empleados || [],
				empleadosHoras: Object.fromEntries(
					Object.entries(editandoParte.empleadosHoras || {}).map(([id, h]) => [id, clampRoundHoras(h)])
				)
			}

			console.log('Actualizando parte:', editandoParte.id, datosActualizacion)

			// Llamar a la API para actualizar
			const resultado = await actualizarParteTrabajo(editandoParte.id, datosActualizacion)

			console.log('Parte actualizado:', resultado)

			// Mostrar mensaje de éxito con advertencia si el estado cambió
			let mensajeExito = `Parte actualizado. ${resultado.detallesCreados} empleados asignados.`
			if (resultado.estadoCambiado) {
				mensajeExito = `⚠️ Parte actualizado. El estado ha cambiado de "${resultado.estadoAnterior}" a "Borrador". Deberás enviar los datos nuevamente para que el parte esté listo para firmar.`
			}
			setMensajeUI({ tipo: resultado.estadoCambiado ? 'warning' : 'success', texto: mensajeExito })

			// El mensaje queda visible en el banner del listado tras cerrar (mismo estado)
			// Refrescar listado de partes sin recargar la página completa
			if (onRefrescarPartes) {
				await onRefrescarPartes()
			}

			// Cerrar modal de edición
			cancelarEdicion()

		} catch (error) {
			console.error('Error al actualizar parte:', error)
			if (error.status === 409) {
				setMensajeUI({ tipo: 'error', texto: error.message })
				// Cerrar edición y refrescar ya: el mensaje persiste en el banner del listado
				cancelarEdicion()
				if (onRefrescarPartes) onRefrescarPartes()
			} else {
				setMensajeUI({ tipo: 'error', texto: `No se pudo actualizar el parte: ${error.message}` })
			}
		} finally {
			setGuardandoCambios(false)
		}
	}

	// Función para manejar cambios en el formulario de edición
	const handleEdicionChange = (campo, valor) => {
		setEditandoParte(prev => ({
			...prev,
			[campo]: valor
		}))
	}

	// Función para manejar cambio de provincia en edición
	const handleProvinciaChangeEdicion = (provincia) => {
		setEditandoParte(prev => ({
			...prev,
			provinciaSeleccionada: provincia,
			obraId: '',
			empleados: [],
			empleadosHoras: {}
		}))
		setEmpleadosObra([])
	}

	// Función para manejar cambio de obra en edición (confirma si había datos)
	const handleObraChangeEdicion = async (obraId) => {
		const habiaDatos = editandoParte?.personaAutorizadaId || (editandoParte?.empleados && editandoParte.empleados.length > 0)
		if (habiaDatos) {
			const confirmar = window.confirm('Cambiar de obra limpiará los empleados y el firmante seleccionados. ¿Continuar?')
			if (!confirmar) return
		}
		setEditandoParte(prev => ({
			...prev,
			obraId: obraId,
			personaAutorizadaId: '',
			empleados: [],
			empleadosHoras: {}
		}))
		setBusquedaLibreJefesEdicion(false)
		setBusquedaLibreEmpleadosEdicion(false)
		await Promise.all([cargarEmpleadosObra(obraId), cargarFirmantesObra(obraId)])
	}

	// Función para agregar/quitar empleado del parte
	const toggleEmpleado = (empleadoId) => {
		setEditandoParte(prev => {
			const empleadosActuales = prev.empleados || []
			const horasActuales = prev.empleadosHoras || {}

			if (empleadosActuales.includes(empleadoId)) {
				// Quitar empleado
				const newEmpleados = empleadosActuales.filter(id => id !== empleadoId)
				const newHoras = { ...horasActuales }
				delete newHoras[empleadoId]

				return {
					...prev,
					empleados: newEmpleados,
					empleadosHoras: newHoras
				}
			} else {
				// Agregar empleado con horas por defecto
				return {
					...prev,
					empleados: [...empleadosActuales, empleadoId],
					empleadosHoras: {
						...horasActuales,
						[empleadoId]: 8 // Horas por defecto
					}
				}
			}
		})
	}

	// Helper para limitar/redondear horas
	const clampRoundHoras = (val) => {
		let n = parseFloat(val)
		if (!isFinite(n)) n = 0
		if (n < 0) n = 0
		if (n > 24) n = 24
		return Math.round(n * 2) / 2
	}

	// Mientras se teclea se guarda el texto crudo (permite "7." de camino a "7.5");
	// el clamp/redondeo se aplica al salir del campo y como cinturón al guardar.
	const cambiarHorasEmpleado = (empleadoId, horas) => {
		setEditandoParte(prev => ({
			...prev,
			empleadosHoras: {
				...prev.empleadosHoras,
				[empleadoId]: horas
			}
		}))
	}
	const normalizarHorasEmpleado = (empleadoId) => {
		setEditandoParte(prev => ({
			...prev,
			empleadosHoras: {
				...prev.empleadosHoras,
				[empleadoId]: clampRoundHoras(prev.empleadosHoras[empleadoId])
			}
		}))
	}

	// Normaliza matrículas para comparar: mayúsculas, sin guiones ni espacios
	// ("7072-klc" y "7072 KLC" encuentran "7072KLC"). Edge case cubierto:
	// partes antiguos sin campo Vehículos quedan excluidos solo si se filtra.
	const normalizarMatricula = (texto) => String(texto || '').toUpperCase().replace(/[\s-]/g, '')

	// Filtrar partes según los criterios
	const partesFiltrados = datos.partesTrabajo.filter(parte => {
		const cumpleObra = !filtroObra || parte.obra === filtroObra
		const cumpleFecha = !filtroFecha || normalizarFecha(parte.fecha) === filtroFecha
		const cumpleEstado = !filtroEstado || (parte.estado || 'Pendiente') === filtroEstado
		const cumplePersonaAutorizada = !filtroPersonaAutorizada || parte.personaAutorizada === filtroPersonaAutorizada
		const cumpleVehiculo = !filtroVehiculo.trim() || normalizarMatricula(parte.vehiculos).includes(normalizarMatricula(filtroVehiculo))
		return cumpleObra && cumpleFecha && cumpleEstado && cumplePersonaAutorizada && cumpleVehiculo
	})

	// Obtener obras únicas para el filtro - usar todas las obras disponibles
	const obrasUnicas = datos.obras.map(obra => obra.nombre).filter(obra => obra)

	// Obtener estados únicos para el filtro
	const estadosUnicos = [...new Set(datos.partesTrabajo.map(parte => parte.estado || 'Pendiente'))].filter(estado => estado).sort()

	// Obtener personas autorizadas únicas para el filtro
	const personasAutorizadasUnicas = [...new Set(datos.partesTrabajo.map(parte => parte.personaAutorizada).filter(persona => persona))].sort()

	// Obtener fechas únicas para debug
	const fechasUnicas = [...new Set(datos.partesTrabajo.map(parte => normalizarFecha(parte.fecha)))].filter(fecha => fecha)

	const verDetalles = async (parte) => {
		setParteSeleccionado(parte)
		setLoadingDetalles(true)
		setDetallesEmpleados([])

		try {
			const detalles = await getDetallesEmpleados(parte.id)
			setDetallesEmpleados(detalles)
		} catch (error) {
			console.error('Error al cargar detalles de empleados:', error)
		} finally {
			setLoadingDetalles(false)
		}
	}

	const abrirFirma = (url) => {
		if (!url) return
		window.open(url, '_blank', 'noopener,noreferrer')
	}
	// Cambiar estado de un empleado (permitido siempre excepto partes firmados)
	const cambiarEstadoEmpleado = async (empleadoId, nuevoEstado) => {
		// Reflejo instantáneo en UI
		setEstadoLocal(prev => ({ ...prev, [empleadoId]: nuevoEstado }))
		try {
			await actualizarEstadoEmpleado(empleadoId, normalizeEstadoForApi(nuevoEstado))
			// Si estamos viendo detalles, refrescar la lista de detalles para ver el estado actualizado
			if (parteSeleccionado) {
				await verDetalles(parteSeleccionado)
			}
		} catch (error) {
			// Revertir si falla
			setEstadoLocal(prev => ({ ...prev, [empleadoId]: undefined }))
			setMensajeUI({ tipo: 'error', texto: error.message })
		}
	}


	// H3: polling client-side puro en lugar de SSE (incompatible con Vercel serverless).
	// Reutiliza la misma lógica de Smart Polling adaptativo que el polling principal.
	const estadoPollRef = useRef(null)
	const estadoPollLastChangeRef = useRef(Date.now())

	const getEstadoPollInterval = () => {
		const elapsed = Date.now() - estadoPollLastChangeRef.current
		if (elapsed < 30000) return 3000   // rápido: cambios recientes
		if (elapsed < 120000) return 8000  // normal
		return 15000                        // lento
	}

	useEffect(() => {
		if (!parteSeleccionado?.id) {
			if (estadoPollRef.current) {
				clearInterval(estadoPollRef.current)
				estadoPollRef.current = null
			}
			return
		}

		let cancelled = false

		const poll = async () => {
			if (cancelled) return
			try {
				const data = await getParteEstado(parteSeleccionado.id)
				if (!data || cancelled) return
				setParteSeleccionado(prev => {
					if (!prev || prev.id !== parteSeleccionado.id) return prev
					if (prev.estado !== data.estado || prev.ultimaEdicion !== data.ultimaEdicion) {
						estadoPollLastChangeRef.current = Date.now()
						return { ...prev, estado: data.estado, ultimaEdicion: data.ultimaEdicion }
					}
					return prev
				})
			} catch { /* sin conexión, ignorar */ }

			// Ajustar intervalo según actividad
			if (estadoPollRef.current) {
				clearInterval(estadoPollRef.current)
				estadoPollRef.current = setInterval(poll, getEstadoPollInterval())
			}
		}

		estadoPollLastChangeRef.current = Date.now()
		estadoPollRef.current = setInterval(poll, getEstadoPollInterval())

		return () => {
			cancelled = true
			if (estadoPollRef.current) {
				clearInterval(estadoPollRef.current)
				estadoPollRef.current = null
			}
		}
	}, [parteSeleccionado?.id])

	const cerrarDetalles = () => {
		if (estadoPollRef.current) {
			clearInterval(estadoPollRef.current)
			estadoPollRef.current = null
		}
		setParteSeleccionado(null)
		setDetallesEmpleados([])
	}

	return (
		<div className="consulta-section">
			{editandoParte ? (
				<div className="edicion-modal">
					<div className="edicion-content">
						<div className="edicion-header">
							<button className="btn-close" onClick={cancelarEdicion}>
								<ArrowLeft size={20} />
								Cancelar Edición
							</button>
							<h2 className="edicion-title">Editar Parte: {editandoParte.nombre}</h2>
						</div>

						{mensajeUI.texto && (
							<div className={`message ${mensajeUI.tipo}`} style={{ marginBottom: 12 }}>
								{mensajeUI.texto}
							</div>
						)}
						<div className="edicion-form">
							<div className="form-group">
								<label className="form-label">Provincia:</label>
								<select
									className="form-select"
									value={editandoParte.provinciaSeleccionada}
									onChange={(e) => handleProvinciaChangeEdicion(e.target.value)}
								>
									<option value="">Selecciona una provincia</option>
									{getProvinciasUnicasEdicion().map(provincia => (
										<option key={provincia} value={provincia}>
											{provincia}
										</option>
									))}
								</select>
							</div>

							<div className="grid grid-2">
								<div className="form-group">
									<label className="form-label">Fecha y Hora:</label>
									<input
										type="datetime-local"
										className="form-input"
										value={editandoParte.fecha}
										onChange={(e) => handleEdicionChange('fecha', e.target.value)}
									/>
								</div>

								<div className="form-group">
									<label className="form-label">Obra:</label>
									<select
										className="form-select"
										value={editandoParte.obraId}
										onChange={(e) => handleObraChangeEdicion(e.target.value)}
										disabled={!editandoParte.provinciaSeleccionada}
									>
										<option value="">
											{!editandoParte.provinciaSeleccionada
												? 'Primero selecciona una provincia'
												: 'Selecciona una obra'}
										</option>
										{getObrasFiltradasEdicion().map(obra => (
											<option key={obra.id} value={obra.id}>
												{obra.nombre}
											</option>
										))}
									</select>
								</div>
							</div>

							<div className="form-group">
								<label className="form-label">Persona Autorizada:</label>
								<label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: '0.9em' }}>
									<input
										type="checkbox"
										checked={busquedaLibreJefesEdicion}
										onChange={(e) => setBusquedaLibreJefesEdicion(e.target.checked)}
									/>
									Buscar en toda la base
								</label>
								{loadingFirmantes ? (
									<div className="empleados-loading"><Loader2 size={16} className="loading-spinner" /> Cargando firmantes…</div>
								) : (
									<>
										{!busquedaLibreJefesEdicion && firmantesObra.length === 0 && (
											<div className="empleados-empty" style={{ marginBottom: 6 }}>
												Esta obra no tiene firmantes asignados. Activa búsqueda libre para elegir uno de la base completa.
											</div>
										)}
										<select
											className="form-select"
											value={editandoParte.personaAutorizadaId}
											onChange={(e) => handleEdicionChange('personaAutorizadaId', e.target.value)}
										>
											<option value="">Selecciona una Persona Autorizada</option>
											{busquedaLibreJefesEdicion
												? datos.jefesObra.map(jefe => {
													const enLista = firmantesObra.some(f => f.id === jefe.id)
													return (
														<option key={jefe.id} value={jefe.id}>
															{jefe.nombre} ({jefe.email}){!enLista && editandoParte.obraId ? ' (no asignado a esta obra)' : ''}
														</option>
													)
												})
												: Object.entries(agruparFirmantesPorRol(firmantesObra)).map(([rol, lista]) => (
													lista.length > 0 && (
														<optgroup key={rol} label={rol}>
															{lista.map(f => (
																<option key={f.id} value={f.id}>
																	{f.nombre}{f.email ? ` (${f.email})` : ''}
																</option>
															))}
														</optgroup>
													)
												))
											}
											{/* Si el firmante guardado no está en la lista filtrada, mostrarlo como fallback */}
											{!busquedaLibreJefesEdicion && editandoParte.personaAutorizadaId &&
												!firmantesObra.some(f => f.id === editandoParte.personaAutorizadaId) && (() => {
													const fallback = datos.jefesObra.find(j => j.id === editandoParte.personaAutorizadaId)
													return fallback ? (
														<option key={fallback.id} value={fallback.id}>
															{fallback.nombre} (no asignado a esta obra)
														</option>
													) : null
												})()
											}
										</select>
									</>
								)}
							</div>

							<CampoVehiculos
								value={editandoParte.vehiculosSel || []}
								onChange={(v) => handleEdicionChange('vehiculosSel', v)}
							/>

							<div className="form-group">
								<label className="form-label">Notas:</label>
								<textarea
									className="form-input"
									rows="4"
									value={editandoParte.notas}
									onChange={(e) => handleEdicionChange('notas', e.target.value)}
									placeholder="Añade cualquier nota o comentario sobre el trabajo realizado..."
								/>
							</div>

							{/* Sección de empleados */}
							<div className="empleados-edicion-section">
								<div className="empleados-header">
									<div className="empleados-info">
										<h3>Empleados del Parte</h3>
										<div className="empleados-stats">
											<span className="stat-asignados">
												Asignados: {editandoParte.empleados.length}
											</span>
											{mostrarEmpleadosObra && (
												<span className="stat-disponibles">
													Disponibles: {getEmpleadosNoAsignados().length}
												</span>
											)}
										</div>
									</div>
									<button
										className="btn btn-primary"
										onClick={() => setMostrarEmpleadosObra(!mostrarEmpleadosObra)}
									>
										<Users size={20} />
										{mostrarEmpleadosObra ? 'Ocultar' : 'Ver'} empleados de esta obra
									</button>
								</div>

								{/* Añadir empleado por ID Copuno o por nombre/apellidos (sugerencias en vivo) */}
								<div className="empleados-search">
									<Search size={18} />
									<input
										type="text"
										className="empleados-search-input"
										placeholder="Añadir empleado por ID Copuno o nombre..."
										value={busquedaIdEdicion}
										onChange={(e) => {
											setBusquedaIdEdicion(e.target.value)
											setErrorBusquedaIdEdicion('')
										}}
										onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
										enterKeyHint="search"
									/>
									{buscandoIdEdicion && <Loader2 size={16} className="loading-spinner" />}
								</div>
								{errorBusquedaIdEdicion && (
									<div className="message error">{errorBusquedaIdEdicion}</div>
								)}
								{getCandidatosBusquedaEdicion().length > 0 && (
									<div className="empleados-lista empleados-lista-compacta">
										{getCandidatosBusquedaEdicion().map(empleado => (
											<div key={empleado.id} className="empleado-item">
												<span className="empleado-info">
													<div className="empleado-nombre-estado">
														<strong>
															{empleado.idCopuno != null ? `${empleado.idCopuno} · ` : '— · '}
															{empleado.nombre}
														</strong>
														<span className="categoria">{empleado.categoria || '—'}</span>
													</div>
												</span>
												<button
													type="button"
													className="btn btn-success"
													onClick={() => añadirEmpleadoPorBusquedaEdicion(empleado)}
												>
													<Plus size={14} /> Añadir
												</button>
											</div>
										))}
									</div>
								)}

								{/* Empleados actuales del parte */}
								<div className="empleados-actuales">
									<h4>Empleados asignados al parte ({editandoParte.empleados.length}):</h4>
									{loadingEmpleadosParte ? (
										<div className="empleados-loading">
											<Loader2 size={20} className="loading-spinner" />
											<p>Cargando empleados del parte...</p>
										</div>
									) : editandoParte.empleados.length === 0 ? (
										<div className="empleados-empty">
											<p>No hay empleados asignados a este parte</p>
										</div>
									) : (
										<div className="empleados-lista-edicion">
											{getEmpleadosAsignados().map(empleado => (
												<div key={empleado.id} className="empleado-edicion-item">
													<div className="empleado-info-edicion">
														<label className="empleado-checkbox-edicion">
															<input
																type="checkbox"
																checked={true}
																onChange={() => toggleEmpleado(empleado.id)}
															/>
															<span className="empleado-nombre-edicion">
																<strong>
																	{empleado.idCopuno != null ? `${empleado.idCopuno} · ` : '— · '}
																	{empleado.nombre}
																</strong>
																<span className="categoria-empleado">{empleado.categoria}</span>
															</span>
														</label>
													</div>
													<div className="empleado-horas-edicion">
														<label className="horas-label">Horas:</label>
														<input
															type="number"
															className="horas-input-edicion"
															min="0"
															max="24"
															step="0.5"
															inputMode="decimal"
															value={editandoParte.empleadosHoras[empleado.id] ?? 8}
															onChange={(e) => cambiarHorasEmpleado(empleado.id, e.target.value)}
															onBlur={() => normalizarHorasEmpleado(empleado.id)}
														/>
														<span className="horas-unidad">h</span>
													</div>
													<div className="empleado-estado-edicion">
														<label className="horas-label">Estado:</label>
														<select
															className="form-select"
															onChange={(e) => cambiarEstadoEmpleado(empleado.id, e.target.value)}
															defaultValue={empleado.estado || ''}
														>
															<option value="" disabled>{empleado.estado ? `Estado actual: ${empleado.estado}` : 'Sin estado'}</option>
															{(estadoOptions.options || []).map(opt => (
																<option key={opt.name} value={opt.name}>
																	{opt.name}
																</option>
															))}
														</select>
														{/* Indicador del color del estado seleccionado */}
														{(() => {
															const seleccionado = estadoLocal[empleado.id] || empleado.estado
															const opt = getEstadoOptionByName(seleccionado)
															if (!opt) return null
															const color = mapNotionColorToHex(opt.color)
															return (
																<span className="estado-empleado" title={seleccionado}>
																	<span className="badge-dot" style={{ backgroundColor: color }} /> {seleccionado}
																</span>
															)
														})()}
													</div>
												</div>
											))}
										</div>
									)}
								</div>

								{/* Lista de empleados de la obra */}
								{mostrarEmpleadosObra && (
									<div className="empleados-obra-disponibles">
										<h4>Empleados disponibles en la obra (no asignados al parte):</h4>
										{loadingEmpleados ? (
											<div className="empleados-loading">
												<Loader2 size={20} className="loading-spinner" />
												<p>Cargando empleados de la obra...</p>
											</div>
										) : getEmpleadosNoAsignados().length === 0 ? (
											<div className="empleados-empty">
												<p>Todos los empleados de la obra ya están asignados al parte</p>
											</div>
										) : (
											<div className="empleados-lista-disponibles">
												{getEmpleadosNoAsignados().map(empleado => (
													<div key={empleado.id} className="empleado-disponible-item">
														<div className="empleado-info-disponible">
															<label className="empleado-checkbox-disponible">
																<input
																	type="checkbox"
																	checked={false}
																	onChange={() => toggleEmpleado(empleado.id)}
																/>
																<span className="empleado-nombre-disponible">
																	<strong>
																		{empleado.idCopuno != null ? `${empleado.idCopuno} · ` : '— · '}
																		{empleado.nombre}
																	</strong>
																	<span className="categoria-empleado">{empleado.categoria}</span>
																</span>
															</label>
														</div>
														<div className="empleado-estado-edicion">
															<label className="horas-label">Estado:</label>
															<select
																className="form-select"
																onChange={(e) => cambiarEstadoEmpleado(empleado.id, e.target.value)}
																defaultValue={estadoLocal[empleado.id] || empleado.estado || ''}
															>
																<option value="" disabled>{empleado.estado ? `Estado actual: ${empleado.estado}` : 'Sin estado'}</option>
																{(estadoOptions.options || []).map(opt => (
																	<option key={opt.name} value={opt.name}>
																		{opt.name}
																	</option>
																))}
															</select>
															{(() => {
																const seleccionado = estadoLocal[empleado.id] || empleado.estado
																const opt = getEstadoOptionByName(seleccionado)
																if (!opt) return null
																const color = mapNotionColorToHex(opt.color)
																return (
																	<span className="estado-empleado" title={seleccionado}>
																		<span className="badge-dot" style={{ backgroundColor: color }} /> {seleccionado}
																	</span>
																)
															})()}
														</div>
													</div>
												))}
											</div>
										)}
									</div>
								)}
							</div>

							{/* Acciones de edición */}
							<div className="edicion-acciones">
								<button
									className="btn btn-success"
									onClick={guardarCambios}
									disabled={guardandoCambios}
								>
									{guardandoCambios ? (
										<>
											<Loader2 size={20} className="loading-spinner" />
											Guardando...
										</>
									) : (
										<>
											<FileText size={20} />
											Guardar Cambios
										</>
									)}
								</button>
								<button
									className="btn btn-secondary"
									onClick={cancelarEdicion}
									disabled={guardandoCambios}
								>
									Cancelar
								</button>
							</div>
						</div>
					</div>
				</div>
			) : parteSeleccionado ? (
				<div className="detalles-modal">
					<div className="detalles-content">
						<div className="detalles-header">
							<button className="btn-close" onClick={cerrarDetalles}>
								<ArrowLeft size={20} />
								Volver
							</button>
							<h2 className="detalles-title">{parteSeleccionado.nombre}</h2>
						</div>
						<div className="detalles-info">
							{/* Alerta si el parte no es editable */}
							{!puedeEditarParte(parteSeleccionado.estado) && (
								<div className="alerta-no-editable">
									<div className="alerta-icon">
										<FileText size={20} />
									</div>
									<div className="alerta-content">
										<h4 className="alerta-title">Parte No Editable</h4>
										<p className="alerta-message">
											{getMensajeEstadoNoEditable(parteSeleccionado.estado)}
										</p>
									</div>
								</div>
							)}

							<div className="info-grid">
								<div className="info-item">
									<Building size={20} />
									<span><strong>Obra:</strong> {parteSeleccionado.obra || 'Sin obra'}</span>
								</div>
								<div className="info-item">
									<Calendar size={20} />
									<span><strong>Fecha:</strong> {formatearFecha(parteSeleccionado.fecha)}</span>
								</div>
								<div className="info-item">
									<Clock size={20} />
									<span><strong>Última Edición:</strong> {formatearFecha(parteSeleccionado.ultimaEdicion)}</span>
								</div>
								<div className="info-item">
									<span><strong>Estado:</strong> {parteSeleccionado.estado || 'Pendiente'}</span>
								</div>
							</div>

							{/* Resumen de horas por categoría */}
							{!loadingDetalles && detallesEmpleados.length > 0 && (() => {
								const { categorias } = calcularSumatoriosHoras(detallesEmpleados)
								// Usar el valor de Notion como fuente de verdad para el total
								const horasTotalesNotion = parteSeleccionado.horasTotales || parteSeleccionado.rpHorasTotales
								return (
									<div className="resumen-horas-section">
										<h3>Resumen de Horas</h3>
										<div className="resumen-horas-grid">
											{Object.entries(categorias).filter(([, horas]) => horas > 0).map(([categoria, horas]) => (
												<div key={categoria} className="resumen-horas-item">
													<span className="resumen-horas">Horas de {categoria}: {horas}</span>
												</div>
											))}
										</div>
										<div className="resumen-total">
											<span className="total-horas">Horas totales: {horasTotalesNotion || 0}</span>
										</div>
									</div>
								)
							})()}

							{/* Sección de empleados asignados */}
							<div className="empleados-section">
								<h3>Empleados Asignados</h3>
								{loadingDetalles ? (
									<div className="loading-detalles">
										<Loader2 size={24} className="loading-spinner" />
										<p>Cargando detalles de empleados...</p>
									</div>
								) : detallesEmpleados.length > 0 ? (
									<div className="empleados-lista-detalles">
										{detallesEmpleados.map((detalle, index) => {
											// F6: enriquecer con ID Copuno cruzando contra empleados globales
											let empId = null
											if (Array.isArray(detalle.empleadoId) && detalle.empleadoId.length > 0) empId = detalle.empleadoId[0].id
											else if (detalle.empleadoId && typeof detalle.empleadoId === 'object' && detalle.empleadoId.id) empId = detalle.empleadoId.id
											else if (typeof detalle.empleadoId === 'string') empId = detalle.empleadoId
											const empGlobal = empId ? datos.empleados.find(e => e.id === empId) : null
											const idCopuno = empGlobal?.idCopuno
											return (
											<div key={detalle.id || index} className="empleado-detalle">
												<div className="empleado-info-detalle">
													<div className="empleado-nombre">
														<User size={16} />
														<span>
															{idCopuno != null ? `${idCopuno} · ` : '— · '}
															{detalle.empleadoNombre || 'Empleado sin nombre'}
														</span>
													</div>
													<div className="empleado-categoria">
														<span className="categoria-badge">{detalle.categoria || 'Sin categoría'}</span>
													</div>
													<div className="empleado-horas">
														<Clock size={16} />
														<span>{detalle.horas || 0} horas</span>
													</div>
												</div>
												{/* Estado del empleado oculto en vista de detalles por requerimiento */}
												{detalle.detalle && (
													<div className="empleado-notas">
														<p>{detalle.detalle}</p>
													</div>
												)}
											</div>
											)
										})}
									</div>
								) : (
									<div className="no-empleados">
										<p>No hay empleados asignados a este parte</p>
									</div>
								)}
							</div>

							{parteSeleccionado.vehiculos && (
								<div className="notas-section">
									<h3>Vehículos:</h3>
									<p>{parteSeleccionado.vehiculos}</p>
								</div>
							)}

							{parteSeleccionado.notas && (
								<div className="notas-section">
									<h3>Notas:</h3>
									<p>{parteSeleccionado.notas}</p>
								</div>
							)}

							{/* Acciones del parte */}
							<div className="parte-acciones-detalles">
								{parteSeleccionado.urlPDF && tienePDFDisponible(parteSeleccionado.estado) && (
									<button className="btn btn-primary" onClick={() => window.open(parteSeleccionado.urlPDF, '_blank')}>
										<FileText size={20} />
										Descargar PDF
									</button>
								)}
								{esEstadoListoFirmar(parteSeleccionado.estado) && parteSeleccionado.firmarUrl && (
									<button
										className="btn btn-sign"
										onClick={() => abrirFirma(parteSeleccionado.firmarUrl)}
									>
										<PenSquare size={20} />
										Firmar ahora
									</button>
								)}
								{esEstadoBorrador(parteSeleccionado.estado) && (
									<button
										className="btn btn-warning"
										onClick={() => handleEnviarDatos(parteSeleccionado)}
										disabled={enviandoParteId === parteSeleccionado.id}
									>
										{enviandoParteId === parteSeleccionado.id ? (
											<>
												<Loader2 size={18} className="spinner-inline" />
												Enviando...
											</>
										) : (
											<>
												<Send size={18} />
												Enviar Datos
											</>
										)}
									</button>
								)}

								{/* Botones de edición solo si el parte es editable */}
								{puedeEditarParte(parteSeleccionado.estado) ? (
									<div className="acciones-edicion">
										<button className="btn btn-secondary" onClick={() => iniciarEdicion(parteSeleccionado)}>
											<FileText size={20} />
											Editar Parte
										</button>
									</div>
								) : (
									<div className="mensaje-no-editable">
										<p>Este parte no puede ser modificado debido a su estado actual</p>
									</div>
								)}
							</div>
						</div>
					</div>
				</div>
			) : (
				<>
					<div className="section-header">
						<button className="btn-back" onClick={onVolver}>
							<ArrowLeft size={20} />
							Volver al Inicio
						</button>
						<h2 className="section-title">Consultar Partes Existentes</h2>
					</div>
					{/* Modal de confirmación para rectificar */}
					{confirmRectificar && (
						<div className="modal-overlay" onClick={() => setConfirmRectificar(null)}>
							<div className="modal-confirm" onClick={e => e.stopPropagation()}>
								<h3>¿Crear parte rectificativo?</h3>
								<p>Se creará un parte nuevo en <strong>Borrador</strong> copiando los empleados y horas de <strong>{confirmRectificar.nombre}</strong>.</p>
								<p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>El parte firmado original se conserva intacto.</p>
								<div className="modal-confirm-actions">
									<button className="btn btn-secondary" onClick={() => setConfirmRectificar(null)}>Cancelar</button>
									<button className="btn btn-warning" onClick={() => ejecutarRectificar(confirmRectificar)}>
										<RotateCcw size={16} />
										Crear rectificativo
									</button>
								</div>
							</div>
						</div>
					)}

					{mensajeUI.texto && (
						<div className={`message ${mensajeUI.tipo}`} style={{ marginBottom: 12 }}>
							{mensajeUI.texto}
						</div>
					)}

					<div className="card">
						<div className="card-header">
							<h2 className="card-title">Consultar Partes Existentes</h2>
							<p className="card-subtitle">Busca y visualiza los partes de trabajo</p>
						</div>

						{/* Filtros */}
						<div className="filtros">
							<div className="filtros-heading">
								<div className="filtros-heading-left">
									<Search size={16} />
									<span>Filtros</span>
								</div>
								{(filtroObra || filtroFecha || filtroEstado || filtroPersonaAutorizada || filtroVehiculo) && (
									<button
										className="btn-reset-filtros"
										onClick={limpiarFiltros}
										title="Restablecer filtros"
									>
										<RotateCcw size={16} />
										<span>Limpiar</span>
									</button>
								)}
							</div>
							<div className="grid">
								<div className="form-group">
									<label className="form-label">Filtrar por Obra:</label>
									<select
										className="form-select"
										value={filtroObra}
										onChange={(e) => setFiltroObra(e.target.value)}
									>
										<option value="">Todas las obras</option>
										{obrasUnicas.map(obra => (
											<option key={obra} value={obra}>{obra}</option>
										))}
									</select>
								</div>
								<div className="form-group">
									<label className="form-label">Filtrar por Fecha:</label>
									<input
										type="date"
										className="form-input"
										value={fechaInput}
										onChange={(e) => {
											setFechaInput(e.target.value)
											setFiltroFecha(e.target.value)
										}}
									/>
								</div>
								<div className="form-group">
									<label className="form-label">Filtrar por Estado:</label>
									<select
										className="form-select"
										value={filtroEstado}
										onChange={(e) => setFiltroEstado(e.target.value)}
									>
										<option value="">Todos los estados</option>
										{estadosUnicos.map(estado => (
											<option key={estado} value={estado}>{estado}</option>
										))}
									</select>
								</div>
								<div className="form-group">
									<label className="form-label">Filtrar por Persona Autorizada:</label>
									<select
										className="form-select"
										value={filtroPersonaAutorizada}
										onChange={(e) => setFiltroPersonaAutorizada(e.target.value)}
									>
										<option value="">Todas las personas autorizadas</option>
										{personasAutorizadasUnicas.map(persona => (
											<option key={persona} value={persona}>{persona}</option>
										))}
									</select>
								</div>
								<div className="form-group">
									<label className="form-label">Filtrar por Vehículo (matrícula):</label>
									<input
										type="text"
										className="form-input"
										value={filtroVehiculo}
										onChange={(e) => setFiltroVehiculo(e.target.value)}
										placeholder="Ej.: 7072KLC (ignora guiones y mayúsculas)"
									/>
								</div>
							</div>
							{(filtroObra || filtroFecha || filtroEstado || filtroPersonaAutorizada) && (
								<div className="filtros-activos">
									{filtroObra && (
										<span className="filtro-chip">Obra: {filtroObra}</span>
									)}
									{filtroFecha && (
										<span className="filtro-chip">Fecha: {formatearFechaFiltro(filtroFecha)}</span>
									)}
									{filtroEstado && (
										<span className="filtro-chip">Estado: {filtroEstado}</span>
									)}
									{filtroPersonaAutorizada && (
										<span className="filtro-chip">Persona Autorizada: {filtroPersonaAutorizada}</span>
									)}
									{filtroVehiculo && (
										<span className="filtro-chip">Vehículo: {filtroVehiculo}</span>
									)}
								</div>
							)}
						</div>

						{/* Debug info para filtros - Comentado para ocultar */}
						{/* {import.meta.env.MODE === 'development' && (
							<div className="debug-filtros">
								<strong>Debug Filtros:</strong> Obras disponibles: {obrasUnicas.length} |
								Partes totales: {datos.partesTrabajo.length} |
								Partes filtrados: {partesFiltrados.length} |
								Fechas disponibles: {fechasUnicas.length}
								{filtroFecha && (
									<span> | Fecha filtro: {filtroFecha}</span>
								)}
							</div>
						)} */}

						{/* Lista de partes */}
						<div className="partes-lista">
							{partesFiltrados.length === 0 ? (
								<div className="no-partes">
									<p className="text-large">No se encontraron partes con los filtros seleccionados</p>
								</div>
							) : (
								partesFiltrados.map((parte) => {
									const estadoClase = `estado-${String(parte.estado || 'pendiente')
										.toLowerCase()
										.normalize('NFD')
										.replace(/[\u0300-\u036f]/g, '')
										.replace(/\s+/g, '-')}`

									const horasTotalesCalculadas = (() => {
										if (parte.rpHorasTotales !== undefined && parte.rpHorasTotales !== null) {
											return formatearHorasTexto(parte.rpHorasTotales)
										}
										const suma = [
											parte.horasOficial1,
											parte.horasOficial2,
											parte.horasCapataz,
											parte.horasEncargado,
											parte.horasPeon
										]
											.filter((h) => typeof h === 'number')
											.reduce((sum, h) => sum + h, 0)
										return formatearHorasTexto(suma)
									})()

									return (
										<div key={parte.id} className={`parte-card ${estadoClase}`}>
											<div className="parte-header">
												<h3 className="parte-nombre">{parte.nombre}</h3>
												<span className={`estado-badge ${estadoClase.replace('estado-', '')}`}>
													{parte.estado || 'Pendiente'}
												</span>
												{parte.esRectificativo && (() => {
													const original = datos.partesTrabajo.find((p) => p.id === parte.rectificaAId)
													return (
														<span className="estado-badge rectificativo" title={original ? `Rectifica a ${original.nombre}` : 'Parte rectificativo'}>
															Rectificativo
														</span>
													)
												})()}
												{Array.isArray(parte.rectificadoPorIds) && parte.rectificadoPorIds.length > 0 && (
													<span className="estado-badge rectificado" title="Este parte tiene un rectificativo asociado">
														Rectificado
													</span>
												)}
											</div>
											<div className="parte-info">
												<div className="info-item">
													<Building size={20} />
													<span><strong>Obra</strong> {parte.obra || 'Sin obra'}</span>
												</div>
												<div className="info-item">
													<Calendar size={20} />
													<span><strong>Fecha</strong> {formatearFecha(parte.fecha)}</span>
												</div>
												<div className="info-item">
													<Users size={20} />
													<span><strong>Horas</strong> {horasTotalesCalculadas}</span>
												</div>
												{parte.vehiculos && (
													<div className="info-item">
														<Truck size={20} />
														<span><strong>Vehículos</strong> {parte.vehiculos}</span>
													</div>
												)}
											</div>

											{/* Indicador visual si el parte no es editable */}
											{!puedeEditarParte(parte.estado) && (
												<div className="parte-no-editable-indicator">
													<FileText size={16} />
													<span>No editable - {parte.estado}</span>
												</div>
											)}

											<div className="parte-acciones">
												<button className="btn btn-primary" onClick={() => verDetalles(parte)}>
													Ver Detalles
												</button>
												{parte.urlPDF && tienePDFDisponible(parte.estado) && (
													<button className="btn btn-secondary" onClick={() => window.open(parte.urlPDF, '_blank')}>
														Descargar PDF
													</button>
												)}
												{esEstadoListoFirmar(parte.estado) && parte.firmarUrl && (
													<button
														className="btn btn-sign"
														onClick={() => abrirFirma(parte.firmarUrl)}
													>
														<PenSquare size={18} />
														Firmar
													</button>
												)}
												{esEstadoBorrador(parte.estado) && (
													<button
														className="btn btn-warning"
														onClick={() => handleEnviarDatos(parte)}
														disabled={enviandoParteId === parte.id}
													>
														{enviandoParteId === parte.id ? (
															<>
																<Loader2 size={18} className="spinner-inline" />
																Enviando...
															</>
														) : (
															<>
																<Send size={18} />
																Enviar Datos
															</>
														)}
													</button>
												)}

												{/* Botones de edición solo si el parte es editable */}
												{puedeEditarParte(parte.estado) && (
													<button className="btn btn-success" onClick={() => iniciarEdicion(parte)}>
														<FileText size={20} />
														Editar
													</button>
												)}

												{/* Rectificar: solo partes firmados y aún no rectificados */}
												{esRectificable(parte.estado) && (!parte.rectificadoPorIds || parte.rectificadoPorIds.length === 0) && (
													<button
														className="btn btn-warning"
														onClick={() => handleRectificar(parte)}
														disabled={rectificandoParteId === parte.id}
													>
														{rectificandoParteId === parte.id ? (
															<>
																<Loader2 size={18} className="spinner-inline" />
																Rectificando...
															</>
														) : (
															<>
																<RotateCcw size={18} />
																Rectificar
															</>
														)}
													</button>
												)}
											</div>
										</div>
									)
								})
							)}
						</div>
					</div>
				</>
			)}
		</div>
	)
}

// Componente para crear nuevo parte
function CrearParte({ datos, estadoOptions, onParteCreado, onVolver }) {
	// Función para obtener fecha actual en formato YYYY-MM-DD
	const getCurrentDate = () => {
		const now = new Date()
		const year = now.getFullYear()
		const month = String(now.getMonth() + 1).padStart(2, '0')
		const day = String(now.getDate()).padStart(2, '0')
		return `${year}-${month}-${day}`
	}

	const [formData, setFormData] = useState({
		provinciaSeleccionada: '', // Nueva propiedad para provincia
		obraId: '',
		obra: '',
		fecha: getCurrentDate(),
		personaAutorizadaId: '',
		personaAutorizada: '',
		empleados: [],
		empleadosHoras: {}, // Nuevo objeto para almacenar horas por empleado
		notas: '',
		vehiculosSel: [] // Vehículos seleccionados de la flota [{id, matricula}]
	})
	const [loading, setLoading] = useState(false)
	const [message, setMessage] = useState('')
	const [empleadosObra, setEmpleadosObra] = useState([])
	const [estadoLocal, setEstadoLocal] = useState({})
	const [loadingEmpleados, setLoadingEmpleados] = useState(false)
	const [parteCreado, setParteCreado] = useState(null)
	const [showOpciones, setShowOpciones] = useState(false)
	const [mensajeUI, setMensajeUI] = useState({ tipo: '', texto: '' })
	const [busquedaEmpleado, setBusquedaEmpleado] = useState('')
	// F4: firmantes de la obra + toggle búsqueda libre de jefes
	const [firmantesObra, setFirmantesObra] = useState([])
	const [loadingFirmantes, setLoadingFirmantes] = useState(false)
	const [busquedaLibreJefes, setBusquedaLibreJefes] = useState(false)
	// F5: toggle búsqueda libre de empleados + resultados de búsqueda incremental
	const [busquedaLibreEmpleados, setBusquedaLibreEmpleados] = useState(false)
	const [resultadosBusquedaLibre, setResultadosBusquedaLibre] = useState([])
	const [buscandoLibre, setBuscandoLibre] = useState(false)
	// EDGE CASE 4: caché de detalles de empleados añadidos al parte (sobrevive a cambio de toggle)
	const [empleadosAñadidosDetalle, setEmpleadosAñadidosDetalle] = useState({})

	// Helper: añadir empleado al parte y memorizar su detalle
	const añadirEmpleadoAlParte = (empleado) => {
		setFormData(prev => ({
			...prev,
			empleados: [...prev.empleados, empleado.id],
			empleadosHoras: { ...prev.empleadosHoras, [empleado.id]: 8 }
		}))
		setEmpleadosAñadidosDetalle(prev => ({ ...prev, [empleado.id]: empleado }))
	}

	// Helper: quitar empleado del parte
	const quitarEmpleadoDelParte = (empleadoId) => {
		setFormData(prev => {
			const newHoras = { ...prev.empleadosHoras }
			delete newHoras[empleadoId]
			return {
				...prev,
				empleados: prev.empleados.filter(id => id !== empleadoId),
				empleadosHoras: newHoras
			}
		})
		setEmpleadosAñadidosDetalle(prev => {
			const next = { ...prev }
			delete next[empleadoId]
			return next
		})
	}

	// Filtrar empleados por nombre de búsqueda (modo filtrado por obra)
	const empleadosFiltrados = empleadosObra.filter(empleado =>
		empleado.nombre.toLowerCase().includes(busquedaEmpleado.toLowerCase())
	)

	// Empleados disponibles a mostrar en el selector (excluye ya añadidos)
	const candidatosVisibles = (busquedaLibreEmpleados ? resultadosBusquedaLibre : empleadosFiltrados)
		.filter(e => !formData.empleados.includes(e.id))

	// F2+F5: búsqueda incremental con debounce.
	// - Si el texto es 4-5 dígitos: intenta primero ID Copuno; si 404, cae a búsqueda por nombre.
	// - Si el texto no es numérico: búsqueda directa por nombre.
	useEffect(() => {
		if (!busquedaLibreEmpleados || busquedaEmpleado.length < 3) {
			setResultadosBusquedaLibre([])
			return
		}
		setBuscandoLibre(true)
		const t = setTimeout(async () => {
			try {
				const texto = busquedaEmpleado.trim()
				const esIdCopuno = /^\d{3,6}$/.test(texto)
				let resultados = []
				if (esIdCopuno) {
					resultados = await buscarEmpleadoPorId(texto)
					if (!resultados || resultados.length === 0) {
						// Fallback a nombre: el ID podría ser parte de un nombre (raro) o no existir
						resultados = await buscarEmpleados(texto, 20)
					}
				} else {
					resultados = await buscarEmpleados(texto, 20)
				}
				setResultadosBusquedaLibre(resultados || [])
			} catch (e) {
				setResultadosBusquedaLibre([])
			} finally {
				setBuscandoLibre(false)
			}
		}, 300)
		return () => clearTimeout(t)
	}, [busquedaEmpleado, busquedaLibreEmpleados])

	// Helpers tolerantes para horas: limitar 0-24 y redondear a 0.5
	const clampRoundHoras = (val) => {
		let n = parseFloat(val)
		if (!isFinite(n)) n = 0
		if (n < 0) n = 0
		if (n > 24) n = 24
		return Math.round(n * 2) / 2
	}

	// Helpers de estado (locales a creación)
	const mapNotionColorToHex = (color) => {
		switch ((color || '').toLowerCase()) {
			case 'gray': return '#6b7280'
			case 'brown': return '#92400e'
			case 'orange': return '#f97316'
			case 'yellow': return '#eab308'
			case 'green': return '#16a34a'
			case 'blue': return '#2563eb'
			case 'purple': return '#7c3aed'
			case 'pink': return '#db2777'
			case 'red': return '#dc2626'
			default: return '#64748b'
		}
	}

	const getEstadoOptionByName = (name) => {
		return (estadoOptions?.options || []).find(opt => opt.name === name)
	}

	const normalizeEstadoForApi = (valor) => {
		const type = estadoOptions?.type
		if (type === 'checkbox') {
			if (typeof valor === 'boolean') return valor
			const v = String(valor).toLowerCase()
			return v === 'on' || v === 'true' || v === 'sí' || v === 'si'
		}
		return valor
	}

	// Función para cargar empleados de una obra
	const cargarEmpleadosObra = async (obraId) => {
		if (!obraId) {
			setEmpleadosObra([])
			return
		}

		setLoadingEmpleados(true)
		try {
			const empleados = await getEmpleadosObra(obraId)
			setEmpleadosObra(empleados)
		} catch (error) {
			console.error('Error al cargar empleados de la obra:', error)
			setEmpleadosObra([])
		} finally {
			setLoadingEmpleados(false)
		}

		// F4: cargar firmantes de la obra en paralelo
		setLoadingFirmantes(true)
		try {
			const firmantes = await getFirmantesAutorizados(obraId)
			setFirmantesObra(firmantes || [])
		} catch (e) {
			console.error('Error al cargar firmantes de la obra:', e)
			setFirmantesObra([])
		} finally {
			setLoadingFirmantes(false)
		}

		const cambiarEstadoEmpleadoObra = async (empleadoId, nuevoEstado) => {
			setEstadoLocal(prev => ({ ...prev, [empleadoId]: nuevoEstado }))
			try {
				await actualizarEstadoEmpleado(empleadoId, normalizeEstadoForApi(nuevoEstado))
			} catch (e) {
				setEstadoLocal(prev => ({ ...prev, [empleadoId]: undefined }))
				setMensajeUI({ tipo: 'error', texto: e.message })
			}
		}
	}

	// Función para obtener provincias únicas
	const getProvinciasUnicas = () => {
		const provincias = datos.obras
			.map(obra => obra.provincia)
			.filter(provincia => provincia) // Filtrar valores vacíos
		return [...new Set(provincias)].sort() // Eliminar duplicados y ordenar
	}

	// Función para filtrar obras por provincia
	const getObrasFiltradas = () => {
		if (!formData.provinciaSeleccionada) {
			return datos.obras
		}
		return datos.obras.filter(obra => obra.provincia === formData.provinciaSeleccionada)
	}

	// Función para manejar el cambio de provincia
	const handleProvinciaChange = (provincia) => {
		setFormData({
			...formData,
			provinciaSeleccionada: provincia,
			obraId: '', // Resetear obra seleccionada
			personaAutorizadaId: '',
			empleados: [], // Limpiar empleados seleccionados
			empleadosHoras: {} // Limpiar horas
		})
		setEmpleadosObra([])
		setFirmantesObra([])
		setBusquedaLibreJefes(false)
		setBusquedaLibreEmpleados(false)
	}

	// Función para manejar el cambio de obra (limpia firmante + empleados + toggles; confirma si había datos)
	const handleObraChange = (obraId) => {
		const habiaDatos = formData.personaAutorizadaId || (formData.empleados && formData.empleados.length > 0)
		if (habiaDatos) {
			const confirmar = window.confirm('Cambiar de obra limpiará los empleados y el firmante seleccionados. ¿Continuar?')
			if (!confirmar) return
		}
		setFormData({
			...formData,
			obraId,
			personaAutorizadaId: '',
			empleados: [],
			empleadosHoras: {}
		})
		setBusquedaLibreJefes(false)
		setBusquedaLibreEmpleados(false)
		setBusquedaEmpleado('')
		cargarEmpleadosObra(obraId)
	}

	const handleSubmit = async (e) => {
		e.preventDefault()
		setLoading(true)
		setMessage('')
		setMensajeUI({ tipo: '', texto: '' })

		try {
			// Encontrar la obra seleccionada
			const obraSeleccionada = datos.obras.find(obra => obra.id === formData.obraId)
			const personaAutorizadaSeleccionada = datos.jefesObra.find(jefe => jefe.id === formData.personaAutorizadaId)

			if (!obraSeleccionada || !personaAutorizadaSeleccionada) {
				throw new Error('Selecciona una obra y una Persona Autorizada válidos')
			}

			if (formData.empleados.length === 0) {
				const confirmar = window.confirm('No hay empleados asignados al parte. ¿Crear el parte sin empleados?')
				if (!confirmar) {
					setLoading(false)
					return
				}
			}

			const horasTotales = Object.values(formData.empleadosHoras).reduce((sum, h) => sum + (Number(h) || 0), 0)
			if (formData.empleados.length > 0 && horasTotales === 0) {
				const confirmar = window.confirm('Todos los empleados tienen 0 horas asignadas. ¿Crear el parte igualmente?')
				if (!confirmar) {
					setLoading(false)
					return
				}
			}

			const parteExistente = (datos.partesTrabajo || []).find(p =>
				p.obraId === formData.obraId && p.fecha?.startsWith(formData.fecha)
			)
			if (parteExistente) {
				const confirmar = window.confirm(
					`Ya existe un parte para esta obra en la fecha ${formData.fecha} (estado: ${parteExistente.estado}). ¿Crear otro igualmente?`
				)
				if (!confirmar) {
					setLoading(false)
					return
				}
			}

			const parteCreado = await crearParteTrabajo({
				obra: obraSeleccionada.nombre,
				obraId: formData.obraId,
				fecha: formData.fecha,
				jefeObraId: formData.personaAutorizadaId,
				notas: formData.notas,
				vehiculos: (formData.vehiculosSel || []).map(v => v.matricula).join(', '),
				vehiculosIds: (formData.vehiculosSel || []).map(v => v.id),
				empleados: formData.empleados,
				empleadosHoras: formData.empleadosHoras
			})

			setParteCreado(parteCreado)
			setShowOpciones(true)
			setMessage(parteCreado.mensaje || 'Parte creado exitosamente')
			setMensajeUI({ tipo: 'success', texto: 'Parte creado correctamente.' })

			// Recargar datos
			if (onParteCreado) {
				onParteCreado()
			}
		} catch (error) {
			console.error('Error al crear parte:', error)
			setMessage(`Error al crear el parte: ${error.message}`)
			setMensajeUI({ tipo: 'error', texto: error.message })
		} finally {
			setLoading(false)
		}
	}

	// Función para volver al formulario
	const volverAFormulario = () => {
		setFormData({
			provinciaSeleccionada: '',
			obraId: '',
			obra: '',
			fecha: getCurrentDate(),
			personaAutorizadaId: '',
			personaAutorizada: '',
			empleados: [],
			empleadosHoras: {},
			notas: '',
			vehiculosSel: []
		})
		setEmpleadosObra([])
		setFirmantesObra([])
		setBusquedaLibreJefes(false)
		setBusquedaLibreEmpleados(false)
		setBusquedaEmpleado('')
		setResultadosBusquedaLibre([])
		setParteCreado(null)
		setShowOpciones(false)
		setMessage('')
	}

	// Función para ver detalles del parte creado
	const verDetallesParte = () => {
		// Cambiar a la sección de consulta y mostrar detalles
		// Esto requeriría pasar el parte creado a la sección de consulta
		// Por ahora, simplemente volvemos al formulario
		volverAFormulario()
	}

	return (
		<div className="crear-section">
			<div className="section-header">
				<button className="btn-back" onClick={onVolver}>
					<ArrowLeft size={20} />
					Volver al Inicio
				</button>
				<h2 className="section-title">Crear Nuevo Parte</h2>
			</div>

			<div className="card">
				<div className="card-header">
					<h2 className="card-title">Crear Nuevo Parte</h2>
					<p className="card-subtitle">Completa la información para crear un nuevo parte de trabajo</p>
				</div>

				{showOpciones ? (
					<div className="parte-creado-opciones">
						<div className="message success">
							{message}
						</div>
						<div className="opciones-container">
							<h3>¿Qué quieres hacer ahora?</h3>
							<div className="opciones-buttons">
								<button
									type="button"
									className="btn btn-primary"
									onClick={volverAFormulario}
								>
									<Plus size={20} />
									Crear Otro Parte
								</button>
								<button
									type="button"
									className="btn btn-secondary"
									onClick={verDetallesParte}
								>
									<FileText size={20} />
									Ver Detalles del Parte
								</button>
							</div>
							{parteCreado && (
								<div className="parte-info-resumen">
									<p><strong>Parte creado:</strong> {parteCreado.properties?.Nombre?.title?.[0]?.plain_text || 'Sin nombre'}</p>
									<p><strong>Empleados asignados:</strong> {parteCreado.empleadosCreados || 0}</p>
									{parteCreado.detallesCreados > 0 && (
										<p><strong>Detalles de horas creados:</strong> {parteCreado.detallesCreados}</p>
									)}
									{parteCreado.erroresDetalles > 0 && (
										<p className="error-info"><strong>Errores en detalles:</strong> {parteCreado.erroresDetalles}</p>
									)}
								</div>
							)}
						</div>
					</div>
				) : (
					<form onSubmit={handleSubmit} className="formulario-parte">
						{mensajeUI.texto && (
							<div className={`message ${mensajeUI.tipo}`}>
								{mensajeUI.texto}
							</div>
						)}
						{message && !mensajeUI.texto && (
							<div className={`message ${message.includes('Error') ? 'error' : 'success'}`}>
								{message}
							</div>
						)}

						<div className="form-group">
							<label className="form-label">Seleccionar Provincia:</label>
							<select
								className="form-select"
								value={formData.provinciaSeleccionada}
								onChange={(e) => handleProvinciaChange(e.target.value)}
								required
							>
								<option value="">Selecciona una provincia</option>
								{getProvinciasUnicas().map(provincia => (
									<option key={provincia} value={provincia}>
										{provincia}
									</option>
								))}
							</select>
						</div>

						<div className="grid grid-2">
							<div className="form-group">
								<label className="form-label">Seleccionar Obra:</label>
								<select
									className="form-select"
									value={formData.obraId}
									onChange={(e) => handleObraChange(e.target.value)}
									required
									disabled={!formData.provinciaSeleccionada}
								>
									<option value="">
										{!formData.provinciaSeleccionada
											? 'Primero selecciona una provincia'
											: 'Selecciona una obra'}
									</option>
									{getObrasFiltradas().map(obra => (
										<option key={obra.id} value={obra.id}>
											{obra.nombre}
										</option>
									))}
								</select>
							</div>

							<div className="form-group">
								<label className="form-label">Fecha del Parte:</label>
								<input
									type="date"
									className="form-input"
									value={formData.fecha}
									onChange={(e) => setFormData({ ...formData, fecha: e.target.value })}
									required
								/>
							</div>
						</div>

						<div className="form-group">
							<label className="form-label">Persona Autorizada:</label>
							<label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: '0.9em' }}>
								<input
									type="checkbox"
									checked={busquedaLibreJefes}
									onChange={(e) => setBusquedaLibreJefes(e.target.checked)}
								/>
								Buscar en toda la base
							</label>
							{loadingFirmantes ? (
								<div className="empleados-loading"><Loader2 size={16} className="loading-spinner" /> Cargando firmantes…</div>
							) : (
								<>
									{!busquedaLibreJefes && formData.obraId && firmantesObra.length === 0 && (
										<div className="empleados-empty" style={{ marginBottom: 6 }}>
											Esta obra no tiene firmantes asignados. Activa búsqueda libre para elegir uno de la base completa.
										</div>
									)}
									<select
										className="form-select"
										value={formData.personaAutorizadaId}
										onChange={(e) => setFormData({ ...formData, personaAutorizadaId: e.target.value })}
										required
									>
										<option value="">Selecciona una Persona Autorizada</option>
										{busquedaLibreJefes
											? datos.jefesObra.map(jefe => {
												const enLista = firmantesObra.some(f => f.id === jefe.id)
												return (
													<option key={jefe.id} value={jefe.id}>
														{jefe.nombre} ({jefe.email}){!enLista && formData.obraId ? ' (no asignado a esta obra)' : ''}
													</option>
												)
											})
											: Object.entries(agruparFirmantesPorRol(firmantesObra)).map(([rol, lista]) => (
												lista.length > 0 && (
													<optgroup key={rol} label={rol}>
														{lista.map(f => (
															<option key={f.id} value={f.id}>
																{f.nombre}{f.email ? ` (${f.email})` : ''}
															</option>
														))}
													</optgroup>
												)
											))
										}
									</select>
								</>
							)}
						</div>

						<div className="form-group">
							<label className="form-label">Empleados:</label>
							{!formData.obraId ? (
								<div className="empleados-placeholder">
									<p>Selecciona una obra para ver los empleados asignados</p>
								</div>
							) : loadingEmpleados ? (
								<div className="empleados-loading">
									<Loader2 size={20} className="loading-spinner" />
									<p>Cargando empleados de la obra...</p>
								</div>
							) : (
								<>
									{/* F5 toggle */}
									<label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: '0.9em' }}>
										<input
											type="checkbox"
											checked={!busquedaLibreEmpleados}
											onChange={(e) => {
												const marcado = e.target.checked
												setBusquedaLibreEmpleados(!marcado)
												setBusquedaEmpleado('')
												setResultadosBusquedaLibre([])
											}}
										/>
										Mostrar solo empleados asignados a esta obra
									</label>

									{/* EDGE CASE 3 — obra sin empleados en modo filtrado */}
									{!busquedaLibreEmpleados && empleadosObra.length === 0 && (
										<div className="empleados-empty" style={{ marginBottom: 8 }}>
											Esta obra no tiene empleados asignados. Activa búsqueda libre para añadir empleados.
										</div>
									)}

									{/* EDGE CASE 4 — Empleados ya añadidos al parte: bloque persistente */}
									{formData.empleados.length > 0 && (
										<div style={{ marginBottom: 12 }}>
											<h4 style={{ marginBottom: 6 }}>
												Empleados añadidos al parte ({formData.empleados.length}) ·{' '}
												<span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
													Horas totales: {formData.empleados.reduce((sum, empId) => sum + (Number(formData.empleadosHoras[empId]) || 0), 0)}
												</span>
											</h4>
											<div className="empleados-lista empleados-lista-compacta">
												{formData.empleados.map(empId => {
													const emp = empleadosAñadidosDetalle[empId]
														|| empleadosObra.find(e => e.id === empId)
														|| resultadosBusquedaLibre.find(e => e.id === empId)
														|| { id: empId, nombre: '(empleado)', categoria: '', idCopuno: null }
													return (
														<div key={empId} className="empleado-item">
															<span className="empleado-info">
																<div className="empleado-nombre-estado">
																	<strong>
																		{emp.idCopuno != null ? `${emp.idCopuno} · ` : '— · '}
																		{emp.nombre}
																	</strong>
																	<span className="categoria">{emp.categoria || '—'}</span>
																</div>
															</span>
															<div className="empleado-horas-input">
																<label className="horas-label">Horas:</label>
																<button
																	type="button"
																	className="horas-btn horas-btn-minus"
																	onClick={() => {
																		const cur = formData.empleadosHoras[empId] || 0
																		setFormData({ ...formData, empleadosHoras: { ...formData.empleadosHoras, [empId]: Math.max(0, cur - 1) } })
																	}}
																>−</button>
																<input
																	type="number"
																	className="horas-input"
																	min="0" max="24" step="0.5"
																	inputMode="decimal"
																	value={formData.empleadosHoras[empId] ?? ''}
																	onFocus={(e) => e.target.select()}
																	onChange={(e) => setFormData({ ...formData, empleadosHoras: { ...formData.empleadosHoras, [empId]: e.target.value } })}
																	onBlur={(e) => setFormData({ ...formData, empleadosHoras: { ...formData.empleadosHoras, [empId]: clampRoundHoras(e.target.value) } })}
																/>
																<button
																	type="button"
																	className="horas-btn horas-btn-plus"
																	onClick={() => {
																		const cur = formData.empleadosHoras[empId] || 0
																		setFormData({ ...formData, empleadosHoras: { ...formData.empleadosHoras, [empId]: Math.min(24, cur + 1) } })
																	}}
																>+</button>
																<span className="horas-unidad">h</span>
															</div>
															<button
																type="button"
																className="btn btn-secondary"
																style={{ marginLeft: 8 }}
																onClick={() => quitarEmpleadoDelParte(empId)}
															>
																<X size={14} /> Quitar
															</button>
														</div>
													)
												})}
											</div>
										</div>
									)}

									{/* Selector / buscador */}
									<div className="empleados-search">
										<Search size={18} />
										<input
											type="text"
											placeholder={busquedaLibreEmpleados ? "Buscar por ID Copuno (4-5 dígitos) o nombre (3+ letras)..." : "Buscar empleado por nombre..."}
											value={busquedaEmpleado}
											onChange={(e) => setBusquedaEmpleado(e.target.value)}
											onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
											enterKeyHint="search"
											className="empleados-search-input"
										/>
										{busquedaEmpleado && (
											<button type="button" onClick={() => setBusquedaEmpleado('')} className="search-clear">
												<X size={16} />
											</button>
										)}
									</div>

									{busquedaLibreEmpleados && busquedaEmpleado.length > 0 && busquedaEmpleado.length < 3 && (
										<div className="empleados-empty"><p>Escribe al menos 3 letras para buscar.</p></div>
									)}
									{busquedaLibreEmpleados && buscandoLibre && (
										<div className="empleados-loading"><Loader2 size={16} className="loading-spinner" /> Buscando…</div>
									)}
									{/* F2: aviso de IDs duplicados en Notion */}
									{busquedaLibreEmpleados && !buscandoLibre && /^\d{3,6}$/.test(busquedaEmpleado.trim()) && resultadosBusquedaLibre.length > 1 && (
										<div className="empleados-empty" style={{ marginBottom: 6, color: '#92400e' }}>
											⚠️ Hay {resultadosBusquedaLibre.length} empleados con ID Copuno {busquedaEmpleado.trim()}. Elige el correcto.
										</div>
									)}

									{candidatosVisibles.length === 0 ? (
										(busquedaLibreEmpleados ? (busquedaEmpleado.length >= 3 && !buscandoLibre) : true) && (
											<div className="empleados-empty">
												<p>{busquedaEmpleado ? `No se encontraron empleados con "${busquedaEmpleado}"` : 'No hay candidatos disponibles para añadir.'}</p>
											</div>
										)
									) : (
										<div className="empleados-lista empleados-lista-compacta">
											{candidatosVisibles.map(empleado => (
												<div key={empleado.id} className="empleado-item">
													<span className="empleado-info">
														<div className="empleado-nombre-estado">
															<strong>
																{empleado.idCopuno != null ? `${empleado.idCopuno} · ` : '— · '}
																{empleado.nombre}
															</strong>
															<span className="categoria">{empleado.categoria || '—'}</span>
															{empleado.estado && (
																<span className={`estado-empleado ${empleado.estado?.toLowerCase() || 'sin-estado'}`}>
																	{empleado.estado}
																</span>
															)}
														</div>
													</span>
													<button
														type="button"
														className="btn btn-success"
														onClick={() => añadirEmpleadoAlParte(empleado)}
													>
														<Plus size={14} /> Añadir
													</button>
												</div>
											))}
										</div>
									)}
								</>
							)}
						</div>

						<CampoVehiculos
							value={formData.vehiculosSel}
							onChange={(v) => setFormData({ ...formData, vehiculosSel: v })}
						/>

						<div className="form-group">
							<label className="form-label">Notas Adicionales:</label>
							<textarea
								className="form-input"
								rows="4"
								value={formData.notas}
								onChange={(e) => setFormData({ ...formData, notas: e.target.value })}
								placeholder="Añade cualquier nota o comentario sobre el trabajo realizado..."
							/>
						</div>

						<div className="form-actions">
							<button type="submit" className="btn btn-success" disabled={loading}>
								{loading ? (
									<>
										<Loader2 size={24} className="loading-spinner" />
										Creando...
									</>
								) : (
									<>
										<Plus size={24} />
										Crear Parte
									</>
								)}
							</button>
							<button type="button" className="btn btn-secondary" disabled={loading} onClick={onVolver}>
								Cancelar
							</button>
						</div>
					</form>
				)}
			</div>
		</div>
	)
}

function Footer() {
	const [showDate, setShowDate] = useState(false)
	const version = __APP_VERSION__
	const deployDate = new Date(__BUILD_TIMESTAMP__) // Fecha automática del último build

	return (
		<footer className="app-footer">
			<div className="footer-content">
				<p>Desarrollada por NotionVan</p>
				<div className="version-info">
					<p onClick={() => setShowDate(!showDate)} style={{ cursor: 'pointer' }}>
						Versión {version}
					</p>
					{showDate && (
						<p className="release-date">
							Desplegado: {deployDate.toLocaleDateString('es-ES', {
								year: 'numeric',
								month: 'long',
								day: 'numeric',
								hour: '2-digit',
								minute: '2-digit'
							})}
						</p>
					)}
				</div>
			</div>
		</footer>
	)
}

export default App
