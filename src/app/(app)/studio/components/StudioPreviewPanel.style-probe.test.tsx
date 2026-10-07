/**
 * Regression tests: the Studio preview must surface a styling failure
 * honestly instead of keeping the green "Preview ready" badge.
 *
 * Production defect (2026-09-23, P0): the Tailwind v4 browser build
 * silently compiles zero utilities when a <style type="text/tailwindcss">
 * block carries any @import without tailwindcss. The preview rendered all
 * content completely unstyled while the badge said "Preview ready".
 *
 * The injected inspector script now runs a style probe (hidden element +
 * getComputedStyle) and posts { source: "litt-inspector",
 * type: "style-probe", payload: { tailwindDetected, styled } }. These
 * tests pin the panel's contract: a Tailwind-intended but unstyled preview
 * flips the badge to "Preview styling failed to apply"; every other case
 * keeps "Preview ready".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import StudioPreviewPanel from "./StudioPreviewPanel";
import { useExecutionStore } from "../stores/useExecutionStore";

const { mockGetToken } = vi.hoisted(() => ({ mockGetToken: vi.fn().mockResolvedValue("test-token") }));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ getToken: mockGetToken }),
}));

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => impl(input as RequestInfo, init));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const TERMINAL_HOST = "https://terminal.example.com";
const WORKSPACE_ID = "ws-3648d2ea-b9c5004a";
const TOKEN = "6fbfec4fd43b2b77388eda37213a541d5694a97dca6a82bc4eacd88b8ab2991f";
const PREVIEW_URL = `${TERMINAL_HOST}/preview/${WORKSPACE_ID}?token=${TOKEN}`;

function renderReadyPreview() {
  mockFetch(() =>
    jsonResponse({ runtimeStatus: "ready", previewUrl: PREVIEW_URL, runtimeError: null }),
  );
  render(
    <StudioPreviewPanel
      projectId="project-1"
      projectName="Demo"
      repositoryName={null}
      branch="main"
      workspaceStatus="ready"
    />,
  );
}

function postStyleProbe(payload: { tailwindDetected: boolean; styled: boolean }) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: TERMINAL_HOST,
        data: { source: "litt-inspector", type: "style-probe", payload },
      }),
    );
  });
}

/**
 * "Preview ready" is committed before the previewUrl effect subscribes to
 * window "message". findBy* can observe the badge in that gap (a
 * MutationObserver microtask runs before the useEffect macrotask), and a
 * probe posted then is dropped — the badge stays green. Wait until the
 * iframe exists (previewUrl is set) and flush the effect first.
 */
async function whenPreviewListenerReady() {
  await screen.findByText("Preview ready");
  await screen.findByTitle("Demo preview");
  await act(async () => {
    await Promise.resolve();
  });
}

describe("StudioPreviewPanel — style probe honesty", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    act(() => useExecutionStore.getState().reset());
  });

  it("flips the badge when a Tailwind-intended preview renders unstyled", async () => {
    renderReadyPreview();
    await whenPreviewListenerReady();
    postStyleProbe({ tailwindDetected: true, styled: false });
    await screen.findByText("Preview styling failed to apply", {}, { timeout: 5000 });
    expect(screen.getByTestId("preview-status-dot")).toHaveAttribute(
      "aria-label",
      "Runtime status: Preview styling failed to apply",
    );
    expect(screen.queryByText("Preview ready")).toBeNull();
  });

  it("keeps 'Preview ready' when Tailwind applied", async () => {
    renderReadyPreview();
    await whenPreviewListenerReady();
    postStyleProbe({ tailwindDetected: true, styled: true });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.getByText("Preview ready")).toBeInTheDocument();
    expect(screen.queryByText("Preview styling failed to apply")).toBeNull();
  });

  it("keeps 'Preview ready' for pages without Tailwind intent", async () => {
    renderReadyPreview();
    await whenPreviewListenerReady();
    postStyleProbe({ tailwindDetected: false, styled: true });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.getByText("Preview ready")).toBeInTheDocument();
  });

  it("ignores style-probe messages from other origins", async () => {
    renderReadyPreview();
    await whenPreviewListenerReady();
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://evil.example.com",
          data: { source: "litt-inspector", type: "style-probe", payload: { tailwindDetected: true, styled: false } },
        }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.getByText("Preview ready")).toBeInTheDocument();
    expect(screen.queryByText("Preview styling failed to apply")).toBeNull();
  });
});
