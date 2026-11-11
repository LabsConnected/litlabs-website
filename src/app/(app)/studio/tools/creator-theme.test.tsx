import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";
import { ThemeProvider } from "@/context/ThemeContext";
import ImageTool from "./ImageTool";
import VideoTool from "./VideoTool";
import AudioTool from "./AudioTool";

/**
 * Creator theme compliance — the creator panes must follow the APPLIED
 * theme (useTheme tokens), in both directions. Regression contract for
 * the hard-coded-dark defect: ImageTool styled itself through the
 * :root --glass-* aliases (bound to the dark Glass OS values), and
 * VideoTool/AudioTool hard-coded a #050508 root with white text, so all
 * three rendered dark-purple/black under the light LiTT Signature
 * theme while the rest of Studio followed the theme.
 *
 * Themes are pinned via customColors so the expected token values are
 * exact and independent of the skin tables.
 */

vi.mock("@/context/WalletContext", () => ({
  useWallet: () => ({ balance: 100, refresh: () => Promise.resolve() }),
}));
vi.mock("../context/StudioContext", () => ({
  useStudioContext: () => ({
    projectId: "proj-test-1",
    sessionId: "sess-1",
    setActiveAssetId: vi.fn(),
  }),
}));
vi.mock("../hooks/useAssetsRefresh", () => ({
  notifyAssetsChanged: vi.fn(),
  useAssetsRefreshTrigger: () => 0,
}));
vi.mock("../components/GenerationHistoryCard", () => ({
  default: () => null,
}));
vi.mock("@/lib/api-response", () => ({
  apiFetch: vi.fn(async () => ({})),
  readApiResponse: vi.fn(async () => ({})),
}));
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));
vi.mock("framer-motion", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, useReducedMotion: () => true };
});

const LIGHT_THEME = {
  mode: "light",
  skin: "signature",
  accent: "signature-green",
  backgroundMode: "minimal",
  layoutStyle: "classic",
  customColors: {
    bgColor: "#ffffff",
    textColor: "#10240f",
    boxBg: "#eef5e9",
    borderColor: "#c9dcbf",
    accentColor: "#1d7a35",
    linkColor: "#1d7a35",
    headerColor: "#10240f",
  },
};

const DARK_THEME = {
  mode: "dark",
  skin: "volcanic",
  accent: "lime",
  backgroundMode: "nebula",
  layoutStyle: "classic",
  customColors: {
    bgColor: "#0a0a14",
    textColor: "#f2f2fa",
    boxBg: "#141424",
    borderColor: "#2c2c44",
    accentColor: "#a8ff2f",
    linkColor: "#a8ff2f",
    headerColor: "#f2f2fa",
  },
};

function seedTheme(theme: unknown) {
  localStorage.setItem("litlabs-theme", JSON.stringify(theme));
}

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(JSON.stringify({}), { status: 200 }),
  );
});

describe("creator panes follow the applied theme", () => {
  it("ImageTool root + empty state render the applied LIGHT theme (not hard-coded dark)", async () => {
    seedTheme(LIGHT_THEME);
    const { container } = renderWithTheme(<ImageTool />);
    const root = container.firstElementChild as HTMLElement;
    // ThemeProvider applies the stored theme after a rAF-gated mount.
    // Wait on the text color: it differs between the default theme and
    // the seeded one, while the background is white under both.
    await waitFor(() => expect(root.style.color).toBe("rgb(16, 36, 15)"));
    expect(root.style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(screen.getByText("Create your first image").style.color).toBe("rgb(16, 36, 15)");
  });

  it("ImageTool root renders the applied DARK theme (both directions, not hard-coded light)", async () => {
    seedTheme(DARK_THEME);
    const { container } = renderWithTheme(<ImageTool />);
    const root = container.firstElementChild as HTMLElement;
    await waitFor(() => expect(root.style.backgroundColor).toBe("rgb(10, 10, 20)"));
    expect(root.style.color).toBe("rgb(242, 242, 250)");
  });

  it("VideoTool root + title render the applied LIGHT theme", async () => {
    seedTheme(LIGHT_THEME);
    const { container } = renderWithTheme(<VideoTool />);
    const root = container.firstElementChild as HTMLElement;
    await waitFor(() => expect(root.style.color).toBe("rgb(16, 36, 15)"));
    expect(root.style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(screen.getByText("LiTT Video Lab").style.color).toBe("rgb(16, 36, 15)");
  });

  it("VideoTool root renders the applied DARK theme", async () => {
    seedTheme(DARK_THEME);
    const { container } = renderWithTheme(<VideoTool />);
    const root = container.firstElementChild as HTMLElement;
    await waitFor(() => expect(root.style.backgroundColor).toBe("rgb(10, 10, 20)"));
  });

  it("AudioTool root + title render the applied LIGHT theme", async () => {
    seedTheme(LIGHT_THEME);
    const { container } = renderWithTheme(<AudioTool />);
    const root = container.firstElementChild as HTMLElement;
    await waitFor(() => expect(root.style.color).toBe("rgb(16, 36, 15)"));
    expect(root.style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(screen.getByText("LiTT Audio Lab").style.color).toBe("rgb(16, 36, 15)");
  });

  it("AudioTool root renders the applied DARK theme", async () => {
    seedTheme(DARK_THEME);
    const { container } = renderWithTheme(<AudioTool />);
    const root = container.firstElementChild as HTMLElement;
    await waitFor(() => expect(root.style.backgroundColor).toBe("rgb(10, 10, 20)"));
  });
});

describe("creator sources carry no hard-coded dark surface styling", () => {
  const read = (rel: string) =>
    fs.readFileSync(path.resolve(__dirname, rel), "utf8");

  it("ImageTool no longer styles surfaces through the :root --glass-* aliases or glass classes", () => {
    const src = read("./ImageTool.tsx");
    expect(src).not.toContain("var(--glass-");
    expect(src).not.toContain("glass-panel");
    expect(src).not.toContain("glass-toolbar");
    expect(src).not.toContain("glass-button-secondary");
  });

  it("VideoTool / AudioTool roots are not hard-coded #050508 and titles are not text-white", () => {
    for (const rel of ["./VideoTool.tsx", "./AudioTool.tsx"]) {
      const src = read(rel);
      expect(src).not.toContain('"#050508"');
      expect(src).not.toContain("#080710");
    }
  });
});
