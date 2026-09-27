import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  StudioContextProvider,
  formatSelectionContextBlock,
  isStudioSelectionPayload,
  toSelectionPayload,
  useStudioContextOptional,
  type StudioSelectionPayload,
} from "./StudioContext";

const FULL_PAYLOAD: StudioSelectionPayload = {
  kind: "preview-element",
  label: "Hero heading",
  selector: "main > section.hero > h1",
  tagName: "h1",
  sourceFile: "src/components/Hero.tsx",
  route: "/",
  projectId: "proj-1",
  timestamp: 1727,
};

describe("isStudioSelectionPayload", () => {
  it("recognizes a full F1 payload", () => {
    expect(isStudioSelectionPayload(FULL_PAYLOAD)).toBe(true);
  });

  it("rejects the legacy selection shape", () => {
    expect(
      isStudioSelectionPayload({ elementId: "main > h1", content: "Hero" }),
    ).toBe(false);
  });

  it("rejects null/undefined", () => {
    expect(isStudioSelectionPayload(null)).toBe(false);
    expect(isStudioSelectionPayload(undefined)).toBe(false);
  });
});

describe("formatSelectionContextBlock", () => {
  it("formats label + source file + route + kind", () => {
    expect(formatSelectionContextBlock(FULL_PAYLOAD)).toBe(
      "[Selected: Hero heading — src/components/Hero.tsx @ / (preview-element)]",
    );
  });

  it("omits absent parts without leaving gaps", () => {
    expect(
      formatSelectionContextBlock({
        kind: "canvas-node",
        label: "Hero",
        projectId: "proj-1",
        timestamp: 1,
      }),
    ).toBe("[Selected: Hero (canvas-node)]");
  });

  it("falls back to the selector when no source file is known", () => {
    expect(
      formatSelectionContextBlock({
        kind: "preview-element",
        label: "Hero heading",
        selector: "main > h1",
        tagName: "h1",
        projectId: "proj-1",
        timestamp: 1,
      }),
    ).toBe("[Selected: Hero heading — main > h1 (preview-element)]");
  });

  it("returns null for no selection", () => {
    expect(formatSelectionContextBlock(null)).toBeNull();
    expect(formatSelectionContextBlock(undefined)).toBeNull();
  });
});

describe("toSelectionPayload", () => {
  const fallback = { kind: "canvas-node" as const, projectId: "proj-1" };

  it("passes a full payload through unchanged", () => {
    expect(toSelectionPayload(FULL_PAYLOAD, fallback)).toBe(FULL_PAYLOAD);
  });

  it("upgrades a legacy selection, preferring its label/content", () => {
    const payload = toSelectionPayload(
      {
        elementId: "node-9",
        componentName: "Hero",
        content: "Welcome",
        sourceFile: "src/components/Hero.tsx",
      },
      fallback,
    );
    expect(payload).toMatchObject({
      kind: "canvas-node",
      label: "Welcome",
      elementId: "node-9",
      componentName: "Hero",
      sourceFile: "src/components/Hero.tsx",
      projectId: "proj-1",
    });
    expect(typeof payload?.timestamp).toBe("number");
  });

  it("uses an explicit label when the legacy selection has one", () => {
    const payload = toSelectionPayload(
      { elementId: "x", label: "Custom label" },
      fallback,
    );
    expect(payload?.label).toBe("Custom label");
  });

  it("builds from the fallback when the selection is null", () => {
    const payload = toSelectionPayload(null, {
      ...fallback,
      label: "Canvas",
      kind: "canvas-block",
    });
    expect(payload).toMatchObject({
      kind: "canvas-block",
      label: "Canvas",
      projectId: "proj-1",
    });
  });

  it("returns null when there is nothing to build from", () => {
    expect(toSelectionPayload(null)).toBeNull();
    expect(toSelectionPayload(null, fallback)).toBeNull();
    expect(toSelectionPayload(undefined, fallback)).toBeNull();
  });

  it("coerces legacy style values to strings", () => {
    const payload = toSelectionPayload(
      { elementId: "x", styles: { color: "red", opacity: 0.5 as unknown as string } },
      { ...fallback, label: "X" },
    );
    expect(payload?.styles).toEqual({ color: "red", opacity: "0.5" });
  });
});

describe("useStudioContextOptional", () => {
  it("returns null outside a provider instead of throwing", () => {
    const { result } = renderHook(() => useStudioContextOptional());
    expect(result.current).toBeNull();
  });

  it("returns the context api inside a provider", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StudioContextProvider
        projectId="proj-1"
        sessionId="sess-1"
        workspaceMode="preview"
        creator={null}
        selection={FULL_PAYLOAD}
      >
        {children}
      </StudioContextProvider>
    );
    const { result } = renderHook(() => useStudioContextOptional(), { wrapper });
    expect(result.current?.projectId).toBe("proj-1");
    expect(result.current?.selection).toBe(FULL_PAYLOAD);
  });
});
