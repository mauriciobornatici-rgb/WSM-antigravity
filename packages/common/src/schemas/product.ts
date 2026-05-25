import { z } from 'zod';
import { optionalUuidSchema, paginationQuerySchema } from './common.js';

export const productStatusSchema = z.enum(['active', 'inactive']);

export const createProductSchema = z.object({
  sku: z.string().min(1),
  barcode: z.string().nullable().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  image_url: z.string().max(2048).nullable().optional(),
  location: z.string().nullable().optional(),
  purchase_price: z.coerce.number().min(0).optional(),
  cost_price: z.coerce.number().min(0).optional(),
  sale_price: z.coerce.number().min(0).optional(),
  stock_initial: z.coerce.number().int().min(0).optional(),
  status: productStatusSchema.optional(),
});

export const uploadProductImageSchema = z.object({
  data_url: z.string().max(2_200_000),
});

export const productFiltersSchema = z.object({
  supplier_id: optionalUuidSchema,
}).merge(paginationQuerySchema);

export const batchCreateSchema = z.object({
  product_id: z.string().uuid(),
  batch_number: z.string().min(1).max(100),
  manufacturing_date: z.string().datetime().nullable().optional(),
  expiration_date: z.string().datetime().nullable().optional(),
  supplier_id: optionalUuidSchema,
  quantity_initial: z.coerce.number().positive(),
  location: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});
