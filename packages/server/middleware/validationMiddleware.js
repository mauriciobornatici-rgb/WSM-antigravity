import { z } from 'zod';
import * as commonSchemas from '@wsm/common';

export const validate = (schema) => (req, res, next) => {
    try {
        const dataToValidate = {
            body: Object.keys(req.body || {}).length ? req.body : undefined,
            params: Object.keys(req.params || {}).length ? req.params : undefined,
            query: Object.keys(req.query || {}).length ? req.query : undefined
        };
        const validated = schema.parse(dataToValidate);
        
        if (validated.body) req.body = validated.body;
        if (validated.params) req.params = validated.params;
        if (validated.query) {
            req.validatedQuery = validated.query;
            Object.assign(req.query, validated.query);
        }
        
        next();
    } catch (error) {
        if (error.issues) {
            const details = error.issues.map((issue) => ({
                message: issue.message,
                path: issue.path
            }));
            return res.status(400).json({
                error: 'validation_error',
                message: 'Datos de entrada invalidos (Zod)',
                details
            });
        }
        next(error);
    }
};

export const validateZod = validate;

export const zodSchemas = {
    emptyQuery: z.object({
        query: commonSchemas.emptyQuerySchema.optional()
    }),
    idParam: z.object({
        params: z.object({
            id: commonSchemas.uuidSchema
        })
    }),
    login: z.object({
        body: commonSchemas.loginSchema
    }),
    user: z.object({
        body: commonSchemas.createUserSchema
    }),
    userUpdate: z.object({
        params: z.object({
            id: commonSchemas.uuidSchema
        }),
        body: commonSchemas.updateUserSchema
    }),
    product: z.object({
        body: commonSchemas.createProductSchema
    }),
    uploadProductImage: z.object({
        body: commonSchemas.uploadProductImageSchema
    }),
    productFilters: z.object({
        query: commonSchemas.productFiltersSchema.optional()
    }),
    order: z.object({
        body: commonSchemas.createOrderSchema
    }),
    orderFilters: z.object({
        query: commonSchemas.orderFiltersSchema.optional()
    }),
    orderStatus: z.object({
        params: z.object({
            id: commonSchemas.uuidSchema
        }),
        body: commonSchemas.orderStatusSchema
    }),
    orderDispatch: z.object({
        params: z.object({
            id: commonSchemas.uuidSchema
        }),
        body: commonSchemas.orderDispatchSchema
    }),
    orderDeliver: z.object({
        params: z.object({
            id: commonSchemas.uuidSchema
        }),
        body: commonSchemas.orderDeliverSchema
    }),
    orderInvoice: z.object({
        params: z.object({
            id: commonSchemas.uuidSchema
        }),
        body: commonSchemas.orderInvoiceSchema
    }),
    invoicePayment: z.object({
        params: z.object({
            id: commonSchemas.uuidSchema
        }),
        body: commonSchemas.invoicePaymentSchema
    }),
    orderItemPick: z.object({
        params: z.object({
            id: commonSchemas.uuidSchema
        }),
        body: commonSchemas.orderItemPickSchema
    }),
    purchaseOrder: z.object({
        body: commonSchemas.purchaseOrderSchema
    }),
    purchaseOrderFilters: z.object({
        query: commonSchemas.purchaseOrderFiltersSchema.optional()
    }),
    purchaseOrderStatus: z.object({
        params: z.object({
            id: commonSchemas.uuidSchema
        }),
        body: commonSchemas.purchaseOrderStatusSchema
    }),
    reception: z.object({
        body: commonSchemas.receptionSchema
    }),
    receptionFilters: z.object({
        query: commonSchemas.receptionFiltersSchema.optional()
    }),
    approveReception: z.object({
        params: z.object({
            id: commonSchemas.uuidSchema
        }),
        body: commonSchemas.approveReceptionSchema.optional()
    }),
    supplierReturnFilters: z.object({
        query: commonSchemas.supplierReturnFiltersSchema.optional()
    }),
    supplierReturnCreate: z.object({
        body: commonSchemas.supplierReturnCreateSchema
    }),
    supplierPaymentFilters: z.object({
        query: commonSchemas.supplierPaymentFiltersSchema.optional()
    }),
    supplierPaymentCreate: z.object({
        body: commonSchemas.supplierPaymentCreateSchema
    }),
    supplierInvoiceFilters: z.object({
        query: commonSchemas.supplierInvoiceFiltersSchema.optional()
    }),
    supplierInvoiceCreate: z.object({
        body: commonSchemas.supplierInvoiceCreateSchema
    }),
    qualityCheck: z.object({
        body: commonSchemas.qualityCheckSchema
    }),
    invoiceFilters: z.object({
        query: commonSchemas.invoiceFiltersSchema.optional()
    }),
    invoiceItemsQuery: z.object({
        query: commonSchemas.invoiceItemsQuerySchema
    }),
    manualInvoice: z.object({
        body: commonSchemas.manualInvoiceSchema
    }),
    inventoryMovementFilters: z.object({
        query: commonSchemas.inventoryMovementFiltersSchema.optional()
    }),
    inventoryMovementCreate: z.object({
        body: commonSchemas.inventoryMovementCreateSchema
    }),
    batchFilters: z.object({
        query: commonSchemas.batchFiltersSchema.optional()
    }),
    batchCreate: z.object({
        body: commonSchemas.batchCreateSchema
    }),
    batchUpdate: z.object({
        params: z.object({
            id: commonSchemas.uuidSchema
        }),
        body: commonSchemas.batchUpdateSchema
    }),
    serialFilters: z.object({
        query: commonSchemas.serialFiltersSchema.optional()
    }),
    serialCreate: z.object({
        body: commonSchemas.serialCreateSchema
    }),
    serialUpdate: z.object({
        params: z.object({
            id: commonSchemas.uuidSchema
        }),
        body: commonSchemas.serialUpdateSchema
    }),
    client: z.object({
        body: commonSchemas.clientSchema
    }),
    clientUpdate: z.object({
        params: z.object({
            id: commonSchemas.uuidSchema
        }),
        body: commonSchemas.clientSchema
    }),
    supplier: z.object({
        body: commonSchemas.supplierSchema
    }),
    supplierUpdate: z.object({
        params: z.object({
            id: commonSchemas.uuidSchema
        }),
        body: commonSchemas.supplierSchema
    }),
    companySettingsUpdate: z.object({
        body: commonSchemas.companySettingsUpdateSchema
    }),
    auditLogsFilters: z.object({
        query: commonSchemas.auditLogsFiltersSchema.optional()
    }),
    transactionsFilters: z.object({
        query: commonSchemas.transactionsFiltersSchema.optional()
    }),
    cashTransaction: z.object({
        body: commonSchemas.cashTransactionSchema
    }),
    cashShiftOpen: z.object({
        params: z.object({
            id: commonSchemas.uuidSchema
        }),
        body: commonSchemas.cashShiftOpenSchema
    }),
    cashShiftClose: z.object({
        params: z.object({
            id: commonSchemas.uuidSchema
        }),
        body: commonSchemas.cashShiftCloseSchema
    }),
    shiftPayment: z.object({
        params: z.object({
            id: commonSchemas.uuidSchema
        }),
        body: commonSchemas.shiftPaymentSchema
    }),
    warrantiesFilters: z.object({
        query: commonSchemas.warrantiesFiltersSchema.optional()
    }),
    warrantyCreate: z.object({
        body: commonSchemas.warrantyCreateSchema
    }),
    warrantyStatusUpdate: z.object({
        params: z.object({
            id: commonSchemas.uuidSchema
        }),
        body: commonSchemas.warrantyStatusUpdateSchema
    }),
    clientReturnsFilters: z.object({
        query: commonSchemas.clientReturnsFiltersSchema.optional()
    }),
    clientReturnCreate: z.object({
        body: commonSchemas.clientReturnCreateSchema
    }),
    creditNotesFilters: z.object({
        query: commonSchemas.creditNotesFiltersSchema.optional()
    }),
    creditNoteCreate: z.object({
        body: commonSchemas.creditNoteCreateSchema
    })
};

export const schemas = zodSchemas;
