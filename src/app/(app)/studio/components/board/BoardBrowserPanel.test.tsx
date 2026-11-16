import "@testing-library/jest-dom";
import { describe, expect, it, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@/context/ThemeContext";
import BoardBrowserPanel from "./BoardBrowserPanel";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderPanel() {
  return render(
    <ThemeProvider>
      <BoardBrowserPanel />
    </ThemeProvider>,
  );
}

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BoardBrowserPanel — live lookup", () => {
  it("shows no result or error before a lookup is run", () => {
    renderPanel();
    expect(screen.queryByTestId("board-browser-lookup-result")).toBeNull();
    expect(screen.queryByTestId("board-browser-lookup-error")).toBeNull();
  });

  it("renders the real sourced result after a successful lookup", async () => {
    fetchSpy.mockResolvedValue(
      response({
        success: true,
        formatted: "Best Buy (123 Main St) is open now. Source: Google Places.",
        source: "Google Places",
      }),
    );

    renderPanel();
    fireEvent.change(screen.getByTestId("board-browser-lookup-input"), {
      target: { value: "What time does Best Buy open?" },
    });
    fireEvent.click(screen.getByTestId("board-browser-lookup-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("board-browser-lookup-result")).toHaveTextContent("Source: Google Places"),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/studio/lookup",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows the honest error message instead of a fake result when the lookup fails", async () => {
    fetchSpy.mockResolvedValue(response({ success: false, error: "I couldn't find a match for \"nowhere\"." }));

    renderPanel();
    fireEvent.change(screen.getByTestId("board-browser-lookup-input"), {
      target: { value: "nowhere hours" },
    });
    fireEvent.click(screen.getByTestId("board-browser-lookup-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("board-browser-lookup-error")).toHaveTextContent("couldn't find a match"),
    );
    expect(screen.queryByTestId("board-browser-lookup-result")).toBeNull();
  });
});
