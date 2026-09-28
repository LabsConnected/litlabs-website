import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLittAppStore } from "@/lib/litt-client/store-context";
import { LittAppFrame } from "./litt-app-frame";
import LittAppPage from "./page";

function Probe() {
  const conversationId = useLittAppStore((state) => state.conversationId);
  return <span>{conversationId ?? "none"}</span>;
}

describe("LittAppFrame", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty("--litt-keyboard-inset");
    vi.unstubAllGlobals();
  });

  it("renders the placeholder inside its own frame", () => {
    render(
      <LittAppFrame>
        <LittAppPage />
      </LittAppFrame>,
    );
    expect(screen.getByRole("heading", { name: "LiTT" })).toBeInTheDocument();
    expect(screen.getByText("Your conversation will show up here.")).toBeInTheDocument();
    expect(document.querySelector("[data-litt-app]")).not.toBeNull();
  });

  it("renders its own frame and a private store", () => {
    render(
      <LittAppFrame>
        <Probe />
      </LittAppFrame>,
    );
    const frame = document.querySelector("[data-litt-app]");
    expect(frame).not.toBeNull();
    const css = readFileSync("src/app/(litt)/app/litt-app.css", "utf8");
    expect(css).toContain("padding-top: env(safe-area-inset-top, 0px)");
    expect(css).toContain("var(--litt-keyboard-inset, 0px)");
    expect(screen.getByText("none")).toBeInTheDocument();
  });

  it("publishes the keyboard overlap and clears it on unmount", () => {
    const listeners = new Map<string, EventListener>();
    const viewport = {
      height: 500,
      offsetTop: 0,
      addEventListener: (name: string, listener: EventListener) => {
        listeners.set(name, listener);
      },
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });

    const { unmount } = render(
      <LittAppFrame>
        <div>app</div>
      </LittAppFrame>,
    );
    expect(document.documentElement.style.getPropertyValue("--litt-keyboard-inset")).toBe("300px");
    unmount();
    expect(document.documentElement.style.getPropertyValue("--litt-keyboard-inset")).toBe("");
    expect(viewport.removeEventListener).toHaveBeenCalled();
  });
});
