import { test, expect } from '@playwright/test';

test('signup rate limit triggers 429 after multiple attempts', async ({ request }) => {
  const url = 'http://localhost:3000/api/auth/signup';
  for (let i = 0; i < 6; i++) {
    const res = await request.post(url, {
      data: { email: `rltest${i}@example.com`, password: 'pass', turnstileToken: 'test' },
    });
    if (i < 5) expect(res.status()).toBeGreaterThanOrEqual(200);
    else expect(res.status()).toBe(429);
  }
});
