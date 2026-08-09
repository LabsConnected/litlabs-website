# Missions

## What missions are

Missions replace tutorials. Instead of "Lesson 1: HTML Elements," missions are real tasks that produce real results.

```
Mission 01

Launch something people can visit

✓ Pick an idea
✓ Generate your site
✓ Change something visually
✓ Connect a form
○ Publish it
```

## Mission structure

```ts
interface Mission {
  id: string;                    // "mission-01-first-launch"
  track: "builder" | "creator";  // which 21-day track
  week: 1 | 2 | 3;
  day: number;                   // 1-21
  title: string;                 // "Launch something people can visit"
  promise: string;               // "You'll have a live URL."
  steps: MissionStep[];
  reward: MissionReward;
  prerequisites?: string[];      // mission IDs
  workspaceType: "tutorial_sandbox" | "project";
  assistanceLevels: ("show_me" | "build_with_me" | "challenge_me")[];
}

interface MissionStep {
  id: string;
  label: string;                 // "Pick an idea"
  type: "action" | "check" | "build";
  completed: boolean;
  hint?: string;
  checkCommand?: string;         // command to verify completion
}

interface MissionReward {
  xp: number;
  unlocks: CosmeticUnlock[];
  badge?: string;
}

interface CosmeticUnlock {
  type: "wallpaper" | "theme" | "litt_shell" | "badge" | "profile_frame";
  id: string;
  name: string;
}
```

## The 21-day track

See `LEARNING_SYSTEM.md` for the full day-by-day breakdown.

### Week 1 — Make things

```
Mission 01: First HTML site
  You'll have a page open in a browser.
  Files: index.html, style.css, script.js
  Reward: 🌌 Nebula Grid wallpaper, +150 XP

Mission 02: Style it
  Same page, but styled.
  Reward: 💜 Glass OS theme unlock, +150 XP

Mission 03: Images and assets
  Page with images.
  Reward: 🖼 Image badge, +100 XP

Mission 04: JavaScript interaction
  Interactive button.
  Reward: ⚡ LiTT spark effect, +150 XP

Mission 05: Mobile responsiveness
  Responsive page.
  Reward: 📱 Mobile badge, +100 XP

Mission 06: Forms
  Working form.
  Reward: 📝 Form badge, +100 XP

Mission 07: Publish
  Live URL.
  Reward: 🚀 First Launch badge, Builder Level 2, +300 XP
```

### Week 2 — Understand projects

```
Mission 08: Files & folders
Mission 09: Terminal basics
Mission 10: Git concepts
Mission 11: GitHub
Mission 12: APIs
Mission 13: Environment variables
Mission 14: Debugging
```

### Week 3 — Modern AI building

```
Mission 15: Components
Mission 16: React concepts
Mission 17: Next.js basics
Mission 18: Database
Mission 19: Authentication
Mission 20: AI APIs
Mission 21: Build final project (LiTT assists, doesn't carry)
```

## Mission workspace

Each mission gets its own sandbox:

```
Mission Workspace

first-html-site/
├ index.html
├ style.css
└ script.js

[ Preview ]  [ Reset Mission ]  [ Save as Project ]
```

### Sandbox features

- Isolated files (no damage to real projects)
- Terminal
- Preview
- Checkpoints
- Reset button
- LiTT access (full chat, voice, tools)
- No deployment risk

### Save as Project

If the user loves what they made:

```
[ Keep this project ]

→ Promotes sandbox to a normal Studio project
→ Files move to user's project space
→ Conversation continues
→ Full Studio features unlocked
```

This is the transition from learning → creating.

## Mission UI

### Mission list

```
BUILDER TRACK — Week 1

✓ Mission 01: First HTML site
✓ Mission 02: Style it
→ Mission 03: Images and assets    IN PROGRESS
○ Mission 04: JavaScript interaction
○ Mission 05: Mobile responsiveness
○ Mission 06: Forms
○ Mission 07: Publish
```

### Mission detail

```
MISSION 03

Images and assets

You'll add images to your page and learn how to organize them.

Assistance:
[ 🟢 Show Me ]  [ 🟡 Build With Me ]  [ 🔴 Challenge Me ]

Steps:
✓ Find an image to use
→ Add it to your page with <img>
○ Add alt text for accessibility
○ Make it responsive

[ Start Mission ]  [ Preview ]  [ Reset ]
```

### Mission complete

```
MISSION COMPLETE

🖼 Images and assets

You learned:
✓ <img> tag
✓ Alt text
✓ Responsive images

Builder XP +100

Unlocked:
🖼 Image badge

[ Next Mission ]  [ Keep Building ]  [ Save as Project ]
```

## Mission in IDE (LiTT Bridge)

Missions can continue inside VS Code / Windsurf:

```
MISSION 04

Make the button react.

□ Find button
□ Add event listener
□ Change text on click

[ Ask LiTT ]  [ Hint ]  [ Check Work ]
```

See `LITT_BRIDGE_EXTENSION.md`.

## Database schema

```sql
CREATE TABLE studio_missions (
  id TEXT PRIMARY KEY,
  track TEXT NOT NULL,
  week INTEGER NOT NULL,
  day INTEGER NOT NULL,
  title TEXT NOT NULL,
  promise TEXT,
  steps JSONB NOT NULL,
  reward JSONB NOT NULL,
  prerequisites TEXT[],
  workspace_type TEXT NOT NULL DEFAULT 'tutorial_sandbox'
);

CREATE TABLE studio_user_mission_progress (
  user_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started', -- not_started, in_progress, completed
  current_step INTEGER DEFAULT 0,
  assistance_level TEXT DEFAULT 'show_me',
  sandbox_project_id TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, mission_id)
);
```

## What needs to be built

1. Mission definitions (JSON/TS data files)
2. Mission list + detail UI
3. Mission workspace (sandbox creation, isolation)
4. Step tracking + verification
5. Reward unlock system
6. "Save as Project" promotion flow
7. XP + skill graph integration
