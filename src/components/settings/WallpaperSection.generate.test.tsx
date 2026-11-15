import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { WallpaperSection } from "./WallpaperSection";

// Board-only rebuild (Larry 2026-11-14, checklist item 7c): "Generate
// wallpaper with LiTT" was a bare link to /studio?tool=image&intent=
// wallpaper — an intent no code read. It must actually generate through
// /api/media/generate and set the wallpaper via updateProfile.

const updateProfile = vi.fn();

vi.mock("@/context/ProfileContext", () => ({
  useProfile: () => ({
    profile: {
      wallpaper: "mesh",
      customWallpaperUrl: null,
      wallpaperOverlay: 0.3,
      wallpaperBlur: 0,
      wallpaperFit: "cover",
      wallpaperEffect: "none",
    },
    updateProfile,
  }),
}));

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("WallpaperSection — Generate wallpaper with LiTT (item 7c)", () => {
  let fetchBodies: Record<string, unknown>[] = [];

  beforeEach(() => {
    updateProfile.mockClear();
    fetchBodies = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders built-in prompt options and no dead Studio link", () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));
    const { container } = render(<WallpaperSection />);
    expect(screen.getByTestId("wallpaper-generate")).toBeTruthy();
    expect(screen.getAllByTestId("wallpaper-generate-preset")).toHaveLength(4);
    expect(container.querySelector('a[href*="intent=wallpaper"]')).toBeNull();
  });

  it("a preset fills the prompt box", () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));
    render(<WallpaperSection />);
    // Index 1 is the "Nebula" preset (a wallpaper card shares the name).
    fireEvent.click(screen.getAllByTestId("wallpaper-generate-preset")[1]);
    const input = screen.getByTestId("wallpaper-generate-prompt") as HTMLInputElement;
    expect(input.value).toMatch(/nebula/i);
  });

  it("generates via /api/media/generate and sets the wallpaper on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/api/media/generate")) {
          fetchBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return jsonResponse({
            success: true,
            downloadUrl: "https://cdn.example/wallpaper.png",
            assetId: "generation_job:1",
          });
        }
        return jsonResponse({});
      }),
    );
    render(<WallpaperSection />);
    fireEvent.click(screen.getByTestId("wallpaper-generate"));

    await waitFor(() => expect(updateProfile).toHaveBeenCalled());
    expect(fetchBodies).toHaveLength(1);
    expect(fetchBodies[0].generationMode).toBe("auto-free");
    expect(String(fetchBodies[0].prompt)).toMatch(/wallpaper/i);
    expect(updateProfile).toHaveBeenCalledWith({
      wallpaper: "custom",
      customWallpaperUrl: "https://cdn.example/wallpaper.png",
    });
    expect(screen.getByTestId("wallpaper-generate-done")).toBeTruthy();
  });

  it("shows the server's honest error and sets nothing on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/api/media/generate")) {
          return jsonResponse(
            { success: false, code: "NO_PROVIDER", error: "No image provider is configured" },
            422,
          );
        }
        return jsonResponse({});
      }),
    );
    render(<WallpaperSection />);
    fireEvent.click(screen.getByTestId("wallpaper-generate"));

    await waitFor(() => expect(screen.getByTestId("wallpaper-generate-error")).toBeTruthy());
    expect(screen.getByTestId("wallpaper-generate-error").textContent).toMatch(
      /No image provider is configured/,
    );
    expect(updateProfile).not.toHaveBeenCalled();
  });
});
