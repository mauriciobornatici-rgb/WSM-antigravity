import { z } from 'zod';

const visibilitySchema = z.enum(['visible', 'unlisted', 'hidden']);
const syncStatusSchema = z.enum(['local_only', 'pending', 'synced', 'conflict', 'error']);

export const onlineStoreCatalogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(200).optional(),
  visibility: visibilitySchema.optional(),
  sync_status: syncStatusSchema.optional(),
});

export const onlineStoreOrderQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(200).optional(),
  payment_status: z.string().trim().max(30).optional(),
  shipping_status: z.string().trim().max(30).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

export const onlineStoreVariantSchema = z.object({
  sku: z.string().trim().min(1).max(100),
  barcode: z.string().trim().max(100).nullable().optional(),
  size: z.string().trim().max(50).nullable().optional(),
  color: z.string().trim().max(50).nullable().optional(),
  sale_price: z.coerce.number().min(0),
  purchase_price: z.coerce.number().min(0).default(0),
  stock_initial: z.coerce.number().int().min(0).default(0),
  image_url: z.string().url().max(2048).nullable().optional(),
});

export const onlineStoreProductCreateSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(20000).nullable().optional(),
  brand: z.string().trim().max(100).nullable().optional(),
  category: z.string().trim().max(100).nullable().optional(),
  visibility: visibilitySchema.default('hidden'),
  publish: z.boolean().default(false),
  variants: z.array(onlineStoreVariantSchema).min(1).max(100),
});

export const onlineStoreProductUpdateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(20000).nullable().optional(),
  brand: z.string().trim().max(100).nullable().optional(),
  category: z.string().trim().max(100).nullable().optional(),
  visibility: visibilitySchema.optional(),
});

export const onlineStoreFulfillmentUpdateSchema = z.object({
  status: z.enum(['UNPACKED', 'PACKED', 'DISPATCHED', 'READY_FOR_PICKUP', 'DELIVERED']).optional(),
  tracking_code: z.string().trim().max(255).nullable().optional(),
  tracking_url: z.string().url().max(2048).nullable().optional(),
  notify_customer: z.boolean().default(true),
}).refine((value) => value.status || value.tracking_code !== undefined || value.tracking_url !== undefined, {
  message: 'Debe indicar estado o información de seguimiento',
});

export const onlineStoreTrackingEventSchema = z.object({
  status: z.enum([
    'dispatched', 'received_by_post_office', 'in_transit', 'out_for_delivery',
    'delivery_attempt_failed', 'delayed', 'ready_for_pickup', 'delivered',
    'returned_to_sender', 'lost', 'failure',
  ]),
  description: z.string().trim().min(1).max(500),
  address: z.string().trim().max(500).nullable().optional(),
  happened_at: z.string().datetime().optional(),
  estimated_delivery_at: z.string().datetime().nullable().optional(),
});
