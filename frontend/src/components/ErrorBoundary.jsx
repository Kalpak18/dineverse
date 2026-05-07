import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
    this._onUnhandledRejection = (event) => {
      if (import.meta.env.DEV) console.error('[Unhandled rejection]', event.reason);
      event.preventDefault(); // suppress browser console noise in prod
    };
  }

  componentDidMount() {
    window.addEventListener('unhandledrejection', this._onUnhandledRejection);
  }

  componentWillUnmount() {
    window.removeEventListener('unhandledrejection', this._onUnhandledRejection);
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    if (import.meta.env.DEV) console.error('React error boundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      const errMsg = this.state.error?.message || 'An unexpected error occurred';
      return (
        <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50">
          <div className="text-center max-w-md">
            <div className="text-6xl mb-4">⚠️</div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Something went wrong</h1>
            <p className="text-gray-500 text-sm mb-2">
              The app hit an unexpected error. You can try refreshing or going back home.
            </p>
            <details className="mb-6 text-xs text-left mx-auto max-w-xs bg-white border border-gray-200 rounded-lg p-3">
              <summary className="cursor-pointer text-gray-500 font-medium">Error details</summary>
              <p className="mt-2 text-red-600 font-mono break-words">{errMsg}</p>
            </details>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="btn-primary"
              >
                Refresh
              </button>
              <button
                onClick={() => { this.setState({ hasError: false, error: null }); window.location.href = '/'; }}
                className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200"
              >
                Go Home
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
