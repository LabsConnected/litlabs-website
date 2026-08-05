import { test, expect } from '@playwright/test';

test('signup with turnstile mock succeeds', async ({ page }) => {
  await page.goto('/signup');
  await page.fill('input[name="email"]', 'e2e+turnstile@example.com');
  await page.fill('input[name="password"]', 'P@ssword123!');
  await page.evaluate(() => {
    // @ts-ignore
    window.__TEST_TURNSTILE_TOKEN = 'test-token';
  });
  await page.click('button[type="submit"]');
  await page.waitForResponse((resp) => resp.url().endsWith('/api/auth/signup') && resp.status() === 200);
  await expect(page.locator('text=Welcome')).toHaveCount(1);
});
