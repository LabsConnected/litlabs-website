import { test, expect } from '@playwright/test';

test('provider execute preflight and execute', async ({ request }) => {
  const estimateRes = await request.post('http://localhost:3000/api/provider-calls/estimate', {
    data: { inputSize: 1000, provider: 'gemini' },
  });
  expect([200, 400, 422]).toContain(estimateRes.status());

  const execRes = await request.post('http://localhost:3000/api/provider-calls/execute', {
    data: { input: 'test', confirm: true },
  });
  expect(execRes.status()).toBe(200);
});
