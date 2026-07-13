/**
 * Game Cloud System for LiTTree-LabStudios
 * Browser-based gaming with HTML5 games
 */

export type GameCategory =
  | "retro"
  | "arcade"
  | "puzzle"
  | "multiplayer"
  | "emulator";
export type GamePlatform = "html5" | "emulator" | "dos" | "browser";
export type EmulatorEngine = "emulatorjs" | "jsdos";

export interface Game {
  id: string;
  title: string;
  description: string;
  category: GameCategory;
  platform: GamePlatform;
  coverUrl: string;
  html5Url?: string;
  externalUrl?: string;
  emulator?: EmulatorEngine;
  year: number;
  developer: string;
  players: number;
  rating: number;
  tags: string[];
  plays: string;
  license?: string;
  sourceUrl?: string;
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

// Demo game library - in production, this would come from a database
export const GAME_LIBRARY: Game[] = [
  // HTML5 Games - Verified iframe-friendly embeds
  {
    id: "pong",
    title: "Browser Pong",
    description: "Classic Atari Pong in your browser.",
    category: "retro",
    platform: "html5",
    coverUrl:
      "https://image.pollinations.ai/prompt/retro%20arcade%20pong%20game%20cover%20neon%20dark%20background%20minimal?width=400&height=250&nologo=true&seed=101",
    html5Url: "https://sethclydesdale.github.io/browser-pong/",
    year: 1972,
    developer: "Atari",
    players: 2,
    rating: 4.5,
    tags: ["retro", "classic", "arcade"],
    plays: "12.8K",
  },
  {
    id: "2048",
    title: "2048",
    description: "Slide tiles to reach the legendary 2048 tile.",
    category: "puzzle",
    platform: "html5",
    coverUrl:
      "https://image.pollinations.ai/prompt/2048%20puzzle%20game%20cover%20numbered%20tiles%20dark%20background%20minimal?width=400&height=250&nologo=true&seed=202",
    html5Url: "https://gabrielecirulli.github.io/2048/",
    year: 2014,
    developer: "Gabriele Cirulli",
    players: 1,
    rating: 4.5,
    tags: ["puzzle", "numbers", "minimalist"],
    plays: "28.6K",
  },
  {
    id: "hextris",
    title: "Hextris",
    description: "Fast-paced hexagon stacking puzzle.",
    category: "puzzle",
    platform: "html5",
    coverUrl:
      "https://image.pollinations.ai/prompt/hextris%20hexagon%20stacking%20puzzle%20game%20cover%20colorful%20neon%20dark%20background?width=400&height=250&nologo=true&seed=303",
    html5Url: "https://hextris.github.io/hextris/",
    year: 2014,
    developer: "Logan Engstrom",
    players: 1,
    rating: 4.3,
    tags: ["puzzle", "fast", "reaction"],
    plays: "31.4K",
  },
  {
    id: "tetris-react",
    title: "Tetris",
    description: "Classic block-stacking puzzle game.",
    category: "puzzle",
    platform: "html5",
    coverUrl:
      "https://image.pollinations.ai/prompt/tetris%20block%20puzzle%20game%20cover%20retro%20neon%20falling%20blocks%20dark%20background?width=400&height=250&nologo=true&seed=404",
    html5Url: "https://chvin.github.io/react-tetris/",
    year: 1984,
    developer: "Alexey Pajitnov",
    players: 1,
    rating: 4.8,
    tags: ["puzzle", "classic", "blocks"],
    plays: "45.2K",
  },
  {
    id: "pacman",
    title: "Pac-Man",
    description: "The classic arcade maze chase.",
    category: "arcade",
    platform: "html5",
    coverUrl:
      "https://image.pollinations.ai/prompt/pacman%20arcade%20maze%20game%20cover%20neon%20yellow%20character%20dark%20background?width=400&height=250&nologo=true&seed=505",
    html5Url: "https://pacman.platzh1rsch.ch/",
    year: 1980,
    developer: "Namco",
    players: 1,
    rating: 4.9,
    tags: ["arcade", "classic", "maze"],
    plays: "52.1K",
  },
  {
    id: "snake",
    title: "Snake Arcade",
    description: "Eat, grow, and don't crash into yourself.",
    category: "arcade",
    platform: "html5",
    coverUrl:
      "https://image.pollinations.ai/prompt/retro%20snake%20arcade%20game%20cover%20neon%20green%20pixel%20snake%20dark%20background?width=400&height=250&nologo=true&seed=606",
    html5Url: "https://alfredang.github.io/snake-game/",
    year: 1976,
    developer: "Various",
    players: 1,
    rating: 4.4,
    tags: ["arcade", "classic", "reflexes"],
    plays: "19.2K",
  },
  {
    id: "sudoku",
    title: "Sudoku",
    description: "Fill the grid with numbers 1–9.",
    category: "puzzle",
    platform: "html5",
    coverUrl:
      "https://image.pollinations.ai/prompt/sudoku%20puzzle%20game%20cover%20numbers%20grid%20dark%20background%20minimal?width=400&height=250&nologo=true&seed=707",
    html5Url: "https://www.sudoku100.com/embed/interactive",
    year: 2004,
    developer: "Various",
    players: 1,
    rating: 4.4,
    tags: ["puzzle", "numbers", "logic"],
    plays: "15.8K",
  },
  {
    id: "flappy",
    title: "Flappy Bird",
    description: "Tap to fly between the pipes.",
    category: "arcade",
    platform: "html5",
    coverUrl:
      "https://image.pollinations.ai/prompt/flappy%20bird%20arcade%20game%20cover%20pixel%20art%20bird%20pipes%20dark%20background?width=400&height=250&nologo=true&seed=808",
    html5Url: "https://chaping.github.io/game/flappy-bird/",
    year: 2013,
    developer: "Dong Nguyen",
    players: 1,
    rating: 4.2,
    tags: ["arcade", "skill", "endless"],
    plays: "38.7K",
  },
  {
    id: "minesweeper",
    title: "Minesweeper",
    description: "Clear the board without detonating a mine.",
    category: "puzzle",
    platform: "html5",
    coverUrl:
      "https://image.pollinations.ai/prompt/minesweeper%20puzzle%20game%20cover%20retro%20mines%20grid%20dark%20background?width=400&height=250&nologo=true&seed=909",
    html5Url: "https://minesweeper.github.io/",
    year: 1990,
    developer: "Microsoft",
    players: 1,
    rating: 4.5,
    tags: ["puzzle", "logic", "classic"],
    plays: "22.3K",
  },
  // More freeware HTML5 games
  {
    id: "chess",
    title: "Chess",
    description: "Classic chess with a clean board and AI opponent.",
    category: "puzzle",
    platform: "html5",
    coverUrl:
      "https://image.pollinations.ai/prompt/chess%20board%20game%20cover%20dark%20elegant%20minimal?width=400&height=250&nologo=true&seed=110",
    html5Url: "https://chess.com/play/computer",
    year: 1475,
    developer: "Chess.com",
    players: 2,
    rating: 4.7,
    tags: ["puzzle", "strategy", "classic"],
    plays: "85.1K",
    license: "Freeware",
  },
  {
    id: "wordle",
    title: "Wordle",
    description: "Guess the five-letter word in six tries.",
    category: "puzzle",
    platform: "html5",
    coverUrl:
      "https://image.pollinations.ai/prompt/wordle%20word%20game%20cover%20colorful%20tiles%20dark%20background?width=400&height=250&nologo=true&seed=111",
    html5Url: "https://wordleplay.com/",
    year: 2021,
    developer: "Josh Wardle",
    players: 1,
    rating: 4.6,
    tags: ["puzzle", "word", "daily"],
    plays: "91.2K",
    license: "Freeware",
  },
  {
    id: "asteroids",
    title: "Asteroids",
    description: "Blast asteroids and UFOs in vector arcade action.",
    category: "arcade",
    platform: "html5",
    coverUrl:
      "https://image.pollinations.ai/prompt/asteroids%20space%20arcade%20game%20cover%20vector%20neon%20dark?width=400&height=250&nologo=true&seed=112",
    html5Url: "https://heckman.github.io/asteroids/",
    year: 1979,
    developer: "Atari",
    players: 1,
    rating: 4.5,
    tags: ["arcade", "space", "retro"],
    plays: "18.7K",
    license: "Freeware",
  },
  {
    id: "loderunner",
    title: "Lode Runner",
    description: "Collect gold and outsmart enemies in this classic platformer.",
    category: "arcade",
    platform: "html5",
    coverUrl:
      "https://image.pollinations.ai/prompt/lode%20runner%20platformer%20game%20cover%20retro%20neon%20dark?width=400&height=250&nologo=true&seed=113",
    html5Url: "https://loderunnerwebgame.com/game/",
    year: 1983,
    developer: "Broderbund",
    players: 1,
    rating: 4.4,
    tags: ["arcade", "platformer", "classic"],
    plays: "14.3K",
    license: "Freeware",
  },
  // Emulators (bring-your-own-ROM)
  {
    id: "emulatorjs",
    title: "Retro Console Lab",
    description:
      "Play NES, SNES, GBA, Genesis and more. Upload your own legally owned ROMs.",
    category: "emulator",
    platform: "emulator",
    emulator: "emulatorjs",
    coverUrl:
      "https://image.pollinations.ai/prompt/retro%20console%20controller%20collage%20nes%20snes%20gba%20genesis%20dark%20neon?width=400&height=250&nologo=true&seed=201",
    externalUrl: "https://demo.emulatorjs.org/",
    year: 1985,
    developer: "EmulatorJS",
    players: 1,
    rating: 4.8,
    tags: ["emulator", "console", "retro"],
    plays: "50.2K",
    license: "GPL-3.0",
    sourceUrl: "https://github.com/EmulatorJS/EmulatorJS",
  },
  {
    id: "jsdos",
    title: "DOS Box Lab",
    description:
      "Run classic DOS games and apps. Upload your own legally owned DOS files.",
    category: "emulator",
    platform: "dos",
    emulator: "jsdos",
    coverUrl:
      "https://image.pollinations.ai/prompt/dos%20computer%20retro%20monitor%20command%20line%20dark%20neon?width=400&height=250&nologo=true&seed=202",
    externalUrl: "/games/dos",
    year: 1981,
    developer: "js-dos",
    players: 1,
    rating: 4.7,
    tags: ["emulator", "dos", "retro"],
    plays: "32.6K",
    license: "GPL-2.0",
    sourceUrl: "https://github.com/caiiiycuk/js-dos",
  },
  // External freeware / open-source hubs
  {
    id: "itchio-free",
    title: "itch.io Free Games",
    description: "Thousands of free indie games you can play in your browser.",
    category: "arcade",
    platform: "browser",
    coverUrl:
      "https://image.pollinations.ai/prompt/itch.io%20indie%20game%20marketplace%20cover%20colorful%20dark?width=400&height=250&nologo=true&seed=301",
    externalUrl: "https://itch.io/games/free/platform-web",
    year: 2013,
    developer: "itch.io",
    players: 1,
    rating: 4.6,
    tags: ["indie", "browser", "free"],
    plays: "1M+",
    license: "Varies",
  },
  {
    id: "homegames",
    title: "Homegames",
    description: "Open-source party games you can play in the browser with friends.",
    category: "multiplayer",
    platform: "browser",
    coverUrl:
      "https://image.pollinations.ai/prompt/homegames%20party%20multiplayer%20game%20cover%20fun%20dark?width=400&height=250&nologo=true&seed=302",
    externalUrl: "https://homegames.io/",
    year: 2020,
    developer: "Homegames",
    players: 8,
    rating: 4.5,
    tags: ["multiplayer", "party", "browser"],
    plays: "8.4K",
    license: "MIT",
    sourceUrl: "https://github.com/homegamesio/homegames",
  },
  {
    id: "openretro",
    title: "Open Retro Game Database",
    description: "Discover legally available classic games and homebrew titles.",
    category: "retro",
    platform: "browser",
    coverUrl:
      "https://image.pollinations.ai/prompt/retro%20game%20database%20cover%20pixel%20art%20dark?width=400&height=250&nologo=true&seed=303",
    externalUrl: "https://www.mobygames.com/",
    year: 1999,
    developer: "MobyGames",
    players: 1,
    rating: 4.4,
    tags: ["retro", "database", "discovery"],
    plays: "2M+",
    license: "Catalog",
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
      g.description.toLowerCase().includes(q) ||
      g.tags.some((t) => t.toLowerCase().includes(q)),
  );
}

export function getGameById(id: string): Game | undefined {
  return GAME_LIBRARY.find((g) => g.id === id);
}
