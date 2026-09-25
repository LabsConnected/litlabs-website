import { expect, test } from "@playwright/test";

test.describe("LiTT website smoke test", () => {
  test("loads the website and exposes the primary UI", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page).toHaveTitle(/LITT|LiTTree|LitLabs/i);
    await expect(page.locator("h1")).toContainText("LiTT builds the rest");
    await expect(
      page.getByRole("link", { name: /start building free/i }).first(),
    ).toBeVisible();
  });

  test("primary navigation is interactive", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const watchWork = page.getByRole("link", { name: /watch litt work/i });
    await expect(watchWork).toBeVisible();
    await watchWork.click();
    await expect(page.locator("#how-it-works")).toBeInViewport();
  });
});
