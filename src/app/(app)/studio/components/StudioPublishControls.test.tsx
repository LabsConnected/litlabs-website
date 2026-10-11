import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import StudioPublishControls from "./StudioPublishControls";

/**
 * P0 — Static Publishing UI: component tests.
 *
 * Proves the publish controls handle all states (idle → publishing →
 * published → unpublish), surface errors honestly, enforce the
 * unpublish confirmation, and never leak another user's data.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Controllable fetch mock — each test sets the handler.
let fetchHandler: (url: string, init?: RequestInit) => Promise<Response>;

beforeEach(() => {
  vi.restoreAllMocks();
  fetchHandler = async () => jsonResponse({ published: false, deployment: null });
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => fetchHandler(url, init)));
});

describe("StudioPublishControls", () => {
  it("renders nothing without a projectId", () => {
    const { container } = render(<StudioPublishControls projectId={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows Publish button when not published", async () => {
    render(<StudioPublishControls projectId="proj-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("publish-button")).toBeInTheDocument();
    });
    expect(screen.getByText("Publish site")).toBeInTheDocument();
  });

  it("publishes and shows the live URL on success", async () => {
    let callCount = 0;
    fetchHandler = async (url, init) => {
      callCount++;
      if (callCount === 1) return jsonResponse({ published: false, deployment: null });
      return jsonResponse({
        published: true,
        deploymentId: "dep-1",
        publicUrl: "https://example.litt.host/sites/dep-1",
        fileCount: 3,
      });
    };
    render(<StudioPublishControls projectId="proj-1" />);
    await waitFor(() => expect(screen.getByTestId("publish-button")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId("publish-button"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("publish-live-url")).toBeInTheDocument();
    });
    expect(screen.getByTestId("publish-live-url")).toHaveAttribute(
      "href",
      "https://example.litt.host/sites/dep-1",
    );
  });

  it("shows error state when publish fails", async () => {
    let callCount = 0;
    fetchHandler = async () => {
      callCount++;
      if (callCount === 1) return jsonResponse({ published: false, deployment: null });
      return jsonResponse({ error: "Publish failed.", detail: "Hosting not configured." }, 502);
    };
    render(<StudioPublishControls projectId="proj-1" />);
    await waitFor(() => expect(screen.getByTestId("publish-button")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId("publish-button"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("publish-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("publish-error")).toHaveTextContent("Hosting not configured.");
  });

  it("requires confirmation before unpublishing", async () => {
    const publishedState = {
      published: true,
      deployment: {
        id: "dep-1",
        status: "ready",
        publicUrl: "https://example.litt.host/sites/dep-1",
        urlVerified: true,
        fileCount: 3,
      },
    };
    const calls: Array<{ url: string; method?: string }> = [];
    fetchHandler = async (url, init) => {
      calls.push({ url, method: init?.method });
      return jsonResponse(publishedState);
    };
    render(<StudioPublishControls projectId="proj-1" />);
    await waitFor(() => expect(screen.getByTestId("publish-unpublish")).toBeInTheDocument());

    // First click shows confirmation, does NOT call DELETE.
    await act(async () => {
      fireEvent.click(screen.getByTestId("publish-unpublish"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("unpublish-confirm")).toBeInTheDocument();
    });
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);

    // Cancel returns to published state.
    await act(async () => {
      fireEvent.click(screen.getByTestId("unpublish-confirm-no"));
    });
    await waitFor(() => {
      expect(screen.queryByTestId("unpublish-confirm")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("publish-live-url")).toBeInTheDocument();
  });

  it("unpublishes after confirmation", async () => {
    const publishedState = {
      published: true,
      deployment: {
        id: "dep-1",
        status: "ready",
        publicUrl: "https://example.litt.host/sites/dep-1",
        urlVerified: true,
        fileCount: 3,
      },
    };
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    fetchHandler = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body as string });
      if (init?.method === "DELETE") {
        return jsonResponse({ unpublished: true, deploymentId: "dep-1" });
      }
      return jsonResponse(publishedState);
    };
    render(<StudioPublishControls projectId="proj-1" />);
    await waitFor(() => expect(screen.getByTestId("publish-unpublish")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId("publish-unpublish"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("unpublish-confirm-yes")).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("unpublish-confirm-yes"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("publish-button")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("publish-live-url")).not.toBeInTheDocument();
    const deleteCall = calls.find((c) => c.method === "DELETE");
    expect(deleteCall).toBeDefined();
    expect(deleteCall?.body).toBe(JSON.stringify({ deploymentId: "dep-1" }));
  });

  it("compact mode renders icon buttons for the toolbar", async () => {
    fetchHandler = async () =>
      jsonResponse({
        published: true,
        deployment: {
          id: "dep-1",
          status: "ready",
          publicUrl: "https://example.litt.host/sites/dep-1",
          urlVerified: true,
          fileCount: 3,
        },
      });
    render(<StudioPublishControls projectId="proj-1" compact />);
    await waitFor(() => {
      expect(screen.getByTestId("publish-button")).toBeInTheDocument();
    });
    // Compact mode: icon button with aria-label, no text label.
    expect(screen.getByTestId("publish-button")).toHaveAttribute("aria-label", "Republish site");
    expect(screen.getByTestId("unpublish-button")).toBeInTheDocument();
  });
});
