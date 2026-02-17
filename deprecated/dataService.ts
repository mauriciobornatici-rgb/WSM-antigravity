import { api } from './api';
import { mockService } from './mockData';

/**
 * Unified Service - Automatically uses real API where available, falls back to mock
 */
export const dataService = {
    // IMPLEMENTED IN REAL APIs
    getClients: () => api.getClients(),
    createClient: (data: any) => api.createClient(data),
    getProducts: () => api.getProducts(),
    createProduct: (data: any) => api.createProduct(data),
    getSuppliers: () => api.getSuppliers(),
    createSupplier: (data: any) => api.createSupplier(data),
    getInventory: () => api.getInventory(),
    getOrders: () => api.getOrders(),
    createOrder: (customerName: string, items: any[], clientId?: string) => {
        return api.createOrder({
            customer_name: customerName,
            client_id: clientId,
            items: items.map((i: any) => ({
                product_id: i.product?.id || i.product_id,
                quantity: i.quantity
            })),
            total_amount: items.reduce((sum: number, item: any) => {
                const price = item.product?.sale_price || item.sale_price || 0;
                return sum + (price * item.quantity);
            }, 0)
        });
    },
    getTransactions: () => api.getTransactions(),
    getCompanySettings: () => api.getCompanySettings(),
    updateCompanySettings: (data: any) => api.updateCompanySettings(data),

    // STILL USING MOCK (Temporarily)
    getSystemSettings: () => mockService.getSystemSettings(),
    getUsers: () => mockService.getUsers(),
    updateUserRole: (...args: any[]) => mockService.updateUserRole(...args),
    toggleUserStatus: (...args: any[]) => mockService.toggleUserStatus(...args),
    updateSystemSettings: (...args: any[]) => mockService.updateSystemSettings(...args),
    updateOrderStatus: (...args: any[]) => mockService.updateOrderStatus(...args),
    getWarranties: () => mockService.getWarranties(),
    getReturns: () => mockService.getReturns(),
    getPurchaseOrders: () => mockService.getPurchaseOrders(),
    getSupplierPayments: (...args: any[]) => mockService.getSupplierPayments(...args),
    getReceptions: () => mockService.getReceptions(),
    getSupplierReturns: () => mockService.getSupplierReturns(),
    getInvoices: () => mockService.getInvoices(),
    createSupplierPayment: (...args: any[]) => mockService.createSupplierPayment(...args),
    performQualityCheck: (...args: any[]) => mockService.performQualityCheck(...args),
    createSupplierReturn: (...args: any[]) => mockService.createSupplierReturn(...args),
    createReception: (...args: any[]) => mockService.createReception(...args),
    updatePurchaseStatus: (...args: any[]) => mockService.updatePurchaseStatus(...args),
    createPurchaseOrder: (...args: any[]) => mockService.createPurchaseOrder(...args),
    createInvoice: (...args: any[]) => mockService.createInvoice(...args),
    createReturn: (...args: any[]) => mockService.createReturn(...args),
    addTransaction: (...args: any[]) => mockService.addTransaction(...args),
    updateClientBalance: (...args: any[]) => mockService.updateClientBalance(...args),
};
