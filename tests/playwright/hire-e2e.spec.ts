import { test, expect } from "@playwright/test";

/**
 * End-to-end test: /hire form → API → Supabase
 *
 * Fills out the actual form on /hire, submits it, then verifies
 * the row exists in Supabase via the service-role REST API.
 */

const SUPABASE_URL = "https://rokbfvuoqildggnhappy.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

test("Hire form creates verified row in Supabase", async ({ page }) => {
  // Skip if no service key
  test.skip(!SERVICE_KEY, "SUPABASE_SERVICE_ROLE_KEY not set");

  const testEmail = `e2e-hire-test-${Date.now()}@litlabs.net`;

  // 1. Go to /hire
  await page.goto("https://litlabs.net/hire", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  // 2. Scroll to the inquiry form
  await page.locator("#inquiry").scrollIntoViewIfNeeded();

  // 3. Fill out the form
  await page.locator('input[placeholder="Your name"]').fill("E2E Hire Test");
  await page.locator('input[placeholder="Email address"]').fill(testEmail);
  await page.locator('input[placeholder="Phone (optional)"]').fill("+16165550199");
  await page.locator('input[placeholder="Company (optional)"]').fill("E2E Test Co");
  await page.locator("select").selectOption("launch_sprint");
  await page.locator('textarea[placeholder="Tell us about your project..."]').fill(
    "End-to-end test from /hire form — safe to delete.",
  );

  // 4. Submit
  await page.getByRole("button", { name: /send inquiry/i }).click();

  // 5. Wait for success state
  await expect(page.locator("text=Thanks — we'll be in touch")).toBeVisible({ timeout: 15000 });

  // 6. Wait a moment for Supabase to commit
  await page.waitForTimeout(2000);

  // 7. Verify the row in Supabase via REST API
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };

  const resp = await page.request.get(
    `${SUPABASE_URL}/rest/v1/service_inquiries?select=*&email=eq.${encodeURIComponent(testEmail)}`,
    { headers },
  );

  expect(resp.status()).toBe(200);
  const rows = await resp.json();
  expect(rows.length).toBe(1);

  const row = rows[0];
  console.log("Verified row:", JSON.stringify(row, null, 2));

  // Verify all fields
  expect(row.name).toBe("E2E Hire Test");
  expect(row.email).toBe(testEmail);
  expect(row.phone).toBe("+16165550199");
  expect(row.company).toBe("E2E Test Co");
  expect(row.service_id).toBe("launch_sprint");
  expect(row.service_name).toBe("LiTTree Launch Sprint");
  expect(row.status).toBe("new");
  expect(row.source).toBe("hire_page");
  expect(row.created_at).toBeTruthy();
  expect(row.updated_at).toBeTruthy();

  // 8. Cleanup — delete the test row
  const deleteResp = await page.request.delete(
    `${SUPABASE_URL}/rest/v1/service_inquiries?email=eq.${encodeURIComponent(testEmail)}`,
    { headers },
  );
  expect(deleteResp.status()).toBe(204);
  console.log("Test row deleted successfully");
});
