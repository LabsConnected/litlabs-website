// @vitest-environment jsdom
/**
 * StudioPreviewPanel — cross-origin inspector bridge.
 *
 * Preview iframes are served by the terminal-server host, so direct DOM
 * access is blocked by the same-origin policy. The terminal-server proxy
 * injects an inspector script that speaks a postMessage protocol; these
 * tests pin the parent side of that protocol:
 *   - valid ready/select events from the preview origin are honored
 *   - events from wrong origins, wrong sources, or malformed payloads are ignored
 *   - previews that never answer the handshake report selection as
 *     unavailable instead of faking it
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import StudioPreviewPanel from "./StudioPreviewPanel";
import { useExecutionStore } from "../stores/useExecutionStore";

const { mockGetToken } = vi.hoisted(() => ({ mockGetToken: vi.fn().mockResolvedValue("test-token") }));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ getToken: mockGetToken }),
}));

const PREVIEW_ORIGIN = "https://terminal-server.example.com";
const PREVIEW_URL = `${PREVIEW_ORIGIN}/preview/ws-1?token=preview-token-123`;

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => impl(input as RequestInfo, init));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Force the iframe into the cross-origin path (contentDocument blocked). */
async function renderCrossOriginPreview(onSelectionChange?: (s: unknown) => void) {
  mockFetch(() => jsonResponse({ runtimeStatus: "ready", previewUrl: PREVIEW_URL, runtimeError: null }));
  render(
    <StudioPreviewPanel
      projectId="project-1"
      projectName="Demo"
      repositoryName={null}
      branch="main"
      workspaceStatus="ready"
      onSelectionChange={onSelectionChange}
    />,
  );
  const iframe = (await screen.findByTitle("Demo preview")) as HTMLIFrameElement;
  // Simulate the same-origin policy: contentDocument access throws.
  Object.defineProperty(iframe, "contentDocument", {
    configurable: true,
    get() {
      throw new DOMException("Blocked a frame with origin", "SecurityError");
    },
  });
  const postMessageSpy = vi.spyOn(iframe.contentWindow!, "postMessage");
  fireEvent.load(iframe);
  // attachSelection is scheduled with setTimeout(0) after load.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { iframe, postMessageSpy };
}

function inspectorMessage(
  iframe: HTMLIFrameElement,
  data: unknown,
  origin = PREVIEW_ORIGIN,
  source: MessageEventSource | null = null,
) {
  const event = new MessageEvent("message", {
    data,
    origin,
    source: source ?? (iframe.contentWindow as MessageEventSource),
  });
  act(() => {
    window.dispatchEvent(event);
  });
}

describe("StudioPreviewPanel inspector bridge", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    act(() => useExecutionStore.getState().reset());
  });

  it("sends a token-gated enable command to the preview origin after load", async () => {
    const { postMessageSpy } = await renderCrossOriginPreview();
    expect(postMessageSpy).toHaveBeenCalledWith(
      { source: "litt-inspector", type: "enable", token: "preview-token-123" },
      PREVIEW_ORIGIN,
    );
  });

  it("honors a select event from the preview origin and reports it to the parent", async () => {
    const onSelectionChange = vi.fn();
    const { iframe } = await renderCrossOriginPreview(onSelectionChange);

    inspectorMessage(iframe, { source: "litt-inspector", type: "ready" });
    inspectorMessage(iframe, {
      source: "litt-inspector",
      type: "select",
      payload: { label: "Checkout button", selector: "main > button:nth-of-type(2)", tagName: "button" },
    });

    await waitFor(() => {
      expect(onSelectionChange).toHaveBeenCalledWith({
        label: "Checkout button",
        selector: "main > button:nth-of-type(2)",
        tagName: "button",
      });
    });
    expect(screen.getByTestId("preview-selection")).toHaveTextContent("Selected: Checkout button");
  });

  it("ignores events from other origins", async () => {
    const onSelectionChange = vi.fn();
    const { iframe } = await renderCrossOriginPreview(onSelectionChange);

    inspectorMessage(
      iframe,
      { source: "litt-inspector", type: "select", payload: { label: "x", selector: "x", tagName: "div" } },
      "https://evil.example.com",
    );

    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId("preview-selection")).toBeNull();
  });

  it("ignores events whose source is not the preview iframe", async () => {
    const onSelectionChange = vi.fn();
    const { iframe } = await renderCrossOriginPreview(onSelectionChange);

    inspectorMessage(
      iframe,
      { source: "litt-inspector", type: "select", payload: { label: "x", selector: "x", tagName: "div" } },
      PREVIEW_ORIGIN,
      window, // a message from the parent window itself must not count
    );

    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("ignores malformed payloads and untagged messages", async () => {
    const onSelectionChange = vi.fn();
    const { iframe } = await renderCrossOriginPreview(onSelectionChange);

    inspectorMessage(iframe, { type: "select", payload: { label: "x", selector: "x", tagName: "div" } });
    inspectorMessage(iframe, { source: "litt-inspector", type: "select", payload: { label: "x" } });
    inspectorMessage(iframe, "litt-inspector");

    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId("preview-selection")).toBeNull();
  });

  it("reports selection as unavailable when no bridge answers the handshake", async () => {
    await renderCrossOriginPreview();
    // No "ready" reply — the timeout (2.5s) must surface the honest error.
    await waitFor(
      () => {
        expect(screen.getByText("Element selection is unavailable for this preview.")).toBeTruthy();
      },
      { timeout: 4000 },
    );
  });

  it("does not report unavailability once the bridge has answered", async () => {
    const { iframe } = await renderCrossOriginPreview();
    inspectorMessage(iframe, { source: "litt-inspector", type: "ready" });
    await new Promise((resolve) => setTimeout(resolve, 2700));
    expect(screen.queryByText("Element selection is unavailable for this preview.")).toBeNull();
  });

  it("clearing the selection sends a clear command into the frame", async () => {
    const onSelectionChange = vi.fn();
    const { iframe, postMessageSpy } = await renderCrossOriginPreview(onSelectionChange);

    inspectorMessage(iframe, { source: "litt-inspector", type: "ready" });
    inspectorMessage(iframe, {
      source: "litt-inspector",
      type: "select",
      payload: { label: "Nav", selector: "nav", tagName: "nav" },
    });
    await screen.findByTestId("preview-selection");

    fireEvent.click(screen.getByLabelText("Clear selected preview element"));

    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        { source: "litt-inspector", type: "clear", token: "preview-token-123" },
        PREVIEW_ORIGIN,
      );
      expect(onSelectionChange).toHaveBeenLastCalledWith(null);
    });
  });
});
