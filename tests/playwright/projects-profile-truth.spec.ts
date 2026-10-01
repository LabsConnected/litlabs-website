import { test, expect } from "@playwright/test";

/**
 * Issue #602 — Projects / Dashboard / Profile share GET /api/studio-projects.
 * Runs in authenticated-chromium when Clerk test users exist.
 *
 * Mocks the canonical list so the three surfaces cannot drift even when
 * the test account has no coffee-cart row.
 */

const COFFEE = {
  id: "d7758a48-0479-4283-b578-d3b86c3328c4",
  name: "A simple one-page site for a neighborhood coffee cart",
  sourceType: "blank",
  githubFullName: null,
  githubBranch: null,
  workspaceStatus: "ready",
  runtimeStatus: "ready",
  updatedAt: "2026-10-01T20:00:00.000Z",
};

async function mockStudioProjects(page: import("@playwright/test").Page) {
  await page.route("**/api/studio-projects", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ projects: [COFFEE], legacyOnly: [] }),
    });
  });
}

test.describe("P0 project truth across surfaces", () => {
  test("dashboard recent projects lists the canonical studio project", async ({
    page,
  }) => {
    await mockStudioProjects(page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(COFFEE.name, { exact: false })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("No projects yet")).toHaveCount(0);
  });

  test("profile recent projects lists the same canonical studio project", async ({
    page,
  }) => {
    await mockStudioProjects(page);
    await page.goto("/profile", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(COFFEE.name, { exact: false })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("No projects yet")).toHaveCount(0);
  });

  test("projects page lists the same canonical studio project", async ({
    page,
  }) => {
    await mockStudioProjects(page);
    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(COFFEE.name, { exact: false })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("/agents does not tell a signed-in user to sign in", async ({ page }) => {
    await page.goto("/agents", { waitUntil: "domcontentloaded" });
    const note = page.getByTestId("agents-session-note");
    await expect(note).toBeVisible({ timeout: 20_000 });
    await expect(note).not.toContainText(/Sign in or create an account/i);
    await expect(note).toContainText(/signed in/i);
  });

  test("wallet starter copy is 1,500 LiTTBits", async ({ page }) => {
    await page.goto("/wallet", { waitUntil: "domcontentloaded" });
    const body = (await page.locator("body").textContent()) || "";
    expect(body).toContain("1,500 LiTTBits");
    expect(body).not.toContain("500 starter AI credits");
  });
});

test.describe("P0 nav aliases @ 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("dashboard still lists canonical projects at 390px", async ({ page }) => {
    await mockStudioProjects(page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(COFFEE.name, { exact: false })).toBeVisible({
      timeout: 20_000,
    });
  });
});
