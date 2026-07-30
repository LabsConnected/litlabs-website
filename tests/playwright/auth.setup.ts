import { test as setup, expect } from "@playwright/test";
import { clerk, clerkSetup } from "@clerk/testing/playwright";
import path from "path";

const DEPLOYMENT_URL = process.env.SMOKE_TEST_URL || "http://localhost:3000";

const userAEmail = process.env.CLERK_TEST_USER_A_EMAIL;
const userBEmail = process.env.CLERK_TEST_USER_B_EMAIL;

const userAAuthFile = path.join(__dirname, ".clerk", "user-a.json");
const userBAuthFile = path.join(__dirname, ".clerk", "user-b.json");

setup.describe.configure({ mode: "serial" });

setup("clerk global setup", async () => {
  await clerkSetup();
});

setup("authenticate User A and save storage state", async ({ page }) => {
  expect(userAEmail, "CLERK_TEST_USER_A_EMAIL must be set").toBeDefined();

  await page.goto(DEPLOYMENT_URL);
  await clerk.signIn({ page, emailAddress: userAEmail! });

  // Verify server-side auth by hitting a protected API endpoint
  const resp = await page.context().request.get(`${DEPLOYMENT_URL}/api/studio-projects`);
  expect(resp.status(), `User A auth check: expected non-401, got ${resp.status()}`).not.toBe(401);
  console.log(`[Setup] User A authenticated: GET /api/studio-projects => ${resp.status()}`);

  await page.context().storageState({ path: userAAuthFile });
  console.log(`[Setup] User A storage state saved to ${userAAuthFile}`);
});

setup("authenticate User B and save storage state", async ({ page }) => {
  expect(userBEmail, "CLERK_TEST_USER_B_EMAIL must be set").toBeDefined();

  await page.goto(DEPLOYMENT_URL);
  await clerk.signIn({ page, emailAddress: userBEmail! });

  // Verify server-side auth by hitting a protected API endpoint
  const resp = await page.context().request.get(`${DEPLOYMENT_URL}/api/studio-projects`);
  expect(resp.status(), `User B auth check: expected non-401, got ${resp.status()}`).not.toBe(401);
  console.log(`[Setup] User B authenticated: GET /api/studio-projects => ${resp.status()}`);

  await page.context().storageState({ path: userBAuthFile });
  console.log(`[Setup] User B storage state saved to ${userBAuthFile}`);
});
