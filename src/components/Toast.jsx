import { useEffect } from 'react'
import { CheckCircle2, AlertTriangle, XCircle, X } from 'lucide-react'

// Aviso flotante único (F4/UX-16): siempre a la vista (abajo-centro, por encima
// de todo), independiente de dónde esté el botón que disparó la acción. Los de
// éxito/aviso se autocierran; los errores persisten hasta que el usuario los
// cierra. role="status"/"alert" anuncia el mensaje a lectores de pantalla
// (resuelve también UX-15 —mensajes eternos— y UX-34 —aria-live—).
const AUTOCIERRE_MS = 6000

export default function Toast({ tipo, texto, onCerrar }) {
	const esError = tipo === 'error'

	useEffect(() => {
		if (!texto || esError) return
		const t = setTimeout(onCerrar, AUTOCIERRE_MS)
		return () => clearTimeout(t)
	}, [texto, esError, onCerrar])

	if (!texto) return null

	const Icono = esError ? XCircle : tipo === 'warning' ? AlertTriangle : CheckCircle2
	return (
		<div className={`toast toast--${tipo || 'success'}`} role={esError ? 'alert' : 'status'}>
			<Icono size={22} aria-hidden="true" className="toast-icono" />
			<span className="toast-texto">{texto}</span>
			<button type="button" className="toast-cerrar" onClick={onCerrar} aria-label="Cerrar aviso">
				<X size={18} />
			</button>
		</div>
	)
}
