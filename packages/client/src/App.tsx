import { Suspense, lazy } from "react"
import { BrowserRouter, Routes, Route } from "react-router-dom"
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "sonner"
import { AuthProvider } from "@/context/AuthContext"
import { ThemeProvider } from "@/context/ThemeContext"
import { ProtectedRoute } from "@/components/ProtectedRoute"
import AppLayout from "@/layout/AppLayout"
import ErrorBoundary from "@/components/common/ErrorBoundary"
import { Loader } from "@/components/common/Loader"
import { showErrorToast } from "@/lib/errorHandling"
import { PERMISSIONS } from "@wsm/common"

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
const CollectionsPage = lazy(() => import("@/pages/Collections"));
const SupplierPaymentsPage = lazy(() => import("@/pages/SupplierPayments"));
const CurrentAccountsPage = lazy(() => import("@/pages/CurrentAccounts"));
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
      <ThemeProvider>
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
                    <ProtectedRoute permission={PERMISSIONS.ORDERS_SELL}>
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
                      <ProtectedRoute permission={PERMISSIONS.INVENTORY_MANAGE}>
                        <InventoryPage />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/picking/:id"
                    element={
                      <ProtectedRoute permission={PERMISSIONS.ORDERS_PICK}>
                        <PickingPage />
                      </ProtectedRoute>
                    }
                  />

                  {/* Orders - Admin, Manager, Cashier & Warehouse (for picking) */}
                  <Route
                    path="/orders"
                    element={
                      <ProtectedRoute permission={PERMISSIONS.ORDERS_READ}>
                        <OrdersPage />
                      </ProtectedRoute>
                    }
                  />

                  {/* Clients - Admin, Manager, Cashier */}
                  <Route
                    path="/clients"
                    element={
                      <ProtectedRoute permission={PERMISSIONS.CLIENTS_MANAGE}>
                        <ClientsPage />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/clients/:id"
                    element={
                      <ProtectedRoute permission={PERMISSIONS.CLIENTS_MANAGE}>
                        <ClientDetailPage />
                      </ProtectedRoute>
                    }
                  />

                  {/* Returns & Warranties */}
                  <Route
                    path="/returns-warranties"
                    element={
                      <ProtectedRoute permission={PERMISSIONS.WARRANTIES_MANAGE}>
                        <ReturnsAndWarrantiesPage />
                      </ProtectedRoute>
                    }
                  />

                  {/* Accounting - Admin Only */}
                  <Route
                    path="/accounting"
                    element={
                      <ProtectedRoute permission={PERMISSIONS.ACCOUNTING_MANAGE}>
                        <AccountingPage />
                      </ProtectedRoute>
                    }
                  />

                  {/* Settings - Admin Only */}
                  <Route
                    path="/settings"
                    element={
                      <ProtectedRoute permission={PERMISSIONS.SETTINGS_MANAGE}>
                        <SettingsPage />
                      </ProtectedRoute>
                    }
                  />

                  {/* Purchasing Module - Admin & Manager */}
                  <Route
                    path="/suppliers"
                    element={
                      <ProtectedRoute permission={PERMISSIONS.SUPPLIERS_MANAGE}>
                        <SuppliersPage />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/purchase-orders"
                    element={
                      <ProtectedRoute permission={PERMISSIONS.PROCUREMENT_MANAGE}>
                        <PurchaseOrdersPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/receptions"
                    element={
                      <ProtectedRoute permission={PERMISSIONS.RECEPTIONS_MANAGE}>
                        <ReceptionsPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/invoices"
                    element={
                      <ProtectedRoute permission={PERMISSIONS.INVOICES_MANAGE}>
                        <InvoicesPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/cash-management"
                    element={
                      <ProtectedRoute permission={PERMISSIONS.CASH_MANAGE}>
                        <CashManagementPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/collections"
                    element={
                      <ProtectedRoute permission={PERMISSIONS.COLLECTIONS_MANAGE}>
                        <CollectionsPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/supplier-payments"
                    element={
                      <ProtectedRoute permission={PERMISSIONS.SUPPLIER_PAYMENTS_MANAGE}>
                        <SupplierPaymentsPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/current-accounts"
                    element={
                      <ProtectedRoute permission={PERMISSIONS.COLLECTIONS_MANAGE}>
                        <CurrentAccountsPage />
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
                    <ProtectedRoute permission={PERMISSIONS.SETTINGS_MANAGE}>
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
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
