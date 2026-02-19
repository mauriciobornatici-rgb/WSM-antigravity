import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

function NotFound() {
    return (
        <section className="min-h-[calc(100vh-7rem)] rounded-xl border border-white/10 bg-slate-950/40 p-6 md:p-10">
            <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-4 text-center">
                <p className="text-sm font-semibold uppercase tracking-wide text-cyan-300">Error 404</p>
                <h1 className="text-3xl font-bold text-white md:text-4xl">No encontramos esta pantalla</h1>
                <p className="max-w-xl text-sm text-slate-300 md:text-base">
                    La ruta que intentaste abrir no existe o fue movida. Volve al inicio para seguir operando.
                </p>
                <Button asChild className="mt-2">
                    <Link to="/">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Volver al inicio
                    </Link>
                </Button>
            </div>
        </section>
    );
}

export default NotFound;
