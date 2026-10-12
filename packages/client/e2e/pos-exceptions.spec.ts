import { test, expect, type Page } from '@playwright/test';

// Manager review of offline POS sales that broke a rule (ADR-010/011), against a simulated API.
const PENDING = [{
  id: 41,
  type: 'price',
  order_id: '3f2b8c1e-0000-4000-8000-000000000001',
  customer_name: 'Consumidor final',
  total_amount: 968,
  user_id: 'u-cajera',
  user_name: 'Cajera QA',
  created_at: '2026-10-12T10:00:00.000Z',
  details: { source: 'offline_pos', role: 'cashier', lines: [{ product_id: 'p-1', catalog_price: 1000, unit_price: 800 }] },
  review: null,
}];

async function mockApi(page: Page, role: string) {
  const reviews: unknown[] = [];
  let pending = [...PENDING];
  await page.route('**/api/**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/session', (route) => route.fulfill({
    json: { user: { id: 'u-1', name: 'Usuario QA', email: 'qa@sports.store', role, status: 'active' } },
  }));
  await page.route('**/api/products**', (route) => route.fulfill({ json: [{ id: 'p-1', name: 'Pelota Mundial', sku: 'PEL-001', sale_price: 1000 }] }));
  await page.route('**/api/pos/exceptions?*', (route) => {
    const status = new URL(route.request().url()).searchParams.get('status');
    return route.fulfill({ json: status === 'reviewed' ? [] : pending });
  });
  await page.route('**/api/pos/exceptions/*/review', async (route) => {
    reviews.push(route.request().postDataJSON());
    pending = [];
    await route.fulfill({ json: { id: 41, decision: 'approved', notes: null } });
  });
  return reviews;
}

test.describe('Excepciones POS', () => {
  test('el gerente ve el contador en el menú, revisa la excepción y el contador desaparece', async ({ page }) => {
    const reviews = await mockApi(page, 'manager');

    await page.goto('/pos-exceptions');

    const menuItem = page.getByRole('link', { name: /Excepciones POS/ });
    await expect(menuItem).toContainText('1');
    await expect(page.getByText('Precio distinto').first()).toBeVisible();
    await expect(page.getByText(/Pelota Mundial/).first()).toBeVisible();

    await page.getByRole('button', { name: /Aprobar/ }).first().click();
    await page.getByLabel(/Notas/).fill('Liquidación autorizada');
    await page.getByRole('dialog').getByRole('button', { name: /Aprobar|Confirmar/ }).click();

    await expect(page.getByText('Excepción aprobada')).toBeVisible();
    expect(reviews).toEqual([{ decision: 'approved', notes: 'Liquidación autorizada' }]);
    await expect(page.getByText('No hay excepciones pendientes')).toBeVisible();
    await expect(menuItem).not.toContainText('1');
  });

  test('un cajero no ve el menú ni puede entrar a la pantalla', async ({ page }) => {
    await mockApi(page, 'cashier');
    await page.goto('/pos-exceptions');
    await expect(page.getByText('403')).toBeVisible();
    await expect(page.getByRole('link', { name: /Excepciones POS/ })).toHaveCount(0);
  });
});
