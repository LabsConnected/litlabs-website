/**
 * Game Cloud System for LiTT Code
 * Browser-based gaming with HTML5 games
 */

export type GameCategory = "retro" | "arcade" | "puzzle" | "multiplayer";
export type GamePlatform = "html5" | "browser" | "emulator" | "dos";

/**
 * Branding status for a game in the LiTT Arcade catalog.
 * - `original`: Fully owned by LiTTree, safe to brand as ours.
 * - `inspired`: Game mechanics inspired by a classic, reskinned/renamed. Not the original IP.
 * - `opensource`: Community open-source game, credited to original author.
 * - `licensed`: Properly licensed (not currently used but reserved).
 */
export type GameStatus = "original" | "inspired" | "opensource" | "licensed";

export interface Game {
  id: string;
  /** Original game title (for attribution / internal reference) */
  title: string;
  /** LiTT Arcade branded title shown on cards. If omitted, falls back to title. */
  brandTitle?: string;
  description: string;
  /** Short one-line tagline for card display (defaults to description if omitted) */
  tagline?: string;
  category: GameCategory;
  platform: GamePlatform;
  coverUrl: string;
  html5Url?: string;
  externalUrl?: string;
  sourceUrl?: string;
  license: "open-source" | "free-to-play" | "public-domain";
  licenseLabel: string;
  launchMode: "embedded" | "new-tab";
  year: number;
  developer: string;
  players: number;
  rating: number;
  tags: string[];
  plays: string;
  /** Branding: who owns this entry in the arcade */
  status: GameStatus;
  /** Attribution for inspired/opensource games (shown on detail view) */
  sourceAttribution?: string;
  /** Controls hint for detail modal (e.g. "Arrow keys + Space") */
  controlsHint?: string;
  progress?: number;
  difficulty?: "easy" | "medium" | "hard" | "expert";
  controls?: string[];
  achievements?: Achievement[];
  bestScore?: number;
  totalPlays?: number;
  playersToday?: number;
}

export interface SaveState {
  id: string;
  gameId: string;
  userId: string;
  stateData: string;
  createdAt: number;
  name: string;
}

export interface LeaderboardEntry {
  userId: string;
  username: string;
  score: number;
  timestamp: number;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  unlocked: boolean;
}

// LiTT Arcade game library — branded entries with honest attribution.
// Risky IP names (Tetris, Pac-Man, Flappy Bird, Pong) have been renamed
// to LiTT Arcade originals/editions. The original title is kept in `title`
// for internal reference; `brandTitle` is what users see on cards.
export const GAME_LIBRARY: Game[] = [
  {
    id: "xquest",
    title: "XQuest JS",
    brandTitle: "XQuest",
    description: "Momentum-based space combat with escalating enemy waves.",
    tagline: "Space shooter with momentum physics",
    category: "arcade",
    platform: "html5",
    coverUrl: "/games/artwork/xquest.png",
    html5Url: "https://scottrippey.github.io/xquestjs/",
    sourceUrl: "https://github.com/scottrippey/xquestjs",
    license: "open-source",
    licenseLabel: "Open source",
    launchMode: "embedded",
    year: 2024,
    developer: "Scott Rippey",
    players: 1,
    rating: 4.8,
    tags: ["space", "shooter", "action", "momentum"],
    plays: "New",
    status: "opensource",
    sourceAttribution: "Original game by Scott Rippey (MIT)",
    controlsHint: "Arrow keys to fly · Space to shoot",
  },
  {
    id: "pong",
    title: "Browser Pong",
    brandTitle: "Neon Paddle",
    description: "Two paddles, one ball, infinite rallies. The original arcade concept, reimagined.",
    tagline: "Paddle vs paddle — first to score wins",
    category: "retro",
    platform: "html5",
    coverUrl: "/games/artwork/pong.png",
    html5Url: "https://sethclydesdale.github.io/browser-pong/",
    sourceUrl: "https://github.com/SethClydesdale/browser-pong",
    license: "open-source",
    licenseLabel: "Open source",
    launchMode: "embedded",
    year: 1972,
    developer: "Seth Clydesdale",
    players: 2,
    rating: 4.5,
    tags: ["retro", "classic", "arcade"],
    plays: "12.8K",
    status: "inspired",
    sourceAttribution: "Inspired by the 1972 paddle sport concept. Browser build by Seth Clydesdale (GPL).",
    controlsHint: "W/S for left paddle · ↑/↓ for right paddle",
  },
  {
    id: "2048",
    title: "2048",
    brandTitle: "LiTT Merge",
    description: "Slide numbered tiles together to double their value. Reach 2048 to win.",
    tagline: "Merge tiles. Double values. Hit 2048.",
    category: "puzzle",
    platform: "html5",
    coverUrl: "/games/artwork/2048.png",
    html5Url: "https://gabrielecirulli.github.io/2048/",
    sourceUrl: "https://github.com/gabrielecirulli/2048",
    license: "open-source",
    licenseLabel: "MIT",
    launchMode: "embedded",
    year: 2014,
    developer: "Gabriele Cirulli",
    players: 1,
    rating: 4.5,
    tags: ["puzzle", "numbers", "minimalist"],
    plays: "28.6K",
    status: "opensource",
    sourceAttribution: "Original game by Gabriele Cirulli (MIT)",
    controlsHint: "Arrow keys to slide tiles",
  },
  {
    id: "hextris",
    title: "Hextris",
    brandTitle: "Hextris",
    description: "Fast-paced hexagon stacking puzzle. Spin the hex, match the colors.",
    tagline: "Hexagon reaction puzzle",
    category: "puzzle",
    platform: "html5",
    coverUrl: "/games/artwork/hextris.png",
    html5Url: "https://hextris.github.io/hextris/",
    sourceUrl: "https://github.com/Hextris/hextris",
    license: "open-source",
    licenseLabel: "GPL-3.0",
    launchMode: "embedded",
    year: 2014,
    developer: "Logan Engstrom",
    players: 1,
    rating: 4.3,
    tags: ["puzzle", "fast", "reaction"],
    plays: "31.4K",
    status: "opensource",
    sourceAttribution: "Original game by Logan Engstrom (GPL-3.0)",
    controlsHint: "Arrow keys to rotate the hexagon",
  },
  {
    id: "tetris-react",
    title: "Tetris",
    brandTitle: "Block Drop X",
    description: "Falling blocks, rotating pieces, vanishing lines. The stacking puzzle, reborn.",
    tagline: "Stack, rotate, clear lines",
    category: "puzzle",
    platform: "html5",
    coverUrl: "/games/artwork/tetris.png",
    html5Url: "https://chvin.github.io/react-tetris/",
    sourceUrl: "https://github.com/chvin/react-tetris",
    license: "open-source",
    licenseLabel: "MIT",
    launchMode: "embedded",
    year: 1984,
    developer: "chvin",
    players: 1,
    rating: 4.8,
    tags: ["puzzle", "classic", "blocks"],
    plays: "45.2K",
    status: "inspired",
    sourceAttribution: "Inspired by the falling-block puzzle genre. React build by chvin (MIT).",
    controlsHint: "←→ to move · ↑ to rotate · ↓ to drop",
  },
  {
    id: "pacman",
    title: "Pac-Man",
    brandTitle: "Maze Munch",
    description: "Dash through the maze, gobble every dot, dodge the ghosts. A maze-chase classic.",
    tagline: "Eat all dots. Dodge the ghosts.",
    category: "arcade",
    platform: "html5",
    coverUrl: "/games/artwork/pacman.png",
    html5Url: "https://pacman.platzh1rsch.ch/",
    license: "free-to-play",
    licenseLabel: "Community web edition",
    launchMode: "embedded",
    year: 1980,
    developer: "platzh1rsch",
    players: 1,
    rating: 4.9,
    tags: ["arcade", "classic", "maze"],
    plays: "52.1K",
    status: "inspired",
    sourceAttribution: "Inspired by the maze-chase genre. Community web build by platzh1rsch.",
    controlsHint: "Arrow keys to navigate the maze",
  },
  {
    id: "snake",
    title: "Snake Arcade",
    brandTitle: "Byte Snake",
    description: "Eat, grow, and don't crash into yourself. The classic snake game, neon-skinned.",
    tagline: "Eat. Grow. Don't crash.",
    category: "arcade",
    platform: "html5",
    coverUrl: "/games/artwork/snake.png",
    html5Url: "https://alfredang.github.io/snake-game/",
    sourceUrl: "https://github.com/alfredang/snake-game",
    license: "open-source",
    licenseLabel: "Source available",
    launchMode: "embedded",
    year: 1976,
    developer: "Alfred Ang",
    players: 1,
    rating: 4.4,
    tags: ["arcade", "classic", "reflexes"],
    plays: "19.2K",
    status: "inspired",
    sourceAttribution: "Inspired by the snake game concept. Browser build by Alfred Ang.",
    controlsHint: "Arrow keys to steer the snake",
  },
  {
    id: "sudoku",
    title: "Sudoku",
    brandTitle: "Number Grid",
    description: "Fill the 9×9 grid so every row, column, and box contains 1–9. Pure logic.",
    tagline: "9×9 logic puzzle. No math required.",
    category: "puzzle",
    platform: "html5",
    coverUrl: "/games/artwork/sudoku.png",
    html5Url: "https://aduh95.github.io/web-sudoku/",
    sourceUrl: "https://github.com/aduh95/web-sudoku",
    license: "open-source",
    licenseLabel: "Open source",
    launchMode: "embedded",
    year: 2004,
    developer: "aduh95",
    players: 1,
    rating: 4.4,
    tags: ["puzzle", "numbers", "logic"],
    plays: "15.8K",
    status: "opensource",
    sourceAttribution: "Original web build by aduh95 (open source)",
    controlsHint: "Click cell · Press 1–9 · Backspace to clear",
  },
  {
    id: "flappy",
    title: "Flappy Bird",
    brandTitle: "Pipe Hopper",
    description: "Tap to fly, weave between pipes, don't crash. One-button endurance test.",
    tagline: "Tap to fly. Dodge the pipes.",
    category: "arcade",
    platform: "html5",
    coverUrl: "/games/artwork/flappy.png",
    html5Url: "https://chaping.github.io/game/flappy-bird/",
    sourceUrl: "https://github.com/chaping/game",
    license: "open-source",
    licenseLabel: "Source available",
    launchMode: "embedded",
    year: 2013,
    developer: "chaping",
    players: 1,
    rating: 4.2,
    tags: ["arcade", "skill", "endless"],
    plays: "38.7K",
    status: "inspired",
    sourceAttribution: "Inspired by the tap-to-fly genre. Browser build by chaping.",
    controlsHint: "Space or Click to flap",
  },
  {
    id: "minesweeper",
    title: "Minesweeper",
    brandTitle: "Grid Sweep",
    description: "Clear the board without detonating a mine. Use logic, not luck.",
    tagline: "Clear the field. Don't blow up.",
    category: "puzzle",
    platform: "html5",
    coverUrl: "/games/artwork/minesweeper.png",
    html5Url: "https://minesweeper.github.io/",
    sourceUrl: "https://github.com/minesweeper/minesweeper",
    license: "open-source",
    licenseLabel: "Open source",
    launchMode: "embedded",
    year: 1990,
    developer: "minesweeper.github.io",
    players: 1,
    rating: 4.5,
    tags: ["puzzle", "logic", "classic"],
    plays: "22.3K",
    status: "opensource",
    sourceAttribution: "Original web build by minesweeper.github.io (open source)",
    controlsHint: "Click to reveal · Right-click to flag",
  },
];

export const STORAGE_KEYS = {
  saveStates: "litlabs-game-saves",
  lastPlayed: "litlabs-game-last",
  favorites: "litlabs-game-favs",
};

export function loadSaveStates(gameId: string): SaveState[] {
  if (typeof window === "undefined") return [];
  try {
    const allSaves = JSON.parse(
      localStorage.getItem(STORAGE_KEYS.saveStates) || "{}",
    );
    return allSaves[gameId] || [];
  } catch {
    return [];
  }
}

export function saveGameState(
  gameId: string,
  state: Omit<SaveState, "id" | "createdAt">,
): void {
  if (typeof window === "undefined") return;
  try {
    const allSaves = JSON.parse(
      localStorage.getItem(STORAGE_KEYS.saveStates) || "{}",
    );
    const gameSaves = allSaves[gameId] || [];
    const newSave: SaveState = {
      ...state,
      id: `save_${Date.now()}`,
      createdAt: Date.now(),
    };
    allSaves[gameId] = [...gameSaves, newSave].slice(-5); // Keep last 5 saves
    localStorage.setItem(STORAGE_KEYS.saveStates, JSON.stringify(allSaves));
  } catch {
    // Ignore storage errors
  }
}

export function getFavorites(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.favorites) || "[]");
  } catch {
    return [];
  }
}

export function toggleFavorite(gameId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const favs = getFavorites();
    const isFav = favs.includes(gameId);
    const newFavs = isFav
      ? favs.filter((id) => id !== gameId)
      : [...favs, gameId];
    localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(newFavs));
    return !isFav;
  } catch {
    return false;
  }
}

export function getGamesByCategory(category: GameCategory): Game[] {
  return GAME_LIBRARY.filter((g) => g.category === category);
}

export function getGamesByPlatform(): Game[] {
  return GAME_LIBRARY;
}

export function searchGames(query: string): Game[] {
  const q = query.toLowerCase();
  return GAME_LIBRARY.filter(
    (g) =>
      g.title.toLowerCase().includes(q) ||
      (g.brandTitle?.toLowerCase().includes(q) ?? false) ||
      g.description.toLowerCase().includes(q) ||
      (g.tagline?.toLowerCase().includes(q) ?? false) ||
      g.tags.some((t) => t.toLowerCase().includes(q)),
  );
}

/** Get the display title (brandTitle if set, otherwise title) */
export function getDisplayTitle(game: Game): string {
  return game.brandTitle ?? game.title;
}

/** Status badge label for card display */
export function getStatusLabel(status: GameStatus): string {
  switch (status) {
    case "original": return "LiTT Original";
    case "inspired": return "Inspired Classic";
    case "opensource": return "Open Source";
    case "licensed": return "Licensed";
  }
}

export function getGameById(id: string): Game | undefined {
  return GAME_LIBRARY.find((g) => g.id === id);
}
