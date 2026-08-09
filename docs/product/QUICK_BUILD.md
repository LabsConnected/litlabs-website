# Quick Build — Screen-by-Screen Flow

## The goal

A user with zero coding knowledge goes from signup to a real, working website preview in **2–5 minutes**. No setup screens. No framework selection. No GitHub. No environment variables.

## Screen 1: Onboarding question

After signup, one screen:

```
Hey 👋 I'm LiTT.

What do you want LiTT to help you become?

[ 🚀 I just want to build things ]
[ 🧠 I want to learn while building ]
[ 💻 I already develop ]
[ 🎨 I'm mostly a creator ]
```

This sets initial complexity, not capability. Stored on user profile. Changeable anytime.

**For Quick Build flow, assume user picks "🚀 I just want to build things".**

## Screen 2: What are we making?

```
What are we making?

[ Website ]  [ App ]  [ Brand ]  [ Image ]  [ Music ]  [ I'm not sure ]
```

User clicks **Website**.

## Screen 3: Tell me about it

```
Tell me what the business/project is. Speak normally.

[_______________________________________________________________]

Examples:
• "Larry's Lawn Care in Grand Haven. Residential landscaping and snow removal."
• "A portfolio site for my photography business."
• "A SaaS landing page for my AI scheduling tool."
```

User types their description.

## Screen 4: LiTT understands + plan

LiTT processes the description and responds:

```
Got it.

I'm thinking:
• Home
• Services
• Gallery
• Reviews
• Contact / Quote

Style:
Professional, local, outdoors.

[ Build It ]     [ Change Plan ]
```

LiTT asks **at most 2–3 useful questions** if the description is ambiguous. Otherwise, it proceeds straight to a plan.

If user clicks **Change Plan**:

```
What would you like to change?

[ Add/remove pages ]  [ Different style ]  [ Different features ]  [ Just talk to me ]
```

If user clicks **Build It**:

## Screen 5: The magic screen — LiTT is building

```
             LiTT IS BUILDING

        🤖
      floating

✓ Understanding your business
✓ Creating visual direction
✓ Building pages
→ Adding responsive layout
○ Testing
○ Preview

         01:47
```

### What's happening behind the scenes

1. LiTT generates project structure (Next.js or static HTML depending on complexity)
2. Creates pages based on plan
3. Applies styling (Glass OS design tokens, brand-appropriate palette)
4. Makes it responsive
5. Runs typecheck / build
6. Prepares preview

### LiTT character states

- **Idle**: floating calmly
- **Thinking**: `◌ Inspecting project`
- **Working**: checklist with `→` for current step, `✓` for completed
- **Success**: tiny celebration, glow, LiTT reacts

### Timing targets

| Step | Target |
|---|---|
| Understand + plan | < 10s |
| Build pages | < 60s |
| Style + responsive | < 30s |
| Test + preview prep | < 20s |
| **Total** | **< 2 min for simple sites** |

## Screen 6: Your site is ready

```
✨ BUILD COMPLETE

5 files created
Mobile ✓
Desktop ✓
0 TypeScript errors

[ See It ]
```

User clicks **See It**:

```
┌───────────────────────────────────────┐
│                                       │
│       REAL LIVE PREVIEW               │
│                                       │
│       (actual rendered website)       │
│                                       │
└───────────────────────────────────────┘

[ Change Something ]  [ Edit Visually ]  [ Teach Me ]  [ Publish ]
```

### Change Something

Returns to chat. User can type or speak:

```
User: "Make the hero darker and make the button stand out more."

LiTT: "Got it. Updating that section."

[Canvas changes]
[Preview changes]

LiTT: "Better?"
```

### Edit Visually

Opens Canvas. User can click sections, drag, resize, and speak/type changes.

### Teach Me

Opens Guided Build mode:

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

### Publish

See `PRODUCT_ROADMAP.md` — publish flow is a P0 item but separate spec.

## Screen 7: After first build — the ladder

Once the first site is built and previewed, the user sees:

```
Your site is live in preview.

Next steps:
[ Publish it ]           → Deploy to a URL
[ Make it yours ]        → Colors, domain, images, branding
[ Make it useful ]       → Forms, auth, database, payments
[ Keep building ]        → Add more pages, features
[ Learn how it works ]   → Guided Build / Teach Me
```

This is the beginning of the product ladder, not the end.

## What the user NEVER sees during Quick Build

- GitHub
- npm
- framework selection
- Docker
- environment variables
- model selection
- branch selection
- API tokens
- terminal
- file tree
- package.json

All of that exists in Studio. It's just not shown during Quick Build.

## Progressive disclosure

After the first build, the user can gradually unlock more:

```
Quick Build (beginner)
  → "I want more control" → Canvas + visual editing
  → "I want to see the code" → Code view (read-only first)
  → "I want to edit code" → Code editor (with LiTT assist)
  → "I want terminal" → Terminal panel
  → "I want Git" → GitHub connection
  → "I want to deploy" → Publish flow
  → Full Studio (advanced)
```

Each step is opt-in. The user is never forced to see more than they need.

## Voice integration

At any point during Quick Build, the user can use voice:

```
[Looking at preview]
User: "LiTT, I don't like that hero. Make it darker and make the button stand out more."

LiTT: "Got it. Updating that section."

[Canvas changes]
[Preview changes]

LiTT: "Better?"
```

This is where voice becomes killer — the user is looking at a real preview and can talk to it naturally.

## Existing codebase mapping

| Screen | Current implementation |
|---|---|
| Onboarding question | Not built — needs new route |
| What are we making | Not built — needs new route |
| Tell me about it | Not built — needs new route |
| Plan | `StudioProjectPicker` has some project creation logic |
| Magic build screen | Not built — needs build progress UI |
| Preview | `PreviewWorkspace` exists |
| Change Something | `CommandComposer` + `StudioTranscript` exist |
| Edit Visually | `CanvasPanel` exists |
| Teach Me | Not built — needs Guided Build mode |
| Publish | Not built — needs deploy flow |

### What needs to be built

1. **Onboarding route** (`/onboarding`) — persona selection
2. **Quick Build route** (`/build`) — the guided flow: what → describe → plan → build → preview
3. **Build progress component** — the magic screen with LiTT character + checklist + timer
4. **Intent classifier** — routes natural language to build tools
5. **Quick Build template system** — pre-built site templates that LiTT customizes
6. **Post-build action bar** — Change / Edit / Teach / Publish buttons
