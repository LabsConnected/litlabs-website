// Beautiful AI-generated style wallpapers using CSS only
// Each wallpaper is designed to look like AI art

export type WallpaperId =
  | 'default' | 'gradient' | 'mesh' | 'dark' | 'custom'
  | 'nebula' | 'cyberpunk' | 'aurora' | 'matrix' | 'sunset'
  | 'ocean' | 'forest' | 'cosmic' | 'minimal' | 'glass'
  | 'lava' | 'crystal' | 'tokyo' | 'solar' | 'honeycomb';

export interface Wallpaper {
  id: WallpaperId;
  name: string;
  description: string;
  category: 'abstract' | 'nature' | 'tech' | 'minimal';
  preview: string; // CSS for preview
  fullStyle: React.CSSProperties; // Full page styles
  requiresCustom?: boolean;
}

export const WALLPAPERS: Wallpaper[] = [
  {
    id: 'default',
    name: 'Midnight',
    description: 'Clean dark base with subtle depth',
    category: 'minimal',
    preview: 'linear-gradient(180deg, #0a0a0f 0%, #111118 100%)',
    fullStyle: { background: 'linear-gradient(180deg, #0a0a0f 0%, #111118 100%)' }
  },
  {
    id: 'gradient',
    name: 'Deep Ocean',
    description: 'Flowing blue-purple gradient',
    category: 'abstract',
    preview: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f0f23 100%)',
    fullStyle: { background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f0f23 100%)' }
  },
  {
    id: 'mesh',
    name: 'Neural Mesh',
    description: 'Animated floating gradient orbs',
    category: 'tech',
    preview: 'radial-gradient(circle at 30% 70%, #818cf820, transparent), radial-gradient(circle at 70% 30%, #a78bfa20, transparent), #0a0a0f',
    fullStyle: { backgroundColor: '#0a0a0f' } // Handled by AnimatedBackground component
  },
  {
    id: 'dark',
    name: 'Void',
    description: 'Pure black for focus',
    category: 'minimal',
    preview: '#050505',
    fullStyle: { backgroundColor: '#050505' }
  },
  {
    id: 'nebula',
    name: 'Nebula Dreams',
    description: 'Cosmic purple-pink nebula clouds',
    category: 'abstract',
    preview: 'radial-gradient(ellipse at 20% 30%, #9333ea30, transparent), radial-gradient(ellipse at 80% 70%, #ec489930, transparent), radial-gradient(ellipse at 50% 50%, #3b82f620, transparent), #0a0a0f',
    fullStyle: {
      background: `
        radial-gradient(ellipse at 20% 30%, #9333ea40 0%, transparent 50%),
        radial-gradient(ellipse at 80% 70%, #ec489940 0%, transparent 50%),
        radial-gradient(ellipse at 50% 50%, #3b82f420 0%, transparent 60%),
        linear-gradient(180deg, #0f0f1a 0%, #1a1a2e 50%, #0f0f1a 100%)
      `
    }
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk City',
    description: 'Neon grid with synthwave vibes',
    category: 'tech',
    preview: 'repeating-linear-gradient(0deg, transparent, transparent 40px, #ff00ff10 40px, #ff00ff10 41px), repeating-linear-gradient(90deg, transparent, transparent 40px, #00ffff10 40px, #00ffff10 41px), linear-gradient(180deg, #1a0a1a 0%, #0a1a2e 100%)',
    fullStyle: {
      background: `
        repeating-linear-gradient(0deg, transparent, transparent 60px, #ff00ff08 60px, #ff00ff08 61px),
        repeating-linear-gradient(90deg, transparent, transparent 60px, #00ffff08 60px, #00ffff08 61px),
        linear-gradient(180deg, #1a0a1a 0%, #0d1a2e 50%, #0a0f1a 100%)
      `,
      backgroundSize: '100% 100%, 100% 100%, 100% 100%'
    }
  },
  {
    id: 'aurora',
    name: 'Northern Lights',
    description: 'Flowing green-blue aurora waves',
    category: 'nature',
    preview: 'linear-gradient(180deg, #0a1f1a 0%, #0a2f3f 50%, #0a0f2f 100%)',
    fullStyle: {
      background: `
        radial-gradient(ellipse at 30% 80%, #22d3ee30 0%, transparent 50%),
        radial-gradient(ellipse at 70% 20%, #34d39930 0%, transparent 50%),
        radial-gradient(ellipse at 50% 50%, #10b98120 0%, transparent 60%),
        linear-gradient(180deg, #0a1f1a 0%, #0a2f3f 50%, #0a0f2f 100%)
      `
    }
  },
  {
    id: 'matrix',
    name: 'Digital Rain',
    description: 'Green code-style cascading gradient',
    category: 'tech',
    preview: 'linear-gradient(180deg, #001a00 0%, #000a00 100%)',
    fullStyle: {
      background: `
        linear-gradient(180deg, 
          rgba(0, 50, 0, 0.3) 0%, 
          rgba(0, 20, 0, 0.1) 50%, 
          rgba(0, 50, 0, 0.3) 100%
        ),
        #000a00
      `,
      backgroundSize: '100% 200%',
      animation: 'matrix-shift 8s ease-in-out infinite'
    }
  },
  {
    id: 'sunset',
    name: 'Golden Hour',
    description: 'Warm orange-pink sunset gradient',
    category: 'nature',
    preview: 'linear-gradient(135deg, #7c2d12 0%, #c2410c 50%, #fb923c 100%)',
    fullStyle: {
      background: `
        radial-gradient(ellipse at 20% 80%, #fb923c40 0%, transparent 50%),
        radial-gradient(ellipse at 80% 20%, #f472b640 0%, transparent 50%),
        linear-gradient(135deg, #2d1a12 0%, #4a2510 30%, #7c2d12 60%, #c2410c 100%)
      `
    }
  },
  {
    id: 'ocean',
    name: 'Deep Blue',
    description: 'Calming ocean depths',
    category: 'nature',
    preview: 'linear-gradient(180deg, #0c1a3a 0%, #1e3a5f 50%, #0c1a3a 100%)',
    fullStyle: {
      background: `
        radial-gradient(ellipse at 50% 0%, #60a5fa20 0%, transparent 50%),
        radial-gradient(ellipse at 30% 100%, #3b82f620 0%, transparent 50%),
        linear-gradient(180deg, #0c1a3a 0%, #1e3a5f 40%, #0f172a 100%)
      `
    }
  },
  {
    id: 'forest',
    name: 'Midnight Forest',
    description: 'Deep green mystical woods',
    category: 'nature',
    preview: 'linear-gradient(180deg, #0a1f0a 0%, #1a2f1a 50%, #0a1f0a 100%)',
    fullStyle: {
      background: `
        radial-gradient(ellipse at 80% 80%, #22c55e20 0%, transparent 50%),
        radial-gradient(ellipse at 20% 20%, #16a34a20 0%, transparent 50%),
        linear-gradient(180deg, #0a1f0a 0%, #1a2f1a 50%, #0d1a0d 100%)
      `
    }
  },
  {
    id: 'cosmic',
    name: 'Starfield',
    description: 'Deep space with star dots',
    category: 'abstract',
    preview: 'radial-gradient(circle, white 1px, transparent 1px), #0a0a15',
    fullStyle: {
      background: `
        radial-gradient(1px 1px at 20px 30px, rgba(255,255,255,0.8), transparent),
        radial-gradient(1px 1px at 40px 70px, rgba(255,255,255,0.6), transparent),
        radial-gradient(1px 1px at 50px 160px, rgba(255,255,255,0.7), transparent),
        radial-gradient(1px 1px at 90px 40px, rgba(255,255,255,0.5), transparent),
        radial-gradient(1px 1px at 130px 80px, rgba(255,255,255,0.6), transparent),
        radial-gradient(1px 1px at 160px 120px, rgba(255,255,255,0.7), transparent),
        linear-gradient(180deg, #050510 0%, #0a0a1a 50%, #050510 100%)
      `,
      backgroundSize: '200px 200px, 200px 200px, 200px 200px, 200px 200px, 200px 200px, 200px 200px, 100% 100%'
    }
  },
  {
    id: 'minimal',
    name: 'Pure Minimal',
    description: 'Ultra clean subtle gray',
    category: 'minimal',
    preview: '#fafafa',
    fullStyle: { background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f5 100%)' }
  },
  {
    id: 'glass',
    name: 'Frosted Glass',
    description: 'Blurry gradient layers',
    category: 'abstract',
    preview: 'linear-gradient(135deg, #ffffff10 0%, #ffffff05 100%), linear-gradient(225deg, #a78bfa20 0%, #818cf820 100%)',
    fullStyle: {
      background: `
        linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%),
        linear-gradient(225deg, rgba(167,139,250,0.15) 0%, rgba(129,140,248,0.15) 50%, rgba(251,191,36,0.1) 100%),
        #0a0a12
      `
    }
  },
  {
    id: 'lava',
    name: 'Lava Flow',
    description: 'Molten red and orange rivers',
    category: 'nature',
    preview: 'radial-gradient(ellipse at 50% 100%, #dc262630, transparent), linear-gradient(180deg, #1a0a0a 0%, #2d1212 100%)',
    fullStyle: {
      background: `
        radial-gradient(ellipse at 30% 100%, #dc262640 0%, transparent 50%),
        radial-gradient(ellipse at 70% 80%, #f9731640 0%, transparent 50%),
        radial-gradient(ellipse at 50% 50%, #7f1d1d20 0%, transparent 60%),
        linear-gradient(180deg, #1a0a0a 0%, #2d1212 100%)
      `
    }
  },
  {
    id: 'crystal',
    name: 'Crystal Cave',
    description: 'Icy blue and teal geometric depths',
    category: 'nature',
    preview: 'linear-gradient(135deg, #0c1f2d 0%, #0a2f3f 50%, #0c1f2d 100%)',
    fullStyle: {
      background: `
        radial-gradient(ellipse at 20% 30%, #22d3ee30 0%, transparent 50%),
        radial-gradient(ellipse at 80% 70%, #2dd4bf30 0%, transparent 50%),
        radial-gradient(ellipse at 50% 50%, #0891b220 0%, transparent 60%),
        linear-gradient(135deg, #0c1f2d 0%, #0a2f3f 50%, #0c1f2d 100%)
      `
    }
  },
  {
    id: 'tokyo',
    name: 'Tokyo Night',
    description: 'Dark purple with neon pink highlights',
    category: 'tech',
    preview: 'repeating-linear-gradient(90deg, #1a0a2e, #1a0a2e 20px, #2d1b4e 20px, #2d1b4e 21px), #1a0a2e',
    fullStyle: {
      background: `
        radial-gradient(ellipse at 80% 20%, #ec489940 0%, transparent 50%),
        radial-gradient(ellipse at 20% 80%, #a855f740 0%, transparent 50%),
        repeating-linear-gradient(90deg, transparent, transparent 60px, rgba(236,72,153,0.06) 60px, rgba(236,72,153,0.06) 61px),
        linear-gradient(180deg, #1a0a2e 0%, #120522 100%)
      `
    }
  },
  {
    id: 'solar',
    name: 'Solar Flare',
    description: 'Bright yellow and orange energy burst',
    category: 'abstract',
    preview: 'radial-gradient(circle at 50% 50%, #fbbf2420, transparent), linear-gradient(135deg, #2a1a0a 0%, #3d1f0a 100%)',
    fullStyle: {
      background: `
        radial-gradient(ellipse at 50% 50%, #fbbf2440 0%, transparent 40%),
        radial-gradient(ellipse at 40% 60%, #f9731630 0%, transparent 50%),
        radial-gradient(ellipse at 60% 40%, #f59e0b30 0%, transparent 50%),
        linear-gradient(135deg, #2a1a0a 0%, #3d1f0a 100%)
      `
    }
  },
  {
    id: 'honeycomb',
    name: 'Honeycomb Drip',
    description: 'Hexagonal honeycomb pattern with amber glow',
    category: 'abstract',
    preview: 'repeating-conic-gradient(from 30deg at 50% 50%, #f59e0b10 0deg 60deg, transparent 60deg 120deg), #0d0a05',
    fullStyle: {
      background: `
        radial-gradient(ellipse at 50% 50%, #fbbf2415 0%, transparent 60%),
        radial-gradient(ellipse at 20% 80%, #f59e0b12 0%, transparent 50%),
        radial-gradient(ellipse at 80% 20%, #d9770612 0%, transparent 50%),
        linear-gradient(180deg, #0d0a05 0%, #1a1510 100%)
      `
    }
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Upload your own image',
    category: 'minimal',
    preview: 'repeating-linear-gradient(45deg, #333, #333 10px, #444 10px, #444 20px)',
    fullStyle: {},
    requiresCustom: true
  }
];

export const getWallpaperById = (id: WallpaperId): Wallpaper => {
  return WALLPAPERS.find(w => w.id === id) || WALLPAPERS[0];
};

export const getWallpapersByCategory = (category: Wallpaper['category']) => {
  return WALLPAPERS.filter(w => w.category === category && w.id !== 'custom');
};
