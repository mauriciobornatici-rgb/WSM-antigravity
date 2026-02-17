import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
    ChevronLeft,
    ChevronRight,
    LayoutDashboard,
    ShoppingCart,
    Boxes,
    Truck,
    Landmark,
    ShieldCheck,
    FileText,
    Printer,
    Sparkles,
    Layers,
    BarChart3
} from "lucide-react"

const slides = [
    {
        id: "cover",
        title: "EcoSystem WMS & POS",
        subtitle: "Solución Integral de Gestión Comercial y Logística",
        icon: Sparkles,
        content: "Una plataforma moderna diseñada para optimizar cada aspecto de su negocio, desde la venta directa hasta el control profundo de almacén y finanzas.",
        tags: ["Eficiencia", "Control", "Crecimiento"],
        color: "from-blue-600 to-indigo-700"
    },
    {
        id: "dashboard",
        title: "Centro de Control Inteligente",
        subtitle: "Dashboard y Analítica en Tiempo Real",
        icon: LayoutDashboard,
        features: [
            "Vistas consolidadas de ventas diarias.",
            "Indicadores de rendimiento de pedidos WMS.",
            "Alertas automáticas de quiebre de stock.",
            "Seguimiento de actividad reciente y movimientos de caja."
        ],
        content: "Tome decisiones basadas en datos con una interfaz clara que le permite supervisar toda su operación en un solo vistazo.",
        color: "from-slate-800 to-slate-900"
    },
    {
        id: "pos",
        title: "Punto de Venta de Alto Rendimiento",
        subtitle: "Ventas Ágiles y Experiencia de Cliente Superior",
        icon: ShoppingCart,
        features: [
            "Búsqueda ultra-rápida por SKU y Categorías.",
            "Gestión de clientes y cuentas corrientes.",
            "Múltiples métodos de pago (Efectivo, Tarjeta, QR, Cta. Cte.).",
            "Emisión automática de facturas legales (Tipo A y B) y tickets."
        ],
        content: "Reduzca tiempos de espera y profesionalice su atención al público con un POS intuitivo y potente.",
        color: "from-indigo-600 to-blue-500"
    },
    {
        id: "inventory",
        title: "WMS: Gestión Avanzada de Stock",
        subtitle: "Control Total de Inventario y Almacenes",
        icon: Boxes,
        features: [
            "Visibilidad multi-ubicación en tiempo real.",
            "Historial detallado de movimientos de mercadería.",
            "Categorización y SKU management profesional.",
            "Integración directa con el flujo de ventas."
        ],
        content: "Elimine errores de stock y optimice su espacio de almacenamiento con nuestro sistema de gestión de depósitos.",
        color: "from-emerald-600 to-teal-700"
    },
    {
        id: "purchases",
        title: "Ciclo de Compras y Suministros",
        subtitle: "De la Orden de Compra al Almacén",
        icon: Truck,
        features: [
            "Gestión de Órdenes de Compra a proveedores.",
            "Recepción asistida con validación de remitos.",
            "Control de Calidad (QC) integrado al flujo.",
            "Gestión de Devoluciones y RMA por fallas o faltantes."
        ],
        content: "Asegure que lo que paga es exactamente lo que recibe con un flujo documental riguroso.",
        color: "from-amber-600 to-orange-700"
    },
    {
        id: "cash",
        title: "Auditoría y Gestión de Cajas",
        subtitle: "Control Financiero y Arqueos de Turno",
        icon: Landmark,
        features: [
            "Apertura y cierre de turnos con base de caja.",
            "Arqueos ciegos para mayor seguridad.",
            "Detección automática de sobrantes y faltantes.",
            "Registro de gastos y pagos directos de caja."
        ],
        content: "Transparencia absoluta en el manejo de efectivo y valores en todos sus puntos de venta.",
        color: "from-cyan-600 to-blue-700"
    },
    {
        id: "legal",
        title: "Cumplimiento Administrativo",
        subtitle: "Facturación y Comprobantes Legales",
        icon: FileText,
        features: [
            "Módulo de facturación configurable.",
            "Cumplimiento con normativas fiscales para Facturas A/B.",
            "Impresión de tickets de control interno.",
            "Seguimiento de vencimientos de facturas de proveedores."
        ],
        content: "Mantenga su contabilidad al día con herramientas que facilitan el registro legal de cada transacción.",
        color: "from-slate-700 to-slate-800"
    }
]

export default function PresentationPage() {
    const [currentSlide, setCurrentSlide] = useState(0)

    const nextSlide = () => setCurrentSlide((prev) => (prev + 1) % slides.length)
    const prevSlide = () => setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length)

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "ArrowRight" || e.key === " ") {
                nextSlide()
            } else if (e.key === "ArrowLeft") {
                prevSlide()
            }
        }
        window.addEventListener("keydown", handleKeyDown)
        return () => window.removeEventListener("keydown", handleKeyDown)
    }, [])

    const firstSlide = slides[0]
    if (!firstSlide) return null

    const slide = slides[currentSlide] ?? firstSlide

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col font-sans overflow-x-hidden selection:bg-blue-100 print:bg-white">
            {/* Navigation Header - Hidden on Print */}
            <header className="h-16 bg-white border-b flex items-center justify-between px-8 shrink-0 sticky top-0 z-30 print:hidden">
                <div className="flex items-center gap-2">
                    <Layers className="h-6 w-6 text-blue-600" />
                    <span className="font-bold text-xl tracking-tight text-slate-800">EcoSystem <span className="text-blue-600 font-extrabold">WMS</span></span>
                </div>

                <div className="flex items-center gap-4">
                    <div className="text-sm text-slate-500 font-medium mr-4">
                        Slide {currentSlide + 1} de {slides.length}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-2">
                        <Printer className="h-4 w-4" /> Exportar PDF
                    </Button>
                    <div className="flex gap-1">
                        <div className="flex gap-2">
                            <Button variant="outline" size="icon" onClick={prevSlide} className="h-10 w-10 rounded-full border-2 hover:bg-slate-100 transition-colors shadow-sm" title="Anterior (Flecha Izquierda)">
                                <ChevronLeft className="h-6 w-6 text-slate-700" />
                            </Button>
                            <Button variant="outline" size="icon" onClick={nextSlide} className="h-10 w-10 rounded-full border-2 hover:bg-blue-50 hover:border-blue-200 transition-colors shadow-sm" title="Siguiente (Flecha Derecha / Espacio)">
                                <ChevronRight className="h-6 w-6 text-blue-600" />
                            </Button>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content Area */}
            <main className="flex-1 flex items-center justify-center p-6 md:p-12 lg:p-20 relative overflow-hidden">
                {/* Floating Side Controls - Hidden on Print */}
                <div className="absolute inset-y-0 left-0 w-24 flex items-center justify-center z-40 print:hidden">
                    <Button
                        variant="secondary"
                        size="icon"
                        onClick={prevSlide}
                        className="h-14 w-14 rounded-full shadow-2xl bg-white/80 backdrop-blur-sm border border-slate-200 hover:bg-white text-slate-800 transition-all hover:scale-110 active:scale-95"
                    >
                        <ChevronLeft className="h-8 w-8" />
                    </Button>
                </div>
                <div className="absolute inset-y-0 right-0 w-24 flex items-center justify-center z-40 print:hidden">
                    <Button
                        variant="secondary"
                        size="icon"
                        onClick={nextSlide}
                        className="h-14 w-14 rounded-full shadow-2xl bg-blue-600/90 backdrop-blur-sm border border-blue-500 hover:bg-blue-600 text-white transition-all hover:scale-110 active:scale-95 animate-in fade-in slide-in-from-right-4"
                    >
                        <ChevronRight className="h-8 w-8" />
                    </Button>
                </div>
                {/* Decorative Background for screen - Hidden on Print */}
                <div className="absolute top-1/4 -left-20 w-96 h-96 bg-blue-200/20 blur-3xl rounded-full print:hidden" />
                <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-indigo-200/20 blur-3xl rounded-full print:hidden" />

                <Card className="w-full max-w-6xl overflow-hidden border-0 shadow-2xl relative z-10 print:shadow-none print:w-full print:max-w-none">
                    <div className={`grid grid-cols-1 lg:grid-cols-2 min-h-[600px] print:grid-cols-2`}>
                        {/* Visual Side */}
                        <div className={`bg-gradient-to-br ${slide.color} text-white p-12 flex flex-col justify-center items-center text-center relative overflow-hidden`}>
                            {/* Patterns - Hidden on Print */}
                            <div className="absolute inset-0 opacity-10 pointer-events-none print:hidden">
                                <div className="absolute top-0 left-0 w-full h-full" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '40px 40px' }} />
                            </div>

                            <div className="relative z-10 animate-in fade-in zoom-in duration-700">
                                <div className="bg-white/20 p-6 rounded-3xl backdrop-blur-md inline-block mb-8 shadow-xl">
                                    <slide.icon className="h-20 w-20 text-white" strokeWidth={1.5} />
                                </div>
                                <h2 className="text-4xl md:text-5xl font-black mb-4 tracking-tight leading-tight">
                                    {slide.title}
                                </h2>
                                <p className="text-xl md:text-2xl text-blue-50/80 font-medium">
                                    {slide.subtitle}
                                </p>

                                {slide.tags && (
                                    <div className="flex gap-2 justify-center mt-12 flex-wrap">
                                        {slide.tags.map(tag => (
                                            <span key={tag} className="px-4 py-1 bg-white/10 rounded-full text-sm font-bold backdrop-blur-sm border border-white/20">
                                                #{tag}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Info Side */}
                        <div className="bg-white p-12 flex flex-col justify-center print:p-8">
                            <div className="max-w-md mx-auto w-full animate-in slide-in-from-right-8 duration-500">
                                <div className="mb-10">
                                    <h3 className="text-slate-900 text-2xl font-bold mb-4 flex items-center gap-3 italic">
                                        <BarChart3 className="h-6 w-6 text-blue-600" /> Descripción
                                    </h3>
                                    <p className="text-slate-600 text-lg leading-relaxed">
                                        {slide.content}
                                    </p>
                                </div>

                                {slide.features && (
                                    <div className="space-y-4">
                                        <h4 className="text-slate-800 text-lg font-bold uppercase tracking-widest text-sm mb-6 flex items-center gap-2">
                                            Funcionalidades Clave
                                            <div className="h-px bg-slate-100 flex-1" />
                                        </h4>
                                        <ul className="space-y-4">
                                            {slide.features.map((feature, i) => (
                                                <li key={i} className="flex items-start gap-4 group">
                                                    <div className="h-6 w-6 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                                                        <ShieldCheck className="h-4 w-4" />
                                                    </div>
                                                    <span className="text-slate-700 font-medium">{feature}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {slide.id !== 'cover' && (
                                    <div className="mt-10 flex justify-end">
                                        <Button
                                            onClick={nextSlide}
                                            variant="ghost"
                                            className="text-blue-600 font-bold hover:bg-blue-50 gap-2 group border-b-2 border-transparent hover:border-blue-200 rounded-none transition-all"
                                        >
                                            Ver Siguiente Módulo <ChevronRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
                                        </Button>
                                    </div>
                                )}

                                {slide.id === 'cover' && (
                                    <div className="mt-12 p-6 bg-slate-50 rounded-2xl border border-slate-100 space-y-4">
                                        <p className="text-slate-500 text-sm font-medium italic">
                                            "Eficiencia operativa desde el primer día."
                                        </p>
                                        <Button
                                            onClick={nextSlide}
                                            className="w-full h-14 bg-blue-600 hover:bg-blue-700 text-xl font-black group shadow-lg shadow-blue-500/30 animate-pulse hover:animate-none"
                                        >
                                            Comenzar Presentación <ChevronRight className="ml-2 h-6 w-6 group-hover:translate-x-2 transition-transform" />
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </Card>
            </main>

            {/* Footer / Progress Bar - Hidden on Print */}
            <footer className="h-2 bg-slate-200 w-full print:hidden">
                <div
                    className="h-full bg-blue-600 transition-all duration-500 ease-out shadow-[0_0_10px_rgba(37,99,235,0.5)]"
                    style={{ width: `${((currentSlide + 1) / slides.length) * 100}%` }}
                />
            </footer>

            {/* Print-only CSS */}
            <style>{`
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          header, footer, button, .print-hidden { display: none !important; }
          main { padding: 0 !important; }
          .card { box-shadow: none !important; margin: 0 !important; }
          .slide-container { page-break-after: always; height: 100vh; }
        }
      `}</style>

            {/* Full Presentation for Print (Hidden on screen) */}
            <div className="hidden print:block">
                {slides.map((s, idx) => (
                    <div key={idx} className="h-screen w-full flex flex-col page-break-after-always overflow-hidden">
                        <div className="flex-1 flex border-4 border-slate-100">
                            <div className={`w-1/2 bg-gradient-to-br ${s.color} text-white p-12 flex flex-col justify-center items-center text-center`}>
                                <s.icon className="h-24 w-24 mb-8" strokeWidth={1.5} />
                                <h2 className="text-5xl font-black mb-6">{s.title}</h2>
                                <p className="text-2xl font-medium opacity-90">{s.subtitle}</p>
                            </div>
                            <div className="w-1/2 bg-white p-16 flex flex-col justify-center">
                                <div className="mb-12">
                                    <h3 className="text-3xl font-bold mb-6 text-slate-900 border-b-2 border-blue-600 inline-block pb-2">Descripción</h3>
                                    <p className="text-xl text-slate-600 leading-relaxed">{s.content}</p>
                                </div>
                                {s.features && (
                                    <div className="space-y-6">
                                        <h4 className="text-xl font-black text-slate-800 uppercase tracking-tighter">Funcionalidades</h4>
                                        <ul className="space-y-4">
                                            {s.features.map((f, i) => (
                                                <li key={i} className="flex items-start gap-4">
                                                    <div className="h-6 w-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0 mt-1">
                                                        <ShieldCheck className="h-4 w-4" />
                                                    </div>
                                                    <span className="text-lg text-slate-700 font-semibold">{f}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="h-16 bg-slate-900 text-white flex items-center justify-between px-12 text-sm font-bold">
                            <span>EcoSystem WMS - Propuesta de Implementación</span>
                            <span>Página {idx + 1} / {slides.length}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
