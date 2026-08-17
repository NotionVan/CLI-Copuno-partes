import React from 'react'
import ReactDOM from 'react-dom/client'
import { SpeedInsights } from '@vercel/speed-insights/react'
import App from './App.jsx'
import AuthGate from './auth/AuthGate.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
	<React.StrictMode>
		<ErrorBoundary>
			<AuthGate>
				<App />
			</AuthGate>
		</ErrorBoundary>
		<SpeedInsights />
	</React.StrictMode>,
) 