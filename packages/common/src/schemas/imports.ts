import { z } from 'zod';

/**
 * Spreadsheet imports of products, clients and suppliers. The screen reads the file, maps its
 * headers to these column keys and sends plain rows; the server validates every row with the
 * same rules as the manual forms. The columns live here so the template the screen offers and
 * what the server accepts can never drift apart.
 */
export const IMPORT_ENTITIES = ['products', 'clients', 'suppliers'] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

// One file at most (a bigger catalog goes in several files).
export const IMPORT_MAX_ROWS = 5000;
// Rows saved per request: each request is short (it fits serverless time limits) and a failure
// only rolls back its own batch.
export const IMPORT_BATCH_ROWS = 50;

export interface ImportColumn {
  key: string;
  header: string;
  required?: boolean;
  // Kept as text in the template (codes and CUITs: Excel would drop leading zeros).
  text?: boolean;
  hint: string;
  example: string | number;
  // Other headers people write for the same column (compared without accents or case).
  aliases?: readonly string[];
}

export const IMPORT_COLUMNS: Readonly<Record<ImportEntity, readonly ImportColumn[]>> = {
  products: [
    { key: 'sku', header: 'SKU', required: true, text: true, hint: 'Código interno, único por producto (cada talle o color es un producto).', example: 'REM-DRY-M-AZ', aliases: ['codigo', 'código', 'codigo interno', 'cod'] },
    { key: 'name', header: 'Nombre', required: true, hint: 'Nombre del producto.', example: 'Remera Dry Fit', aliases: ['producto', 'descripcion corta', 'articulo', 'artículo'] },
    { key: 'barcode', header: 'Código de barras', text: true, hint: 'Opcional. Si empieza con 0, cargalo como texto.', example: '7790001234567', aliases: ['codigo de barras', 'ean', 'barcode'] },
    { key: 'family', header: 'Familia', hint: 'Opcional. Agrupa los talles y colores de un mismo artículo; si queda vacío y hay talle o color, se usa el nombre.', example: 'Remera Dry Fit', aliases: ['grupo de talles', 'articulo base'] },
    { key: 'category', header: 'Categoría', hint: 'Opcional. Si no existe, se crea.', example: 'Indumentaria', aliases: ['categoria', 'rubro', 'grupo'] },
    { key: 'subcategory', header: 'Subcategoría', hint: 'Opcional. Necesita la categoría; si no existe, se crea dentro de ella.', example: 'Remeras', aliases: ['subcategoria', 'subrubro', 'subgrupo'] },
    { key: 'brand', header: 'Marca', hint: 'Opcional. Si no existe, se crea.', example: 'Deportiva', aliases: ['marca'] },
    { key: 'size', header: 'Talle', hint: 'Opcional. Si no existe, se crea.', example: 'M', aliases: ['talla', 'medida'] },
    { key: 'color', header: 'Color', hint: 'Opcional. Si no existe, se crea.', example: 'Azul' },
    { key: 'vat_rate', header: 'Alícuota IVA', hint: '21 si queda vacío. Valores: 0, 2,5, 5, 10,5, 21 o 27.', example: 21, aliases: ['alicuota', 'alicuota iva', 'iva', 'iva %'] },
    { key: 'cost', header: 'Costo neto (sin IVA)', hint: 'Precio de compra sin IVA. Obligatorio si cargás stock inicial.', example: 5000, aliases: ['costo', 'costo neto', 'precio de compra', 'precio compra'] },
    { key: 'sale_price', header: 'Precio de venta final (con IVA)', required: true, hint: 'El precio que ve el cliente, con IVA incluido.', example: 12100, aliases: ['precio', 'precio de venta', 'precio venta', 'precio final', 'pvp'] },
    { key: 'stock', header: 'Stock inicial', hint: 'Solo para productos nuevos (necesita el costo). El de un producto existente no se cambia: se ajusta con un conteo.', example: 10, aliases: ['stock', 'cantidad', 'existencia'] },
    { key: 'location', header: 'Ubicación', hint: 'Opcional. Código de una ubicación cargada (por ejemplo DEP-A1). Vacío: General.', example: 'DEP-A1', aliases: ['ubicacion', 'deposito', 'depósito'] },
    { key: 'stock_min', header: 'Stock mínimo', hint: 'Opcional. Para el aviso de reposición.', example: 2, aliases: ['minimo', 'mínimo', 'stock minimo'] },
    { key: 'supplier', header: 'Proveedor', hint: 'Opcional. CUIT o nombre exacto de un proveedor cargado.', example: '30-71234567-4', aliases: ['proveedor cuit'] },
    { key: 'description', header: 'Descripción', hint: 'Opcional.', example: 'Remera de secado rápido', aliases: ['descripcion', 'detalle'] },
  ],
  clients: [
    { key: 'name', header: 'Nombre o razón social', required: true, hint: 'Nombre del cliente.', example: 'Club Atlético Ejemplo', aliases: ['nombre', 'razon social', 'cliente'] },
    { key: 'tax_id', header: 'CUIT / DNI', text: true, hint: 'Opcional, salvo para Responsable Inscripto (CUIT de 11 dígitos). Con o sin guiones.', example: '30-71234567-4', aliases: ['cuit', 'dni', 'cuit/dni', 'documento'] },
    { key: 'tax_condition', header: 'Condición IVA', hint: 'Consumidor Final, Responsable Inscripto, Monotributista o Exento. Vacío: sin especificar.', example: 'Responsable Inscripto', aliases: ['condicion iva', 'condicion', 'iva'] },
    { key: 'email', header: 'Correo electrónico', hint: 'Opcional.', example: 'administracion@ejemplo.com', aliases: ['correo', 'email', 'mail', 'e-mail', 'correo electronico'] },
    { key: 'phone', header: 'Teléfono', text: true, hint: 'Opcional.', example: '11 4567-8900', aliases: ['telefono', 'tel', 'celular'] },
    { key: 'address', header: 'Dirección', hint: 'Opcional.', example: 'Av. Siempre Viva 742, Córdoba', aliases: ['direccion', 'domicilio'] },
    { key: 'credit_limit', header: 'Límite de crédito', hint: 'Opcional. Para ventas a cuenta corriente; vacío: 0.', example: 500000, aliases: ['limite de credito', 'limite', 'credito'] },
  ],
  suppliers: [
    { key: 'name', header: 'Razón social', required: true, hint: 'Nombre del proveedor.', example: 'Distribuidora Ejemplo SA', aliases: ['nombre', 'razon social', 'proveedor'] },
    { key: 'tax_id', header: 'CUIT', text: true, hint: 'Opcional. Con o sin guiones.', example: '30-71234567-4', aliases: ['cuit', 'cuit/dni', 'documento'] },
    { key: 'contact_name', header: 'Contacto', hint: 'Opcional. Persona de contacto.', example: 'Laura Pérez', aliases: ['persona de contacto', 'vendedor'] },
    { key: 'email', header: 'Correo electrónico', hint: 'Opcional.', example: 'ventas@ejemplo.com', aliases: ['correo', 'email', 'mail', 'e-mail', 'correo electronico'] },
    { key: 'phone', header: 'Teléfono', text: true, hint: 'Opcional.', example: '351 456-7890', aliases: ['telefono', 'tel', 'celular'] },
    { key: 'address', header: 'Dirección', hint: 'Opcional.', example: 'Ruta 9 km 5, Córdoba', aliases: ['direccion', 'domicilio'] },
    { key: 'category', header: 'Categoría', hint: 'Opcional. Qué le comprás (indumentaria, calzado, fletes...).', example: 'Indumentaria', aliases: ['categoria', 'rubro'] },
  ],
};

// A cell as the screen sends it: text, number or empty. The server parses and validates it.
const importCellSchema = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);

const importRowSchema = z
  .object({ row: z.number().int().min(1).max(1_000_000) })
  .catchall(importCellSchema)
  .refine((row) => Object.keys(row).length <= 40, { message: 'Demasiadas columnas en una fila' });

export const importEntityParamSchema = z.object({ entity: z.enum(IMPORT_ENTITIES) });

export const importPreviewSchema = z.object({
  rows: z.array(importRowSchema).min(1).max(IMPORT_MAX_ROWS),
  // What to do with a product, client or supplier that already exists: skip it or update it
  // with the non-empty cells of the file.
  update_existing: z.boolean().optional().default(false),
});

export const importCommitSchema = z.object({
  rows: z.array(importRowSchema).min(1).max(IMPORT_BATCH_ROWS),
  update_existing: z.boolean().optional().default(false),
  // The same id for every batch of one file: the audit and the opening-stock entries name it.
  batch_id: z.string().uuid(),
});

export type ImportRowAction = 'create' | 'update' | 'skip' | 'error';

export interface ImportRowResult {
  row: number;
  action: ImportRowAction;
  key: string;
  errors: string[];
  warnings: string[];
  // Products: the numbers as they were read, so a price a thousand times off is seen before saving.
  values?: { sale_price: number | null; cost: number | null; stock: number | null };
}

export interface ImportSummary {
  create: number;
  update: number;
  skip: number;
  error: number;
}

export interface ImportResponse {
  summary: ImportSummary;
  rows: ImportRowResult[];
}
