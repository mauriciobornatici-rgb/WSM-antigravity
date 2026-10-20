import { z } from 'zod';
import { optionalUuidSchema, paginationQuerySchema } from './common.js';

export const productStatusSchema = z.enum(['active', 'inactive']);

export const createProductSchema = z.object({
  sku: z.string().min(1),
  barcode: z.string().nullable().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  subcategory: z.string().max(100).nullable().optional(),
  category_option_id: optionalUuidSchema,
  subcategory_option_id: optionalUuidSchema,
  brand_option_id: optionalUuidSchema,
  size_option_id: optionalUuidSchema,
  color_option_id: optionalUuidSchema,
  family_name: z.string().trim().max(255).nullable().optional(),
  brand: z.string().max(100).nullable().optional(),
  size: z.string().max(100).nullable().optional(),
  color: z.string().max(100).nullable().optional(),
  image_url: z.string().max(2048).nullable().optional(),
  location: z.string().nullable().optional(),
  purchase_price: z.coerce.number().min(0).optional(),
  cost_price: z.coerce.number().min(0).optional(),
  sale_price: z.coerce.number().min(0).optional(),
  // ADR-017: the product's VAT rate (21 % unless the goods have a reduced rate). It decides the
  // final price shown and the VAT account of every sale.
  vat_rate: z.coerce.number().refine((rate) => [0, 2.5, 5, 10.5, 21, 27].includes(rate), {
    message: 'Alícuota no válida (0, 2,5, 5, 10,5, 21 o 27 %)',
  }).optional(),
  // ADR-019: units of this product kept out of the online store (when the policy is on);
  // empty uses the store-wide quantity.
  tiendanube_safety_stock: z.coerce.number().int().min(0).max(100000).nullable().optional(),
  // ADR-027 (D1): a purchase at another cost updates the product's cost, and a new cost moves the
  // sale price keeping the markup. Both on by default; turned off, the value stays as loaded.
  auto_update_cost: z.boolean().optional(),
  auto_update_price: z.boolean().optional(),
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
