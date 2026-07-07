import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Renderer Error]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh',
          boxSizing: 'border-box',
          padding: '24px',
          background: '#1e1e1e',
          color: '#e0e0e0',
          fontFamily: 'Consolas, "Courier New", monospace',
        }}>
          <h2 style={{ marginTop: 0, color: '#f48771' }}>Renderer crashed</h2>
          <div style={{ marginBottom: '12px', color: '#cccccc' }}>
            The UI hit a runtime error instead of rendering normally.
          </div>
          <pre style={{
            whiteSpace: 'pre-wrap',
            background: '#252526',
            border: '1px solid #3c3c3c',
            borderRadius: '6px',
            padding: '12px',
          }}>
            {this.state.error.message}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}
