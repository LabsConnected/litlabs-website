import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ImageStudio from "./ImageStudio";

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    tokens: new Proxy({}, { get: () => "#111111" }),
  }),
}));

vi.mock("../../context/StudioContext", () => ({
  useStudioContext: () => ({ setActiveAssetId: vi.fn() }),
}));

vi.mock("../../hooks/useAssetsRefresh", () => ({
  notifyAssetsChanged: vi.fn(),
  useAssetsRefreshTrigger: () => 0,
}));

class MockImage {
  crossOrigin = "";
  naturalWidth = 0;
  naturalHeight = 0;
  width = 0;
  height = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private source = "";

  get src() {
    return this.source;
  }

  set src(value: string) {
    this.source = value;
    const portrait = value.includes("portrait");
    this.naturalWidth = portrait ? 768 : 1024;
    this.naturalHeight = portrait ? 1344 : 1024;
    this.width = this.naturalWidth;
    this.height = this.naturalHeight;
    queueMicrotask(() => this.onload?.());
  }
}

function stubStageSize() {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [
            {
              target,
              contentRect: { width: 1000, height: 800 },
            } as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
}

async function renderAndLoad(kind: "square" | "portrait") {
  const asset = {
    id: kind,
    name: `${kind} image`,
    url: `https://cdn.example.com/${kind}.png`,
    thumbnailUrl: `https://cdn.example.com/${kind}-thumb.png`,
  };
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ assets: [asset] }),
  } as Response);

  render(<ImageStudio projectId="project-1" />);
  const assetButton = await screen.findByTestId(`image-asset-${kind}`);
  fireEvent.click(assetButton);
  return screen.findByTestId("image-studio-canvas-frame");
}

describe("ImageStudio canvas fit regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubStageSize();
    vi.stubGlobal("Image", MockImage);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("bounds a square canvas by the fixed stage and its 720px width cap", async () => {
    const frame = await renderAndLoad("square");

    expect(frame.style.width).toBe("720px");
    expect(frame.style.height).toBe("720px");
    expect(Number.parseInt(frame.style.width, 10)).toBeLessThanOrEqual(1000);
    expect(Number.parseInt(frame.style.height, 10)).toBeLessThanOrEqual(800);

    const canvas = screen.getByTestId("image-studio-canvas");
    expect(canvas).toHaveAttribute("width", "1024");
    expect(canvas).toHaveAttribute("height", "1024");
    expect(canvas).toHaveClass("h-full", "w-full");
  });

  it("bounds a portrait canvas by both fixed stage dimensions and the 720px cap", async () => {
    const frame = await renderAndLoad("portrait");

    expect(frame.style.width).toBe("457px");
    expect(frame.style.height).toBe("800px");
    expect(Number.parseInt(frame.style.width, 10)).toBeLessThanOrEqual(720);
    expect(Number.parseInt(frame.style.height, 10)).toBeLessThanOrEqual(800);

    const canvas = screen.getByTestId("image-studio-canvas");
    expect(canvas).toHaveAttribute("width", "768");
    expect(canvas).toHaveAttribute("height", "1344");
    expect(canvas).toHaveClass("h-full", "w-full");
  });
});
