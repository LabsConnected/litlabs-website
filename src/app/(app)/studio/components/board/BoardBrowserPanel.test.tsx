import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/context/ThemeContext";
import { useStudioBrowserStore } from "../../stores/useStudioBrowserStore";
import BoardBrowserPanel, { BROWSER_EMBED_WATCHDOG_MS } from "./BoardBrowserPanel";

function wrap(node: React.ReactNode) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

function navigateTo(value: string) {
  fireEvent.change(screen.getByTestId("board-browser-input"), {
    target: { value },
  });
  fireEvent.keyDown(screen.getByTestId("board-browser-input"), { key: "Enter" });
}

describe("BoardBrowserPanel embed-blocked state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Tab state lives in the shared store now — start each test from
    // a single fresh tab, as a first mount would see it.
    useStudioBrowserStore.getState().reset();
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
      "This page couldn't be loaded in the panel.",
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
      "/api/studio/browser/proxy?url=https%3A%2F%2Fexample.com",
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
    expect(frame).toHaveAttribute(
      "src",
      "/api/studio/browser/proxy?url=https%3A%2F%2Fgoogle.com",
    );
    expect(screen.getByTestId("board-browser-loading")).toBeInTheDocument();

    // A load on the retry disarms the re-armed watchdog.
    fireEvent.load(frame);
    act(() => {
      vi.advanceTimersByTime(BROWSER_EMBED_WATCHDOG_MS + 5000);
    });
    expect(screen.queryByTestId("board-browser-blocked")).toBeNull();
    expect(screen.getByTestId("board-browser-frame")).toBeInTheDocument();
  });

  it("back and forward walk the panel history and reload the frame through the proxy", () => {
    wrap(<BoardBrowserPanel />);
    navigateTo("example.com");
    navigateTo("news.site");
    const back = screen.getByTestId("board-browser-back");
    const forward = screen.getByTestId("board-browser-forward");
    expect(back).not.toBeDisabled();
    expect(forward).toBeDisabled();

    fireEvent.click(back);
    expect(screen.getByTestId("board-browser-input")).toHaveValue("https://example.com");
    expect(screen.getByTestId("board-browser-frame")).toHaveAttribute(
      "src",
      "/api/studio/browser/proxy?url=https%3A%2F%2Fexample.com",
    );
    expect(forward).not.toBeDisabled();

    fireEvent.click(forward);
    expect(screen.getByTestId("board-browser-input")).toHaveValue("https://news.site");
    expect(screen.getByTestId("board-browser-frame")).toHaveAttribute(
      "src",
      "/api/studio/browser/proxy?url=https%3A%2F%2Fnews.site",
    );
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

describe("BoardBrowserPanel tabs and in-page navigation sync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStudioBrowserStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function postFromFrame(data: unknown) {
    const frame = screen.getByTestId("board-browser-frame") as HTMLIFrameElement;
    const event = new MessageEvent("message", {
      data,
      source: frame.contentWindow as unknown as MessageEventSource,
    });
    act(() => {
      window.dispatchEvent(event);
    });
  }

  it("opens a second tab with its own history and switches between tabs", () => {
    wrap(<BoardBrowserPanel />);
    navigateTo("example.com");
    fireEvent.load(screen.getByTestId("board-browser-frame"));

    fireEvent.click(screen.getByTestId("board-browser-new-tab"));
    expect(screen.getAllByTestId("board-browser-tab")).toHaveLength(2);
    // The new tab starts empty: no frame, address bar blank.
    expect(screen.queryByTestId("board-browser-frame")).toBeNull();
    expect(screen.getByTestId("board-browser-input")).toHaveValue("");

    navigateTo("news.site");
    expect(screen.getByTestId("board-browser-frame")).toHaveAttribute(
      "src",
      "/api/studio/browser/proxy?url=https%3A%2F%2Fnews.site",
    );

    // Switching back to the first tab restores its page and address.
    fireEvent.click(screen.getAllByTestId("board-browser-tab")[0]);
    expect(screen.getByTestId("board-browser-input")).toHaveValue("https://example.com");
    expect(screen.getByTestId("board-browser-frame")).toHaveAttribute(
      "src",
      "/api/studio/browser/proxy?url=https%3A%2F%2Fexample.com",
    );
  });

  it("closing the active tab activates a neighbor; closing the last tab leaves a fresh one", () => {
    wrap(<BoardBrowserPanel />);
    navigateTo("example.com");
    fireEvent.click(screen.getByTestId("board-browser-new-tab"));
    navigateTo("news.site");
    expect(screen.getAllByTestId("board-browser-tab")).toHaveLength(2);

    fireEvent.click(screen.getAllByTestId("board-browser-close-tab")[1]);
    expect(screen.getAllByTestId("board-browser-tab")).toHaveLength(1);
    expect(screen.getByTestId("board-browser-input")).toHaveValue("https://example.com");

    fireEvent.click(screen.getAllByTestId("board-browser-close-tab")[0]);
    expect(screen.getAllByTestId("board-browser-tab")).toHaveLength(1);
    expect(screen.getByTestId("board-browser-input")).toHaveValue("");
    expect(screen.queryByTestId("board-browser-frame")).toBeNull();
  });

  it("records in-page navigations posted by the proxied document so Back reaches them", () => {
    wrap(<BoardBrowserPanel />);
    navigateTo("example.com");
    fireEvent.load(screen.getByTestId("board-browser-frame"));

    postFromFrame({ source: "litt-browser", type: "navigate", url: "https://example.com/about" });

    expect(screen.getByTestId("board-browser-input")).toHaveValue("https://example.com/about");
    const back = screen.getByTestId("board-browser-back");
    expect(back).not.toBeDisabled();
    fireEvent.click(back);
    expect(screen.getByTestId("board-browser-input")).toHaveValue("https://example.com");
  });

  it("corrects the address bar when the frame reports a redirect landing", () => {
    wrap(<BoardBrowserPanel />);
    navigateTo("example.com");
    postFromFrame({ source: "litt-browser", type: "landed", url: "https://www.example.com/" });
    expect(screen.getByTestId("board-browser-input")).toHaveValue("https://www.example.com/");
    // A landing replaces the entry — Back stays disabled.
    expect(screen.getByTestId("board-browser-back")).toBeDisabled();
  });

  it("ignores messages that do not come from the panel's own frame", () => {
    wrap(<BoardBrowserPanel />);
    navigateTo("example.com");
    const event = new MessageEvent("message", {
      data: { source: "litt-browser", type: "navigate", url: "https://evil.example/" },
    });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(screen.getByTestId("board-browser-input")).toHaveValue("https://example.com");
  });
});

describe("BoardBrowserPanel tab state across remounts (layout flips)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStudioBrowserStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function postFromFrame(data: unknown) {
    const frame = screen.getByTestId("board-browser-frame") as HTMLIFrameElement;
    const event = new MessageEvent("message", {
      data,
      source: frame.contentWindow as unknown as MessageEventSource,
    });
    act(() => {
      window.dispatchEvent(event);
    });
  }

  it("keeps tabs, history, and the current page when the panel unmounts and remounts", () => {
    const first = wrap(<BoardBrowserPanel />);
    navigateTo("example.com");
    fireEvent.load(screen.getByTestId("board-browser-frame"));
    fireEvent.click(screen.getByTestId("board-browser-new-tab"));
    navigateTo("news.site");

    // A layout flip (Board → Regular → Board) unmounts the panel and
    // mounts it elsewhere; the store keeps the session, so the user
    // must NOT come back to a fresh "New tab" (live defect 2026-11-22).
    first.unmount();
    wrap(<BoardBrowserPanel />);

    expect(screen.getAllByTestId("board-browser-tab")).toHaveLength(2);
    expect(screen.getByTestId("board-browser-input")).toHaveValue("https://news.site");
    expect(screen.getByTestId("board-browser-frame")).toHaveAttribute(
      "src",
      "/api/studio/browser/proxy?url=https%3A%2F%2Fnews.site",
    );

    fireEvent.click(screen.getAllByTestId("board-browser-tab")[0]);
    expect(screen.getByTestId("board-browser-input")).toHaveValue("https://example.com");
  });

  it("restores the page reached by an in-page link — not the stale pre-click frame src — when the panel remounts", () => {
    const first = wrap(<BoardBrowserPanel />);
    navigateTo("example.com");
    fireEvent.load(screen.getByTestId("board-browser-frame"));

    // Follow a link inside the page. The frame navigates itself and
    // posts "navigate": history and the address bar advance, but the
    // stored frameSrc still names the pre-click page — and the frame
    // must NOT be force-reloaded for it (its src stays put).
    postFromFrame({
      source: "litt-browser",
      type: "navigate",
      url: "https://example.com/about",
    });
    expect(screen.getByTestId("board-browser-input")).toHaveValue(
      "https://example.com/about",
    );
    expect(screen.getByTestId("board-browser-frame")).toHaveAttribute(
      "src",
      "/api/studio/browser/proxy?url=https%3A%2F%2Fexample.com",
    );

    // Layout flip: unmount + remount. The restored frame must load
    // the CURRENT history entry (the post-click page), not the
    // stale frameSrc.
    first.unmount();
    wrap(<BoardBrowserPanel />);
    expect(screen.getByTestId("board-browser-input")).toHaveValue(
      "https://example.com/about",
    );
    expect(screen.getByTestId("board-browser-frame")).toHaveAttribute(
      "src",
      "/api/studio/browser/proxy?url=https%3A%2F%2Fexample.com%2Fabout",
    );

    // The remounted frame's "landed" report names the page it
    // actually loaded, so it cannot replace the newest history
    // entry with the older pre-click URL: history stays intact.
    postFromFrame({
      source: "litt-browser",
      type: "landed",
      url: "https://example.com/about",
    });
    const tab = useStudioBrowserStore.getState().tabs[0];
    expect(tab.history).toEqual([
      "https://example.com",
      "https://example.com/about",
    ]);
    expect(tab.historyIndex).toBe(1);

    // Back still reaches the pre-click page and loads it.
    const back = screen.getByTestId("board-browser-back");
    expect(back).not.toBeDisabled();
    fireEvent.click(back);
    expect(screen.getByTestId("board-browser-input")).toHaveValue(
      "https://example.com",
    );
    expect(screen.getByTestId("board-browser-frame")).toHaveAttribute(
      "src",
      "/api/studio/browser/proxy?url=https%3A%2F%2Fexample.com",
    );
  });

  it("Back from a restored page that timed out loads the previous page and clears the blocked state", () => {
    const first = wrap(<BoardBrowserPanel />);
    navigateTo("example.com");
    fireEvent.load(screen.getByTestId("board-browser-frame"));

    // Follow an in-page link: history advances to the new page while
    // the stored frameSrc keeps naming the pre-click page.
    postFromFrame({
      source: "litt-browser",
      type: "navigate",
      url: "https://example.com/about",
    });
    postFromFrame({
      source: "litt-browser",
      type: "landed",
      url: "https://example.com/about",
    });

    // Layout flip: the remounted frame restores the post-click page.
    first.unmount();
    wrap(<BoardBrowserPanel />);
    expect(screen.getByTestId("board-browser-frame")).toHaveAttribute(
      "src",
      "/api/studio/browser/proxy?url=https%3A%2F%2Fexample.com%2Fabout",
    );

    // This time the restored page never signals a load: the watchdog
    // expires and the panel lands on the failure screen for it.
    act(() => {
      vi.advanceTimersByTime(BROWSER_EMBED_WATCHDOG_MS + 1);
    });
    expect(screen.getByTestId("board-browser-blocked")).toBeInTheDocument();
    expect(screen.getByTestId("board-browser-blocked-url")).toHaveTextContent(
      "https://example.com/about",
    );
    expect(screen.queryByTestId("board-browser-frame")).toBeNull();

    // Back targets the pre-click page. Its proxy URL differs from the
    // restored frame's snapshot src, so no reloadKey bump happens —
    // and the stored frameSrc already named this page, so it does not
    // change either. Only frameGeneration moves. The panel must
    // still treat it as a fresh load: failure screen gone, frame
    // back, showing the previous page.
    fireEvent.click(screen.getByTestId("board-browser-back"));
    expect(screen.getByTestId("board-browser-input")).toHaveValue(
      "https://example.com",
    );
    expect(screen.queryByTestId("board-browser-blocked")).toBeNull();
    const frame = screen.getByTestId("board-browser-frame");
    expect(frame).toHaveAttribute(
      "src",
      "/api/studio/browser/proxy?url=https%3A%2F%2Fexample.com",
    );
    expect(screen.getByTestId("board-browser-loading")).toBeInTheDocument();

    // The re-requested page loads and stays loaded.
    fireEvent.load(frame);
    act(() => {
      vi.advanceTimersByTime(BROWSER_EMBED_WATCHDOG_MS + 5000);
    });
    expect(screen.queryByTestId("board-browser-blocked")).toBeNull();
    expect(screen.getByTestId("board-browser-frame")).toBeInTheDocument();
  });
});
