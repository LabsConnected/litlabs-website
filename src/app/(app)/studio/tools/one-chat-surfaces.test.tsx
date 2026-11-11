import "@testing-library/jest-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";
import MusicTool from "./MusicTool";
import VideoTool from "./VideoTool";

/**
 * ONE-PROMPT contract (Larry, 2026-11-11; ART-20261111-035):
 * the LiTT chat is the single source of truth for text input. Creator
 * panes carry NO chat and NO prompt box of their own — the work itself
 * (player, stage, track list) plus non-text controls fill the pane.
 * Requests arrive from the one chat as staged drafts (the P1-1
 * initialPrompt channel) and are shown read-only; generation fires
 * from pane controls.
 *
 * Exempt by design (parameter / content fields, NOT chats):
 *  - Music: Title / Exclude-styles / Seed parameter inputs and the
 *    Lyrics content editor.
 *  - Image: the prompt parameter field (chat drafts land there via
 *    initialPrompt — see the lane report's classification).
 */

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    resolvedColors: { accentColor: "#a855f7" },
    tokens: {
      background: "#0b0b10",
      text: "#f2f2fa",
      textMuted: "#9a9ab0",
      textInverse: "#0b0b10",
      border: "#2c2c44",
      surface: "#141424",
      primary: "#a8ff2f",
      success: "#22c55e",
      warning: "#f59e0b",
      danger: "#ef4444",
    },
  }),
}));

vi.mock("@/context/WalletContext", () => ({
  useWallet: () => ({ balance: 100, refresh: () => Promise.resolve() }),
}));

vi.mock("@/hooks/use-music-generation", () => ({
  useMusicGeneration: () => ({
    status: "idle",
    progress: 0,
    error: null,
    lbcCharged: 0,
    lbcRefunded: false,
    tracks: [],
    isGenerating: false,
    isCancelling: false,
    startGeneration: vi.fn(),
    cancelGeneration: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-music-vault", () => ({
  useMusicVault: () => ({
    tracks: [],
    loading: false,
    deleteTrack: vi.fn(),
    updateTrack: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/context/MusicPlayerContext", () => ({
  useMusicPlayer: () => ({
    current: null,
    isPlaying: false,
    playTrack: vi.fn(),
    togglePlay: vi.fn(),
  }),
}));

vi.mock("@/lib/api-response", () => ({
  apiFetch: vi.fn(async () => ({})),
  readApiResponse: vi.fn(async () => ({})),
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

vi.mock("../components/music/TrackCard", () => ({
  default: () => null,
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

const fetchSpy = vi.fn(async (_input: unknown, _init?: unknown) =>
  new Response(JSON.stringify({}), { status: 200 }),
);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("fetch", fetchSpy);
});

describe("Music pane — one-prompt contract", () => {
  it("renders NO LiTT Music Producer side-chat (panel, messages, chat input all gone)", () => {
    render(<MusicTool />);
    expect(screen.queryByText("LiTT — Music Producer")).toBeNull();
    expect(screen.queryByPlaceholderText("Make this beat catchier…")).toBeNull();
    expect(screen.queryByLabelText("Send to producer")).toBeNull();
  });

  it("renders NO 'Describe your song' prompt box", () => {
    render(<MusicTool />);
    expect(screen.queryByText("Describe your song")).toBeNull();
    expect(
      screen.queryByPlaceholderText(/Dark melodic trap, distorted 808s/),
    ).toBeNull();
  });

  it("keeps only the lyrics CONTENT editor as a textarea (parameter/content fields exempt)", () => {
    const { container } = render(<MusicTool />);
    const areas = container.querySelectorAll("textarea");
    expect(areas).toHaveLength(1);
    expect(areas[0].getAttribute("placeholder")).toMatch(/Verse 1/);
  });

  it("still shows the work: rail, create modes and the track list region", () => {
    render(<MusicTool />);
    expect(screen.getByText("Library")).toBeTruthy();
    expect(screen.getByText("Recent Generations")).toBeTruthy();
    expect(screen.getByText("Quick Create")).toBeTruthy();
  });

  it("genre preset chips STAGE the prompt as read-only text (buttons, not typing)", () => {
    render(<MusicTool />);
    fireEvent.click(screen.getByRole("button", { name: /Energetic EDM/ }));
    const staged = screen.getByTestId("music-staged-prompt");
    expect(staged.textContent).toContain("Energetic EDM festival anthem");
    expect(staged.tagName).not.toBe("TEXTAREA");
    expect(staged.tagName).not.toBe("INPUT");
  });

  it("a chat draft (initialPrompt) is staged read-only — the one chat is the source", () => {
    render(<MusicTool initialPrompt="a rainy lo-fi beat" />);
    const staged = screen.getByTestId("music-staged-prompt");
    expect(staged.textContent).toContain("a rainy lo-fi beat");
  });

  it("producer transforms are local CONTROLS: 'Make Harder' changes Energy and never calls the producer chat API", () => {
    render(<MusicTool />);
    // Energy readout lives in the Custom controls — open that tab first.
    fireEvent.click(screen.getByRole("button", { name: /^Custom$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Make Harder/ }));
    // Energy slider readout moves 5/10 -> 7/10 (observable control effect).
    expect(screen.getByText("7/10")).toBeTruthy();
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/api/music/producer"))).toBe(false);
  });
});

describe("Video pane — one-prompt contract", () => {
  it("renders NO per-surface prompt input ('Describe your shot' textarea gone)", () => {
    const { container } = render(<VideoTool />);
    expect(screen.queryByTestId("video-prompt-input")).toBeNull();
    expect(container.querySelectorAll("textarea")).toHaveLength(0);
  });

  it("a chat draft (initialPrompt) is staged READ-ONLY and arms Generate", () => {
    render(<VideoTool initialPrompt="ocean waves at dusk" />);
    const staged = screen.getByTestId("video-staged-prompt");
    expect(staged.textContent).toContain("ocean waves at dusk");
    expect(staged.tagName).not.toBe("TEXTAREA");
    const generate = screen.getByRole("button", { name: /Generate ·/ });
    expect(generate).not.toBeDisabled();
  });

  it("mode tabs are CONTROLS with an observable stage readout (mode + model change)", () => {
    render(<VideoTool />);
    const meta = screen.getByTestId("video-stage-meta");
    expect(meta.textContent).toContain("Quick Create");
    expect(meta.textContent).toContain("Veo");

    const quick = screen.getByRole("button", { name: /Quick Create/ });
    expect(quick.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /Animate Image/ }));
    const meta2 = screen.getByTestId("video-stage-meta");
    expect(meta2.textContent).toContain("Animate Image");
    expect(meta2.textContent).toContain("HappyHorse");

    fireEvent.click(screen.getByRole("button", { name: /Director/ }));
    expect(screen.getByTestId("video-stage-meta").textContent).toContain("Director");
    // Director reveals the shot-control chip rows.
    expect(screen.getByText("Camera")).toBeTruthy();
    expect(screen.getByText("Composition")).toBeTruthy();
  });
});

describe("one-prompt sweep — source pins", () => {
  const read = (rel: string) =>
    fs.readFileSync(path.join(process.cwd(), rel), "utf8");

  it("MusicTool source has no producer chat client left", () => {
    const src = read("src/app/(app)/studio/tools/MusicTool.tsx");
    expect(src).not.toContain("/api/music/producer");
    expect(src).not.toContain("producerInput");
    expect(src).not.toContain("Music Producer");
  });

  it("VideoTool source has no prompt input left", () => {
    const src = read("src/app/(app)/studio/tools/VideoTool.tsx");
    expect(src).not.toContain("video-prompt-input");
    expect(src).not.toContain("Describe your shot");
  });

  it("ImageTool prompt parameter field + generate flow are untouched (flagged exemption)", () => {
    const src = read("src/app/(app)/studio/tools/ImageTool.tsx");
    expect(src).toContain("initialPrompt");
    expect(src).toContain("/api/media/generate");
  });
});
