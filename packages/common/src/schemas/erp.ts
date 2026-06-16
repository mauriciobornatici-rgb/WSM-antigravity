import { z } from 'zod';
import { uuidSchema, optionalUuidSchema, paginationQuerySchema } from './common.js';
import { orderPaymentMethodSchema } from './order.js';

export const shiftPaymentMethodSchema = z.enum([
  'cash',
  'debit_card',
  'credit_card',
  'card',
  'transfer',
  'qr',
  'credit_account',
  'other',
]);

// 1. Order Status and Dispatch
export const orderStatusSchema = z.object({
  status: z.enum([
    'pending',
    'picking',
    'confirmed',
    'paid',
    'packed',
    'dispatched',
    'delivered',
    'completed',
    'cancelled',
    'returned',
  ]),
});

export const orderDispatchSchema = z.object({
  shipping_method: z.enum(['pickup', 'delivery']),
  tracking_number: z.string().max(100).nullable().optional(),
  estimated_delivery: z.string().nullable().optional(), // standard string representation of date or iso date
  shipping_address: z.string().nullable().optional(),
  recipient_name: z.string().nullable().optional(),
  recipient_dni: z.string().nullable().optional(),
});

export const orderDeliverSchema = z.object({
  recipient_name: z.string().min(1),
  recipient_dni: z.string().min(1),
  delivery_notes: z.string().nullable().optional(),
});

export const orderInvoiceSchema = z.object({
  invoice_type: z.enum(['A', 'B', 'C', 'TK']).optional(),
  point_of_sale: z.coerce.number().int().min(1).optional(),
  payments: z.array(
    z.object({
      method: orderPaymentMethodSchema,
      amount: z.coerce.number().positive(),
    })
  ).min(1).optional(),
  notes: z.string().nullable().optional(),
});

export const orderItemPickSchema = z.object({
  picked_quantity: z.coerce.number().int().min(0),
});

// 2. Purchase Orders & Procurement
export const purchaseOrderItemSchema = z.object({
  product_id: uuidSchema,
  quantity_ordered: z.coerce.number().int().min(1).optional(),
  quantity: z.coerce.number().int().min(1).optional(),
  unit_cost: z.coerce.number().min(0),
}).refine(data => (data.quantity_ordered !== undefined) !== (data.quantity !== undefined), {
  message: "Debe proveer quantity_ordered o quantity, pero no ambos.",
  path: ["quantity_ordered"]
});

export const purchaseOrderSchema = z.object({
  supplier_id: uuidSchema,
  order_date: z.string().min(1),
  expected_delivery_date: z.string().nullable().optional(),
  items: z.array(purchaseOrderItemSchema).min(1),
  notes: z.string().nullable().optional(),
});

export const purchaseOrderStatusSchema = z.object({
  status: z.enum(['draft', 'sent', 'partial', 'received', 'cancelled']),
});

export const purchaseOrderFiltersSchema = z.object({
  supplier_id: optionalUuidSchema,
  status: z.enum(['draft', 'sent', 'partial', 'received', 'cancelled']).optional(),
});

// 3. Receptions
export const receptionItemSchema = z.object({
  product_id: uuidSchema,
  po_item_id: optionalUuidSchema,
  quantity_expected: z.coerce.number().int().min(0).optional(),
  quantity_received: z.coerce.number().int().min(0),
  unit_cost: z.coerce.number().min(0).optional(),
  location_assigned: z.string().nullable().optional(),
  batch_number: z.string().nullable().optional(),
  expiration_date: z.string().nullable().optional(),
  status: z.enum(['approved', 'rejected']).optional(),
  notes: z.string().nullable().optional(),
});

export const receptionSchema = z.object({
  purchase_order_id: optionalUuidSchema,
  supplier_id: uuidSchema,
  remito_number: z.string().nullable().optional(),
  items: z.array(receptionItemSchema).min(1),
  notes: z.string().nullable().optional(),
});

export const receptionFiltersSchema = z.object({
  supplier_id: optionalUuidSchema,
  status: z.enum(['pending_qc', 'approved', 'partially_approved', 'rejected']).optional(),
});

export const approveReceptionSchema = z.object({
  approved_by: optionalUuidSchema,
});

// 4. Supplier Returns & Payments & Invoices
export const supplierReturnFiltersSchema = z.object({
  supplier_id: optionalUuidSchema,
  status: z.enum(['draft', 'approved', 'rejected', 'cancelled']).optional(),
});

export const supplierReturnCreateSchema = z.object({
  supplier_id: uuidSchema,
  notes: z.string().nullable().optional(),
  items: z.array(
    z.object({
      product_id: uuidSchema,
      quantity: z.coerce.number().positive(),
      unit_cost: z.coerce.number().min(0).optional(),
      reason: z.string().nullable().optional(),
    })
  ).min(1),
});

export const supplierPaymentFiltersSchema = z.object({
  supplier_id: optionalUuidSchema,
});

export const supplierPaymentCreateSchema = z.object({
  supplier_id: uuidSchema,
  payment_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  payments: z.array(
    z.object({
      amount: z.coerce.number().positive(),
      payment_method: z.string().min(1).max(100).optional(),
      reference_number: z.string().nullable().optional(),
    })
  ).min(1),
});

export const supplierInvoiceFiltersSchema = z.object({
  supplier_id: optionalUuidSchema,
  status: z.enum(['approved', 'cancelled']).optional(),
});

export const supplierInvoiceCreateSchema = z.object({
  invoice_number: z.string().min(2).max(100),
  invoice_type: z.enum(['A', 'B', 'C', 'M']),
  supplier_id: uuidSchema,
  reception_id: optionalUuidSchema,
  purchase_order_id: optionalUuidSchema,
  issue_date: z.string().min(1),
  due_date: z.string().nullable().optional(),
  net_amount: z.coerce.number().min(0),
  vat_amount: z.coerce.number().min(0),
  other_taxes: z.coerce.number().min(0).optional(),
  total_amount: z.coerce.number().min(0).optional(),
  notes: z.string().nullable().optional(),
});

// 5. Quality QC
export const qualityCheckSchema = z.object({
  reception_id: uuidSchema,
  product_id: uuidSchema,
  inspector_id: optionalUuidSchema,
  result: z.enum(['pass', 'fail', 'conditional']),
  quantity_checked: z.coerce.number().int().min(0),
  quantity_passed: z.coerce.number().int().min(0),
  quantity_failed: z.coerce.number().int().min(0),
  defect_description: z.string().nullable().optional(),
  action_taken: z.enum(['approve', 'reject', 'return_to_supplier', 'discount']).optional(),
  notes: z.string().nullable().optional(),
});

// 6. Invoices (Customer)
export const invoiceFiltersSchema = z.object({
  client_id: optionalUuidSchema,
  status: z.enum(['issued', 'authorized', 'cancelled']).optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

export const invoiceItemsQuerySchema = z.object({
  invoice_id: uuidSchema,
});

export const manualInvoiceItemSchema = z.object({
  product_id: optionalUuidSchema,
  description: z.string().nullable().optional(),
  product_name: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
  quantity: z.coerce.number().positive(),
  unit_price: z.coerce.number().min(0),
  discount_percentage: z.coerce.number().min(0).max(100).optional(),
  discount: z.coerce.number().min(0).max(100).optional(),
  vat_rate: z.coerce.number().min(0).max(100).optional(),
});

export const manualInvoiceSchema = z.object({
  client_id: optionalUuidSchema,
  customer_name: z.string().nullable().optional(),
  invoice_type: z.enum(['A', 'B', 'C', 'TK']).optional(),
  point_of_sale: z.coerce.number().int().min(1).optional(),
  order_id: optionalUuidSchema,
  notes: z.string().nullable().optional(),
  payment_method: orderPaymentMethodSchema.optional(),
  items: z.array(manualInvoiceItemSchema).min(1),
}).refine(data => data.items.every(item => item.description || item.product_name || item.product_id), {
  message: "Debe ingresar descripción, product_name o product_id en cada ítem",
  path: ["items"],
});

// 7. Inventory Movements & Batches & Serials
export const inventoryMovementFiltersSchema = z.object({
  product_id: optionalUuidSchema,
  type: z.string().max(50).optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const inventoryMovementCreateSchema = z.object({
  type: z.string().max(50),
  product_id: uuidSchema,
  from_location: z.string().nullable().optional(),
  to_location: z.string().nullable().optional(),
  quantity: z.coerce.number().positive(),
  unit_cost: z.coerce.number().min(0).optional(),
  reason: z.string().nullable().optional(),
  reference_type: z.string().nullable().optional(),
  reference_id: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  performed_by: optionalUuidSchema,
});

export const batchFiltersSchema = z.object({
  product_id: optionalUuidSchema,
  status: z.string().max(50).optional(),
});

export const batchUpdateSchema = z.object({
  quantity_current: z.coerce.number().min(0),
  status: z.string().max(50).optional(),
});

export const serialFiltersSchema = z.object({
  product_id: optionalUuidSchema,
  status: z.string().max(50).optional(),
});

export const serialCreateSchema = z.object({
  product_id: uuidSchema,
  serial_number: z.string().min(1).max(255),
  batch_id: optionalUuidSchema,
  location: z.string().nullable().optional(),
  warranty_months: z.coerce.number().int().min(0).optional(),
});

export const serialUpdateSchema = z.object({
  status: z.string().max(50).optional(),
  sold_to_client_id: optionalUuidSchema,
  sold_in_order_id: optionalUuidSchema,
  location: z.string().nullable().optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: "Debe actualizar al menos un campo",
});

// 8. Clients
export const clientSchema = z.object({
  name: z.string().min(2).max(255),
  email: z.string().email().nullable().or(z.literal('')).optional(),
  phone: z.string().nullable().optional(),
  tax_id: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  credit_limit: z.coerce.number().min(0).optional(),
});

// 9. Suppliers
export const supplierSchema = z.object({
  name: z.string().min(2).max(255),
  contact_name: z.string().nullable().optional(),
  email: z.string().email().nullable().or(z.literal('')).optional(),
  phone: z.string().nullable().optional(),
  tax_id: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  account_balance: z.coerce.number().optional(),
});

// 10. Settings
export const companySettingsUpdateSchema = z.object({
  identity: z.object({
    brand_name: z.string().nullable().optional(),
    legal_name: z.string().nullable().optional(),
    tax_id: z.string().nullable().optional(),
    logo_url: z.string().nullable().optional(),
  }).optional(),
  contact: z.object({
    phone: z.string().nullable().optional(),
    email: z.string().email().nullable().or(z.literal('')).optional(),
    website: z.string().nullable().optional(),
  }).optional(),
  address: z.object({
    street: z.string().nullable().optional(),
    number: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    zip: z.string().nullable().optional(),
  }).optional(),
  socials: z.object({
    instagram: z.string().nullable().optional(),
    facebook: z.string().nullable().optional(),
    linkedin: z.string().nullable().optional(),
  }).optional(),
  operation: z.object({
    tax_rate: z.coerce.number().min(0).max(100).optional(),
    default_currency: z.string().length(3).optional(),
  }).optional(),
  billing: z.object({
    iibb: z.string().nullable().optional(),
    start_date: z.string().nullable().optional(),
    iva_condition: z.string().nullable().optional(),
    pos: z.coerce.number().int().min(1).max(99999).nullable().optional(),
    afip_crt: z.string().nullable().optional(),
    afip_key: z.string().nullable().optional(),
    afip_env: z.string().nullable().optional(),
  }).optional(),
  integrations: z.object({
    tiendanube_access_token: z.string().nullable().optional(),
    tiendanube_store_id: z.string().nullable().optional(),
    tiendanube_client_id: z.string().nullable().optional(),
    tiendanube_client_secret: z.string().nullable().optional(),
  }).optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: "Debe actualizar al menos un campo",
});

// 11. Audit logs & Transactions
export const auditLogsFiltersSchema = z.object({
  entity_type: z.string().max(100).optional(),
  entity_id: z.string().max(100).optional(),
}).merge(paginationQuerySchema);

export const transactionsFiltersSchema = z.object({
  supplier_id: optionalUuidSchema,
  client_id: optionalUuidSchema,
  type: z.string().max(50).optional(),
  start_date: z.string().max(50).optional(),
  end_date: z.string().max(50).optional(),
});

// 12. Cash Management
export const cashTransactionSchema = z.object({
  register_id: uuidSchema,
  type: z.enum(['income', 'expense']),
  amount: z.coerce.number().positive(),
  reason: z.string().min(1),
  notes: z.string().nullable().optional(),
});

export const cashShiftOpenSchema = z.object({
  opening_balance: z.coerce.number().min(0),
  opened_by: optionalUuidSchema,
});

export const cashShiftCloseSchema = z.object({
  actual_balance: z.coerce.number().min(0),
  notes: z.string().nullable().optional(),
  closed_by: optionalUuidSchema,
});

export const shiftPaymentSchema = z.object({
  order_id: optionalUuidSchema,
  payment_method: shiftPaymentMethodSchema.optional(),
  amount: z.coerce.number().positive(),
  type: z.enum(['sale', 'income', 'refund', 'expense']).optional(),
});

// 13. Warranties
export const warrantiesFiltersSchema = z.object({
  client_id: optionalUuidSchema,
  status: z.string().max(50).optional(),
});

export const warrantyCreateSchema = z.object({
  client_id: optionalUuidSchema,
  customer_name: z.string().nullable().optional(),
  product_id: uuidSchema,
  serial_number: z.string().nullable().optional(),
  issue_description: z.string().min(1),
});

export const warrantyStatusUpdateSchema = z.object({
  status: z.enum([
    'initiated',
    'received',
    'in_progress',
    'resolved',
    'rejected',
    'closed',
    'sent_to_supplier',
    'supplier_approved',
    'supplier_rejected',
  ]),
  resolution_type: z.enum(['repaired', 'replaced', 'refunded']).nullable().optional(),
  resolution_notes: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

// 14. Returns
export const clientReturnsFiltersSchema = z.object({
  client_id: optionalUuidSchema,
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
});

export const clientReturnCreateSchema = z.object({
  client_id: optionalUuidSchema,
  customer_name: z.string().nullable().optional(),
  order_id: optionalUuidSchema,
  reason: z.string().nullable().optional(),
  items: z.array(
    z.object({
      product_id: uuidSchema,
      quantity: z.coerce.number().int().min(1),
      condition_status: z.enum(['sellable', 'damaged', 'used', 'open_box', 'other']).optional(),
      unit_price: z.coerce.number().min(0).optional(),
    })
  ).min(1).optional(),
});

export const creditNotesFiltersSchema = z.object({
  client_id: optionalUuidSchema,
});

export const creditNoteCreateSchema = z.object({
  client_id: uuidSchema,
  amount: z.coerce.number().positive(),
  reason: z.string().nullable().optional(),
  reference_type: z.enum(['return', 'warranty', 'discount', 'other', 'manual']).nullable().optional(),
  reference_id: optionalUuidSchema,
  notes: z.string().nullable().optional(),
});
