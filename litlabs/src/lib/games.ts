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
  {
    id: "pong",
    title: "Browser Pong",
    description: "Classic Atari Pong — two paddles, one ball, zero mercy.",
    category: "retro",
    platform: "html5",
    coverUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f8/Pong.png/320px-Pong.png",
    html5Url: "https://sethclydesdale.github.io/browser-pong/",
    year: 1972,
    developer: "Atari",
    players: 2,
    rating: 4.5,
    tags: ["retro", "classic", "multiplayer"],
    plays: "12.8K",
    difficulty: "easy",
    controls: ["W/S Keys", "Arrow Keys"],
    featured: true,
  },
  {
    id: "2048",
    title: "2048",
    description: "Slide tiles and combine numbers to reach 2048.",
    category: "puzzle",
    platform: "html5",
    coverUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/2048_logo.svg/320px-2048_logo.svg.png",
    html5Url: "https://gabrielecirulli.github.io/2048/",
    year: 2014,
    developer: "Gabriele Cirulli",
    players: 1,
    rating: 4.5,
    tags: ["puzzle", "numbers", "strategy"],
    plays: "28.6K",
    difficulty: "easy",
    controls: ["Arrow Keys"],
    featured: true,
  },
  {
    id: "hextris",
    title: "Hextris",
    description: "Fast-paced hexagon stacking puzzle. Don't let it overflow.",
    category: "puzzle",
    platform: "html5",
    coverUrl: "https://hextris.github.io/hextris/favicon.png",
    html5Url: "https://hextris.github.io/hextris/",
    year: 2014,
    developer: "Logan Engstrom",
    players: 1,
    rating: 4.3,
    tags: ["puzzle", "reaction", "fast"],
    plays: "31.4K",
    difficulty: "medium",
    controls: ["Arrow Keys"],
    featured: true,
  },
  {
    id: "tetris-react",
    title: "Tetris",
    description: "The timeless block-stacking game. Clear lines, survive.",
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
    description: "Chomp dots, dodge ghosts, eat power pellets.",
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
    featured: true,
  },
  {
    id: "snake",
    title: "Snake Arcade",
    description: "Eat, grow, don't crash. The longer you get, the harder it is.",
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
    id: "flappy",
    title: "Flappy Bird",
    description: "One tap. One chance. Tap to fly through the pipes.",
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
    description: "Use logic to clear the minefield without triggering a bomb.",
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
  {
    id: "chess",
    title: "Chess",
    description: "Play chess against an AI engine in your browser. Full rules.",
    category: "classic",
    platform: "html5",
    coverUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/ChessSet.jpg/320px-ChessSet.jpg",
    html5Url: "https://lichess.org/embed/game/mpJx5wEf?theme=brown&bg=dark",
    year: 1500,
    developer: "Lichess",
    players: 2,
    rating: 4.9,
    tags: ["classic", "strategy", "multiplayer"],
    plays: "98.4K",
    difficulty: "hard",
    controls: ["Mouse"],
    featured: true,
  },
  {
    id: "doom",
    title: "Doom (1993)",
    description: "The original id Software FPS. Run and gun through hell.",
    category: "action",
    platform: "html5",
    coverUrl: "https://upload.wikimedia.org/wikipedia/en/thumb/5/57/Doom_cover_art.jpg/220px-Doom_cover_art.jpg",
    html5Url: "https://js-dos.com/games/doom.zip.html",
    year: 1993,
    developer: "id Software",
    players: 1,
    rating: 4.9,
    tags: ["action", "fps", "classic"],
    plays: "67.3K",
    difficulty: "hard",
    controls: ["Arrow Keys", "Ctrl"],
    featured: true,
  },
  {
    id: "asteroids",
    title: "Asteroids",
    description: "Blast through space rocks in this Atari arcade classic.",
    category: "retro",
    platform: "html5",
    coverUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/13/Asteroi1.png/240px-Asteroi1.png",
    html5Url: "https://dodgames.io/asteroids/",
    year: 1979,
    developer: "Atari",
    players: 1,
    rating: 4.3,
    tags: ["retro", "arcade", "space"],
    plays: "14.1K",
    difficulty: "medium",
    controls: ["Arrow Keys", "Space"],
  },
  {
    id: "breakout",
    title: "Breakout",
    description: "Smash bricks with a bouncing ball and paddle.",
    category: "retro",
    platform: "html5",
    coverUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Breakout2600.svg/220px-Breakout2600.svg.png",
    html5Url: "https://elgoog.im/breakout/",
    year: 1976,
    developer: "Atari",
    players: 1,
    rating: 4.2,
    tags: ["retro", "arcade", "classic"],
    plays: "11.9K",
    difficulty: "easy",
    controls: ["Mouse", "Arrow Keys"],
  },
  {
    id: "space-invaders",
    title: "Space Invaders",
    description: "Defend Earth from descending alien invaders.",
    category: "retro",
    platform: "html5",
    coverUrl: "https://upload.wikimedia.org/wikipedia/en/thumb/0/0a/Space_invaders_by_Taito.jpg/220px-Space_invaders_by_Taito.jpg",
    html5Url: "https://freeinvaders.org/",
    year: 1978,
    developer: "Taito",
    players: 1,
    rating: 4.5,
    tags: ["retro", "arcade", "shooting"],
    plays: "27.8K",
    difficulty: "medium",
    controls: ["Arrow Keys", "Space"],
    featured: true,
  },
  {
    id: "connect4",
    title: "Connect Four",
    description: "Drop discs to connect 4 in a row before your opponent.",
    category: "classic",
    platform: "html5",
    coverUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ad/Connect_Four.gif/200px-Connect_Four.gif",
    html5Url: "https://www.mathsisfun.com/games/connect4.html",
    year: 1974,
    developer: "Milton Bradley",
    players: 2,
    rating: 4.1,
    tags: ["classic", "strategy", "multiplayer"],
    plays: "9.7K",
    difficulty: "easy",
    controls: ["Mouse"],
  },
  {
    id: "frogger",
    title: "Frogger",
    description: "Help the frog cross the road and river without getting squashed.",
    category: "retro",
    platform: "html5",
    coverUrl: "https://upload.wikimedia.org/wikipedia/en/thumb/b/be/Frogger_game_arcade.png/220px-Frogger_game_arcade.png",
    html5Url: "https://www.silvergames.com/en/frogger",
    year: 1981,
    developer: "Konami",
    players: 1,
    rating: 4.3,
    tags: ["retro", "arcade", "reflex"],
    plays: "16.2K",
    difficulty: "medium",
    controls: ["Arrow Keys"],
  },
  {
    id: "dino",
    title: "Chrome Dino",
    description: "Jump over cacti and duck under pterodactyls. How far can you go?",
    category: "arcade",
    platform: "html5",
    coverUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/13/Chromedinogame.gif/300px-Chromedinogame.gif",
    html5Url: "https://chromedino.com/",
    year: 2014,
    developer: "Google",
    players: 1,
    rating: 4.6,
    tags: ["arcade", "endless", "reflex"],
    plays: "201.5K",
    difficulty: "easy",
    controls: ["Space", "Up Arrow"],
    featured: true,
  },
  {
    id: "wordle",
    title: "Wordle",
    description: "Guess the 5-letter word in 6 tries. A new puzzle every day.",
    category: "puzzle",
    platform: "html5",
    coverUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ec/Wordle_196_example.svg/300px-Wordle_196_example.svg.png",
    html5Url: "https://wordlegame.org/",
    year: 2021,
    developer: "Josh Wardle",
    players: 1,
    rating: 4.7,
    tags: ["puzzle", "word", "daily"],
    plays: "445.2K",
    difficulty: "medium",
    controls: ["Keyboard"],
    featured: true,
  },
  {
    id: "geometry-dash",
    title: "Geometry Dash Lite",
    description: "Jump and fly through rhythm-based obstacle courses.",
    category: "action",
    platform: "html5",
    coverUrl: "https://upload.wikimedia.org/wikipedia/en/thumb/9/9e/Geometry_Dash_game_logo.png/250px-Geometry_Dash_game_logo.png",
    html5Url: "https://geometrydash.ee/",
    year: 2013,
    developer: "RobTop Games",
    players: 1,
    rating: 4.6,
    tags: ["action", "rhythm", "skill"],
    plays: "88.3K",
    difficulty: "hard",
    controls: ["Space", "Click"],
    featured: true,
  },
  {
    id: "cut-the-rope",
    title: "Cut the Rope",
    description: "Cut ropes to drop candy into the monster's mouth. Addicting.",
    category: "puzzle",
    platform: "html5",
    coverUrl: "https://upload.wikimedia.org/wikipedia/en/thumb/2/2a/Cut_the_Rope_Logo.png/220px-Cut_the_Rope_Logo.png",
    html5Url: "https://www.cuttherope.net/",
    year: 2010,
    developer: "ZeptoLab",
    players: 1,
    rating: 4.5,
    tags: ["puzzle", "physics", "casual"],
    plays: "56.1K",
    difficulty: "easy",
    controls: ["Mouse", "Touch"],
  },
  {
    id: "sudoku",
    title: "Sudoku",
    description: "Fill the 9x9 grid — every row, column, and box needs 1–9.",
    category: "puzzle",
    platform: "html5",
    coverUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Sudoku_Puzzle_by_L2G-20050714_standardized_layout.svg/320px-Sudoku_Puzzle_by_L2G-20050714_standardized_layout.svg.png",
    html5Url: "https://sudoku.com/",
    year: 2004,
    developer: "Various",
    players: 1,
    rating: 4.4,
    tags: ["puzzle", "logic", "numbers"],
    plays: "15.8K",
    difficulty: "medium",
    controls: ["Mouse"],
  },
  {
    id: "2048-hex",
    title: "2048 Hex",
    description: "2048 on a hexagonal grid — harder, wilder, more satisfying.",
    category: "puzzle",
    platform: "html5",
    coverUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/2048_logo.svg/320px-2048_logo.svg.png",
    html5Url: "https://0x800a.github.io/2048-hex/",
    year: 2015,
    developer: "Community",
    players: 1,
    rating: 4.1,
    tags: ["puzzle", "hex", "numbers"],
    plays: "7.4K",
    difficulty: "hard",
    controls: ["Arrow Keys"],
  },
  {
    id: "monkey-type",
    title: "MonkeyType",
    description: "Test your typing speed and accuracy. Race against the clock.",
    category: "classic",
    platform: "html5",
    coverUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ae/Computer_keyboard.jpg/320px-Computer_keyboard.jpg",
    html5Url: "https://monkeytype.com/",
    year: 2020,
    developer: "Miodec",
    players: 1,
    rating: 4.8,
    tags: ["skill", "typing", "challenge"],
    plays: "312.7K",
    difficulty: "medium",
    controls: ["Keyboard"],
  },
  {
    id: "1010",
    title: "1010! Block Puzzle",
    description: "Place tetromino blocks to clear rows and columns. Chill but deep.",
    category: "puzzle",
    platform: "html5",
    coverUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7c/Emacs_Tetris_vector_based_detail.svg/240px-Emacs_Tetris_vector_based_detail.svg.png",
    html5Url: "https://1010game.io/",
    year: 2014,
    developer: "Gram Games",
    players: 1,
    rating: 4.4,
    tags: ["puzzle", "blocks", "casual"],
    plays: "43.6K",
    difficulty: "easy",
    controls: ["Mouse", "Touch"],
  },
  {
    id: "typeracer",
    title: "TypeRacer",
    description: "Race other players by typing song lyrics and quotes the fastest.",
    category: "multiplayer",
    platform: "html5",
    coverUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ae/Computer_keyboard.jpg/320px-Computer_keyboard.jpg",
    html5Url: "https://play.typeracer.com/",
    year: 2008,
    developer: "TypeRacer LLC",
    players: 2,
    rating: 4.6,
    tags: ["multiplayer", "typing", "racing"],
    plays: "189.3K",
    difficulty: "medium",
    controls: ["Keyboard"],
    featured: true,
  },
  {
    id: "lichess",
    title: "Chess — Rapid",
    description: "10-minute rapid chess against real players worldwide. Free forever.",
    category: "multiplayer",
    platform: "html5",
    coverUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/ChessSet.jpg/320px-ChessSet.jpg",
    html5Url: "https://lichess.org/",
    year: 2010,
    developer: "Lichess",
    players: 2,
    rating: 4.9,
    tags: ["multiplayer", "strategy", "classic"],
    plays: "2.1M",
    difficulty: "hard",
    controls: ["Mouse"],
    featured: true,
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
