import { createClient } from '@supabase/supabase-js'

// Cliente Supabase del frontend (ADR-006). La clave publishable es pública por
// diseño — la seguridad real está en el middleware JWT del servidor y en RLS.
// Sin las variables de entorno (desarrollo/mock), el cliente es null y la app
// funciona sin login (mismo patrón que la simulación del webhook Make).
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const supabase = url && key ? createClient(url, key) : null

if (!supabase && import.meta.env.DEV) {
	console.warn('⚠️ Supabase sin configurar (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY) — app sin login')
}
