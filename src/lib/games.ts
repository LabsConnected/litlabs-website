/**
 * Game Cloud System for LiTTree Lab Studios
 * Browser-based gaming with retro emulators and HTML5 games
 */

export type GameCategory = 'retro' | 'arcade' | 'puzzle' | 'multiplayer';
export type GamePlatform = 'nes' | 'snes' | 'genesis' | 'gb' | 'gba' | 'html5';

export interface Game {
  id: string;
  title: string;
  description: string;
  category: GameCategory;
  platform: GamePlatform;
  coverUrl: string;
  romUrl?: string;
  html5Url?: string;
  year: number;
  developer: string;
  players: number;
  rating: number;
  tags: string[];
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

// Demo game library - in production, this would come from a database
export const GAME_LIBRARY: Game[] = [
  // NES Games
  {
    id: 'smb1',
    title: 'Super Mario Bros.',
    description: 'The classic platformer that started it all.',
    category: 'retro',
    platform: 'nes',
    coverUrl: 'https://upload.wikimedia.org/wikipedia/en/0/03/Super_Mario_Bros._box.png',
    romUrl: '/roms/smb1.nes',
    year: 1985,
    developer: 'Nintendo',
    players: 2,
    rating: 4.9,
    tags: ['platformer', 'classic', 'mario'],
  },
  {
    id: 'tetris-nes',
    title: 'Tetris',
    description: 'The legendary puzzle game.',
    category: 'puzzle',
    platform: 'nes',
    coverUrl: 'https://upload.wikimedia.org/wikipedia/en/7/7d/Tetris_NES_cover.jpg',
    romUrl: '/roms/tetris.nes',
    year: 1989,
    developer: 'Nintendo',
    players: 2,
    rating: 4.8,
    tags: ['puzzle', 'classic', 'addictive'],
  },
  // SNES Games
  {
    id: 'smw',
    title: 'Super Mario World',
    description: 'Mario\'s greatest adventure on SNES.',
    category: 'retro',
    platform: 'snes',
    coverUrl: 'https://upload.wikimedia.org/wikipedia/en/3/32/Super_Mario_World_Coverart.png',
    romUrl: '/roms/smw.smc',
    year: 1991,
    developer: 'Nintendo',
    players: 2,
    rating: 4.9,
    tags: ['platformer', 'mario', 'classic'],
  },
  // Genesis Games
  {
    id: 'sonic1',
    title: 'Sonic the Hedgehog',
    description: 'Blast through zones at supersonic speed.',
    category: 'retro',
    platform: 'genesis',
    coverUrl: 'https://upload.wikimedia.org/wikipedia/en/b/ba/Sonic_the_Hedgehog_1_Genesis_box_art.jpg',
    romUrl: '/roms/sonic1.bin',
    year: 1991,
    developer: 'Sega',
    players: 1,
    rating: 4.7,
    tags: ['platformer', 'speed', 'sonic'],
  },
  // HTML5 Games
  {
    id: '2048',
    title: '2048',
    description: 'Slide tiles to reach 2048.',
    category: 'puzzle',
    platform: 'html5',
    coverUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/2048_logo.svg/1200px-2048_logo.svg.png',
    html5Url: 'https://play2048.co/',
    year: 2014,
    developer: 'Gabriele Cirulli',
    players: 1,
    rating: 4.5,
    tags: ['puzzle', 'numbers', 'minimalist'],
  },
  {
    id: 'hextris',
    title: 'Hextris',
    description: 'Fast-paced hexagon puzzle.',
    category: 'puzzle',
    platform: 'html5',
    coverUrl: '/games/hextris-cover.png',
    html5Url: 'https://hextris.io/',
    year: 2014,
    developer: 'Logan Engstrom',
    players: 1,
    rating: 4.3,
    tags: ['puzzle', 'fast', 'reaction'],
  },
  {
    id: 'krunker',
    title: 'Krunker.io',
    description: 'Fast-paced online FPS.',
    category: 'multiplayer',
    platform: 'html5',
    coverUrl: '/games/krunker-cover.png',
    html5Url: 'https://krunker.io/',
    year: 2018,
    developer: 'Yendis Entertainment',
    players: 8,
    rating: 4.2,
    tags: ['fps', 'multiplayer', 'online'],
  },
  {
    id: 'slither',
    title: 'Slither.io',
    description: 'Grow your snake and dominate the arena.',
    category: 'multiplayer',
    platform: 'html5',
    coverUrl: '/games/slither-cover.png',
    html5Url: 'https://slither.io/',
    year: 2016,
    developer: 'Steve Howse',
    players: 100,
    rating: 4.1,
    tags: ['io', 'multiplayer', 'snake'],
  },
];

export const STORAGE_KEYS = {
  saveStates: 'litlabs-game-saves',
  lastPlayed: 'litlabs-game-last',
  favorites: 'litlabs-game-favs',
};

export function loadSaveStates(gameId: string): SaveState[] {
  if (typeof window === 'undefined') return [];
  try {
    const allSaves = JSON.parse(localStorage.getItem(STORAGE_KEYS.saveStates) || '{}');
    return allSaves[gameId] || [];
  } catch {
    return [];
  }
}

export function saveGameState(gameId: string, state: Omit<SaveState, 'id' | 'createdAt'>): void {
  if (typeof window === 'undefined') return;
  try {
    const allSaves = JSON.parse(localStorage.getItem(STORAGE_KEYS.saveStates) || '{}');
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
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.favorites) || '[]');
  } catch {
    return [];
  }
}

export function toggleFavorite(gameId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const favs = getFavorites();
    const isFav = favs.includes(gameId);
    const newFavs = isFav ? favs.filter(id => id !== gameId) : [...favs, gameId];
    localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(newFavs));
    return !isFav;
  } catch {
    return false;
  }
}

export function getGamesByCategory(category: GameCategory): Game[] {
  return GAME_LIBRARY.filter(g => g.category === category);
}

export function getGamesByPlatform(platform: GamePlatform): Game[] {
  return GAME_LIBRARY.filter(g => g.platform === platform);
}

export function searchGames(query: string): Game[] {
  const q = query.toLowerCase();
  return GAME_LIBRARY.filter(g =>
    g.title.toLowerCase().includes(q) ||
    g.description.toLowerCase().includes(q) ||
    g.tags.some(t => t.toLowerCase().includes(q))
  );
}

export function getGameById(id: string): Game | undefined {
  return GAME_LIBRARY.find(g => g.id === id);
}
