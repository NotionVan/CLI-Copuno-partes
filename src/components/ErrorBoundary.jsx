import React from 'react'

// Red de seguridad global (P4, auditoría 2026-08): sin esto, cualquier excepción
// de render desmonta el árbol y deja la pantalla en blanco absoluto — el
// "pantallazo" que se vio en la demo ante la central. No captura errores de
// promesas ni de handlers (eso lo gestionan los catch de la app), solo el render.
export class ErrorBoundary extends React.Component {
	constructor(props) {
		super(props)
		this.state = { error: null }
	}

	static getDerivedStateFromError(error) {
		return { error }
	}

	componentDidCatch(error, info) {
		console.error('[ErrorBoundary]', this.props.seccion || 'global', error, info?.componentStack)
	}

	render() {
		if (!this.state.error) return this.props.children
		return (
			<div role="alert" style={{
				maxWidth: 560, margin: '15vh auto 0', padding: '32px 28px', textAlign: 'center',
				background: '#fff', border: '1px solid #cfd5ff', borderRadius: 12,
				fontFamily: 'inherit', color: '#050716'
			}}>
				<p style={{ fontSize: '1.15rem', fontWeight: 700, margin: '0 0 8px' }}>
					Algo ha fallado en {this.props.seccion || 'la aplicación'}
				</p>
				<p style={{ margin: '0 0 20px', color: '#3b4263' }}>
					No se ha perdido nada en el sistema. Vuelve a intentarlo; si se repite, avisa a oficina.
				</p>
				<button
					type="button"
					onClick={() => {
						if (this.props.onReintentar) {
							this.setState({ error: null })
							this.props.onReintentar()
						} else {
							window.location.reload()
						}
					}}
					style={{
						minHeight: 44, padding: '0 22px', fontSize: '1rem', fontWeight: 600,
						color: '#fff', background: '#01146d', border: 'none', borderRadius: 8, cursor: 'pointer'
					}}
				>
					Reintentar
				</button>
			</div>
		)
	}
}

export default ErrorBoundary
