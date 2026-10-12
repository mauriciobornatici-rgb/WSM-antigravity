import { test, expect, type Page, type Request } from '@playwright/test';

// The POS UI against a simulated API: proves the browser side of the atomic checkout
// (one call, idempotency key, shift, catalog prices) without touching a database.
const PRODUCT = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  sku: 'PEL-001',
  name: 'Pelota Mundial',
  description: '',
  category: 'Fútbol',
  sale_price: 1000,
  purchase_price: 600,
  vat_rate: 21,
  stock_current: 5,
  status: 'active',
  created_at: '2026-10-01T10:00:00.000Z',
};
const SHIFT_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

type ApiLog = { checkout: Request[]; legacy: Request[] };

async function mockPosApi(page: Page, checkoutResponse: { status: number; json: unknown }): Promise<ApiLog> {
  const log: ApiLog = { checkout: [], legacy: [] };

  // Fallback first: Playwright gives precedence to routes registered later.
  await page.route('**/api/**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/session', (route) => route.fulfill({
    json: { user: { id: 'u-1', name: 'Cajera QA', email: 'caja@sports.store', role: 'cashier', status: 'active' } },
  }));
  await page.route('**/api/products**', (route) => route.fulfill({ json: [PRODUCT] }));
  await page.route('**/api/cash-registers', (route) => route.fulfill({
    json: [{ id: 'reg-1', name: 'Caja 1', status: 'open', current_shift_id: SHIFT_ID }],
  }));
  await page.route('**/api/cash-registers/reg-1/shift', (route) => route.fulfill({
    json: { id: SHIFT_ID, cash_register_id: 'reg-1', status: 'open', opening_balance: 1000, expected_balance: 1000, opened_at: '2026-10-12T09:00:00.000Z' },
  }));
  await page.route('**/api/pos/checkout', async (route) => {
    log.checkout.push(route.request());
    await route.fulfill(checkoutResponse);
  });
  // The pre-atomic flow made these calls: none of them may happen any more.
  for (const legacy of ['**/api/orders', '**/api/invoices', '**/api/cash-shifts/*/payments']) {
    await page.route(legacy, async (route) => {
      if (route.request().method() === 'POST') log.legacy.push(route.request());
      await route.fulfill({ json: [] });
    });
  }
  return log;
}

async function sellOnePelota(page: Page) {
  await page.goto('/pos');
  await page.getByPlaceholder('Buscar por nombre, SKU, codigo, marca, talle o color').fill('Pelota');
  await page.getByText('Pelota Mundial').first().click();
  await page.getByRole('button', { name: /Cobrar/ }).click();
  await page.getByRole('button', { name: 'Confirmar Cobro' }).click();
}

test.describe('POS — checkout atómico', () => {
  test('una venta hace una sola llamada al checkout con clave idempotente, turno y precio de catálogo', async ({ page }) => {
    const log = await mockPosApi(page, {
      status: 200,
      json: { order_id: 'o-1', total_amount: 1210, invoice: null, shift_id: SHIFT_ID, expected_balance: 2210, idempotent_replay: false },
    });

    await sellOnePelota(page);

    await expect(page.getByRole('dialog', { name: 'Venta Registrada con Éxito' })).toBeVisible();
    await expect(page.getByText('Venta registrada con éxito', { exact: true })).toBeVisible();
    expect(log.checkout).toHaveLength(1);
    expect(log.legacy).toHaveLength(0);

    const body = log.checkout[0].postDataJSON();
    expect(body.idempotency_key).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.shift_id).toBe(SHIFT_ID);
    // Net catalog price; VAT is the server's job (ADR-008), so the client sends none.
    expect(body.items).toEqual([{ product_id: PRODUCT.id, quantity: 1, unit_price: 1000 }]);
    expect(body.payments).toEqual([{ method: 'cash', amount: 1210 }]);
  });

  test('si el servidor rechaza el precio, el cajero ve el motivo y el carrito se restaura', async ({ page }) => {
    const log = await mockPosApi(page, {
      status: 409,
      json: {
        status: 'fail',
        error: 'PRICE_OVERRIDE_NOT_ALLOWED',
        message: 'El precio de Pelota Mundial no coincide con el catálogo ($1100). Actualizá los precios en pantalla; cambiar precios requiere autorización.',
      },
    });

    await sellOnePelota(page);

    await expect(page.getByText(/no coincide con el catálogo/).first()).toBeVisible();
    expect(log.checkout).toHaveLength(1);
    // Nothing was charged: the cart is restored and the payment dialog reopens, ready to retry.
    await expect(page.getByRole('button', { name: 'Confirmar Cobro' })).toBeEnabled();
    await expect(page.getByRole('dialog', { name: 'Venta Registrada con Éxito' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('button', { name: /Cobrar/ })).toBeEnabled();
  });
});
