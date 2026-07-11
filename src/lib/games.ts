/**
 * Game Cloud System for LiTT Code
 * Browser-based gaming with HTML5 games
 */

export type GameCategory = "retro" | "arcade" | "puzzle" | "multiplayer";
export type GamePlatform = "html5";

export interface Game {
  id: string;
  title: string;
  description: string;
  category: GameCategory;
  platform: GamePlatform;
  coverUrl: string;
  html5Url?: string;
  year: number;
  developer: string;
  players: number;
  rating: number;
  tags: string[];
  plays: string;
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
