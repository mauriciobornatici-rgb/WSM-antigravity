import { useAuth, type UserRole } from "@/context/AuthContext"
import { clearSessionStorage } from "@/lib/authSession"
import { Navigate, useLocation } from "react-router-dom"

interface ProtectedRouteProps {
    children: React.ReactNode
    allowedRoles?: UserRole[]
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
    const { user, isLoading } = useAuth()
    const location = useLocation()

    if (isLoading) {
        return <div className="h-screen w-screen flex items-center justify-center">Cargando sesión...</div>
    }

    if (!user) {
        return <Navigate to="/login" state={{ from: location }} replace />
    }

    if (user.status !== "active") {
        clearSessionStorage()
        return <Navigate to="/login" replace />
    }

    if (allowedRoles && !allowedRoles.includes(user.role)) {
        return (
            <div className="h-screen w-screen flex flex-col items-center justify-center gap-4">
                <h1 className="text-4xl font-bold">403</h1>
                <p className="text-muted-foreground">No tienes permisos para acceder a esta sección.</p>
                <p className="text-sm">Rol actual: <span className="font-bold uppercase">{user.role}</span></p>
            </div>
        )
    }

    return <>{children}</>
}
