# Game Studio & Arcade

## The vision

Games naturally combine nearly everything LiTTree is building: AI coding + Canvas + images + music + voice + assets + learning + community + remixing. That's one area where the "all-in-one" approach feels coherent rather than bloated.

## Product structure

```
LiTTree Arcade                    LiTTree Studio
PLAY • DISCOVER • SHARE • REMIX    BUILD • EDIT • TEST • PUBLISH
        │                                  │
        │ Create with LiTT                 │
        └──────────────────────────────────┘
                     │
                  ONE LiTT
```

Arcade is where people play/discover/remix. Game Builder belongs inside Studio with LiTT.

## Game Builder in Studio

Games live under **Create**, not as another permanent top tab beside Chat/Canvas/Code.

```
CREATE
├── Images
├── Music
├── Video
├── Websites
├── Documents
└── 🎮 Games
```

Choosing **Games** opens:

```
GAME STUDIO

[ Quick Build ] [ Visual Builder ] [ Code ] [ Preview ] [ Assets ]
```

Same LiTT. Same project. Same conversation.

## Quick Build — games

Beginner says:

> Make me a Minecraft-style browser game where I can place and destroy blocks.

LiTT:

1. Creates isolated project
2. Picks appropriate stack (progressively: HTML/JS/Canvas → Phaser → Three.js → Babylon.js)
3. Generates playable version
4. Runs it
5. Tests controls
6. Opens preview
7. Explains what it built
8. Lets them continue visually, conversationally, or in code

```
✓ Game created
✓ Keyboard controls working
✓ Mouse controls working
✓ Mobile fallback added
✓ Preview running

[ Play ]
[ Change It ]
[ Edit Visually ]
[ Learn How It Works ]
[ Publish to Arcade ]
```

### Tech progression (user doesn't need to know)

| Level | Stack | When |
|---|---|---|
| Simple 2D | HTML + CSS + JavaScript + Canvas API | Beginner games (Pong, Flappy) |
| Better 2D | Phaser | Platformers, arcade games |
| Browser 3D | Three.js / Babylon.js | Block worlds, 3D games |
| Bigger projects | External engines / export workflows | Advanced users (later) |

LiTT determines the implementation. User just says what they want.

### Teach Me for games

```
World
├─ blocks
├─ player
├─ camera
├─ input
└─ game loop
```

## Visual Game Builder

Extends the existing Canvas concept for games.

### Layout

```
┌──────────┬──────────────────────┬──────────────┐
│ OBJECTS  │  GAME WORLD / SCENE  │  PROPERTIES  │
│          │                      │              │
│ Player   │                      │  Position    │
│ Enemy    │                      │  Size        │
│ Platform │                      │  Rotation    │
│ Wall     │                      │              │
│ Block    │                      │  Appearance  │
│ Coin     │                      │  Sprite      │
│ Door     │                      │  Material    │
│ Image    │                      │  Color       │
│ Text     │                      │              │
│ Button   │                      │  Physics     │
│ Camera   │                      │  Collision   │
│ Light    │                      │  Gravity     │
│ Particle │                      │              │
│ Audio    │                      │  Behavior    │
│          │                      │  Move        │
│          │                      │  Jump        │
│          │                      │  Damage      │
│          │                      │  Collect     │
│          │                      │              │
│          │                      │  Events      │
│          │                      │  On Click    │
│          │                      │  On Touch    │
│          │                      │  On Collision│
│          │                      │  On Start    │
└──────────┴──────────────────────┴──────────────┘
```

### AI-driven behavior

User selects enemy:

> Make this guy chase me when I'm within 10 blocks.

LiTT writes the behavior. That's where AI becomes incredibly useful for game creation.

## Behaviors (not scripting)

Don't require users to script everything. Give them **Behaviors**:

```
Player
├── WASD Movement
├── Jump
└── Health

Coin
├── Spin
├── Collectible
└── +10 Score

Enemy
├── Patrol
├── Chase Player
└── Damage On Touch
```

LiTT generates new behaviors from plain English:

> Make this platform disappear two seconds after I step on it.

```
Created behavior: Timed Collapse

Trigger: Player collision
Delay: 2 seconds
Action: Disable platform
Respawn: 5 seconds
```

User can inspect the underlying code if they want.

## Assets connect to the entire platform

Inside Game Studio:

> LiTT, make me a pixel-art spaceship. → Image generator
> Make an explosion sound. → Audio generator
> Make background music. → Music generator
> Make an intro cutscene. → Video generator

All results become:

```
Game Project
└── assets/
    ├── spaceship.png
    ├── explosion.wav
    ├── soundtrack.mp3
    └── intro.mp4
```

**No leaving the project.** Universal artifacts (see `UNIVERSAL_ARTIFACTS.md`) make this work from normal LiTT Chat too.

## Arcade

Primarily about **playing**.

### Structure

```
LiTT ARCADE

Featured
New
Trending
Made with LiTT
Remixable
Multiplayer
Game Jams
My Games
```

### Game card

```
┌─────────────────────────────┐
│          GAME ART           │
│                             │
│ BlockWorld                  │
│ by Larry                    │
│                             │
│ ▶ Play    🔀 Remix          │
│                             │
│ 1.2K plays • 84 likes       │
└─────────────────────────────┘
```

### Remix with LiTT

Player loves a game:

> Remix this.

LiTT copies an allowed project into their workspace:

```
BlockWorld — Larry Remix
```

Then:

> Make everything underwater and replace zombies with robots.

Boom. That's way more LiTTree than just hosting old games.

## Game missions

Fits the education system perfectly (see `LEARNING_SYSTEM.md`).

Not "JavaScript Lesson 14." Instead:

### Mission: Build Pong

```
Learn:
✓ game loop
✓ keyboard input
✓ collision
✓ scoring
```

### Mission: Build Flappy-style game

```
Learn:
✓ gravity
✓ spawning
✓ hit detection
```

### Mission: Build a platformer

### Mission: Build a block world

All with 4 education modes:

```
📚 Teach me first
🧭 Build with me
⚡ LiTT build it
🧪 Let me experiment
```

## Game jams

Community feature (post-P0):

```
48 Hour LiTT Game Jam

Theme: LOST IN SPACE

Rules:
• Build using LiTTree
• Original/licensed assets only
• Publish to Arcade
• Remix allowed if creator enables it

Categories:
Most Fun | Best Art | Best Beginner Game | Best LiTT Use | Community Favorite
```

Gives people a reason to **create**, not merely consume.

## Publishing flow

```
BUILD → TEST → VERIFY → ARCADE PREVIEW → PUBLISH
```

### Game receipt

```
GAME CHECK ✓

Game starts       ✓
Controls          ✓
Assets loaded     ✓
Console errors    0
Mobile            ✓
License scan      ✓
Thumbnail         ✓

[ Publish to Arcade ]
```

See `TRUTH_LAYER.md` for receipt architecture.

## Copyright guardrails

Stay far away from the emulator mess.

### Asset licensing on publish

```
Assets
✓ Original
✓ AI generated
✓ User-owned
✓ Compatible open license

Unknown copyrighted assets
⚠ Review required
```

### Template naming

Templates should be **inspired by genres/mechanics**, not copyrighted franchises.

| Good | Bad |
|---|---|
| Block-building survival starter | Minecraft Clone Pack with Minecraft textures |
| Side-scrolling platformer starter | Super Mario Bros Template |
| Top-down space shooter starter | Galaga Clone |

## In-chat game generation

Someone can type into normal Chat:

> Make me a simple horror game.

LiTT generates it, then says:

```
Your playable prototype is ready.

[ Play ]
[ Open Game Studio ]
[ Edit Code ]
[ Generate Assets ]
[ Publish Later ]
```

This is exactly how games fit into LiTTree — through the universal front door (Chat), with deeper tools available in Game Studio.

## Product structure (updated)

```
                 LiTTree

BUILD
Websites • Apps • Games

CREATE
Images • Music • Video • Branding • Games

LEARN
Courses • Missions • Playground

SHARE
Gallery • Arcade • Remix • Community
```

Underneath: **ONE LiTT**.

## Implementation phases

### Phase 1 — Game Builder basics (P1)

- Game project type in Studio
- Quick Build for games (HTML/JS/Canvas → Phaser)
- Game preview with controls testing
- Visual Game Builder (objects, properties, behaviors)
- AI behavior generation from natural language
- Asset integration (image/audio/video generators → game assets)
- Teach Me for game concepts

### Phase 2 — Arcade (P1/P2)

- Arcade route (`/arcade`)
- Game cards (art, title, author, plays, likes)
- Play / Remix actions
- Publish flow with game receipt
- Copyright guardrails (asset licensing check)
- Featured / New / Trending / Made with LiTT / Remixable sections

### Phase 3 — Game missions (P2)

- Pong, Flappy, Platformer, Block World missions
- Game-specific skill graph nodes
- Game jam system
- Multiplayer (future)

### Phase 4 — Advanced (P2+)

- Three.js / Babylon.js support
- 3D Visual Builder
- Game jam events
- Multiplayer infrastructure
- External engine export

## Existing codebase mapping

| Concept | Current |
|---|---|
| Canvas | `CanvasPanel`, `CanvasNode` — extends to game objects |
| Preview | `PreviewWorkspace` — extends to game preview |
| Image gen | fal.ai integration — connects to game assets |
| Audio gen | Music studio — connects to game audio |
| Video gen | Video studio — connects to game cutscenes |
| Quick Build | Spec'd in `QUICK_BUILD.md` — extends to games |
| Missions | Spec'd in `MISSIONS.md` — game missions added |
| Artifacts | Spec'd in `UNIVERSAL_ARTIFACTS.md` — game results |
| Receipts | Spec'd in `TRUTH_LAYER.md` — game checks |

### What needs to be built

1. **Game project type** — `workspace_type: 'game'` or framework detection
2. **Game Studio route** — `/studio?tool=games` or Create → Games
3. **Visual Game Builder** — extends Canvas with game objects, physics, behaviors
4. **Behavior system** — declarative behaviors + AI generation from natural language
5. **Game preview** — playable preview with input testing
6. **Game asset pipeline** — image/audio/video generators → `assets/` folder
7. **Arcade route** — `/arcade` with game discovery
8. **Game cards** — art, metadata, play/remix actions
9. **Publish flow** — game receipt with specific checks (controls, assets, console, mobile, license)
10. **Remix flow** — copy allowed project to user workspace
11. **Copyright guardrails** — asset license scan on publish
12. **Game missions** — Pong, Flappy, Platformer, Block World
13. **Game jam system** — events, themes, categories, submissions
