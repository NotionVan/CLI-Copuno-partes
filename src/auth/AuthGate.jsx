import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import './auth.css'

// Puerta de autenticación de la plataforma (ADR-006).
// - Sin sesión → formulario email + contraseña (único método expuesto).
// - Enlace de invitación o de reset → pantalla de fijar contraseña.
// - Sin Supabase configurado (dev/mock) → deja pasar sin login.

// La URL se lee al cargar el módulo: supabase-js consume y limpia el hash de
// forma asíncrona, así que después ya no estaría disponible. Un enlace de
// invitación (type=invite) deja sesión iniciada SIN contraseña fijada — si no
// lo detectáramos, el usuario entraría una vez y no podría volver a entrar.
const URL_INICIAL = typeof window !== 'undefined'
	? window.location.hash + window.location.search
	: ''
const LLEGA_DE_ENLACE_EMAIL = /type=(invite|recovery|signup)/.test(URL_INICIAL)

// Un enlace caducado o ya usado vuelve con error en la URL. Sin esto la app
// mostraba el login sin explicar nada y el usuario no sabía qué había fallado.
function errorDelEnlace() {
	const p = new URLSearchParams(URL_INICIAL.replace(/^[#?]/, '').replace('#', '&'))
	const codigo = p.get('error_code') || p.get('error')
	if (!codigo) return null
	if (/expired|invalid/i.test(codigo)) {
		return 'El enlace ha caducado o ya se había usado. Pide uno nuevo desde "¿Has olvidado tu contraseña?".'
	}
	return p.get('error_description') || 'No se pudo validar el enlace. Solicita uno nuevo.'
}

// Lockup de marca: imagotipo oficial (public/logo-copuno.png, recortado de
// copuno.com y con fondo transparente) + nombre del módulo. El logo ya
// contiene el nombre de la empresa, así que no se repite en texto.
function Marca() {
	return (
		<div className="auth-brand">
			<img
				className="auth-brand-logo"
				src="/logo-copuno.png"
				alt="Grupo Copuno"
				width={220}
				height={55}
			/>
			<p className="auth-brand-app">Gestión de Partes</p>
		</div>
	)
}

function Mensaje({ tipo, children }) {
	if (!children) return null
	return (
		<div className={`auth-message is-${tipo}`} role={tipo === 'error' ? 'alert' : 'status'}>
			<span aria-hidden="true">{tipo === 'error' ? '⚠' : '✓'}</span>
			<span>{children}</span>
		</div>
	)
}

function PantallaLogin({ errorInicial }) {
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [error, setError] = useState(errorInicial || null)
	const [aviso, setAviso] = useState(null)
	const [cargando, setCargando] = useState(false)
	const [modoReset, setModoReset] = useState(false)

	const entrar = async (e) => {
		e.preventDefault()
		setError(null); setAviso(null); setCargando(true)
		const { error: err } = await supabase.auth.signInWithPassword({ email, password })
		setCargando(false)
		if (err) {
			// UX-47: «email o contraseña incorrectos» sin cobertura hacía que la
			// gente restableciera su contraseña sin necesidad.
			if (err.status === 429) setError('Has probado demasiadas veces. Espera un minuto y vuelve a intentarlo.')
			else if (!navigator.onLine || /fetch|network/i.test(err.message || '')) setError('No hay conexión ahora mismo. Comprueba la cobertura e inténtalo de nuevo.')
			else setError('Email o contraseña incorrectos.')
		}
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
		<main className="auth-screen">
			<div className="auth-card">
				<Marca />
				<h2 className="auth-heading">
					{modoReset ? 'Restablecer contraseña' : 'Accede con tu cuenta'}
				</h2>
				<Mensaje tipo="error">{error}</Mensaje>
				<Mensaje tipo="info">{aviso}</Mensaje>
				<form onSubmit={modoReset ? enviarReset : entrar}>
					<div className="auth-field">
						<label className="auth-label" htmlFor="auth-email">Email</label>
						<input
							id="auth-email" type="email" required autoComplete="username"
							className="auth-input" value={email}
							onChange={(e) => setEmail(e.target.value)}
						/>
					</div>
					{!modoReset && (
						<div className="auth-field">
							<label className="auth-label" htmlFor="auth-password">Contraseña</label>
							<input
								id="auth-password" type="password" required autoComplete="current-password"
								className="auth-input" value={password}
								onChange={(e) => setPassword(e.target.value)}
							/>
						</div>
					)}
					<button type="submit" className="auth-submit" disabled={cargando}>
						{cargando ? 'Un momento…' : modoReset ? 'Enviar enlace' : 'Entrar'}
					</button>
				</form>
				<button
					type="button" className="auth-link"
					onClick={() => { setModoReset(!modoReset); setError(null); setAviso(null) }}
				>
					{modoReset ? '← Volver al acceso' : '¿Has olvidado tu contraseña?'}
				</button>
			</div>
		</main>
	)
}

function PantallaNuevaPassword({ alTerminar, esInvitacion }) {
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
		if (err) setError('No se pudo guardar. Revisa que cumpla los requisitos.')
		else alTerminar()
	}

	return (
		<main className="auth-screen">
			<div className="auth-card">
				<Marca />
				<h2 className="auth-heading">
					{esInvitacion ? 'Crea tu contraseña para acceder' : 'Elige una contraseña nueva'}
				</h2>
				<Mensaje tipo="error">{error}</Mensaje>
				<form onSubmit={guardar}>
					<div className="auth-field">
						<label className="auth-label" htmlFor="new-password">Contraseña</label>
						<input
							id="new-password" type="password" required autoComplete="new-password"
							className="auth-input" value={password} minLength={10}
							aria-describedby="password-requisitos"
							onChange={(e) => setPassword(e.target.value)}
						/>
					</div>
					<div className="auth-field">
						<label className="auth-label" htmlFor="new-password-2">Repítela</label>
						<input
							id="new-password-2" type="password" required autoComplete="new-password"
							className="auth-input" value={password2} minLength={10}
							onChange={(e) => setPassword2(e.target.value)}
						/>
					</div>
					<button type="submit" className="auth-submit" disabled={cargando}>
						{cargando ? 'Guardando…' : 'Guardar y entrar'}
					</button>
				</form>
				<p className="auth-hint" id="password-requisitos">
					Mínimo 10 caracteres, con letras y números.
				</p>
			</div>
		</main>
	)
}

export default function AuthGate({ children }) {
	const [sesion, setSesion] = useState(null)
	const [listo, setListo] = useState(false)
	// Fijar contraseña: por enlace de email (invitación o reset) o por evento del SDK
	const [fijandoPassword, setFijandoPassword] = useState(LLEGA_DE_ENLACE_EMAIL)

	useEffect(() => {
		if (!supabase) { setListo(true); return }
		supabase.auth.getSession().then(({ data }) => {
			setSesion(data.session)
			setListo(true)
		}).catch(() => {
			// Sin el catch, un fallo de red aquí dejaba la pantalla en blanco para
			// siempre (UX-51/I-D). Con sesión null se muestra el login, que sí
			// explica qué hacer.
			setSesion(null)
			setListo(true)
		})
		const { data: sub } = supabase.auth.onAuthStateChange((evento, nuevaSesion) => {
			if (evento === 'PASSWORD_RECOVERY') setFijandoPassword(true)
			setSesion(nuevaSesion)
		})
		return () => sub.subscription.unsubscribe()
	}, [])

	if (!supabase) return children
	if (!listo) {
		// Mismo shell (logo + spinner) que index.html pinta antes de montar React:
		// sin esto, el montaje borraba el shell y volvía el blanco hasta que
		// getSession() resolvía (UX-51).
		return (
			<div className="shell-arranque" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
				<img src="/logo-copuno.png" alt="Grupo Copuno" style={{ width: 220, maxWidth: '60vw', height: 'auto' }} />
				<div style={{ width: 28, height: 28, border: '3px solid #ccd2ff', borderTopColor: '#01146d', borderRadius: '50%', animation: 'shell-girar 0.9s linear infinite' }} />
			</div>
		)
	}
	if (fijandoPassword && sesion) {
		return (
			<PantallaNuevaPassword
				esInvitacion={/type=invite/.test(URL_INICIAL)}
				alTerminar={() => setFijandoPassword(false)}
			/>
		)
	}
	if (!sesion) return <PantallaLogin errorInicial={errorDelEnlace()} />
	return children
}
