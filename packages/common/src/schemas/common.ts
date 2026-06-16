import { z } from 'zod';

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export const uuidSchema = z.string().regex(uuidRegex, "Invalid UUID");
export const optionalUuidSchema = z.string().regex(uuidRegex, "Invalid UUID").optional().nullable();

export const isoDateSchema = z.string().datetime();
export const optionalIsoDateSchema = z.string().datetime().optional().nullable();

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const getPasswordPolicyMessage = () =>
  'La contraseña debe tener entre 8 y 50 caracteres, e incluir al menos una letra mayúscula, una minúscula, un número y un carácter especial (!@#$%^&*)';

export const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])[A-Za-z\d!@#$%^&*]{8,50}$/;

export const strongPasswordSchema = z
  .string()
  .min(8, getPasswordPolicyMessage())
  .max(50, getPasswordPolicyMessage())
  .regex(strongPasswordRegex, getPasswordPolicyMessage());

export const emptyQuerySchema = z.object({}).strict();
