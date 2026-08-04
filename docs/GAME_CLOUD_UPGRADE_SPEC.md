# LiTTree Game Cloud — Upgrade Spec for Kimi

> **Goal:** Transform `https://litlabs.net/games` from a functional game launcher into a **premium branded arcade showcase** that highlights classic games with custom LiTTree-branded cards, better visual hierarchy, and a cohesive design language.

---

## 1. Current State (What Exists Today)

### Routes
| Route | Purpose |
|-------|---------|
| `/games` | Main Game Cloud landing page (hero + retro arcade + quick play) |
| `/games/retro` | Retro arcade — upload legal ROMs, play in browser via emulator |
| `/games/retro/play/[id]` | Retro game player (emulatorjs) |
| `/games/dos` | DOS emulator (js-dos) with Digger demo + upload `.jsdos` |
| `/games/cloud` | Game Cloud home (alternate) |
| `/studio/games` | **NEW** Native Arcade — Solitaire, Sudoku, Word Search |
| `/studio/games/solitaire` | Klondike Solitaire |
| `/studio/games/sudoku` | Sudoku with notes mode |
| `/studio/games/wordsearch` | Tech-themed word search |

### Current Card Design (Quick Play section)
- 2-4 column responsive grid
- `aspect-4/3` cover image from `/games/artwork/*.png` (2.4MB each — huge!)
- Hover: lift + scale image + show play button overlay
- "Play here" / "New tab" badge top-left
- Title + heart favorite + description + category tag below
- **No LiTTree branding on cards** — they look generic

### Current Game Data Model (`src/lib/games.ts`)
```typescript
interface Game {
  id: string;
  title: string;
  description: string;
  category: "retro" | "arcade" | "puzzle" | "multiplayer";
  platform: "html5" | "browser" | "emulator" | "dos";
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
  progress?: number;
  difficulty?: "easy" | "medium" | "hard" | "expert";
  controls?: string[];
  achievements?: Achievement[];
  bestScore?: number;
  totalPlays?: number;
  playersToday?: number;
}
```

### Retro Arcade Cover Art
- Uses **Libretro thumbnail CDN**: `https://thumbnails.libretro.com/{system}/Named_Boxarts/{filename}.png`
- Fallback: system-colored gradient with system abbreviation
- Games stored in **IndexedDB** (browser-local, private)

### Brand Assets Available
| Asset | Path | Description |
|-------|------|-------------|
| LiTTree Logo (SVG) | `/public/logo-littree.svg` | Circuit-tree with neural nodes, gradient trunk (blue→cyan→purple) |
| LiTTree Logo (PNG) | `/public/logo.png` | 584KB raster version |
| LiTTree Logo (WebP) | `/public/logo.webp` | 54KB optimized |
| Mascot Avatar | `/public/brand/litt-mascot-avatar.png` | LiTTree character |
| Mascot Hero | `/public/brand/litt-mascot-hero.png` | Full mascot render |
| Mascot Character Sheet | `/public/brand/litt-mascot-character-sheet.png` | All poses |
| Agent Hero | `/public/brand/litt-agent-hero-v2.png` | Agent promotional |
| Base Station | `/public/brand/litt-base-station.png` | Station render |
| Mascot Alive Poster | `/public/brand/litt-alive-poster.webp` | Animated poster frame |

### Brand Colors (from logo SVG)
```
Primary Blue:    #1e3a8a → #2563eb → #22d3ee (trunk gradient)
Circuit Branch:  #0ea5e9 → #a855f7 (branch gradient)
Leaf Circuit:    #10b981 → #22d3ee → #a855f7 (leaf gradient)
Glow:            #a855f7 at 25% opacity
Background:      #070812 (near-black with blue tint)
LiTT Green:      #4DFF62 (used in native arcade)
LiTT Purple:     #9B4DFF (used in native arcade)
Orange accent:   #f97316 (used in retro arcade section)
Cyan accent:     #65f4ff (used in promise section)
```

---

## 2. Problems to Fix

### Critical
1. **Cover art images are 2.4MB each** — 10 games = 24MB of PNGs. Should be WebP at ~50-100KB each.
2. **No LiTTree branding on game cards** — cards look like any generic game portal
3. **No "Featured Classics" section** — retro ROMs (Sonic, Mario, Battletoads) are buried below the fold
4. **No card framing/border treatment** — cards are plain rectangles with no brand identity
5. **Quick Play games have no "LiTT Certified" badge** — users don't know these are curated/vetted

### Design
6. Hero section is generic — no mascot, no animated element, no personality
7. Game cards don't show rating, year, or developer prominently
8. No "trending" or "popular this week" social proof
9. No game categories/tabs filter for Quick Play (arcade/puzzle/retro)
10. No keyboard shortcut hints or "press space to play" UX

---

## 3. Upgrade Vision — "LiTT Arcade Premium"

### 3A. Branded Game Card Design

**Concept:** Every game card gets a LiTTree-branded frame treatment.

```
┌─────────────────────────────────┐
│  ┌───────────────────────────┐  │
│  │                           │  │
│  │     COVER ART (4:3)       │  │
│  │                           │  │
│  │  ┌─ LiTT ─┐         ┌──┐  │  │
│  │  │ CERTIFIED│        │▶│  │  │
│  │  └────────┘         └──┘  │  │
│  └───────────────────────────┘  │
│  ═══════════════════════════════ │ ← circuit-line divider
│  XQuest JS              ★ 4.8   │
│  Momentum space combat           │
│  ──── arcade · 1P · 2024 ────   │
│  ┌─────────────────────────────┐ │
│  │ 🎮 LiTTree Game Cloud      │ │ ← branded footer strip
│  └─────────────────────────────┘ │
└─────────────────────────────────┘
```

**Card spec:**
- Border: `1px solid rgba(155, 77, 255, 0.15)` → hover `rgba(155, 77, 255, 0.35)`
- Corner accent: small LiTTree circuit-node dot in top-right corner (from logo SVG)
- "LiTT Certified" badge: small pill with leaf-circuit gradient, only for curated games
- Circuit-line divider between image and text (SVG line with node dots)
- Footer strip: subtle gradient bar with "LiTTree Game Cloud" micro-text
- Hover: card lifts 4px, border glows purple, play button scales in, image zooms 5%
- Active/pressed: card scales to 0.98

**Badge tiers:**
| Badge | Color | Meaning |
|-------|-------|---------|
| LiTT Certified | Green-cyan gradient | Curated by LiTTree team |
| Open Source | Blue | Free, open-source game |
| Retro Classic | Orange | Pre-1995 original |
| Native | Purple | Built with LiTTree Studio |

### 3B. Featured Classics Section (NEW)

**Position:** Right after hero, before retro arcade.

**Concept:** A horizontal-scroll "spotlight" carousel showcasing the user's imported retro ROMs with premium card treatment.

```
╔═══════════════════════════════════════════════════════╗
║  ★ FEATURED CLASSICS                              →  → ║
║  Your legendary collection, front and center           ║
║                                                        ║
║  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐    ║
║  │      │  │      │  │      │  │      │  │      │    ║
║  │Sonic │  │Mario │  │Battle│  │Lion  │  │Scooby│    ║
║  │Spin  │  │Bros 3│  │toads │  │King  │  │Doo   │    ║
║  │      │  │      │  │      │  │      │  │      │    ║
║  │GEN   │  │NES   │  │GEN   │  │GEN   │  │GEN   │    ║
║  └──────┘  └──────┘  └──────┘  └──────┘  └──────┘    ║
║                                                        ║
║  ──── 8 classics in your library ──── See all → ────  ║
╚═══════════════════════════════════════════════════════╝
```

- Horizontal scroll with snap points
- Each card: box art (from Libretro CDN) + system badge + title
- System badge colors: NES=red, SNES=purple, GB=green, GEN=blue, GBA=teal
- "See all" links to `/games/retro`
- If no ROMs imported: show "Import your classics" CTA with upload icon

### 3C. Hero Upgrade with Mascot

**Current:** Plain text hero with gradient background.

**Upgraded:**
- Left side: "Game Cloud" badge, headline, subtext, CTA buttons (same)
- Right side: **LiTTree mascot** (`litt-mascot-hero.png`) holding a game controller
- Background: animated circuit-tree pattern (subtle, from logo SVG paths)
- Floating game icons (Pac-Man ghost, Tetris block, Mario mushroom) drifting up
- Stats bar at bottom: "10 browser games · 8 retro classics · 3 native arcade · 1 DOS lab"

### 3D. Quick Play Category Tabs

**Current:** Flat grid, no filtering.

**Upgraded:**
```
[ All (10) ] [ Arcade (4) ] [ Puzzle (5) ] [ Retro (1) ]    🔍 Search...
```
- Tab pills with count badges (LiTT purple active state)
- Smooth filter animation (cards fade/slide)
- "All" is default

### 3E. Game Detail Modal (NEW)

**Concept:** Clicking a card opens a modal (not direct launch) with:
- Large cover art
- Title, developer, year, rating
- Description (full)
- Tags
- "Play Now" button (big, gradient)
- "Source" link (for open-source games)
- Controls hint (keyboard/touch)
- LiTTree mascot peeking from corner

---

## 4. File Structure for Kimi

```
src/
  app/
    games/
      page.tsx                    ← MAIN: upgrade hero, add featured classics, card redesign
      _components/                ← NEW: extracted components
        GameCard.tsx              ← Branded card component
        FeaturedClassics.tsx      ← Horizontal carousel of retro ROMs
        GameHero.tsx              ← Mascot hero section
        GameDetailModal.tsx       ← Click-to-open detail modal
        QuickPlayGrid.tsx         ← Tabbed filterable grid
        CategoryTabs.tsx          ← Filter tabs with counts
      retro/
        page.tsx                  ← (existing, minor card upgrades)
      dos/
        page.tsx                  ← (existing)
    studio/
      games/                      ← (existing native arcade)
  lib/
    games.ts                      ← Add `featured`, `certified`, `cardTheme` fields
  components/
    games/
      RetroArcadeHero.tsx         ← Add mascot, better branding
      RetroArcadeEmbedded.tsx     ← Card upgrades for ROM grid
```

---

## 5. Data Model Additions

Add to `Game` interface in `src/lib/games.ts`:

```typescript
interface Game {
  // ... existing fields ...
  
  // NEW: Branding & curation
  certified?: boolean;           // LiTT Certified badge
  featured?: boolean;            // Show in featured carousel
  cardTheme?: {
    accentColor?: string;        // Custom card accent (defaults to purple)
    badge?: "certified" | "open-source" | "retro-classic" | "native";
    glowColor?: string;          // Hover glow color
  };
  
  // NEW: Display
  controlsHint?: string;         // "Arrow keys + Space" etc.
  longDescription?: string;      // For detail modal
  screenshots?: string[];        // Optional gameplay screenshots
}
```

---

## 6. Image Optimization Checklist

**Current problem:** 10 PNG covers at 2.4MB each = 24MB.

**Fix:**
1. Convert all `/public/games/artwork/*.png` to WebP
2. Generate 3 sizes: `@1x` (400x300), `@2x` (800x600), `@3x` (1200x900)
3. Use Next.js `<Image>` component instead of `<img>` for automatic optimization
4. Target: each cover < 80KB (WebP @1x), < 150KB (@2x)

```bash
# One-time conversion (run locally)
npx sharp-cli -i "public/games/artwork/*.png" -o "public/games/artwork/webp/" -f webp --quality 80
```

Or use the Next.js Image component which auto-optimizes on Vercel.

---

## 7. CSS/Design Token Spec

```css
/* LiTT Arcade Design Tokens */
:root {
  /* Card */
  --litt-card-bg: rgba(20, 15, 31, 0.72);
  --litt-card-border: rgba(155, 77, 255, 0.15);
  --litt-card-border-hover: rgba(155, 77, 255, 0.35);
  --litt-card-radius: 16px;
  --litt-card-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
  --litt-card-shadow-hover: 0 12px 40px rgba(0, 0, 0, 0.45), 0 0 24px rgba(155, 77, 255, 0.15);
  
  /* Badge */
  --litt-badge-certified: linear-gradient(135deg, #10b981, #22d3ee);
  --litt-badge-open-source: linear-gradient(135deg, #0ea5e9, #2563eb);
  --litt-badge-retro: linear-gradient(135deg, #f97316, #fbbf24);
  --litt-badge-native: linear-gradient(135deg, #9b4dff, #7c3aed);
  
  /* System colors (retro ROMs) */
  --litt-sys-nes: #ef4444;
  --litt-sys-snes: #a855f7;
  --litt-sys-gb: #22c55e;
  --litt-sys-gen: #3b82f6;
  --litt-sys-gba: #14b8a6;
  
  /* Circuit divider */
  --litt-circuit-line: linear-gradient(90deg, transparent, rgba(155, 77, 255, 0.3) 20%, rgba(155, 77, 255, 0.3) 80%, transparent);
}
```

---

## 8. GameCard Component Spec (for Kimi to build)

```tsx
// src/app/games/_components/GameCard.tsx
"use client";

import { Play, Heart, Star } from "lucide-react";
import type { Game } from "@/lib/games";

interface GameCardProps {
  game: Game;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
  onLaunch: (game: Game) => void;
  onOpenDetail?: (game: Game) => void;
}

export function GameCard({ game, isFavorite, onToggleFavorite, onLaunch, onOpenDetail }: GameCardProps) {
  const badge = game.cardTheme?.badge;
  
  return (
    <article
      className="litt-game-card group"
      onClick={() => onOpenDetail?.(game) ?? onLaunch(game)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && (onOpenDetail?.(game) ?? onLaunch(game))}
    >
      {/* Cover */}
      <div className="litt-card-cover">
        <img src={game.coverUrl} alt={`${game.title} cover`} loading="lazy" />
        
        {/* Badges */}
        <div className="litt-card-badges">
          {badge === "certified" && <span className="litt-badge certified">LiTT Certified</span>}
          {badge === "retro-classic" && <span className="litt-badge retro">Retro Classic</span>}
          {badge === "open-source" && <span className="litt-badge oss">Open Source</span>}
          {badge === "native" && <span className="litt-badge native">Native</span>}
        </div>
        
        {/* Play button */}
        <button className="litt-card-play" onClick={(e) => { e.stopPropagation(); onLaunch(game); }}>
          <Play size={18} fill="currentColor" />
        </button>
        
        {/* Circuit corner node */}
        <span className="litt-card-node" />
      </div>
      
      {/* Circuit divider */}
      <div className="litt-circuit-divider">
        <span className="litt-circuit-dot" />
        <span className="litt-circuit-line" />
        <span className="litt-circuit-dot" />
      </div>
      
      {/* Info */}
      <div className="litt-card-info">
        <div className="litt-card-header">
          <h3>{game.title}</h3>
          <span className="litt-card-rating">
            <Star size={11} fill="currentColor" /> {game.rating}
          </span>
        </div>
        <p className="litt-card-desc">{game.description}</p>
        <div className="litt-card-meta">
          <span>{game.category}</span>
          <span>·</span>
          <span>{game.players}P</span>
          <span>·</span>
          <span>{game.year}</span>
        </div>
      </div>
      
      {/* Branded footer strip */}
      <div className="litt-card-footer">
        <img src="/logo-littree.svg" alt="" className="litt-card-logo" />
        <span>LiTTree Game Cloud</span>
      </div>
      
      {/* Favorite */}
      <button className="litt-card-fav" onClick={(e) => { e.stopPropagation(); onToggleFavorite(game.id); }}>
        <Heart size={14} fill={isFavorite ? "#f97316" : "none"} />
      </button>
    </article>
  );
}
```

---

## 9. Ideas to Showcase Classics Better

### 9A. "Era Timeline" Section
Group retro games by decade:
```
1980s: Pac-Man, Pong, DuckTales
1990s: Sonic Spinball, Battletoads, Lion King, Mario Bros 3, Scooby Doo
2000s: 2048, Flappy Bird
2020s: XQuest JS, Hextris
```
Visual: horizontal timeline with game cards branching off like the LiTTree circuit branches.

### 9B. "System Showcase" Cards
For retro ROMs, show the console as a 3D-styled card:
- NES card: red border, NES controller icon, "Nintendo Entertainment System"
- Genesis card: blue border, Genesis pad icon, "Sega Genesis / Mega Drive"
- Game Boy card: green border, GB cartridge icon

### 9C. "Now Playing" Live Widget
If a retro game was played recently, show a persistent widget:
```
🎮 NOW PLAYING: Scooby Doo Mystery (USA)
 Sega Genesis · Last played 2h ago
 [Resume] [New Game] [See Save States]
```

### 9D. Achievement-Style Stats Bar
```
🏆 8 Classics · 12,847 plays · 3 systems · 2 save states
```

### 9E. "LiTTree Recommends" AI Curator
Use the AI agent to recommend games based on what the user has played:
> "Since you enjoyed Scooby Doo Mystery, try Battletoads — another Sega Genesis platformer."

### 9F. Seasonal/Themed Collections
- "Spooky Classics" (October): Scooby Doo, Castlevania-style games
- "Holiday Classics" (December): Winter-themed games
- "Summer Arcade": Fast-paced action games

### 9G. Play Stats per Game
Show play count, last played, best score (for games that track it):
```
Sonic Spinball
★ 4.2 · 47 plays · Best: 128,400
Last played: 3 days ago
```

### 9H. Custom Box Art Generator
For games without cover art (or to add LiTTree flair), generate branded box art:
- LiTTree circuit-tree border frame
- Game title in LiTTree font
- System badge
- Mascot peeking from corner

---

## 10. Implementation Priority

| Priority | Task | Effort |
|----------|------|--------|
| P0 | Convert cover PNGs to WebP (24MB → ~1MB) | 30 min |
| P0 | Build branded GameCard component | 2 hrs |
| P0 | Add Featured Classics carousel | 2 hrs |
| P1 | Hero upgrade with mascot | 1 hr |
| P1 | Category tabs for Quick Play | 1 hr |
| P1 | Game detail modal | 2 hrs |
| P2 | Era timeline section | 3 hrs |
| P2 | System showcase cards | 2 hrs |
| P2 | Play stats per game | 2 hrs |
| P3 | AI curator recommendations | 4 hrs |
| P3 | Custom box art generator | 4 hrs |
| P3 | Seasonal collections | 2 hrs |

---

## 11. Key Files to Give Kimi

1. **This document** — full spec
2. `src/app/games/page.tsx` — current page (485 lines)
3. `src/lib/games.ts` — game data model + library
4. `src/lib/retro-arcade.ts` — retro ROM system + cover art
5. `public/logo-littree.svg` — brand logo SVG
6. `src/components/games/RetroArcadeHero.tsx` — retro hero component
7. `src/components/games/RetroArcadeEmbedded.tsx` — retro game grid
8. `src/app/studio/games/game-cloud.tsx` — native arcade registry (for design reference)

---

## 12. Prompt to Give Kimi

```
I need you to upgrade the game showcase page at /games for LiTTree LabStudios 
(litlabs.net). The current page works but looks generic — I want premium 
branded cards with the LiTTree circuit-tree logo identity, a featured classics 
carousel for retro ROMs, and better visual hierarchy.

Read the upgrade spec at docs/GAME_CLOUD_UPGRADE_SPEC.md for full details.

Key requirements:
1. Build a reusable GameCard component with LiTTree branding (circuit divider, 
   certified badges, branded footer strip, corner node accent)
2. Add a "Featured Classics" horizontal carousel showing imported retro ROMs 
   with system-colored badges
3. Upgrade the hero to include the LiTTree mascot (public/brand/litt-mascot-hero.png)
4. Add category filter tabs to Quick Play (All / Arcade / Puzzle / Retro)
5. Convert cover art from 2.4MB PNGs to optimized WebP
6. Use the brand color palette from the logo SVG (blue→cyan→purple gradients)

Brand colors: #9B4DFF (purple), #4DFF62 (green), #22d3ee (cyan), #f97316 (orange)
Logo: /public/logo-littree.svg (circuit tree with neural nodes)
Mascot: /public/brand/litt-mascot-hero.png

The page is Next.js 16 + React 19 + Tailwind CSS v4. Use "use client" for 
interactive components. Keep it accessible (aria-labels, type="button", 
keyboard nav). Don't add console.log in server code.
```

---

**End of spec.** Copy this file to Kimi along with the files listed in section 11.
