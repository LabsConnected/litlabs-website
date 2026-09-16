/**
 * Self-hosted games — regression tests.
 *
 * 2048 and Hextris used to load from third-party hosts. The 2048 host
 * (gabrielecirulli.github.io/2048) started redirecting to play2048.co, which
 * sends `frame-ancestors 'self'` and renders a broken page inside our player.
 * The Hextris host (hextris.github.io/hextris) 301s to hextris.io, which is
 * unreachable. Both games are now vendored under public/games/play so they
 * can never be broken by an upstream host change again.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { GAME_LIBRARY, getGameById } from "@/lib/games";

const REPO_ROOT = join(__dirname, "..", "..");

describe("self-hosted games", () => {
  it("serves 2048 and Hextris from same-origin relative URLs", () => {
    for (const id of ["2048", "hextris"]) {
      const game = getGameById(id);
      expect(game).toBeDefined();
      expect(game!.launchMode).toBe("embedded");
      // A relative URL can never be broken by a third-party redirect or
      // frame-ancestors block.
      expect(game!.html5Url).toMatch(/^\//);
      // The /games app route swallows extensionless directory URLs under it
      // (e.g. /games/play/2048/ 404s), so self-hosted games must point at
      // the index.html file explicitly.
      expect(game!.html5Url).toMatch(/\/index\.html$/);
    }
  });

  it("has the vendored game files in public/", () => {
    expect(existsSync(join(REPO_ROOT, "public/games/play/2048/index.html"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "public/games/play/hextris/index.html"))).toBe(true);
    // Key assets the games need at load time.
    expect(existsSync(join(REPO_ROOT, "public/games/play/2048/js/game_manager.js"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "public/games/play/hextris/js/main.js"))).toBe(true);
  });

  it("ships the vendored license files for attribution", () => {
    expect(existsSync(join(REPO_ROOT, "public/games/play/2048/LICENSE.txt"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "public/games/play/hextris/LICENSE.md"))).toBe(true);
  });

  it("does not bundle third-party ad/tracking scripts in the vendored games", () => {
    const hextrisHtml = readFileSync(
      join(REPO_ROOT, "public/games/play/hextris/index.html"),
      "utf8",
    );
    const hextrisMain = readFileSync(
      join(REPO_ROOT, "public/games/play/hextris/js/main.js"),
      "utf8",
    );
    expect(hextrisHtml).not.toMatch(/adsbygoogle|googlesyndication/);
    // No analytics/tracking beacons phoning home to the original authors.
    for (const f of ["index.html", "js/initialization.js"]) {
      const src = readFileSync(join(REPO_ROOT, "public/games/play/hextris", f), "utf8");
      expect(src).not.toMatch(/google-analytics|GoogleAnalyticsObject|googletagmanager/);
    }
    expect(hextrisMain).not.toMatch(/hextris\.io\/a\.js/);
  });

  it("keeps source attribution pointing at the upstream repos", () => {
    expect(getGameById("2048")!.sourceUrl).toBe("https://github.com/gabrielecirulli/2048");
    expect(getGameById("hextris")!.sourceUrl).toBe("https://github.com/Hextris/hextris");
  });

  it("every game in the library has a playable launch URL", () => {
    for (const game of GAME_LIBRARY) {
      expect(game.html5Url, `${game.id} html5Url`).toBeTruthy();
      if (game.launchMode === "embedded") {
        expect(game.html5Url, `${game.id} html5Url`).toMatch(/^(https?:\/\/|\/)/);
      }
    }
  });
});
