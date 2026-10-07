/**
 * ErrorBoundary - Catches JavaScript errors in child components
 *
 * Prevents entire app from crashing and provides fallback UI with:
 * - Error message display
 * - Stack trace (development only)
 * - Retry/reload options
 *
 * Reference: React Error Boundaries documentation
 */

import { Component, type ReactNode, type ErrorInfo } from 'react'
import { RefreshCw, Home } from 'lucide-react'
import { FallbackPanel } from './FallbackPanel'
import { fallbackStyles } from './fallbackStyles'
import { logger } from '../../lib/logger'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Optional fallback UI to render instead of children when an error occurs */
  fallback?: ReactNode
  /** Called when an error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

/**
 * Error Boundary Component
 *
 * Wraps child components and catches JavaScript errors anywhere in their
 * child component tree, logs them, and displays a fallback UI.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    logger.error('ErrorBoundary caught an error', error)
    logger.error('Component stack', errorInfo.componentStack)

    // Update state with error info
    this.setState({ errorInfo })

    // Call optional error handler
    this.props.onError?.(error, errorInfo)
  }

  handleReload = (): void => {
    window.location.reload()
  }

  handleGoHome = (): void => {
    window.location.href = '/projects'
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // If a custom fallback was provided, use it
      if (this.props.fallback) {
        return this.props.fallback
      }

      // Default fallback UI. Inline styles are deliberate: this renders around
      // the app shell, where the stylesheet may not have loaded. The grammar
      // and the tokens come from FallbackPanel (#205).
      return (
        <FallbackPanel
          title="Something went wrong"
          message="An unexpected error occurred. Your work may not have been saved."
          actions={
            <>
              <button
                type="button"
                onClick={this.handleRetry}
                style={fallbackStyles.primaryButton}
              >
                <RefreshCw size={16} strokeWidth={2} />
                Try Again
              </button>
              <button
                type="button"
                onClick={this.handleGoHome}
                style={fallbackStyles.secondaryButton}
              >
                <Home size={16} strokeWidth={2} />
                Go to Projects
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                style={fallbackStyles.secondaryButton}
              >
                <RefreshCw size={16} strokeWidth={2} />
                Reload App
              </button>
            </>
          }
        >
          {this.state.error && (
            <div style={fallbackStyles.detail}>{this.state.error.message}</div>
          )}

          {import.meta.env.DEV && this.state.errorInfo && (
            <details style={fallbackStyles.detail}>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                Component Stack (Development)
              </summary>
              <pre
                style={{
                  margin: '8px 0 0',
                  overflow: 'auto',
                  maxHeight: '200px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {this.state.errorInfo.componentStack}
              </pre>
            </details>
          )}

          <p style={fallbackStyles.helpText}>
            If this error persists, try reloading the app or contact support.
          </p>
        </FallbackPanel>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
