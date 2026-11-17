import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@/context/ThemeContext";
import BoardBrowserPanel, { BROWSER_EMBED_WATCHDOG_MS } from "./BoardBrowserPanel";

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

function wrap(node: React.ReactNode) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

function navigateTo(value: string) {
  fireEvent.change(screen.getByTestId("board-browser-input"), {
    target: { value },
  });
  fireEvent.keyDown(screen.getByTestId("board-browser-input"), { key: "Enter" });
}

let fetchSpy: MockInstance<typeof fetch>;

describe("BoardBrowserPanel — live lookup", () => {
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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

describe("BoardBrowserPanel embed-blocked state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("shows the blocked explanation, attempted URL, and open-externally action when no load arrives within the watchdog bound", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    wrap(<BoardBrowserPanel />);
    navigateTo("google.com");

    // Before the bound expires the panel explains that it is loading,
    // and does not yet claim the site is blocked.
    expect(screen.getByTestId("board-browser-frame")).toBeInTheDocument();
    expect(screen.getByTestId("board-browser-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("board-browser-blocked")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(BROWSER_EMBED_WATCHDOG_MS + 1);
    });

    const blocked = screen.getByTestId("board-browser-blocked");
    expect(blocked).toHaveTextContent(
      "This site doesn't allow itself to be displayed inside other apps, so it can't be shown here.",
    );
    expect(screen.getByTestId("board-browser-blocked-url")).toHaveTextContent(
      "https://google.com",
    );
    // The unexplained blank frame is gone.
    expect(screen.queryByTestId("board-browser-frame")).toBeNull();

    fireEvent.click(screen.getByTestId("board-browser-blocked-open"));
    expect(openSpy).toHaveBeenCalledWith(
      "https://google.com",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("does not show the blocked state when the frame loads normally", () => {
    wrap(<BoardBrowserPanel />);
    navigateTo("example.com");
    fireEvent.load(screen.getByTestId("board-browser-frame"));

    act(() => {
      vi.advanceTimersByTime(BROWSER_EMBED_WATCHDOG_MS + 5000);
    });

    expect(screen.queryByTestId("board-browser-blocked")).toBeNull();
    expect(screen.queryByTestId("board-browser-loading")).toBeNull();
    expect(screen.getByTestId("board-browser-frame")).toHaveAttribute(
      "src",
      "https://example.com",
    );
  });

  it("shows the blocked state on an iframe error without waiting for the watchdog", () => {
    wrap(<BoardBrowserPanel />);
    navigateTo("example.com");
    act(() => {
      screen
        .getByTestId("board-browser-frame")
        .dispatchEvent(new Event("error"));
    });
    expect(screen.getByTestId("board-browser-blocked")).toBeInTheDocument();
  });

  it("Try again re-arms the embed: the frame returns and a later load clears the blocked path", () => {
    wrap(<BoardBrowserPanel />);
    navigateTo("google.com");
    act(() => {
      vi.advanceTimersByTime(BROWSER_EMBED_WATCHDOG_MS + 1);
    });
    expect(screen.getByTestId("board-browser-blocked")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("board-browser-blocked-retry"));

    // Blocked UI is replaced by a fresh frame with the watchdog re-armed.
    expect(screen.queryByTestId("board-browser-blocked")).toBeNull();
    const frame = screen.getByTestId("board-browser-frame");
    expect(frame).toHaveAttribute("src", "https://google.com");
    expect(screen.getByTestId("board-browser-loading")).toBeInTheDocument();

    // A load on the retry disarms the re-armed watchdog.
    fireEvent.load(frame);
    act(() => {
      vi.advanceTimersByTime(BROWSER_EMBED_WATCHDOG_MS + 5000);
    });
    expect(screen.queryByTestId("board-browser-blocked")).toBeNull();
    expect(screen.getByTestId("board-browser-frame")).toBeInTheDocument();
  });

  it("Try again without a load re-enters the blocked state after the watchdog expires again", () => {
    wrap(<BoardBrowserPanel />);
    navigateTo("google.com");
    act(() => {
      vi.advanceTimersByTime(BROWSER_EMBED_WATCHDOG_MS + 1);
    });
    fireEvent.click(screen.getByTestId("board-browser-blocked-retry"));
    expect(screen.queryByTestId("board-browser-blocked")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(BROWSER_EMBED_WATCHDOG_MS + 1);
    });
    expect(screen.getByTestId("board-browser-blocked")).toBeInTheDocument();
  });
});
