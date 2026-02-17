import { Loader2 } from "lucide-react";

export function Loader() {
    return (
        <div className="flex h-screen w-full items-center justify-center bg-background/50 backdrop-blur-sm">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
    );
}
