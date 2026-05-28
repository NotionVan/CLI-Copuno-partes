import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
	plugins: [react()],
	define: {
		__BUILD_TIMESTAMP__: JSON.stringify(new Date().toISOString()),
		__APP_VERSION__: JSON.stringify(version)
	},
	server: {
		port: 5173,
		open: true,
		proxy: {
			'/api': {
				target: 'http://localhost:3001',
				changeOrigin: true
			}
		}
	},
	build: {
		outDir: 'dist',
		sourcemap: false, // Desactivar sourcemaps en producción por seguridad
		minify: 'terser',
		terserOptions: {
			compress: {
				drop_console: true, // Remover console.log en producción
				drop_debugger: true
			}
		},
		rollupOptions: {
			output: {
				manualChunks: {
					'react-vendor': ['react', 'react-dom', 'react-router-dom'],
					'ui-vendor': ['lucide-react']
				}
			}
		}
	}
}) 