import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LogOut, KeyRound, UserCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import './auth.css'

// Menú de cuenta en la cabecera (ADR-006): cambiar contraseña y cerrar sesión.
// Cerrar sesión importa especialmente en obra, donde se comparten dispositivos.
// Sin Supabase configurado (dev/mock) no se renderiza nada.
export default function MenuCuenta() {
	const [usuario, setUsuario] = useState(null)
	const [abierto, setAbierto] = useState(false)
	const [cambiando, setCambiando] = useState(false)
	const contenedor = useRef(null)

	useEffect(() => {
		if (!supabase) return
		supabase.auth.getUser().then(({ data }) => setUsuario(data?.user || null))
	}, [])

	useEffect(() => {
		if (!abierto) return
		const fuera = (e) => {
			if (contenedor.current && !contenedor.current.contains(e.target)) setAbierto(false)
		}
		const escape = (e) => { if (e.key === 'Escape') setAbierto(false) }
		document.addEventListener('mousedown', fuera)
		document.addEventListener('keydown', escape)
		return () => {
			document.removeEventListener('mousedown', fuera)
			document.removeEventListener('keydown', escape)
		}
	}, [abierto])

	if (!supabase || !usuario) return null

	return (
		<div className="cuenta" ref={contenedor}>
			<button
				type="button"
				className="cuenta-boton"
				onClick={() => setAbierto(!abierto)}
				aria-expanded={abierto}
				aria-haspopup="menu"
				title={usuario.email}
			>
				<UserCircle size={20} aria-hidden="true" />
				<span className="cuenta-email">{usuario.email}</span>
			</button>

			{abierto && (
				<div className="cuenta-menu" role="menu">
					<button
						type="button" className="cuenta-item" role="menuitem"
						onClick={() => { setCambiando(true); setAbierto(false) }}
					>
						<KeyRound size={16} aria-hidden="true" /> Cambiar contraseña
					</button>
					<button
						type="button" className="cuenta-item" role="menuitem"
						onClick={() => supabase.auth.signOut().then(() => window.location.reload())}
					>
						<LogOut size={16} aria-hidden="true" /> Cerrar sesión
					</button>
				</div>
			)}

			{/* Por portal: la cabecera tiene backdrop-filter, que la convierte en
			    bloque contenedor de position:fixed — sin portal, el modal se
			    centraría dentro de la franja de la cabecera, no del viewport. */}
			{cambiando && createPortal(
				<ModalCambiarPassword alCerrar={() => setCambiando(false)} />,
				document.body
			)}
		</div>
	)
}

function ModalCambiarPassword({ alCerrar }) {
	const [password, setPassword] = useState('')
	const [password2, setPassword2] = useState('')
	const [error, setError] = useState(null)
	const [hecho, setHecho] = useState(false)
	const [guardando, setGuardando] = useState(false)

	const guardar = async (e) => {
		e.preventDefault()
		setError(null)
		if (password !== password2) { setError('Las contraseñas no coinciden.'); return }
		setGuardando(true)
		const { error: err } = await supabase.auth.updateUser({ password })
		setGuardando(false)
		if (err) setError('No se pudo guardar. Revisa que cumpla los requisitos.')
		else setHecho(true)
	}

	return (
		<div className="cuenta-overlay" role="dialog" aria-modal="true" aria-label="Cambiar contraseña">
			<div className="auth-card cuenta-dialogo">
				<h2 className="auth-heading">Cambiar contraseña</h2>
				{hecho ? (
					<>
						<div className="auth-message is-info" role="status">
							<span aria-hidden="true">✓</span>
							<span>Contraseña actualizada. Úsala la próxima vez que entres.</span>
						</div>
						<button type="button" className="auth-submit" onClick={alCerrar}>Cerrar</button>
					</>
				) : (
					<>
						{error && (
							<div className="auth-message is-error" role="alert">
								<span aria-hidden="true">⚠</span><span>{error}</span>
							</div>
						)}
						<form onSubmit={guardar}>
							<div className="auth-field">
								<label className="auth-label" htmlFor="cuenta-pass">Nueva contraseña</label>
								<input
									id="cuenta-pass" type="password" required autoComplete="new-password"
									className="auth-input" minLength={10} value={password}
									aria-describedby="cuenta-requisitos"
									onChange={(e) => setPassword(e.target.value)}
								/>
							</div>
							<div className="auth-field">
								<label className="auth-label" htmlFor="cuenta-pass-2">Repítela</label>
								<input
									id="cuenta-pass-2" type="password" required autoComplete="new-password"
									className="auth-input" minLength={10} value={password2}
									onChange={(e) => setPassword2(e.target.value)}
								/>
							</div>
							<button type="submit" className="auth-submit" disabled={guardando}>
								{guardando ? 'Guardando…' : 'Guardar'}
							</button>
						</form>
						<p className="auth-hint" id="cuenta-requisitos">
							Mínimo 10 caracteres, con letras y números.
						</p>
						<button type="button" className="auth-link" onClick={alCerrar}>Cancelar</button>
					</>
				)}
			</div>
		</div>
	)
}
