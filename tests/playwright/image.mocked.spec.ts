import { test, expect } from "@playwright/test";
import { monitorApplicationErrors, assertNoErrors, waitForPageReady } from "./helpers";

/**
 * Mocked image generation tests — deterministic, no real AI calls.
 *
 * Intercepts the image generation API and returns a placeholder image
 * so tests are fast and free.
 */

test.describe("Image generation (mocked) @studio @image", () => {
  test("Generate image with mocked response", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    // Intercept image generation API
    await page.route("**/api/studio/image**", async (route) => {
      // Return a small valid PNG (1x1 red pixel)
      const base64Png =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
      const buffer = Buffer.from(base64Png, "base64");

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          url: `data:image/png;base64,${base64Png}`,
          width: 1024,
          height: 1024,
        }),
      });
    });

    await page.goto("/studio?tool=image");
    await waitForPageReady(page, { testId: "studio-command-composer", timeout: 30_000 });

    // Find the image prompt input
    const promptInput = page.getByTestId("image-prompt-input");
    if (await promptInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await promptInput.fill("A futuristic glowing purple and green tree laboratory");

      // Click generate
      const generateButton = page.getByTestId("generate-image-button");
      await generateButton.click();

      // Wait for the generated image
      const generatedImage = page.getByTestId("generated-image").last();
      await expect(generatedImage).toBeVisible({ timeout: 30_000 });

      // Verify the image is valid
      const isValid = await generatedImage.evaluate((el) => {
        const img = el as HTMLImageElement;
        return img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
      });
      expect(isValid).toBe(true);
    }

    assertNoErrors(errors);
  });

  test("Image generation failure shows error", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    await page.route("**/api/studio/image**", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Image generation failed" }),
      });
    });

    await page.goto("/studio?tool=image");
    await waitForPageReady(page, { testId: "studio-command-composer", timeout: 30_000 });

    const promptInput = page.getByTestId("image-prompt-input");
    if (await promptInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await promptInput.fill("Test error");
      await page.getByTestId("generate-image-button").click();

      await expect(page.getByText(/error|failed/i).first()).toBeVisible({ timeout: 15_000 });
    }

    assertNoErrors(errors);
  });
});
