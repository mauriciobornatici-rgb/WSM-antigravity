import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
    }

    public render() {
        if (this.state.hasError) {
            return this.props.fallback || (
                <div style={{
                    padding: '2rem',
                    margin: '2rem',
                    border: '1px solid #ff4d4f',
                    borderRadius: '8px',
                    backgroundColor: '#fff1f0',
                    color: '#cf1322',
                    fontFamily: 'system-ui, -apple-system, sans-serif'
                }}>
                    <h2>Ups! Algo salió mal.</h2>
                    <p>La aplicación ha encontrado un error inesperado.</p>
                    <pre style={{
                        fontSize: '0.8rem',
                        background: '#fff',
                        padding: '1rem',
                        borderRadius: '4px',
                        overflow: 'auto'
                    }}>
                        {this.state.error?.message}
                    </pre>
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            marginTop: '1rem',
                            padding: '0.5rem 1rem',
                            backgroundColor: '#cf1322',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                        }}
                    >
                        Recargar Aplicación
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
