import { test, expect } from "@playwright/test";
import { monitorApplicationErrors, assertNoErrors, waitForPageReady } from "./helpers";

/**
 * Mocked chat tests — deterministic, no real AI provider calls.
 *
 * Intercepts the messages API and returns controlled streaming responses
 * so tests are fast, repeatable, and free.
 */

test.describe("Chat (mocked) @studio @chat", () => {
  test("Send message and receive mocked streaming response", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    // Intercept the messages API and return a deterministic response
    await page.route("**/api/studio/conversations/*/messages", async (route) => {
      const request = route.request();
      const body = JSON.parse(request.postData() ?? "{}");

      // Return a streaming SSE response
      const userMessageId = "msg-user-test";
      const assistantMessageId = "msg-assistant-test";
      const mockResponse = [
        `data: ${JSON.stringify({
          type: "user_message",
          userMessage: { id: userMessageId, role: "user", content: body.message, status: "completed" },
          revision: 2,
        })}\n\n`,
        `data: ${JSON.stringify({
          type: "assistant_message",
          assistantMessage: { id: assistantMessageId, role: "assistant", content: "", status: "streaming" },
        })}\n\n`,
        `data: ${JSON.stringify({ type: "text", text: "LiTTree chat test passed" })}\n\n`,
        `data: ${JSON.stringify({
          type: "done",
          assistantMessage: {
            id: assistantMessageId,
            role: "assistant",
            content: "LiTTree chat test passed",
            status: "completed",
          },
          revision: 2,
        })}\n\n`,
        `data: [DONE]\n\n`,
      ].join("");

      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: mockResponse,
      });
    });

    await page.goto("/studio");
    await waitForPageReady(page, { testId: "studio-command-composer" });

    // Type and send a message
    const input = page.getByTestId("studio-command-input");
    await input.fill("Reply with the exact phrase: LiTTree chat test passed");

    await page.getByTestId("studio-send-button").click();

    // Wait for the assistant response
    await expect(
      page.getByText("LiTTree chat test passed").last(),
    ).toBeVisible({ timeout: 30_000 });

    assertNoErrors(errors);
  });

  test("Enter key sends message", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    await page.route("**/api/studio/conversations/*/messages", async (route) => {
      const mockResponse = [
        `data: ${JSON.stringify({ type: "user_message", userMessage: { id: "u1", role: "user", content: "Enter test", status: "completed" }, revision: 2 })}\n\n`,
        `data: ${JSON.stringify({ type: "text", text: "Enter key works" })}\n\n`,
        `data: ${JSON.stringify({ type: "done", assistantMessage: { id: "a1", role: "assistant", content: "Enter key works", status: "completed" }, revision: 2 })}\n\n`,
        `data: [DONE]\n\n`,
      ].join("");

      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: mockResponse,
      });
    });

    await page.goto("/studio");
    await waitForPageReady(page, { testId: "studio-command-composer" });

    const input = page.getByTestId("studio-command-input");
    await input.fill("Enter test");
    await input.press("Enter");

    await expect(page.getByText("Enter key works").last()).toBeVisible({ timeout: 30_000 });

    assertNoErrors(errors);
  });

  test("Shift+Enter creates a new line", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    await page.goto("/studio");
    await waitForPageReady(page, { testId: "studio-command-composer" });

    const input = page.getByTestId("studio-command-input") as ReturnType<typeof page.getByTestId>;
    await input.fill("Line 1");
    await input.press("Shift+Enter");
    await input.type("Line 2");

    const value = await input.inputValue();
    expect(value).toContain("\n");
    expect(value).toContain("Line 1");
    expect(value).toContain("Line 2");

    assertNoErrors(errors);
  });

  test("Provider failure shows honest error message", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    await page.route("**/api/studio/conversations/*/messages", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "LLM provider unavailable" }),
      });
    });

    await page.goto("/studio");
    await waitForPageReady(page, { testId: "studio-command-composer" });

    await page.getByTestId("studio-command-input").fill("Test error handling");
    await page.getByTestId("studio-send-button").click();

    // Should show an error message — not silently fail
    await expect(page.getByText(/error|failed|unavailable/i).first()).toBeVisible({
      timeout: 15_000,
    });

    assertNoErrors(errors);
  });
});
