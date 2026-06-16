import { z } from 'zod';
import { strongPasswordSchema } from './common.js';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const userRoleSchema = z.enum(['admin', 'manager', 'cashier', 'warehouse']);
export const userStatusSchema = z.enum(['active', 'inactive']);

export const createUserSchema = z.object({
  name: z.string().min(2).max(255),
  email: z.string().email(),
  password: strongPasswordSchema,
  role: userRoleSchema,
});

export const updateUserSchema = z.object({
  name: z.string().min(2).max(255),
  email: z.string().email(),
  password: z.union([strongPasswordSchema, z.literal(''), z.null()]).optional(),
  role: userRoleSchema,
  status: userStatusSchema,
});
