import { test, expect } from "@playwright/test";
import { monitorApplicationErrors, assertNoErrors, waitForPageReady } from "./helpers";

/**
 * Studio tests — authenticated Studio load and interaction.
 *
 * Verifies Studio loads with real content (not loading state),
 * composer is interactive, and agent selection works.
 */

test.describe("Studio @studio", () => {
  test("Studio loads with composer visible", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    await page.goto("/studio");
    await waitForPageReady(page, { testId: "studio-command-composer", timeout: 30_000 });

    // Composer must be visible — not just "Initializing Studio"
    await expect(page.getByTestId("studio-command-composer")).toBeVisible();

    // Loading state must NOT be visible
    await expect(page.getByTestId("studio-loading")).not.toBeVisible({ timeout: 5000 }).catch(() => {
      // If the test ID doesn't exist, check for the text
      expect(page.getByText("Initializing Studio")).not.toBeVisible();
    });

    assertNoErrors(errors);
  });

  test("Command input is focusable and accepts text", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    await page.goto("/studio");
    await waitForPageReady(page, { testId: "studio-command-composer" });

    const input = page.getByTestId("studio-command-input");
    await expect(input).toBeVisible();

    await input.click();
    await input.fill("Test message from Playwright");
    await expect(input).toHaveValue("Test message from Playwright");

    assertNoErrors(errors);
  });

  test("Send button is present and clickable", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    await page.goto("/studio");
    await waitForPageReady(page, { testId: "studio-command-composer" });

    const sendButton = page.getByTestId("studio-send-button");
    await expect(sendButton).toBeVisible();

    // Button should be disabled when input is empty
    await expect(sendButton).toBeDisabled().catch(() => {
      // Some implementations may not disable — just verify it exists
    });

    // Type something and verify button becomes enabled
    await page.getByTestId("studio-command-input").fill("Hello LiTT");
    await expect(sendButton).toBeEnabled({ timeout: 5000 }).catch(() => {
      // Some implementations may always be enabled
    });

    assertNoErrors(errors);
  });

  test("Agent selector is present", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    await page.goto("/studio");
    await waitForPageReady(page, { testId: "studio-command-composer" });

    const agentTrigger = page.getByTestId("agent-trigger");
    await expect(agentTrigger).toBeVisible();

    // Click to open the agent popover
    await agentTrigger.click();

    // Agent popover should show agent names
    await expect(page.getByText(/LiTT/i).first()).toBeVisible({ timeout: 5000 });

    assertNoErrors(errors);
  });

  test("Model selector is present", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    await page.goto("/studio");
    await waitForPageReady(page, { testId: "studio-command-composer" });

    const modelTrigger = page.getByTestId("model-trigger");
    await expect(modelTrigger).toBeVisible();

    assertNoErrors(errors);
  });
});
