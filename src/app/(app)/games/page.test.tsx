/**
 * Games page player overlay — regression tests.
 *
 * Covers the "make all my games work" pass:
 *  1. The player overlay renders above the cookie-consent banner (z-index).
 *  2. The overlay shows the game's controls hint so players know how to play.
 *  3. The game viewport has an explicit height so the iframe can't collapse.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Retro arcade storage touches IndexedDB — not present in jsdom. The
// components already degrade gracefully, so resolve to an empty library.
vi.mock("@/lib/retro-arcade", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/retro-arcade")>();
  return {
    ...mod,
    listRetroGames: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));

// PageShell pulls in the theme provider tree — stub it to a passthrough so
// this test exercises the games page's own overlay logic, not the shell.
vi.mock("@/components/PageShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import GamesPage from "./page";
import { GAME_LIBRARY } from "@/lib/games";

describe("GamesPage player overlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  function openFirstGame() {
    render(<GamesPage />);
    const game = GAME_LIBRARY[0];
    const playButton = screen.getByRole("button", {
      name: `Play ${game.brandTitle ?? game.title}`,
    });
    fireEvent.click(playButton);
    return game;
  }

  it("renders the player overlay above the cookie-consent banner", () => {
    openFirstGame();
    const overlay = screen.getByTitle(`${GAME_LIBRARY[0].title} game`).closest("div.fixed");
    expect(overlay).not.toBeNull();
    // CookieConsent uses z-[10000]; the player must sit above it.
    expect(overlay!.className).toMatch(/z-\[10001\]/);
  });

  it("shows the game's controls hint in the player footer", () => {
    const game = openFirstGame();
    expect(game.controlsHint).toBeTruthy();
    expect(screen.getByText(`🎮 ${game.controlsHint}`)).toBeTruthy();
  });

  it("gives the game viewport an explicit height so the iframe cannot collapse", () => {
    openFirstGame();
    const iframe = screen.getByTitle(`${GAME_LIBRARY[0].title} game`);
    const viewport = iframe.parentElement!;
    expect(viewport.style.height).toBeTruthy();
    expect(viewport.style.minHeight).toBeTruthy();
  });

  it("closes the overlay with the close button", () => {
    openFirstGame();
    fireEvent.click(screen.getByRole("button", { name: "Close game" }));
    expect(
      screen.queryByTitle(`${GAME_LIBRARY[0].title} game`),
    ).toBeNull();
  });
});
