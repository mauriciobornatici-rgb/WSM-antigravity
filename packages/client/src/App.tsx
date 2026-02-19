import { Suspense, lazy } from "react"
import { BrowserRouter, Routes, Route } from "react-router-dom"
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "sonner"
import { AuthProvider } from "@/context/AuthContext"
import { ProtectedRoute } from "@/components/ProtectedRoute"
import AppLayout from "@/layout/AppLayout"
import ErrorBoundary from "@/components/common/ErrorBoundary"
import { Loader } from "@/components/common/Loader"
import { showErrorToast } from "@/lib/errorHandling"

// Lazy Load Pages
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const InventoryPage = lazy(() => import("@/pages/Inventory"));
const PickingPage = lazy(() => import("@/pages/Picking"));
const POSPage = lazy(() => import("@/pages/POS"));
const OrdersPage = lazy(() => import("@/pages/Orders"));
const AccountingPage = lazy(() => import("@/pages/Accounting"));
const LoginPage = lazy(() => import("@/pages/Login"));
const ClientsPage = lazy(() => import("@/pages/Clients"));
const ClientDetailPage = lazy(() => import("@/pages/ClientDetail"));
const ReturnsAndWarrantiesPage = lazy(() => import("@/pages/ReturnsAndWarranties"));
const SettingsPage = lazy(() => import("@/pages/Settings"));
const SuppliersPage = lazy(() => import("@/pages/Suppliers"));
const PurchaseOrdersPage = lazy(() => import("@/pages/PurchaseOrders"));
const ReceptionsPage = lazy(() => import("@/pages/Receptions"));
const InvoicesPage = lazy(() => import("@/pages/Invoices"));
const CashManagementPage = lazy(() => import("@/pages/CashManagement"));
const PresentationPage = lazy(() => import("@/pages/Presentation"));
const NotFoundPage = lazy(() => import("@/pages/NotFound"));

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      showErrorToast("Error de consulta", error)
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      showErrorToast("Error de operación", error)
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
})

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <Suspense fallback={<Loader />}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />

                {/* POS Route - Accessible for Cashier and Admin */}
                <Route
                  path="/pos"
                  element={
                    <ProtectedRoute allowedRoles={['admin', 'cashier']}>
                      <POSPage />
                    </ProtectedRoute>
                  }
                />

                {/* Main Layout Routes */}
                <Route element={<AppLayout />}>
                  <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />

                  {/* Inventory - Admin, Manager & Warehouse */}
                  <Route
                    path="/inventory"
                    element={
                      <ProtectedRoute allowedRoles={['admin', 'manager', 'warehouse']}>
                        <InventoryPage />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/picking/:id"
                    element={
                      <ProtectedRoute allowedRoles={['admin', 'manager', 'warehouse']}>
                        <PickingPage />
                      </ProtectedRoute>
                    }
                  />

                  {/* Orders - Admin, Manager, Cashier & Warehouse (for picking) */}
                  <Route
                    path="/orders"
                    element={
                      <ProtectedRoute allowedRoles={['admin', 'manager', 'cashier', 'warehouse']}>
                        <OrdersPage />
                      </ProtectedRoute>
                    }
                  />

                  {/* Clients - Admin, Manager, Cashier */}
                  <Route
                    path="/clients"
                    element={
                      <ProtectedRoute allowedRoles={['admin', 'manager', 'cashier']}>
                        <ClientsPage />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/clients/:id"
                    element={
                      <ProtectedRoute allowedRoles={['admin', 'manager', 'cashier']}>
                        <ClientDetailPage />
                      </ProtectedRoute>
                    }
                  />

                  {/* Returns & Warranties */}
                  <Route
                    path="/returns-warranties"
                    element={
                      <ProtectedRoute allowedRoles={['admin', 'manager', 'cashier']}>
                        <ReturnsAndWarrantiesPage />
                      </ProtectedRoute>
                    }
                  />

                  {/* Accounting - Admin Only */}
                  <Route
                    path="/accounting"
                    element={
                      <ProtectedRoute allowedRoles={['admin']}>
                        <AccountingPage />
                      </ProtectedRoute>
                    }
                  />

                  {/* Settings - Admin Only */}
                  <Route
                    path="/settings"
                    element={
                      <ProtectedRoute allowedRoles={['admin']}>
                        <SettingsPage />
                      </ProtectedRoute>
                    }
                  />

                  {/* Purchasing Module - Admin & Manager */}
                  <Route
                    path="/suppliers"
                    element={
                      <ProtectedRoute allowedRoles={['admin', 'manager']}>
                        <SuppliersPage />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/purchase-orders"
                    element={
                      <ProtectedRoute allowedRoles={['admin', 'manager']}>
                        <PurchaseOrdersPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/receptions"
                    element={
                      <ProtectedRoute allowedRoles={['admin', 'manager', 'warehouse']}>
                        <ReceptionsPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/invoices"
                    element={
                      <ProtectedRoute allowedRoles={['admin', 'manager', 'cashier']}>
                        <InvoicesPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/cash-management"
                    element={
                      <ProtectedRoute allowedRoles={['admin', 'cashier']}>
                        <CashManagementPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="*"
                    element={
                      <ProtectedRoute>
                        <NotFoundPage />
                      </ProtectedRoute>
                    }
                  />
                </Route>

                <Route
                  path="/presentation"
                  element={
                    <ProtectedRoute allowedRoles={['admin']}>
                      <PresentationPage />
                    </ProtectedRoute>
                  }
                />
              </Routes>
            </Suspense>
          </BrowserRouter>
          <Toaster />
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

export default App
