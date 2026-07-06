/**
 * Game Cloud System for LiTTree Lab Studios
 * Browser-based gaming with HTML5 games
 */

export type GameCategory = "retro" | "arcade" | "puzzle" | "multiplayer" | "classic" | "action";
export type GamePlatform = "html5";

export type GameMeta = {
  id: string;
  title: string;
  href: string;
  category: GameCategory;
  difficulty: "easy" | "medium" | "hard";
  controls: string[];
  description: string;
  achievements?: string[];
  featured?: boolean;
};

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
  featured?: boolean;
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
    coverUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f8/Pong.png/320px-Pong.png",
    html5Url: "https://sethclydesdale.github.io/browser-pong/",
    year: 1972,
    developer: "Atari",
    players: 2,
    rating: 4.5,
    tags: ["retro", "classic", "arcade"],
    plays: "12.8K",
    difficulty: "easy",
    controls: ["Mouse", "Arrow Keys"],
    featured: true,
  },
  {
    id: "2048",
    title: "2048",
    description: "Slide tiles to reach the legendary 2048 tile.",
    category: "puzzle",
    platform: "html5",
    coverUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/2048_logo.svg/320px-2048_logo.svg.png",
    html5Url: "https://gabrielecirulli.github.io/2048/",
    year: 2014,
    developer: "Gabriele Cirulli",
    players: 1,
    rating: 4.5,
    tags: ["puzzle", "numbers", "minimalist"],
    plays: "28.6K",
    difficulty: "easy",
    controls: ["Arrow Keys"],
    featured: true,
  },
  {
    id: "hextris",
    title: "Hextris",
    description: "Fast-paced hexagon stacking puzzle.",
    category: "puzzle",
    platform: "html5",
    coverUrl: "https://hextris.github.io/hextris/favicon.png",
    html5Url: "https://hextris.github.io/hextris/",
    year: 2014,
    developer: "Logan Engstrom",
    players: 1,
    rating: 4.3,
    tags: ["puzzle", "fast", "reaction"],
    plays: "31.4K",
    difficulty: "medium",
    controls: ["Arrow Keys"],
  },
  {
    id: "tetris-react",
    title: "Tetris",
    description: "Classic block-stacking puzzle game.",
    category: "puzzle",
    platform: "html5",
    coverUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7c/Emacs_Tetris_vector_based_detail.svg/240px-Emacs_Tetris_vector_based_detail.svg.png",
    html5Url: "https://chvin.github.io/react-tetris/",
    year: 1984,
    developer: "Alexey Pajitnov",
    players: 1,
    rating: 4.8,
    tags: ["puzzle", "classic", "blocks"],
    plays: "45.2K",
    difficulty: "medium",
    controls: ["Arrow Keys"],
    featured: true,
  },
  {
    id: "pacman",
    title: "Pac-Man",
    description: "The classic arcade maze chase.",
    category: "arcade",
    platform: "html5",
    coverUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Pacman_%28video_game%29.jpg/320px-Pacman_%28video_game%29.jpg",
    html5Url: "https://pacman.platzh1rsch.ch/",
    year: 1980,
    developer: "Namco",
    players: 1,
    rating: 4.9,
    tags: ["arcade", "classic", "maze"],
    plays: "52.1K",
    difficulty: "medium",
    controls: ["Arrow Keys"],
  },
  {
    id: "snake",
    title: "Snake Arcade",
    description: "Eat, grow, and don't crash into yourself.",
    category: "arcade",
    platform: "html5",
    coverUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Snake_can_be_completed.png/320px-Snake_can_be_completed.png",
    html5Url: "https://alfredang.github.io/snake-game/",
    year: 1976,
    developer: "Various",
    players: 1,
    rating: 4.4,
    tags: ["arcade", "classic", "reflexes"],
    plays: "19.2K",
    difficulty: "easy",
    controls: ["Arrow Keys"],
    featured: true,
  },
  {
    id: "sudoku",
    title: "Sudoku",
    description: "Fill the grid with numbers 1–9.",
    category: "puzzle",
    platform: "html5",
    coverUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Sudoku_Puzzle_by_L2G-20050714_standardized_layout.svg/320px-Sudoku_Puzzle_by_L2G-20050714_standardized_layout.svg.png",
    html5Url: "https://www.sudoku100.com/embed/interactive",
    year: 2004,
    developer: "Various",
    players: 1,
    rating: 4.4,
    tags: ["puzzle", "numbers", "logic"],
    plays: "15.8K",
    difficulty: "medium",
    controls: ["Mouse"],
  },
  {
    id: "flappy",
    title: "Flappy Bird",
    description: "Tap to fly between the pipes.",
    category: "arcade",
    platform: "html5",
    coverUrl: "https://upload.wikimedia.org/wikipedia/en/0/0a/Flappy_Bird_icon.png",
    html5Url: "https://chaping.github.io/game/flappy-bird/",
    year: 2013,
    developer: "Dong Nguyen",
    players: 1,
    rating: 4.2,
    tags: ["arcade", "skill", "endless"],
    plays: "38.7K",
    difficulty: "hard",
    controls: ["Space", "Click"],
  },
  {
    id: "minesweeper",
    title: "Minesweeper",
    description: "Clear the board without detonating a mine.",
    category: "puzzle",
    platform: "html5",
    coverUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/83/Minesweeper_Windows.png/320px-Minesweeper_Windows.png",
    html5Url: "https://minesweeper.github.io/",
    year: 1990,
    developer: "Microsoft",
    players: 1,
    rating: 4.5,
    tags: ["puzzle", "logic", "classic"],
    plays: "22.3K",
    difficulty: "hard",
    controls: ["Mouse"],
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

export function getFeaturedGames(limit = 4): Game[] {
  const featured = GAME_LIBRARY.filter((g) => g.featured);
  return featured.length > 0 ? featured.slice(0, limit) : GAME_LIBRARY.slice(0, limit);
}

export function getLastPlayedGameId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_KEYS.lastPlayed);
  } catch {
    return null;
  }
}

export function setLastPlayedGameId(gameId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEYS.lastPlayed, gameId);
  } catch {
    // ignore storage errors
  }
}
