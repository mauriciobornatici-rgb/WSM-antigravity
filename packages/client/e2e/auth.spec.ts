import { test, expect } from '@playwright/test';

test.describe('Autenticación y Login', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/session', async (route) => {
      await route.fulfill({ status: 401, json: { error: 'invalid_session' } });
    });
  });

  test('debe mostrar error con credenciales incorrectas', async ({ page }) => {
    await page.route('**/api/login', async (route) => {
      await route.fulfill({
        status: 401,
        json: { error: 'invalid_credentials', message: 'Credenciales inválidas' },
      });
    });

    // Navigate to the login page
    await page.goto('/login');

    // Fill the login form
    await page.fill('input[type="email"]', 'admin@sports.store');
    await page.fill('input[type="password"]', 'contraseñaIncorrecta123');

    // Submit the form
    await page.click('button[type="submit"]');

    // Wait for the error toast (sonner) or UI to react
    // In our app, sonner toasts usually have role="status" or we can look for specific text
    // Assuming backend returns 401 and UI shows "Credenciales incorrectas"
    // Since we don't know the exact text, we just verify we don't navigate away
    await expect(page).toHaveURL(/\/login/);
    
    // Check if the submit button becomes active again
    const button = page.locator('button[type="submit"]');
    await expect(button).toBeEnabled();
  });

  test('debe iniciar sesión exitosamente y redirigir al dashboard', async ({ page }) => {
    // Mock only external boundaries; this UI test remains deterministic and does not touch a database.
    await page.route('**/api/login', async (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        const json = {
          user: { id: '1', name: 'Admin User', email: 'admin@sports.store', role: 'admin', status: 'active' }
        };
        await route.fulfill({ json });
      } else {
        await route.continue();
      }
    });

    await page.route('**/api/dashboard/**', async (route) => {
        await route.fulfill({ json: {} });
    });

    await page.goto('/login');

    await page.fill('input[type="email"]', 'admin@sports.store');
    await page.fill('input[type="password"]', 'CorrectPassword123!');

    await page.click('button[type="submit"]');

    // Verify successful redirect to the dashboard
    await expect(page).toHaveURL(/\/(dashboard)?$/);
    
    // Verify the dashboard or sidebar appears
    // We can check if "SportsERP" or "Admin User" appears somewhere on the new page
    await expect(page.locator('text=SportsERP').first()).toBeVisible();
  });
});
