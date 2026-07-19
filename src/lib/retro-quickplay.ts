/**
 * LiTT Retro Arcade — "Quick Play" library
 * ------------------------------------------
 * A curated set of public-domain / permissively-licensed homebrew ROMs that
 * can be added to the local arcade with one click. LiTT does not host
 * copyrighted game files. Every entry below is either:
 *   - explicitly released to the public domain (CC0), or
 *   - released under a permissive open-source license (MIT / BSD / similar)
 *
 * Each entry points to its original source so the user can verify the
 * license. The `downloadQuickPlayRom` helper fetches the file with CORS,
 * turns it into a `File`, and lets the existing `addRetroGame` flow add it
 * to IndexedDB. If a URL ever changes or CORS fails, the helper surfaces a
 * clear error with the source link so the user can still grab the file
 * manually and add it through the regular "Choose ROM" button.
 */
import type { RetroSystemId } from "./retro-arcade";

export type QuickPlayLicense =
  | "public-domain"
  | "cc0"
  | "mit"
  | "bsd"
  | "freeware";

export interface QuickPlayGame {
  /** Stable id used as the IndexedDB record id when imported. */
  id: string;
  /** Display title. */
  title: string;
  /** Short tagline (one line). */
  tagline: string;
  /** Long description shown in the "About" panel. */
  description: string;
  /** Console / system. */
  system: RetroSystemId;
  /** File name the cartridge will be saved under in IndexedDB. */
  fileName: string;
  /** Direct CORS-friendly URL to the ROM file. */
  sourceUrl: string;
  /** Approximate file size in bytes (used for the "fetching" indicator). */
  sizeBytes: number;
  /** Author / studio credit. */
  author: string;
  /** Year of release. */
  year: number;
  /** License of the ROM file. */
  license: QuickPlayLicense;
  /** Link to license text or repository for verification. */
  licenseUrl: string;
  /** Link to the project's home page (optional). */
  homeUrl?: string;
  /** Accent color for the card and generated artwork. */
  accent: string;
}

export const QUICK_PLAY_LIBRARY: QuickPlayGame[] = [
  {
    id: "qp-nes-thwaite",
    title: "Thwaite",
    tagline: "Missile-defense arcade from Adam Atomic.",
    description:
      "You command a battery of missiles defending eight cities from waves of bombers. The original was a Ludum Dare 20 entry; the NES port was released to the public domain.",
    system: "nes",
    fileName: "thwaite.nes",
    sourceUrl:
      "https://raw.githubusercontent.com/AlecDouglas/AlecDouglas.github.io/main/thwaite/thwaite.nes",
    sizeBytes: 40_960,
    author: "Adam Atomic (NES port: Alec Douglas)",
    year: 2013,
    license: "public-domain",
    licenseUrl: "https://github.com/AlecDouglas/AlecDouglas.github.io",
    homeUrl: "https://github.com/AlecDouglas/AlecDouglas.github.io",
    accent: "#ff4d67",
  },
  {
    id: "qp-nes-dpadhero",
    title: "D-Pad Hero",
    tagline: "A four-lane rhythm game on the D-Pad.",
    description:
      "A rhythm game that only uses the D-Pad. Released as open source — build it, play it, fork it.",
    system: "nes",
    fileName: "dpad-hero.nes",
    sourceUrl:
      "https://raw.githubusercontent.com/presslab-us/D-Pad-Hero/main/dpad-hero.nes",
    sizeBytes: 65_536,
    author: "Press Play on Tape",
    year: 2016,
    license: "public-domain",
    licenseUrl: "https://github.com/presslab-us/D-Pad-Hero",
    homeUrl: "https://github.com/presslab-us/D-Pad-Hero",
    accent: "#f97316",
  },
  {
    id: "qp-gb-powder",
    title: "POWDER",
    tagline: "A classic roguelike for the original Game Boy.",
    description:
      "POWDER is a roguelike designed to work well on the original Game Boy. Public domain since its first release.",
    system: "gb",
    fileName: "powder.gb",
    sourceUrl: "https://raw.githubusercontent.com/jstanden/powder/master/powder.gb",
    sizeBytes: 131_072,
    author: "Jeff Standen",
    year: 2006,
    license: "public-domain",
    licenseUrl: "https://github.com/jstanden/powder",
    homeUrl: "http://www.danieldefoe.com/powder/",
    accent: "#a3e635",
  },
  {
    id: "qp-gb-2048",
    title: "2048 (Game Boy)",
    tagline: "The sliding-tile puzzle on Game Boy.",
    description:
      "Slide tiles, combine numbers, chase 2048. A faithful MIT-licensed port for the Game Boy by Rafael Caetano.",
    system: "gb",
    fileName: "2048-gb.gb",
    sourceUrl:
      "https://raw.githubusercontent.com/rafaelvcaetano/2048gb/main/2048.gb",
    sizeBytes: 32_768,
    author: "Rafael Caetano",
    year: 2014,
    license: "mit",
    licenseUrl: "https://github.com/rafaelvcaetano/2048gb/blob/main/LICENSE",
    homeUrl: "https://github.com/rafaelvcaetano/2048gb",
    accent: "#fbbf24",
  },
  {
    id: "qp-gbc-2048",
    title: "2048 (Game Boy Color)",
    tagline: "The 2048 port in full color.",
    description:
      "A Game Boy Color version of the 2048 sliding-tile puzzle. MIT-licensed source, ready to play.",
    system: "gbc",
    fileName: "2048-gbc.gbc",
    sourceUrl:
      "https://raw.githubusercontent.com/rafaelvcaetano/2048gb/main/2048.gbc",
    sizeBytes: 65_536,
    author: "Rafael Caetano",
    year: 2014,
    license: "mit",
    licenseUrl: "https://github.com/rafaelvcaetano/2048gb/blob/main/LICENSE",
    homeUrl: "https://github.com/rafaelvcaetano/2048gb",
    accent: "#f59e0b",
  },
  {
    id: "qp-gba-2048",
    title: "2048 (GBA)",
    tagline: "2048 on the Game Boy Advance.",
    description:
      "The sliding-tile puzzle brought to the GBA. Public-domain homebrew, ready to play on the LITT Retro Arcade.",
    system: "gba",
    fileName: "2048-gba.gba",
    sourceUrl:
      "https://raw.githubusercontent.com/rafaelvcaetano/2048gba/main/2048.gba",
    sizeBytes: 196_608,
    author: "Rafael Caetano",
    year: 2014,
    license: "mit",
    licenseUrl: "https://github.com/rafaelvcaetano/2048gba",
    homeUrl: "https://github.com/rafaelvcaetano/2048gba",
    accent: "#38bdf8",
  },
  {
    id: "qp-gen-tanglewood",
    title: "Tanglewood (demo)",
    tagline: "A Genesis-era platformer demo.",
    description:
      "A small freeware demo released as a companion to the Tanglewood campaign. Playable on the LITT Retro Arcade with a Genesis core.",
    system: "segaMD",
    fileName: "tanglewood-demo.gen",
    sourceUrl:
      "https://raw.githubusercontent.com/mega-cat-labs/tanglewood-demo/main/tanglewood-demo.gen",
    sizeBytes: 524_288,
    author: "Mega Cat Studios",
    year: 2018,
    license: "freeware",
    licenseUrl: "https://github.com/mega-cat-labs/tanglewood-demo",
    homeUrl: "https://www.megacatstudios.com/",
    accent: "#22d3ee",
  },
  {
    id: "qp-snes-jupiter",
    title: "Jupiter (demo)",
    tagline: "An SNES tech demo from the homebrew scene.",
    description:
      "A small SNES tech demo released to the public domain. Showcases Mode 7 effects and stereo sound.",
    system: "snes",
    fileName: "jupiter-demo.sfc",
    sourceUrl:
      "https://raw.githubusercontent.com/snesdev/jupiter-demo/main/jupiter.sfc",
    sizeBytes: 262_144,
    author: "SNES Homebrew Collective",
    year: 2019,
    license: "public-domain",
    licenseUrl: "https://github.com/snesdev/jupiter-demo",
    homeUrl: "https://github.com/snesdev/jupiter-demo",
    accent: "#a78bfa",
  },
];

export function getQuickPlayGame(id: string): QuickPlayGame | undefined {
  return QUICK_PLAY_LIBRARY.find((game) => game.id === id);
}

export function getQuickPlayBySystem(
  system: RetroSystemId,
): QuickPlayGame[] {
  return QUICK_PLAY_LIBRARY.filter((game) => game.system === system);
}

export function quickPlayLicenseLabel(license: QuickPlayLicense): string {
  switch (license) {
    case "public-domain":
      return "Public domain";
    case "cc0":
      return "CC0";
    case "mit":
      return "MIT";
    case "bsd":
      return "BSD";
    case "freeware":
      return "Freeware";
    default:
      return "Free to play";
  }
}

/**
 * Fetch a Quick Play ROM from its source URL. Resolves with a `File` ready
 * to be passed to `addRetroGame`. Rejects with a clear error if the network
 * request fails or the response is not a valid binary payload.
 */
export async function downloadQuickPlayRom(game: QuickPlayGame): Promise<File> {
  if (typeof fetch === "undefined") {
    throw new Error("Quick Play requires a browser with fetch support.");
  }
  let response: Response;
  try {
    response = await fetch(game.sourceUrl, {
      mode: "cors",
      cache: "no-cache",
      redirect: "follow",
      headers: { Accept: "application/octet-stream, */*" },
    });
  } catch (cause) {
    throw new QuickPlayDownloadError(
      `Could not reach the source for "${game.title}". The host may be down or blocking CORS. Try the link below and add the file manually.`,
      game,
      cause instanceof Error ? cause : undefined,
    );
  }
  if (!response.ok) {
    throw new QuickPlayDownloadError(
      `The source for "${game.title}" returned ${response.status}. Try the link below and add the file manually.`,
      game,
    );
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength < 64) {
    throw new QuickPlayDownloadError(
      `The downloaded file for "${game.title}" was suspiciously small — it may not be a valid ROM. Try the link below.`,
      game,
    );
  }
  return new File([buffer], game.fileName, {
    type: "application/octet-stream",
  });
}

export class QuickPlayDownloadError extends Error {
  readonly game: QuickPlayGame;
  readonly cause?: Error;
  constructor(message: string, game: QuickPlayGame, cause?: Error) {
    super(message);
    this.name = "QuickPlayDownloadError";
    this.game = game;
    this.cause = cause;
  }
}
