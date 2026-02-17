import { useState } from "react"
import { useAuth } from "@/context/AuthContext"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { useNavigate, useLocation } from "react-router-dom"
import { Lock } from "lucide-react"

interface LocationState {
    from?: {
        pathname?: string
    }
}

export default function LoginPage() {
    const { login } = useAuth()
    const navigate = useNavigate()
    const location = useLocation()
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [isLoading, setIsLoading] = useState(false)

    const from = (location.state as LocationState | null)?.from?.pathname || "/"

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsLoading(true)

        try {
            await login({ email, password })
            navigate(from, { replace: true })
        } catch (error) {
            // Error is surfaced by AuthContext's toast notification
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div className="min-h-screen grid lg:grid-cols-2">
            {/* Visual Side */}
            <div className="hidden lg:flex flex-col bg-slate-900 text-white p-10 justify-between relative overflow-hidden">
                <div className="absolute inset-0 bg-blue-600/20 z-0"></div>
                <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-purple-500/30 rounded-full blur-[100px] z-0"></div>
                <div className="relative z-10">
                    <div className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                        <div className="h-8 w-8 rounded bg-blue-500 flex items-center justify-center">S</div>
                        SportsERP
                    </div>
                </div>
                <div className="relative z-10 max-w-md">
                    <h1 className="text-4xl font-bold mb-4">Gestiona tu negocio deportivo al siguiente nivel.</h1>
                    <p className="text-slate-400 text-lg">Control de inventario, ventas POS, picking optimizado y contabilidad en una sola plataforma unificada.</p>
                </div>
                <div className="relative z-10 text-sm text-slate-500">
                    © 2024 Antigravity Systems
                </div>
            </div>

            {/* Login Form Side */}
            <div className="flex items-center justify-center p-8 bg-background">
                <Card className="w-full max-w-md border-none shadow-none">
                    <CardHeader className="space-y-1">
                        <CardTitle className="text-2xl font-bold text-center">Iniciar Sesión</CardTitle>
                        <CardDescription className="text-center">
                            Ingresa tus credenciales para acceder al sistema
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleLogin} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="email">Correo Electrónico</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder="admin@sports.store"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="password">Contraseña</Label>
                                <Input
                                    id="password"
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                />
                            </div>

                            <Button className="w-full bg-blue-600 hover:bg-blue-500" type="submit" disabled={isLoading}>
                                {isLoading ? (
                                    <>
                                        <Lock className="mr-2 h-4 w-4 animate-pulse" />
                                        Iniciando...
                                    </>
                                ) : (
                                    "Ingresar al Sistema"
                                )}
                            </Button>
                        </form>
                        <div className="text-center text-sm text-muted-foreground mt-4">
                            <p>Contacte al administrador si no tiene credenciales de acceso.</p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
