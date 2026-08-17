#!/usr/bin/env node
/**
 * scripts/generar-capturas.mjs — regenera las capturas de los manuales.
 *
 * Sustituye el proceso ad-hoc del 31-07 (que nunca se versionó). Captura las
 * 10 pantallas del manual a 1600×1000 JPEG y las embebe en base64 dentro de
 * docs/manual/index.html, localizando cada <figure> por su atributo alt.
 * Después hay que ejecutar docs/manual-cliente/generar.py para derivar
 * public/manual.html y la versión pegable.
 *
 * DOS BUILDS (gotcha verificado el 17-08):
 *  - 01-login exige un build CON VITE_SUPABASE_* — sin esas variables,
 *    supabase=null y AuthGate deja pasar: el login es inalcanzable.
 *  - El resto exige un build SIN ellas (app sin auth contra el server mock).
 * El script orquesta ambos y deja al final un build normal en dist/.
 *
 * Uso:  node scripts/generar-capturas.mjs
 * Requiere: Chrome instalado, puppeteer-core disponible (se busca en el
 * scratchpad de Claude o vía npx), puerto 3010 libre.
 */

import { execSync, spawn } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const RAIZ = new URL('..', import.meta.url).pathname
const MANUAL = RAIZ + 'docs/manual/index.html'
const PUERTO = 3010
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEWPORT = { width: 1600, height: 1000 }
const JPEG_QUALITY = 82

// alt (tal como está en el manual) → función que deja la pantalla lista
const CAPTURAS = [
	{ alt: 'Pantalla de inicio de sesión', build: 'con-auth', prepara: async () => { } },
	{ alt: 'Pantalla de inicio', build: 'mock', prepara: async () => { } },
	{
		alt: 'Formulario de creación de parte', build: 'mock',
		prepara: async (page) => {
			await click(page, '.action-card', 'Crear')
			await espera(800)
		}
	},
	{
		alt: 'Selección de empleados y horas', build: 'mock',
		prepara: async (page) => {
			// Flujo verificado el 17-08: al seleccionar una obra CON empleados
			// asignados (mock: obra-1 «Reforma Sede Central»), la lista aparece
			// sola con un botón «+ Añadir» por empleado; añadir dos deja los
			// steppers de horas (8 h) y el total visibles.
			await click(page, '.action-card', 'Crear')
			await espera(700)
			const elegirOpcion = async (texto) => {
				await page.evaluate((texto) => {
					for (const sel of document.querySelectorAll('select')) {
						const opt = [...sel.options].find(o => o.textContent.includes(texto))
						if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return }
					}
				}, texto)
				await espera(900)
			}
			await elegirOpcion('Madrid')
			await elegirOpcion('Reforma Sede Central')
			await espera(1200)
			for (let i = 0; i < 2; i++) {
				await page.evaluate(() => {
					const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Añadir') && x.offsetParent !== null)
					b?.click()
				})
				await espera(600)
			}
			await page.evaluate(() => {
				const t = [...document.querySelectorAll('.form-label')].find(x => x.textContent.trim() === 'Empleados:')
				t?.scrollIntoView({ block: 'start' })
				window.scrollBy(0, -70)
			})
			await espera(400)
		}
	},
	{
		alt: 'Listado de partes con filtros', build: 'mock',
		prepara: async (page) => {
			await click(page, '.action-card', 'Consultar')
			await espera(1200)
		}
	},
	{
		alt: 'Modal de detalles de un parte', build: 'mock',
		prepara: async (page) => {
			await click(page, '.action-card', 'Consultar')
			await espera(1200)
			// abrir detalles de un parte Firmado (franja amarilla de no editable)
			await page.evaluate(() => {
				const card = [...document.querySelectorAll('.parte-card')].find(c => c.textContent.includes('Firmado'))
				const btn = [...(card || document).querySelectorAll('button')].find(b => b.textContent.includes('Ver Detalles') || b.textContent.includes('Detalles'))
				btn?.click()
			})
			await espera(1500)
		}
	},
	{
		alt: 'Diálogo de exportación a CSV', build: 'mock',
		prepara: async (page) => {
			await page.evaluate(() => {
				const b = [...document.querySelectorAll('button')].find(x => (x.title || x.textContent).toLowerCase().includes('exportar'))
				b?.click()
			})
			await espera(800)
		}
	},
	{
		alt: 'Aviso de confirmación tras enviar un parte', build: 'mock',
		prepara: async (page) => {
			await click(page, '.action-card', 'Consultar')
			await espera(1200)
			await page.evaluate(() => {
				const card = [...document.querySelectorAll('.parte-card')].find(c => c.textContent.includes('Enviar Datos'))
				const btn = [...(card || document).querySelectorAll('button')].find(b => b.textContent.includes('Enviar Datos'))
				btn?.click()
			})
			await espera(2000) // el mock responde rápido; el toast persiste 6 s
		}
	},
	{
		alt: 'Ventana de actualización automática', build: 'mock',
		prepara: async (page) => {
			await page.evaluate(() => {
				const b = [...document.querySelectorAll('button.cabecera-estado')]
				b[0]?.click()
			})
			await espera(600)
		}
	},
	{
		alt: 'Indicador de estado sin conexión', build: 'mock',
		prepara: async (page) => {
			await page.evaluate(() => window.dispatchEvent(new Event('offline')))
			await espera(600)
		}
	},
]

const espera = (ms) => new Promise(r => setTimeout(r, ms))

async function click(page, selector, texto) {
	await page.evaluate(({ selector, texto }) => {
		const el = [...document.querySelectorAll(selector)].find(x => x.textContent.includes(texto))
		el?.click()
	}, { selector, texto })
}

function cargarPuppeteer() {
	const req = createRequire(import.meta.url)
	try { return req('puppeteer-core') } catch { }
	// fallback: instalación efímera vía npx en un dir temporal es lenta;
	// probamos node_modules de rutas conocidas antes de rendirnos
	const candidatos = [process.env.PUPPETEER_DIR, '/tmp/puppeteer-cache/node_modules/puppeteer-core'].filter(Boolean)
	for (const c of candidatos) {
		try { return req(c) } catch { }
	}
	console.error('puppeteer-core no encontrado. Instálalo puntualmente: npm i --no-save puppeteer-core')
	process.exit(1)
}

function build(conAuth) {
	console.log(`· build ${conAuth ? 'CON' : 'SIN'} VITE_SUPABASE_*`)
	execSync(conAuth ? 'npm run build' : 'VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npm run build',
		{ cwd: RAIZ, stdio: 'pipe' })
}

function arrancarServer() {
	const srv = spawn('node', ['server.js'], {
		cwd: RAIZ,
		env: { ...process.env, USE_MOCK_DATA: 'true', NOTION_TOKEN: 'mock', SUPABASE_URL: '', PORT: String(PUERTO) },
		stdio: 'ignore', detached: false
	})
	return srv
}

async function capturar(browser, def) {
	const page = await browser.newPage()
	await page.setViewport(VIEWPORT)
	await page.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'networkidle2', timeout: 30000 })
	await page.evaluate(() => localStorage.clear())
	await page.reload({ waitUntil: 'networkidle2' })
	await espera(1000)
	await def.prepara(page)
	const buf = await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY })
	await page.close()
	return Buffer.from(buf).toString('base64')
}

function embeber(html, alt, base64) {
	// localizar la <figure> por alt y reemplazar el payload del src
	const re = new RegExp(`(<img src="data:image/jpeg;base64,)[^"]*(" alt="${alt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}")`)
	if (!re.test(html)) throw new Error(`No se encontró la figura con alt="${alt}"`)
	return html.replace(re, `$1${base64}$2`)
}

// ─── main ────────────────────────────────────────────────────────────────────
const puppeteer = cargarPuppeteer()
let html = readFileSync(MANUAL, 'utf8')

for (const modo of ['con-auth', 'mock']) {
	const defs = CAPTURAS.filter(c => c.build === modo)
	if (defs.length === 0) continue
	build(modo === 'con-auth')
	const srv = arrancarServer()
	await espera(2500)
	const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' })
	try {
		for (const def of defs) {
			process.stdout.write(`· capturando «${def.alt}» … `)
			const b64 = await capturar(browser, def)
			html = embeber(html, def.alt, b64)
			console.log(`${Math.round(b64.length * 0.75 / 1024)} KB`)
		}
	} finally {
		await browser.close()
		srv.kill()
	}
}

writeFileSync(MANUAL, html)
console.log(`\n${MANUAL} actualizado (${Math.round(html.length / 1024)} KB)`)
console.log('Siguiente paso: python3 docs/manual-cliente/generar.py  (deriva public/manual.html)')
console.log('Y por último: npm run build  (para dejar dist/ con el build normal)')
