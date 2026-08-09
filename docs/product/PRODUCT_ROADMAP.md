# Product Roadmap

## P0 — The breakthrough product

Scope is frozen. No new features until P0 is solid.

### P0 items

| # | Item | Status | Spec |
|---|---|---|---|
| 1 | One LiTT brain (unified turn loop) | Architecture exists, needs unification | `LITT_CORE_ARCHITECTURE.md` |
| 2 | Quick Build (signup → preview in minutes) | Not started | `QUICK_BUILD.md` |
| 3 | Website generation in minutes | Builder exists, needs Quick Build flow | `QUICK_BUILD.md` |
| 4 | Reliable Preview | `PreviewWorkspace` built | — |
| 5 | Voice + text same conversation | Architecture explored, needs wiring | `LITT_CORE_ARCHITECTURE.md` |
| 6 | Canvas editing | `CanvasPanel` exists | — |
| 7 | PLAN / ACT / AUTO | Exists in composer | — |
| 8 | Verification receipts | Not started | `TRUTH_LAYER.md` |
| 9 | Checkpoints / rollback | Not started | `TRUTH_LAYER.md` |
| 10 | Publish | Not started | — |
| 11 | Glass OS | In progress (~60%) | `DESIGN_SYSTEM.md` |
| 12 | Fun first-build mission | Not started | `MISSIONS.md` |
| 13 | LiTT activity states (live execution UX) | Not started | `LITT_ACTIVITY_STATES.md` |

### P0 delivery phases

#### Phase 1: Foundation (current)

- ✅ Glass OS tokens + classes
- ✅ Header, sidebar, tab rows, composer, inspector, transcript
- ⬜ Finish Glass OS: bottom drawer, preview, canvas panels, dashboard
- ⬜ Unify voice/text turn loop (`runLiTTTurn`)
- ⬜ LiTT activity states (event emitter + SSE streaming + activity card)

#### Phase 2: Quick Build

- Onboarding route (`/onboarding`)
- Quick Build route (`/build`)
- Build progress screen (LiTT character + checklist)
- Post-build action bar (Change / Edit / Teach / Publish)
- Quick Build template system

#### Phase 3: Trust

- Evidence collection (typecheck, build, tests, preview, mobile)
- Build receipts in transcript
- Checkpoints before file mutations
- Rollback API + UI
- "Why did LiTT do that?" explanation cards

#### Phase 4: Publish

- Deploy flow (Vercel / Netlify)
- Custom domain connection
- Deploy verification in receipts

#### Phase 5: First Mission

- Mission 01: "Launch something people can visit"
- Tutorial sandbox system
- Mission UI (list, detail, workspace)
- Reward system (cosmetic unlocks)
- "Save as Project" promotion

## P1 — After breakthrough is solid

| Item | Spec |
|---|---|
| LiTT Workspace Operator (typed tools, risk classes, audit) | `LITT_OPERATOR.md` Phase 1 |
| Browser Operator (Playwright, live view, replay) | `LITT_OPERATOR.md` Phase 2 |
| Universal artifacts (structured message parts) | `UNIVERSAL_ARTIFACTS.md` |
| In-chat media generation (image/audio/video in chat) | `UNIVERSAL_ARTIFACTS.md` |
| Invisible tool routing (intent classifier) | `LITT_CORE_ARCHITECTURE.md` |
| Command cleanup (22 composable commands) | `LITT_OPERATOR.md` |
| Agent management page (catalog, not chat) | `AGENT_MANAGEMENT.md` |
| Game Builder basics (Quick Build, Visual Builder, behaviors) | `GAME_STUDIO_ARCADE.md` Phase 1 |
| Explain Mode | `LEARNING_SYSTEM.md` |
| Guided Build (Teach Me moments) | `LEARNING_SYSTEM.md` |
| Skill graph | `LEARNING_SYSTEM.md` |
| 4 education modes (Course/Missions/Build/Playground) | `LEARNING_SYSTEM.md` |
| Learning roadmap UI | `LEARNING_SYSTEM.md` |
| 21-day Builder Track (missions 2-21) | `MISSIONS.md` |
| LiTT Lab (playground) | `TUTORIAL_SANDBOX.md` |
| BYOK (bring your own key) | `PROVIDER_BYOK.md` |
| Project portability (.litt/project.json, LITT.md, AGENTS.md) | `PROJECT_PORTABILITY.md` |
| Themes system | `DESIGN_SYSTEM.md` |

## P2 — Ecosystem

| Item | Spec |
|---|---|
| Cloud Computer (E2B Desktop, VNC) | `LITT_OPERATOR.md` Phase 3 |
| LiTT Bridge Desktop (Windows app) | `LITT_OPERATOR.md` Phase 4 |
| Cross-device Operator | `LITT_OPERATOR.md` Phase 5 |
| LiTT Bridge (VS Code / Windsurf extension) | `LITT_BRIDGE_EXTENSION.md` |
| Missions in IDE | `LITT_BRIDGE_EXTENSION.md` + `MISSIONS.md` |
| Mobile surface | `LITT_CORE_ARCHITECTURE.md` |
| Telephone voice | Existing voice infrastructure |
| Four worlds (BUILD / CREATE / LEARN / SHARE) | `LITT_PRODUCT_VISION.md` |
| Arcade (play, discover, remix, publish) | `GAME_STUDIO_ARCADE.md` Phase 2 |
| Game missions (Pong, Flappy, Platformer, Block World) | `GAME_STUDIO_ARCADE.md` Phase 3 |
| Game jams | `GAME_STUDIO_ARCADE.md` Phase 4 |
| Gallery / remix / community | — |
| Generated themes | `DESIGN_SYSTEM.md` |
| LiTT character customization | — |

## What we are NOT building

- Marketplace expansion
- Tons of additional agents
- Complex social feed
- More random generators
- Deep mobile functionality (P2)
- Giant theme marketplace
- Fancy gamification economy
- Dozens of integrations

**These dilute the breakthrough. They can come after P0 proves the product.**

## Success metrics for P0

Not vanity metrics. Real signals:

1. **Time to first preview** — target: < 5 minutes for a simple website
2. **Build receipt accuracy** — every claim is verified (0 unverified claims)
3. **Voice + text in same conversation** — user can switch modalities mid-conversation without context loss
4. **Checkpoint rollback works** — user can undo any change
5. **First mission completion** — user publishes something in mission 01
6. **Glass OS consistency** — no visual inconsistencies across Studio surfaces

## The north star

```
Idea
 ↓
LiTT understands me
 ↓
Something works
 ↓
I can SEE it
 ↓
I can TALK to it
 ↓
I can TOUCH/edit it
 ↓
LiTT proves it works
 ↓
I understand what happened
 ↓
I publish it
 ↓
I come back tomorrow
 ↓
LiTT REMEMBERS
```

**Fast like an AI builder. Fun like a creative playground. Reliable like a real development environment. Educational without feeling like school.**
