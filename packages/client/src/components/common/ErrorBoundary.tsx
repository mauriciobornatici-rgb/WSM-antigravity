import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    /** When this value changes (e.g. the route path) a caught error is cleared. */
    resetKey?: string;
    /** 'app' replaces the whole screen; 'route' keeps the layout and only replaces the page. */
    scope?: 'app' | 'route';
}

interface State {
    hasError: boolean;
    error: Error | null;
}

// After a deploy the browser may still reference lazy chunks that no longer exist.
function isStaleChunkError(error: Error | null) {
    const message = error?.message ?? '';
    return /dynamically imported module|Importing a module script failed|Failed to fetch dynamically/i.test(message);
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

    public componentDidUpdate(previousProps: Props) {
        if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) {
            this.setState({ hasError: false, error: null });
        }
    }

    private readonly retry = () => {
        this.setState({ hasError: false, error: null });
    };

    public render() {
        if (!this.state.hasError) {
            return this.props.children;
        }
        if (this.props.fallback) {
            return this.props.fallback;
        }

        const staleChunk = isStaleChunkError(this.state.error);
        const isRoute = this.props.scope === 'route';

        return (
            <div
                role="alert"
                className={`flex flex-col items-center justify-center gap-4 p-8 text-center ${isRoute ? 'min-h-[60vh]' : 'min-h-screen bg-background'}`}
            >
                <h2 className="text-xl font-semibold text-foreground">
                    {staleChunk ? 'Hay una versión nueva del sistema' : 'Algo salió mal en esta pantalla'}
                </h2>
                <p className="max-w-md text-sm text-muted-foreground">
                    {staleChunk
                        ? 'Recargá la página para usar la versión actualizada. Tus datos guardados no se pierden.'
                        : 'El resto del sistema sigue funcionando. Podés reintentar o volver al inicio; si el problema continúa, avisá a soporte con el detalle de abajo.'}
                </p>
                {!staleChunk && this.state.error?.message && (
                    <pre className="max-w-lg overflow-auto rounded-md border border-border bg-muted p-3 text-left text-xs text-muted-foreground">
                        {this.state.error.message}
                    </pre>
                )}
                <div className="flex flex-wrap justify-center gap-2">
                    {isRoute && !staleChunk && (
                        <button
                            type="button"
                            onClick={this.retry}
                            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            Reintentar
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => window.location.reload()}
                        className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        Recargar
                    </button>
                    {isRoute && (
                        <a
                            href="/"
                            className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
                        >
                            Volver al inicio
                        </a>
                    )}
                </div>
            </div>
        );
    }
}

export default ErrorBoundary;
