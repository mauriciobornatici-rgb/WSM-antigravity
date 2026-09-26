import { z } from 'zod';
import { optionalUuidSchema, isoDateSchema, uuidSchema, paginationQuerySchema } from './common.js';

export const orderPaymentMethodSchema = z.enum([
  'cash',
  'transfer',
  'credit_account',
  'card',
  'debit_card',
  'credit_card',
  'qr',
  'check',
]);

export const orderPaymentLineSchema = z.object({
  method: orderPaymentMethodSchema,
  amount: z.coerce.number().positive(),
  check: z.object({
    issuer_name: z.string().min(1).max(255),
    bank_name: z.string().min(1).max(255),
    check_number: z.string().min(1).max(100),
    issue_date: z.string().nullable().optional(),
    due_date: z.string().min(1),
    instrument_amount: z.coerce.number().positive().optional(),
  }).optional(),
}).superRefine((payment, ctx) => {
  if (payment.method === 'check' && !payment.check) {
    ctx.addIssue({ code: 'custom', message: 'Los datos del cheque son obligatorios', path: ['check'] });
  }
});

export const createOrderSchema = z.object({
  idempotency_key: uuidSchema.optional(),
  // When a POS sale captured offline is replayed: its prices are honoured (audited).
  offline_captured_at: z.iso.datetime({ offset: true }).optional(),
  client_id: optionalUuidSchema,
  customer_name: z.string().nullable().optional(),
  counter_user_id: optionalUuidSchema,
  counter_name: z.string().nullable().optional(),
  total_amount: z.coerce.number().min(0).optional(),
  payment_method: orderPaymentMethodSchema.optional(),
  payments: z.array(orderPaymentLineSchema).min(1).optional(),
  shipping_method: z.enum(['pickup', 'delivery']).optional(),
  shipping_address: z.string().nullable().optional(),
  estimated_delivery: z.union([isoDateSchema, z.iso.date()]).nullable().optional(),
  recipient_name: z.string().nullable().optional(),
  recipient_dni: z.string().nullable().optional(),
  delivery_notes: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z.array(
    z.object({
      product_id: uuidSchema,
      quantity: z.coerce.number().int().min(1),
      unit_price: z.coerce.number().min(0).optional(),
      vat_rate: z.coerce.number().min(0).max(100).optional(),
    })
  ).min(1),
});

export const orderFiltersSchema = z.object({
  client_id: optionalUuidSchema,
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
  ]).optional(),
  shipping_method: z.enum(['pickup', 'delivery']).optional(),
}).merge(paginationQuerySchema);

export const invoicePaymentSchema = z.object({
  payments: z.array(orderPaymentLineSchema).min(1),
  notes: z.string().nullable().optional(),
});

export const pickupOrderCheckoutSchema = z.object({
  recipient_name: z.string().nullable().optional(),
  recipient_dni: z.string().nullable().optional(),
  delivery_notes: z.string().nullable().optional(),
  shift_id: optionalUuidSchema,
  invoice_type: z.enum(['A', 'B', 'C', 'TK']).optional(),
  point_of_sale: z.coerce.number().int().positive().optional(),
  payments: z.array(orderPaymentLineSchema).optional(),
  extra_items: z.array(
    z.object({
      product_id: uuidSchema,
      quantity: z.coerce.number().int().min(1),
      unit_price: z.coerce.number().min(0).optional(),
    })
  ).optional(),
  notes: z.string().nullable().optional(),
});
