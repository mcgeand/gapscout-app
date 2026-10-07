import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import toast from 'react-hot-toast'
// Archivo, self-hosted via @fontsource. Imported here rather than from
// globals.css so Vite rewrites the woff2 url()s into hashed assets;
// through Tailwind's @import they stay as unresolved relative paths.
import '@fontsource/archivo/latin-400.css'
import '@fontsource/archivo/latin-500.css'
import '@fontsource/archivo/latin-600.css'
import '@fontsource/archivo/latin-700.css'
import '@fontsource/archivo/latin-800.css'
import './styles/globals.css'
import App from './App.tsx'
import { logger } from './lib/logger'

window.addEventListener('unhandledrejection', (event) => {
  logger.error('Unhandled promise rejection', event.reason)
  toast.error('Something went wrong')
})

window.addEventListener('error', (event) => {
  logger.error('Uncaught error', event.error ?? event.message)
  toast.error('Something went wrong')
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
