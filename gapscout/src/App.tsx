import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import toast from 'react-hot-toast'
import { router } from './app/routes'
import { useProjectStore } from './state/projectStore'
import { ErrorBoundary } from './components/shared/ErrorBoundary'
import { UpdaterPrompt } from './components/UpdaterPrompt'
import { logger } from './lib/logger'

/**
 * GapScout - Main Application Component
 *
 * Provides routing configuration, toast notifications, and initializes stores.
 * ErrorBoundary wraps the entire app to catch any unhandled errors.
 */
function App() {
  const initialize = useProjectStore((state) => state.initialize)

  // Initialize stores on mount
  useEffect(() => {
    initialize()
  }, [initialize])

  // Error handler for ErrorBoundary - shows toast and logs error
  const handleError = (error: Error) => {
    logger.error('Application error', error)
    toast.error('An unexpected error occurred. Please try again.')
  }

  return (
    <>
      <ErrorBoundary onError={handleError}>
        <RouterProvider router={router} />
        <UpdaterPrompt />
      </ErrorBoundary>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#fff',
            color: '#1F2937',
            border: '1px solid #E5E7EB',
            borderRadius: '0.5rem',
            fontSize: '0.875rem',
          },
          success: {
            iconTheme: {
              primary: '#10B981',
              secondary: '#fff',
            },
          },
          error: {
            iconTheme: {
              primary: '#EF4444',
              secondary: '#fff',
            },
          },
        }}
      />
    </>
  )
}

export default App
