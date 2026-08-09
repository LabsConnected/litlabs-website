# Learning System

## The promise

> **Become comfortable building with AI in 21 days.**

Not "become a senior developer." Not "learn web development in 30 days."

Become **dangerous enough with AI + software that you don't feel helpless anymore.**

## Core principles

1. **Never force one style on everybody** — 4 education modes, switchable anytime
2. **Never leave the learner wondering what's next** — LiTT always has a recommended next step
3. **Learn while owning a working product** — use the user's real project, not fake examples
4. **Skipping is completely acceptable** — "Let LiTT Handle This" is a valid choice for every topic
5. **Same LiTT learning memory across all modes** — skill graph persists regardless of how you learn

## 4 Education Styles

When someone enters **Learn**, they choose:

```
Welcome to LiTTree Learn.

What sounds best?

📚 Start from the beginning
   Teach me the fundamentals in order.

🧭 Learn by building
   Give me real projects and teach concepts along the way.

⚡ Help me build something
   Skip the lessons for now.

🧪 Let me experiment
   Give me a safe playground.
```

> **You can switch modes at any time. Your progress stays with LiTT.**

| Mode | Best for | What it is |
|---|---|---|
| 📚 **Course** | "Teach me properly from the beginning." | Structured, sequential learning with hands-on practice |
| 🧭 **Missions** | "Teach me while I build things." | Real projects with concepts explained as they become relevant |
| ⚡ **Build** | "Just help me make shit." | LiTT builds it, offers optional "Teach Me" afterward |
| 🧪 **Playground** | "Let me experiment safely." | LiTT Lab — sandbox with full LiTT access, no risk |

All four use the **same LiTT learning memory** (skill graph, struggles, preferences).

### Switching between modes

Someone can start with:

```
⚡ Just Build
```

and two weeks later decide:

> I want to actually understand this.

LiTT already knows their project, so instead of generic lessons:

> "Let's use **your own navbar** to learn HTML structure."

That's much better than starting over with fake examples.

## 📚 Course Mode — Structured Learning

Structured, sequential learning. But not dry.

### Topic format

Instead of:

> Lesson 1: HTML Elements

Do:

```
HTML — What actually makes up a webpage
```

Then:

```
HTML tells the browser WHAT exists.

<h1>      Heading
<p>       Paragraph
<img>     Image
<a>       Link
<button>  Button
```

Then immediately:

```
Try it →

Change:

<h1>Hello</h1>

to:

<h1>My First Website</h1>

[ Run ]
```

LiTT shows the result. Structured **and** hands-on.

### The learning loop

Every concept follows this loop:

```
1. WHAT IS THIS?
      ↓
2. WHY DO I NEED IT?
      ↓
3. SEE AN EXAMPLE
      ↓
4. TRY IT YOURSELF
      ↓
5. USE IT IN SOMETHING REAL
      ↓
6. WHAT'S NEXT?
```

**Never leave the learner wondering what's next.**

### Course curriculum

```
FOUNDATIONS
  How websites work
  HTML
  CSS
  JavaScript

TOOLS
  Files & folders
  Terminal
  Git
  GitHub

MODERN BUILDING
  APIs
  React
  Next.js
  Databases
  Authentication

SHIP
  Testing
  Deployment
  Domains
```

### Every topic has 3 choices

```
[ Learn It ]
[ Let LiTT Handle This ]
[ Already Know This ]
```

If someone doesn't care about Git:

> **Let LiTT Handle This**

Fine. LiTT handles Git while giving them a tiny explanation when necessary. Later they can return and learn it.

## 🧭 Missions Mode — Learn by Building

Real projects with concepts explained as they become relevant.

```
Mission 01: Build your first website
  → LiTT explains HTML structure as it creates pages
  → LiTT explains CSS as it styles them
  → LiTT explains responsive design as it makes it mobile-friendly

Mission 02: Add styling
  → Deeper CSS concepts

Mission 03: Make it interactive
  → JavaScript basics
```

See `MISSIONS.md` for full mission structure.

### 3 Assistance levels (within missions)

#### 🟢 SHOW ME

LiTT does the work and explains it.

```
LiTT: I'll create the page and show you what changed.
```

#### 🟡 BUILD WITH ME

LiTT guides, user does the typing.

```
LiTT: Add this heading beneath <body>.
      I'll check it when you're done.
```

#### 🔴 CHALLENGE ME

User does it alone.

```
Goal: Add a green button linking to /contact.

[ Check My Work ]  [ Hint ]  [ LiTT Help ]
```

## ⚡ Build Mode — Just Build

User doesn't care about learning right now.

```
User: "Make me a website."

LiTT builds it.
```

But afterward:

```
Your site is ready.

[ Keep Building ]
[ Show Me How It Works ]
[ Teach Me What We Just Used ]
```

If they choose "Teach Me What We Just Used":

```
We used:
• HTML for page structure
• CSS for styling
• JavaScript for the contact form

Want to learn any of these properly?

[ Learn HTML ]  [ Learn CSS ]  [ Learn JavaScript ]  [ No thanks, keep building ]
```

This is the bridge from Build → Course/Missions.

## 🧪 Playground Mode — LiTT Lab

A safe place to experiment. See `TUTORIAL_SANDBOX.md`.

```
🧪 LiTT Lab

Try:
HTML | CSS | JavaScript | React | APIs | AI | Images

[ Reset ]  [ Save as Project ]
```

No mission required. No structure. Just a safe place to break things with LiTT.

## Learning Roadmap

Visual, always visible:

```
YOUR BUILDER PATH

FOUNDATIONS
● How websites work
● HTML
◉ CSS             ← YOU ARE HERE
○ JavaScript

TOOLS
○ Files & folders
○ Terminal
○ Git
○ GitHub

MODERN BUILDING
○ APIs
○ React
○ Next.js
○ Databases
○ Authentication

SHIP
○ Testing
○ Deployment
○ Domains
```

No mystery. They always know:

- Where they are
- What they've learned
- What's coming
- What they can skip

## LiTT Always Has a Next Step

At the end of everything:

```
✅ You understand basic HTML structure.

You can now:

[ Learn CSS Next ]        Recommended
[ Practice HTML ]
[ Build Something ]
[ Ask LiTT Questions ]
```

And explain why:

> **Recommended: CSS**
> You now know what goes on the page. CSS teaches you how to make it look good.

That's the guidance most learners are missing.

## "Explain as we go" — Global Teaching Level

A global setting that controls how much LiTT explains during any mode:

```
Teaching Level

○ Off
○ Minimal
● Helpful
○ Detailed
```

### Off

LiTT just does things. No explanations.

### Minimal

> "I created a CSS file for styling."

### Helpful

> "I created `styles.css`. CSS controls how the HTML looks."

### Detailed

LiTT goes into selectors, cascade, inheritance, specificity, etc.

This is better than forcing one education style on everybody. A Build mode user might want "Minimal." A Course mode user might want "Detailed."

## Explain Mode

Anywhere in Studio, a `[? Explain]` button can appear.

### Targets

| Click | Question |
|---|---|
| File | "Explain this file." |
| Canvas node | "What does this section do?" |
| Terminal error | "Explain this like I'm new." |
| Code selection | "Why is this needed?" |
| Build receipt | "Explain what changed." |

### Explanation levels

```
Explain:
[ Simple ]  [ Normal ]  [ Technical ]
```

### Simple example

Instead of:

> "This component hydrates client-side state."

LiTT says:

> "This file controls the navigation bar. When somebody taps the menu button on a phone, this code decides whether the menu opens or closes."

### How it works

Explain Mode routes through LITT CORE with:

```ts
{
  tool: "code.explain",
  target: {
    type: "file" | "canvas_node" | "terminal_error" | "code_selection" | "receipt",
    path?: string,
    nodeId?: string,
    error?: string,
    selection?: { startLine, endLine, content },
  },
  level: "simple" | "normal" | "technical",
  userSkillContext: SkillGraph,  // so LiTT can reference what they already know
}
```

LiTT adjusts explanations based on the user's skill graph:

> "This is similar to the event listener you used two missions ago."

## Skill Graph

LiTT remembers what the user actually knows:

```
Larry's Knowledge

HTML          Comfortable
CSS           Learning
JavaScript    Beginner
Terminal      Comfortable
Git           Needs practice
React         Learning
Deployment    Comfortable
```

Then LiTT doesn't waste time explaining `<p>` tags to someone who already knows them. And it doesn't suddenly say "Just rebase your branch" to somebody who hasn't learned Git.

### Skill levels

```
Comfortable    — demonstrated proficiency
Learning       — actively practicing
Beginner       — introduced but not practiced
Needs practice — learned but rusty
Unknown        — not yet encountered
```

### Skill tracking

Progress comes from **demonstrated tasks**, not just clicking "next."

- Completed a mission using HTML tags → HTML skill up
- Successfully edited a CSS file → CSS skill up
- Pushed to GitHub → Git skill up
- Deployed a project → Deployment skill up
- Clicked "Let LiTT Handle This" → skill stays "Unknown"
- Clicked "Already Know This" → skill set to "Comfortable" (verified later)

### How LiTT uses it

- Adjusts explanation depth
- References prior knowledge ("similar to what you did in Mission 2")
- Suggests next topics based on gaps
- Never condescends ("You should already know closures")
- Never uses jargon the user hasn't learned

```ts
interface SkillGraph {
  skills: Array<{
    category: string;       // "Foundations", "Tools", "Modern Building", "Ship"
    name: string;           // "HTML", "CSS", "JavaScript"
    level: "comfortable" | "learning" | "beginner" | "needs_practice" | "unknown";
    demonstratedAt: string[]; // mission IDs / course topics where demonstrated
  }>;
  struggles: string[];      // ["terminal", "git branches"]
  teachingLevel: "off" | "minimal" | "helpful" | "detailed";
  preferredExplanation: "simple" | "normal" | "technical";
}
```

## Guided Build — Teach Me moments

After Quick Build or any Build mode session, the user can choose "Teach Me":

```
Your site is working. I added a contact form.
Want to know how it works, or keep building?

[ Keep Building ]  [ Teach Me ]
```

If Teach Me:

```
Contact form
├── What it does
├── Where the file lives
├── How submissions work
└── Try changing it yourself
```

This is **contextual learning** — the user learns about their own working project, not a toy example.

## "Why did LiTT do that?"

Every AI change can include:

```
Changed: Navbar.tsx

Why:
Mobile navigation overflowed below 768px.

What LiTT changed:
Switched the navigation into a collapsible menu.

[ Explain Code ]  [ View Diff ]
```

This teaches while maintaining trust. See `TRUTH_LAYER.md`.

## 21-Day Builder Track (Missions mode)

See `MISSIONS.md` for full detail.

### Week 1 — Make things

| Day | Mission | Produces |
|---|---|---|
| 1 | First HTML site | A page in a browser |
| 2 | Style it | Same page, styled |
| 3 | Images and assets | Page with images |
| 4 | JavaScript interaction | Interactive button |
| 5 | Mobile responsiveness | Responsive page |
| 6 | Forms | Working form |
| 7 | Publish | Live URL |

### Week 2 — Understand projects

| Day | Mission | Produces |
|---|---|---|
| 8 | Files & folders | Understanding of project structure |
| 9 | Terminal basics | Run commands |
| 10 | Git concepts | First commit |
| 11 | GitHub | Push to remote |
| 12 | APIs | Fetch data |
| 13 | Environment variables | Config management |
| 14 | Debugging | Fix a broken project |

### Week 3 — Modern AI building

| Day | Mission | Produces |
|---|---|---|
| 15 | Components | Reusable UI piece |
| 16 | React concepts | Interactive component |
| 17 | Next.js basics | Next.js page |
| 18 | Database | Data persistence |
| 19 | Authentication | Login flow |
| 20 | AI APIs | AI-powered feature |
| 21 | Build final project | Complete project with LiTT assisting |

**Every mission produces something visible.** No boring theoretical filler.

## Rewards

Mission completion gives cosmetic rewards:

```
MISSION COMPLETE

🚀 Your first site is alive.

You learned:
✓ HTML structure
✓ CSS styling
✓ Linking pages

Builder XP +150

Unlocked:
🌌 Nebula Grid wallpaper

[ Keep Building ]
```

### Reward types

- Wallpapers
- LiTT effects (halo, particles, glow)
- Themes
- Badges
- Profile frames
- Workspace decorations

**Not pay-to-win. Not NFTs. Just personality.**

## Database schema

```sql
CREATE TABLE studio_user_skills (
  user_id TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  category TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'unknown',
  demonstrated_at TEXT[],
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, skill_name)
);

CREATE TABLE studio_user_learning_prefs (
  user_id TEXT PRIMARY KEY,
  education_mode TEXT DEFAULT 'build',      -- course | missions | build | playground
  teaching_level TEXT DEFAULT 'helpful',     -- off | minimal | helpful | detailed
  explanation_level TEXT DEFAULT 'simple',   -- simple | normal | technical
  current_topic TEXT,
  struggles TEXT[],
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## Existing codebase mapping

| Concept | Current |
|---|---|
| Conversation | `useConversationStore` |
| Messages | `ConversationMessage` |
| Reasoning | `ConversationMessage.reasoning` |
| Tool activity | `ConversationMessage.toolActivity` |
| Action chips | `ActionChips`, `parseJarvisActions` |

### What needs to be built

1. **Education mode selector** — UI for choosing Course/Missions/Build/Playground
2. **Skill graph** — `studio_user_skills` table, tracking logic
3. **Learning preferences** — `studio_user_learning_prefs` table
4. **Learning roadmap UI** — visual path with current position
5. **Course curriculum** — topic definitions with learning loop structure
6. **Explain Mode** — API endpoint + UI button + rendering
7. **Mission system** — mission definitions, progress tracking, sandbox creation
8. **Assistance level selector** — UI in mission workspace
9. **Reward system** — unlock logic, cosmetic storage
10. **Guided Build mode** — "Teach Me" flow in Studio
11. **"Why did LiTT do that?"** — explanation cards on diffs
12. **Teaching level setting** — global setting in user preferences
13. **"Let LiTT Handle This" / "Already Know This"** — skip/verify flow per topic
