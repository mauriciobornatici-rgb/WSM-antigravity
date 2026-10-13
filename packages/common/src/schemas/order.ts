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
  // ADR-017: the shipping of an order made here. Charged to the customer or absorbed by the
  // business. VAT 21 % unless another rate is picked for an exception.
  shipping_charge: z.object({
    amount: z.coerce.number().min(0),
    charge_customer: z.boolean(),
    vat_rate: z.coerce.number().refine((rate) => [0, 2.5, 5, 10.5, 21, 27].includes(rate), {
      message: 'Alícuota no válida (0, 2,5, 5, 10,5, 21 o 27 %)',
    }).optional(),
  }).optional(),
  items: z.array(
    z.object({
      product_id: uuidSchema,
      quantity: z.coerce.number().int().min(1),
      unit_price: z.coerce.number().min(0).optional(),
      vat_rate: z.coerce.number().min(0).max(100).optional(),
    })
  ).min(1),
});

// A POS counter checkout processed atomically (sale + invoice + cash-shift payments).
export const posCheckoutSchema = createOrderSchema
  .omit({ shipping_method: true, shipping_address: true, estimated_delivery: true, counter_user_id: true, shipping_charge: true })
  .extend({
    idempotency_key: uuidSchema,
    shift_id: uuidSchema,
    payments: z.array(orderPaymentLineSchema).min(1),
    emit_invoice: z.boolean().optional(),
    invoice_type: z.enum(['A', 'B', 'C', 'TK']).optional(),
    point_of_sale: z.coerce.number().int().positive().optional(),
  });

// Manager review of offline POS sales that broke a rule (price or stock), ADR-010.
export const posExceptionsQuerySchema = z.object({
  status: z.enum(['pending', 'reviewed']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const posExceptionReviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  notes: z.string().trim().max(500).optional(),
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

// ADR-017: change the shipping of an order made here before it is invoiced.
export const orderShippingChargeSchema = z.object({
  amount: z.coerce.number().min(0),
  charge_customer: z.boolean(),
  vat_rate: z.coerce.number().refine((rate) => [0, 2.5, 5, 10.5, 21, 27].includes(rate), {
    message: 'Alícuota no válida (0, 2,5, 5, 10,5, 21 o 27 %)',
  }).optional(),
});

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
