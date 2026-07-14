/**
 * Music System for LiTT
 * Provides background music capabilities with user preferences
 */

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  url: string;
  duration?: number;
  cover?: string;
  isLive?: boolean;
  genre?: string;
}

export interface UserMusicPreferences {
  enabled: boolean;
  volume: number;
  autoPlay: boolean;
  muteOnLeave: boolean;
  currentTrackId?: string;
  lastTrackId?: string;
  profileMusicId?: string;
  allowOthersToHear: boolean;
}

export const STORAGE_KEY = 'litlabs-music-prefs';

// Curated synthwave/cyberpunk tracks (royalty-free / Creative Commons)
export const DEFAULT_PLAYLIST: MusicTrack[] = [
  {
    id: 'midnight-city',
    title: 'Midnight City',
    artist: 'M83',
    url: 'https://www.youtube.com/embed/dX3k_QDnzHE?autoplay=1&loop=1&playlist=dX3k_QDnzHE',
    duration: 243,
  },
  {
    id: 'nightcall',
    title: 'Nightcall',
    artist: 'Kavinsky',
    url: 'https://www.youtube.com/embed/MV_3Dpw-BRY?autoplay=1&loop=1&playlist=MV_3Dpw-BRY',
    duration: 258,
  },
  {
    id: 'tech-noir',
    title: 'Tech Noir',
    artist: 'Gunship',
    url: 'https://www.youtube.com/embed/JRkNZH_3K3s?autoplay=1&loop=1&playlist=JRkNZH_3K3s',
    duration: 322,
  },
  {
    id: 'resonance',
    title: 'Resonance',
    artist: 'Home',
    url: 'https://www.youtube.com/embed/8GW6sLrK40k?autoplay=1&loop=1&playlist=8GW6sLrK40k',
    duration: 212,
  },
  {
    id: 'solaris',
    title: 'Solaris',
    artist: 'Cyberpunk Ambient',
    url: 'https://www.youtube.com/embed/SvO5EfwfMoQ?autoplay=1&loop=1&playlist=SvO5EfwfMoQ',
    duration: 180,
  },
];

export function getDefaultPreferences(): UserMusicPreferences {
  return {
    enabled: false,
    volume: 70,
    autoPlay: false,
    muteOnLeave: true,
    allowOthersToHear: true,
  };
}

export function loadMusicPreferences(): UserMusicPreferences {
  if (typeof window === 'undefined') return getDefaultPreferences();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...getDefaultPreferences(), ...JSON.parse(stored) };
    }
  } catch {
    // Fallback to defaults
  }
  return getDefaultPreferences();
}

export function saveMusicPreferences(prefs: UserMusicPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage errors
  }
}

export function getTrackById(id: string): MusicTrack | undefined {
  return DEFAULT_PLAYLIST.find(t => t.id === id);
}

export function getRandomTrack(): MusicTrack {
  return DEFAULT_PLAYLIST[Math.floor(Math.random() * DEFAULT_PLAYLIST.length)];
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
