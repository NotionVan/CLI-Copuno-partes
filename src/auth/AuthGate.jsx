import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Puerta de autenticación de la plataforma (ADR-006).
// - Sin sesión → formulario email + contraseña (único método expuesto).
// - Evento PASSWORD_RECOVERY (enlace de reset por email) → pantalla de nueva contraseña.
// - Sin Supabase configurado (dev/mock) → deja pasar sin login.

const estilos = {
	fondo: {
		minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
		background: '#f5f6f8', padding: '1rem'
	},
	tarjeta: {
		background: '#fff', borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,.08)',
		padding: '2rem', width: '100%', maxWidth: 380
	},
	titulo: { margin: '0 0 .25rem', fontSize: '1.25rem' },
	subtitulo: { margin: '0 0 1.25rem', color: '#666', fontSize: '.9rem' },
	label: { display: 'block', fontSize: '.85rem', marginBottom: 4, color: '#333' },
	input: {
		width: '100%', padding: '.6rem .75rem', marginBottom: '1rem', borderRadius: 8,
		border: '1px solid #ccc', fontSize: '1rem', boxSizing: 'border-box'
	},
	boton: {
		width: '100%', padding: '.65rem', borderRadius: 8, border: 'none',
		background: '#1a56db', color: '#fff', fontSize: '1rem', cursor: 'pointer'
	},
	enlace: {
		background: 'none', border: 'none', color: '#1a56db', cursor: 'pointer',
		fontSize: '.85rem', padding: 0, marginTop: '1rem'
	},
	error: { color: '#b91c1c', fontSize: '.85rem', marginBottom: '1rem' },
	aviso: { color: '#15803d', fontSize: '.85rem', marginBottom: '1rem' }
}

function PantallaLogin() {
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [error, setError] = useState(null)
	const [aviso, setAviso] = useState(null)
	const [cargando, setCargando] = useState(false)
	const [modoReset, setModoReset] = useState(false)

	const entrar = async (e) => {
		e.preventDefault()
		setError(null); setAviso(null); setCargando(true)
		const { error: err } = await supabase.auth.signInWithPassword({ email, password })
		setCargando(false)
		if (err) setError('Email o contraseña incorrectos.')
	}

	const enviarReset = async (e) => {
		e.preventDefault()
		setError(null); setAviso(null); setCargando(true)
		const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
			redirectTo: window.location.origin
		})
		setCargando(false)
		if (err) setError('No se pudo enviar el email. Inténtalo en unos minutos.')
		else setAviso('Si el email existe, recibirás un enlace para restablecer la contraseña.')
	}

	return (
		<div style={estilos.fondo}>
			<div style={estilos.tarjeta}>
				<h1 style={estilos.titulo}>Copuno — Gestión de partes</h1>
				<p style={estilos.subtitulo}>
					{modoReset ? 'Restablecer contraseña' : 'Accede con tu cuenta'}
				</p>
				{error && <div style={estilos.error}>{error}</div>}
				{aviso && <div style={estilos.aviso}>{aviso}</div>}
				<form onSubmit={modoReset ? enviarReset : entrar}>
					<label style={estilos.label} htmlFor="auth-email">Email</label>
					<input
						id="auth-email" type="email" required autoComplete="username"
						style={estilos.input} value={email}
						onChange={(e) => setEmail(e.target.value)}
					/>
					{!modoReset && (
						<>
							<label style={estilos.label} htmlFor="auth-password">Contraseña</label>
							<input
								id="auth-password" type="password" required autoComplete="current-password"
								style={estilos.input} value={password}
								onChange={(e) => setPassword(e.target.value)}
							/>
						</>
					)}
					<button type="submit" style={estilos.boton} disabled={cargando}>
						{cargando ? 'Un momento…' : modoReset ? 'Enviar enlace' : 'Entrar'}
					</button>
				</form>
				<button
					type="button" style={estilos.enlace}
					onClick={() => { setModoReset(!modoReset); setError(null); setAviso(null) }}
				>
					{modoReset ? '← Volver al acceso' : '¿Has olvidado tu contraseña?'}
				</button>
			</div>
		</div>
	)
}

function PantallaNuevaPassword({ alTerminar }) {
	const [password, setPassword] = useState('')
	const [password2, setPassword2] = useState('')
	const [error, setError] = useState(null)
	const [cargando, setCargando] = useState(false)

	const guardar = async (e) => {
		e.preventDefault()
		setError(null)
		if (password !== password2) { setError('Las contraseñas no coinciden.'); return }
		setCargando(true)
		const { error: err } = await supabase.auth.updateUser({ password })
		setCargando(false)
		if (err) setError('No se pudo guardar. Mínimo 10 caracteres con letras y números.')
		else alTerminar()
	}

	return (
		<div style={estilos.fondo}>
			<div style={estilos.tarjeta}>
				<h1 style={estilos.titulo}>Nueva contraseña</h1>
				<p style={estilos.subtitulo}>Mínimo 10 caracteres, con letras y números.</p>
				{error && <div style={estilos.error}>{error}</div>}
				<form onSubmit={guardar}>
					<label style={estilos.label} htmlFor="new-password">Nueva contraseña</label>
					<input
						id="new-password" type="password" required autoComplete="new-password"
						style={estilos.input} value={password}
						onChange={(e) => setPassword(e.target.value)}
					/>
					<label style={estilos.label} htmlFor="new-password-2">Repítela</label>
					<input
						id="new-password-2" type="password" required autoComplete="new-password"
						style={estilos.input} value={password2}
						onChange={(e) => setPassword2(e.target.value)}
					/>
					<button type="submit" style={estilos.boton} disabled={cargando}>
						{cargando ? 'Guardando…' : 'Guardar y entrar'}
					</button>
				</form>
			</div>
		</div>
	)
}

export default function AuthGate({ children }) {
	const [sesion, setSesion] = useState(null)
	const [listo, setListo] = useState(false)
	const [recuperando, setRecuperando] = useState(false)

	useEffect(() => {
		if (!supabase) { setListo(true); return }
		supabase.auth.getSession().then(({ data }) => {
			setSesion(data.session)
			setListo(true)
		})
		const { data: sub } = supabase.auth.onAuthStateChange((evento, nuevaSesion) => {
			if (evento === 'PASSWORD_RECOVERY') setRecuperando(true)
			setSesion(nuevaSesion)
		})
		return () => sub.subscription.unsubscribe()
	}, [])

	if (!supabase) return children
	if (!listo) return null
	if (recuperando && sesion) return <PantallaNuevaPassword alTerminar={() => setRecuperando(false)} />
	if (!sesion) return <PantallaLogin />
	return children
}
