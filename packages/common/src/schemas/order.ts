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
]);

export const createOrderSchema = z.object({
  client_id: optionalUuidSchema,
  customer_name: z.string().nullable().optional(),
  counter_user_id: optionalUuidSchema,
  counter_name: z.string().nullable().optional(),
  total_amount: z.coerce.number().min(0).optional(),
  payment_method: orderPaymentMethodSchema.optional(),
  shipping_method: z.enum(['pickup', 'delivery']).optional(),
  shipping_address: z.string().nullable().optional(),
  estimated_delivery: isoDateSchema.nullable().optional(),
  recipient_name: z.string().nullable().optional(),
  recipient_dni: z.string().nullable().optional(),
  delivery_notes: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z.array(
    z.object({
      product_id: uuidSchema,
      quantity: z.coerce.number().int().min(1),
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
}).merge(paginationQuerySchema);

export const invoicePaymentSchema = z.object({
  payments: z.array(
    z.object({
      method: orderPaymentMethodSchema,
      amount: z.coerce.number().positive(),
    })
  ).min(1),
  notes: z.string().nullable().optional(),
});
