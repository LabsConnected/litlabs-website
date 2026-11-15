> **LEGACY HISTORY — NOT CURRENT GUIDANCE.**
> This document was written in June 2026 for the Litlabsos codebase and was
> preserved on 2026-11-15 under `docs/legacy/` as project history when the
> remaining good pieces of Litlabsos were pulled into litlabs-website.
> Its design palette (cyan/magenta accents) is **superseded**: current
> decisions are the light Signature look by default, charcoal dark surfaces,
> and no pink anywhere. Do not use this document as design or build guidance.

# LiTree LabStudios — Full Design & Build Blueprint
# Version 1.0 | 2026-06-26

---

## ═══════════════════════════════════════
## PART 1: THE ONE-LINE PROMISE
## ═══════════════════════════════════════

**"LiTree LabStudios is the future creator OS — build AI tools, share your work publicly, discover what others are making, and grow with a community of builders."**

Every page, every button, every piece of copy must answer: "does this support that promise?"

---

## ═══════════════════════════════════════
## PART 2: COMPLETE DESIGN SYSTEM
## ═══════════════════════════════════════

### Color Palette

#### Core Brand Colors
```
Name           Hex        Usage
──────────────────────────────────────────────────────
--lit-bg       #0a0a12   Primary background (deep space)
--lit-surface  #111118   Card/panel surfaces
--lit-box-bg  rgba(255,255,255,0.03)  Subtle card fill
--lit-border  rgba(255,255,255,0.1)   Borders, dividers
--lit-text    #e0e0e0   Primary text
--lit-muted   rgba(255,255,255,0.6)  Secondary text

Brand Accents (keep all four — each serves a different purpose):
--lit-header   #00f0ff   Cyan — primary brand, CTAs, links, active states
--lit-accent   #ff00a0   Magenta/Pink — social actions, love, creativity
--lit-link     #ff9ff3   Soft pink — secondary links, tags
--lit-success  #00ff41   Neon green — online status, success, live indicators
```

#### Style Concept Colors (pick one as primary)

**Concept A — Creator OS Noir** (Perplexity/Claude vibe)
```
Background:     #0a0a0f (near black)
Surface:        #13131a (charcoal)
Primary Accent: #00f0ff (electric cyan)
Secondary:      #a78bfa (soft violet — softer than magenta)
Success:        #00ff41
Warning:        #fbbf24 (amber)
Text:           #f4f4f5
Muted:          #71717a
Glass:          rgba(255,255,255,0.04) + backdrop-blur-xl
```

**Concept B — Future Social Neon** (vibrant, alive, MySpace future)
```
Background:     #08080d (black with purple undertone)
Surface:        #0f0f1a
Primary Accent: #ff2d78 (hot magenta/pink)
Secondary:      #00d4ff (electric cyan)
Tertiary:       #a855f7 (violet)
Live Status:    #39ff14 (neon green)
Text:           #ffffff
Muted:          #9ca3af
Glow:           0 0 20px rgba(255,45,120,0.4)  ← USE SPARINGLY
```

**Concept C — Command Playground** (Commander Code, technical)
```
Background:     #0d0d0d (matte black)
Surface:        #1a1a1a
Primary Accent: #ff9500 (amber terminal orange)
Secondary:      #00c853 (matrix green)
Tertiary:       #00b0ff (steel blue)
Success:        #00e676
Warning:        #ff5252 (alert red)
Text:           #e8e8e8
Muted:          #6b6b6b
Grid lines:     rgba(255,255,255,0.03)
```

### Typography

```css
/* Primary Font Stack */
--font-display: 'Space Grotesk', 'Inter', system-ui, sans-serif;
/* Use for: headings, nav, labels, buttons */

/* Body Font */
--font-body: 'Inter', system-ui, -apple-system, sans-serif;
/* Use for: paragraphs, descriptions, form fields */

/* Mono Font */
--font-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
/* Use for: code, terminal output, system stats, timestamps */

/* Scale (mobile-first) */
--text-xs:   0.75rem  /* 12px — timestamps, badges */
--text-sm:   0.875rem /* 14px — body text, card desc */
--text-base: 1rem     /* 16px — standard body */
--text-lg:   1.125rem /* 18px — card titles */
--text-xl:   1.25rem  /* 20px — section headings */
--text-2xl:  1.5rem   /* 24px — page titles */
--text-3xl:  1.875rem /* 30px — hero subheadings */
--text-4xl:  2.25rem  /* 36px — hero headings */
--text-5xl:  3rem     /* 48px — homepage hero */
--text-6xl:  3.75rem  /* 60px — marketing hero (desktop only) */

/* Font Weights */
--font-normal:   400
--font-medium:   500
--font-semibold: 600
--font-bold:     700
--font-black:    900

/* Line Heights */
--leading-tight:   1.2  /* headings */
--leading-normal:  1.5  /* body */
--leading-relaxed: 1.75 /* long descriptions */
```

### Spacing System (8px base unit)

```
--space-1:  0.25rem  /* 4px  — icon gaps */
--space-2:  0.5rem   /* 8px  — tight gaps */
--space-3:  0.75rem  /* 12px — button padding small */
--space-4:  1rem     /* 16px — card padding */
--space-5:  1.25rem /* 20px — section gaps */
--space-6:  1.5rem  /* 24px — card padding large */
--space-8:  2rem     /* 32px — section spacing */
--space-10: 2.5rem  /* 40px — hero spacing */
--space-12: 3rem     /* 48px — section padding */
--space-16: 4rem     /* 64px — major sections */
--space-20: 5rem     /* 80px — hero sections */
--space-24: 6rem     /* 96px — landing sections */
```

### Border Radius

```
--radius-sm:   0.375rem  /* 6px  — buttons, inputs */
--radius-md:   0.75rem   /* 12px — cards, panels */
--radius-lg:   1rem      /* 16px — modals, overlays */
--radius-xl:   1.5rem   /* 24px — hero cards */
--radius-full: 9999px   /* pills, avatars, badges */
```

### Shadows & Glows

```css
/* Standard Card Shadow */
--shadow-card: 0 4px 24px rgba(0,0,0,0.4);

/* Glow effects (use SPARINGLY on Concept B only) */
--glow-cyan:   0 0 20px rgba(0,240,255,0.3);
--glow-pink:   0 0 20px rgba(255,0,160,0.3);
--glow-green:  0 0 15px rgba(0,255,65,0.25);

/* Glass panels */
--glass: rgba(255,255,255,0.04);
--glass-border: rgba(255,255,255,0.08);
--glass-blur: backdrop-blur-xl;
```

### Motion & Animation

```css
/* Timing */
--duration-fast:   150ms   /* hover, active states */
--duration-normal: 300ms   /* transitions, reveals */
--duration-slow:    500ms   /* page transitions */
--duration-slower:  800ms   /* hero animations */

/* Easing */
--ease-out:    cubic-bezier(0.16, 1, 0.3, 1);  /* natural deceleration */
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1); /* smooth back-and-forth */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* bouncy, for CTAs */

/* Standard animations */
.animate-fadeIn     { animation: fadeIn var(--duration-normal) var(--ease-out); }
.animate-slideUp    { animation: slideUp var(--duration-normal) var(--ease-out); }
.animate-scaleIn    { animation: scaleIn var(--duration-normal) var(--ease-spring); }
.animate-pulse-glow { animation: pulseGlow 2s var(--ease-in-out) infinite; }
.animate-float      { animation: float 6s var(--ease-in-out) infinite; }

/* Hover transforms */
.hover-lift { transition: transform var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out); }
.hover-lift:hover { transform: translateY(-2px); box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
```

---

## ═══════════════════════════════════════
## PART 3: COMPONENT LIBRARY
## ═══════════════════════════════════════

### Buttons

**Primary Button** (CTAs, main actions)
```css
background: var(--lit-header);    /* cyan */
color: #000000;
padding: 0.75rem 1.5rem;        /* 12px 24px */
border-radius: var(--radius-sm);
font-weight: 700;
font-size: 0.875rem;
transition: all var(--duration-fast) var(--ease-out);
border: none;
cursor: pointer;
```
*Hover:* scale(1.02), brightness(1.1), glow if Concept B

**Secondary Button** (secondary CTAs)
```css
background: transparent;
color: var(--lit-header);
border: 1px solid var(--lit-header);
padding: 0.75rem 1.5rem;
border-radius: var(--radius-sm);
font-weight: 600;
font-size: 0.875rem;
```
*Hover:* background rgba(0,240,255,0.1)

**Social Button** (follow, like, share)
```css
background: var(--lit-accent);    /* magenta/pink */
color: #ffffff;
border: none;
padding: 0.5rem 1.25rem;
border-radius: var(--radius-full);
font-weight: 700;
font-size: 0.75rem;
letter-spacing: 0.05em;
text-transform: uppercase;
```
*Hover:* scale(1.05), brightness(1.15)

**Ghost Button** (tertiary actions)
```css
background: transparent;
color: var(--lit-muted);
border: 1px solid var(--lit-border);
padding: 0.5rem 1rem;
border-radius: var(--radius-sm);
font-weight: 500;
font-size: 0.75rem;
```
*Hover:* color var(--lit-text), border-color rgba(255,255,255,0.2)

### Cards

**Standard Glass Card**
```css
background: rgba(255,255,255,0.04);
border: 1px solid rgba(255,255,255,0.08);
border-radius: var(--radius-lg);
padding: 1.5rem;
backdrop-filter: blur(12px);
transition: all var(--duration-normal) var(--ease-out);
```
*Hover:* border-color rgba(0,240,255,0.2), translateY(-2px), shadow-card

**Feature Card** (homepage feature sections)
```css
background: var(--lit-surface);
border: 1px solid var(--lit-border);
border-radius: var(--radius-xl);
padding: 2rem;
position: relative;
overflow: hidden;
```
*Add a subtle gradient overlay on hover (3-5% opacity shift)*

**Feed Card** (social posts)
```css
background: rgba(0,0,0,0.3);
border: 1px solid rgba(255,255,255,0.06);
border-radius: var(--radius-lg);
overflow: hidden;
```
*Header, media area, footer structure*

**Creator Profile Card** (carousel, spotlight)
```css
background: rgba(255,255,255,0.03);
border: 1px solid rgba(255,255,255,0.08);
border-radius: var(--radius-xl);
padding: 1.25rem;
text-align: center;
transition: all var(--duration-normal) var(--ease-out);
```
*Avatar ring in accent color, glow on hover (Concept B only)*

### Navigation

**Navbar**
```
Height: 4rem (64px)
Position: sticky top-0
Background: bg + 80% opacity + backdrop-blur-xl
Border-bottom: 1px solid rgba(255,255,255,0.06)
Z-index: 60
```

**Sidebar (Studio, Builder)**
```
Width: 4rem  (collapsed/icon-only)
Width: 16rem (expanded)
Position: fixed left (or top on mobile)
Background: var(--lit-surface)
Border-right: 1px solid var(--lit-border)
Collapsible: YES — use icon rail when collapsed
```

**Right History Drawer (Studio)**
```
Width: 280px (open)
Width: 0px (closed — hides completely)
Position: fixed right
Background: var(--lit-surface)
Border-left: 1px solid var(--lit-border)
Toggle button: at top of panel, shows/hides
State persistence: localStorage key "history_panel_open"
Mobile: convert to bottom drawer or overlay
```

### Avatar System

```
Sizes:
--avatar-xs:  24px   (inline, small icons)
--avatar-sm:  32px   (comments, small lists)
--avatar-md:  40px   (feed cards, standard)
--avatar-lg:  64px   (profiles, featured)
--avatar-xl:  96px   (profile headers)
--avatar-2xl: 128px  (profile hero)

Style:
border-radius: var(--radius-full);
border: 2px solid var(--lit-border);
/* Online indicator: 10px green dot, bottom-right, 2px offset */
```

### Badges & Tags

**Role Badge** (Builder, Artist, Strategist)
```css
padding: 0.25rem 0.75rem;
border-radius: var(--radius-full);
font-size: 0.625rem;
font-weight: 700;
letter-spacing: 0.08em;
text-transform: uppercase;
background: rgba(0,240,255,0.1);
color: var(--lit-header);
border: 1px solid rgba(0,240,255,0.2);
```

**Status Badge** (Online, Live, Idle)
```css
padding: 0.2rem 0.6rem;
border-radius: var(--radius-full);
font-size: 0.625rem;
font-weight: 600;
background: rgba(0,255,65,0.1);
color: var(--lit-success);
border: 1px solid rgba(0,255,65,0.2);
/* Online dot: 6px circle, pulsing animation */
```

**Category Tag** (gallery, marketplace)
```css
padding: 0.25rem 0.75rem;
border-radius: var(--radius-full);
font-size: 0.6875rem;
font-weight: 600;
background: rgba(255,255,255,0.05);
color: var(--lit-muted);
border: 1px solid rgba(255,255,255,0.08);
cursor: pointer;
transition: all var(--duration-fast);
```
*Active:* background var(--lit-header), color #000, border-color transparent

### Input Fields

```css
background: rgba(0,0,0,0.3);
border: 1px solid var(--lit-border);
border-radius: var(--radius-sm);
padding: 0.625rem 0.875rem;
font-size: 0.875rem;
color: var(--lit-text);
outline: none;
transition: border-color var(--duration-fast);
```
*Focus:* border-color var(--lit-header), box-shadow: 0 0 0 3px rgba(0,240,255,0.1)

### Modals & Overlays

```css
background: rgba(0,0,0,0.85);
backdrop-filter: blur(8px);
z-index: 100;
```
*Modal:* background var(--lit-surface), border 1px solid var(--lit-border), radius var(--radius-xl), max-width 32rem

---

## ═══════════════════════════════════════
## PART 4: COMPLETE HOMEPAGE WIREFRAME
## ═══════════════════════════════════════

### Section 1: Hero (Viewport Height)
```
┌──────────────────────────────────────────────────────┐
│  NAVBAR (sticky)                                     │
├──────────────────────────────────────────────────────┤
│                                                      │
│     [BADGE: NOW IN PUBLIC BETA]                      │
│                                                      │
│     Build your future                                │
│     social space.                                    │
│                                                      │
│     Create agents. Share your work.                  │
│     Follow builders. Launch experiments              │
│     people actually want to explore.                  │
│                                                      │
│     [START FREE →]     [TRY STUDIO →]               │
│                                                      │
│     ✓ Free forever   ✓ No credit card   ✓ 5min setup│
│                                                      │
│  ─────────────────────────────────────────────────  │
│  LIVE: 127 builders online now  🔴                  │
└──────────────────────────────────────────────────────┘
```

**Copy:**
- Headline: "Build your future social space."
- Subhead: "Create agents. Share your work. Follow builders. Launch experiments people actually want to explore."
- CTA 1: "Start Free" (primary, cyan)
- CTA 2: "Try Studio" (secondary, ghost)
- Trust line: "✓ Free forever  ✓ No credit card  ✓ Up in 5 minutes"
- Live indicator: "127 builders online now" (real count from Supabase)

---

### Section 2: What You Can Do (4 cards)
```
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│     🤖       │ │     🎨       │ │     📡       │ │     👥       │
│              │ │              │ │              │ │              │
│   BUILD      │ │   CREATE     │ │   SHARE      │ │   CONNECT    │
│              │ │              │ │              │ │              │
│  Deploy AI   │ │  Images,     │ │  Post to     │ │  Follow      │
│  agents to   │ │  music, and  │ │  channels.   │ │  builders.   │
│  do your     │ │  video with  │ │  Go viral   │ │  Get         │
│  work.       │ │  AI tools.   │ │  organically.│ │  discovered. │
│              │ │              │ │              │ │              │
│  [LEARN →]   │ │  [CREATE →]  │ │  [SHARE →]  │ │  [CONNECT →] │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

---

### Section 3: Live Activity Strip
```
┌──────────────────────────────────────────────────────┐
│  🔴 LIVE — What's happening right now                │
├──────────────────────────────────────────────────────┤
│                                                      │
│  🎨 Sarah just generated album art → Pixel Forge      │
│  💻 Alex deployed a new agent workflow → 2h ago       │
│  🚀 Jordan hit 1,000 followers → 4h ago              │
│  ⚡ Mike shipped a new feature → 6h ago               │
│                                                      │
└──────────────────────────────────────────────────────┘
```
*Real data from Supabase — posts ordered by created_at DESC, last 24h*

---

### Section 4: Featured Creators Carousel
```
┌──────────────────────────────────────────────────────┐
│  🔥 CREATOR SPOTLIGHT            [See all →]         │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐    │
│  │  👤    │  │  👤    │  │  👤    │  │  👤    │    │
│  │ cyan   │  │ magenta│  │ green  │  │ violet │    │
│  │ ring   │  │ ring   │  │ ring   │  │ ring   │    │
│  │ Alex   │  │ Sarah  │  │ Mike   │  │ Jordan │    │
│  │Builder │  │Artist  │  │Dev     │  │Strateg │    │
│  │2.4k 🌟 │  │1.8k 🌟 │  │1.2k 🌟 │  │  890 🌟│    │
│  │[FOLLOW]│  │[FOLLOW]│  │[FOLLOW]│  │[FOLLOW]│    │
│  └────────┘  └────────┘  └────────┘  └────────┘    │
│                                    ◄  ►              │
└──────────────────────────────────────────────────────┘
```

---

### Section 5: Live Social Feed Preview
```
┌──────────────────────┬──────────────────────────────┐
│  📡 LIVE FEED        │  ⚡ TRENDING THIS WEEK        │
├──────────────────────┼──────────────────────────────┤
│                      │                              │
│  ┌────────────────┐  │  🏆 Most Remixed Project     │
│  │ AC  Alex Chen  │  │     "Dual-Agent Setup"       │
│  │ 2h ago         │  │     by @alexchen · 847 remixes│
│  │                │  │                              │
│  │ Just deployed  │  │  🎨 Most Liked Creation      │
│  │ my first dual  │  │     "Neon Cityscapes"        │
│  │ agent setup... │  │     by @sarahk · 2.4k ❤     │
│  │                │  │                              │
│  │ 💬 12  🔁 8   │  │  👤 Rising Creator           │
│  └────────────────┘  │     @mikedev — +340% this wk │
│                      │                              │
│  ┌────────────────┐  │                              │
│  │ SK  Sarah Kim  │  │                              │
│  │ 4h ago         │  │                              │
│  │ Pixel Forge    │  │                              │
│  │ generated my   │  │                              │
│  │ EP album art   │  │                              │
│  │                │  │                              │
│  │ 💬 45  🔁 23  │  │                              │
│  └────────────────┘  │                              │
└──────────────────────┴──────────────────────────────┘
```

---

### Section 6: What The Studio Looks Like
```
┌──────────────────────────────────────────────────────┐
│  YOUR CREATOR STUDIO                                  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────────────┐ ┌──────────────────────┐   │
│  │  NEURAL STUDIO       │ │  WHAT YOU CAN MAKE   │   │
│  │                      │ │                      │   │
│  │  [Director]──→[Exec] │ │  ✦ AI Images         │   │
│  │      ↓               │ │  ✦ AI Video          │   │
│  │  [Pixel Forge]       │ │  ✦ AI Music          │   │
│  │                      │ │  ✦ Agent Workflows   │   │
│  │  ┌──────────────┐   │ │  ✦ Social Posts      │   │
│  │  │ Prompt here │   │ │                      │   │
│  │  └──────────────┘   │ │  All in one workspace│   │
│  │  [Generate →]       │ │                      │   │
│  └──────────────────────┘ └──────────────────────┘   │
│                                                      │
│           [OPEN STUDIO FREE →]                       │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

### Section 7: Social Proof / Testimonials
```
┌──────────────────────────────────────────────────────┐
│  WHAT BUILDERS ARE SAYING                             │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────┐ │
│  │ "LiTTree feels   │ │ "I finally own   │ │ ... │ │
│  │ like the creative│ │ my distribution. │ │      │ │
│  │ network I always │ │ My agents handle │ │      │ │
│  │ wanted."         │ │ cross-posting..." │ │      │ │
│  │ — Alex Chen      │ │ — Sarah Kim      │ │      │ │
│  │ Builder 🌟       │ │ Artist 🌟        │ │      │ │
│  └──────────────────┘ └──────────────────┘ └──────┘ │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

### Section 8: Final CTA
```
┌──────────────────────────────────────────────────────┐
│                                                      │
│     Ready to build your space?                       │
│                                                      │
│     Join 52,891 creators building the future.        │
│     Start free. No credit card.                       │
│                                                      │
│     [START FREE →]                                   │
│                                                      │
│     Already have an account? Sign in                  │
│                                                      │
└──────────────────────────────────────────────────────┘
```
*Note: Replace 52,891 with real count from Supabase once you have real users*

---

## ═══════════════════════════════════════
## PART 5: THREE VISUAL STYLE CONCEPTS
## ═══════════════════════════════════════

### CONCEPT A — Creator OS Noir
**Feel:** Perplexity meets Claude. Premium, calm, trustworthy, expensive.
**Best for:** Homepage, onboarding, profiles, serious builder audience.

```css
/* Tailwind classes for this concept */
background-slate-950:     bg-[#0a0a0f]
surface:                  bg-[#13131a]
card:                     bg-[#13131a] border border-white/10 rounded-2xl
primary-button:           bg-[#00f0ff] text-black font-bold px-6 py-3 rounded-lg
secondary-button:         bg-transparent border border-[#00f0ff] text-[#00f0ff] font-semibold
social-button:            bg-[#a78bfa] text-white font-bold px-5 py-2 rounded-full
text:                     text-[#f4f4f5]
text-muted:               text-[#71717a]
accent:                   text-[#00f0ff]
success:                  text-[#00ff41]
card-hover:               hover:border-[#00f0ff]/30 hover:-translate-y-0.5
glass:                    bg-white/[0.04] backdrop-blur-xl border border-white/[0.08]
```

**Font:** Space Grotesk (display) + Inter (body)
**Spacing:** Generous — use `--space-8` to `--space-16` between sections
**Glows:** Minimal. Only on primary buttons and active states.
**Avatar rings:** 2px solid `#00f0ff` with subtle outer glow

---

### CONCEPT B — Future Social Neon
**Feel:** Vibrant alive community, MySpace from the future, personality-first.
**Best for:** Social feed, creator profiles, gallery, community pages.

```css
/* Tailwind classes for this concept */
background:                bg-[#08080d]
surface:                   bg-[#0f0f1a]
card:                      bg-white/[0.03] border border-white/8 rounded-2xl
primary-button:            bg-[#ff2d78] text-white font-bold px-6 py-3 rounded-full
secondary-button:         bg-transparent border border-[#00d4ff] text-[#00d4ff] font-semibold
social-button:            bg-[#ff2d78] text-white font-bold px-5 py-2 rounded-full
text:                     text-white
text-muted:               text-[#9ca3af]
accent-pink:              text-[#ff2d78]
accent-cyan:              text-[#00d4ff]
accent-violet:            text-[#a855f7]
live-indicator:            text-[#39ff14]
card-hover:               hover:border-[#ff2d78]/40 hover:-translate-y-1 hover:shadow-[0_0_30px_rgba(255,45,120,0.15)]
glass:                    bg-white/[0.03] backdrop-blur-xl border border-white/[0.06]
avatar-ring-pink:          ring-2 ring-[#ff2d78] ring-offset-2 ring-offset-[#08080d]
avatar-ring-cyan:          ring-2 ring-[#00d4ff] ring-offset-2 ring-offset-[#08080d]
glow-pink:                shadow-[0_0_20px_rgba(255,45,120,0.4)]
glow-cyan:                shadow-[0_0_20px_rgba(0,212,255,0.3)]
```

**Font:** Space Grotesk Bold (display) + Inter (body)
**Spacing:** Medium — energetic, not cramped
**Glows:** YES — use on avatar rings, active buttons, live indicators
**Avatar rings:** 3px glowing ring in accent color, animated pulse
**Feed cards:** floating engagement badges (large heart/like count as overlay)
**Special:** Creator spotlight with expanding glow on hover, neon status chips

---

### CONCEPT C — Command Playground
**Feel:** Commander Code, terminal precision, modular OS, power-user focused.
**Best for:** Studio, agent logs, terminal, pipeline views, technical pages.

```css
/* Tailwind classes for this concept */
background:                bg-[#0d0d0d]
surface:                   bg-[#1a1a1a]
card:                      bg-[#1a1a1a] border border-white/10 rounded-lg
primary-button:            bg-[#ff9500] text-black font-bold px-5 py-2.5 rounded
secondary-button:         bg-transparent border border-[#ff9500] text-[#ff9500]
social-button:            bg-[#00c853] text-black font-bold px-5 py-2 rounded
text:                     text-[#e8e8e8]
text-muted:               text-[#6b6b6b]
accent-amber:             text-[#ff9500]
accent-green:             text-[#00c853]
accent-blue:              text-[#00b0ff]
success:                  text-[#00e676]
warning:                  text-[#ff5252]
card-hover:               hover:border-[#ff9500]/30 hover:bg-white/[0.03]
glass:                    bg-white/[0.025] backdrop-blur-sm border border-white/[0.06]
terminal:                  font-mono text-[#00c853] bg-[#0a0a0a]
status-bar:               bg-[#1a1a1a] border-b border-white/[0.06]
grid-lines:               bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:24px_24px]
```

**Font:** JetBrains Mono (mono) + Inter (body)
**Spacing:** Tight — efficient use of space for dense dashboards
**Glows:** No decorative glows. Functional only (status indicators, active nodes)
**Avatar rings:** None or thin 1px amber border
**Special:** Dot grid background on map views, terminal-style headers, status bars

---

### Style Assignment by Page

| Page | Style | Rationale |
|------|-------|-----------|
| Homepage | Concept A + B hybrid | Trust + social energy |
| Studio | Concept C | Power, precision, workspace |
| Gallery | Concept B | Visual, expressive, alive |
| Social Feed | Concept B | Social, community, personality |
| Profile | Concept A + B | Identity, credibility, personality |
| Marketplace | Concept A | Clean, trustworthy commerce |
| Showcase | Concept A | Professional, credible |
| Agent Chat | Concept C | Technical, focused |
| Onboarding | Concept A | Calm, clear, guided |
| Settings | Concept C | Dense, organized, efficient |

---

## ═══════════════════════════════════════
## PART 6: PAGE-BY-PAGE BUILD ROADMAP
## ═══════════════════════════════════════

### Priority 1 — Maximum Impact (Do These First)

---

#### P1-1: Homepage Hero Rewrite
**File:** `src/app/page.tsx`
**Time:** 2-3 hours
**Changes:**
- Replace "Deploy Specialized AI Agents" headline with "Build your future social space."
- Replace technical subhead with human-language promise
- Keep the terminal demo visual — it's strong
- Add real-time "builders online" counter from Supabase
- Add live activity strip below hero
- Replace fake stats (52,891 users) with real Supabase count or remove
- Add social feed preview section
- Add "featured creator" mini-carousel

**Copy to use:**
```
Hero Badge:     NOW IN PUBLIC BETA
Headline:      Build your future social space.
Subhead:       Create agents. Share your work. Follow builders.
                Launch experiments people actually want to explore.
CTA 1:         Start Free →
CTA 2:         Try Studio →
Trust:          ✓ Free forever  ✓ No credit card  ✓ 5-minute setup
```

---

#### P1-2: Collapsible Right History Panel (Studio)
**File:** `src/app/studio/page.tsx`
**Time:** 1-2 hours
**Changes:**
- Add toggle state: `const [historyOpen, setHistoryOpen] = useState(true)`
- Store state in localStorage: `localStorage.getItem/setItem('studio_history_open')`
- History panel width: `w-[280px]` → `w-0 overflow-hidden` when collapsed
- Add toggle button at top of right panel
- Smooth CSS transition: `transition-all duration-300`
- On mobile (<768px): convert to bottom drawer or overlay
- Make center canvas `flex-1 min-w-0` to fill freed space

**Wireframe:**
```
┌─────────┬──────────────────────────────┬────────────┐
│ TOOLS   │     MAIN CANVAS               │ HISTORY    │
│         │                              │ [≡] [×]   │
│ Image   │  [Prompt input]              │ job 1 ✓   │
│ Video   │  [Settings]                 │ job 2 ✓   │
│ Audio   │  [Canvas / Output]          │ job 3 ⟳   │
│ Agent   │                              │ job 4 ⏳   │
│ Terminal│                              │ job 5 ✓   │
│         │                              │ job 6 ✓   │
│         │                              │ job 7 ✓   │
└─────────┴──────────────────────────────┴────────────┘
         ↑ collapsed
┌─────────┬──────────────────────────────┐
│ TOOLS   │     MAIN CANVAS (full)       │
│         │                              │
│ Image   │  [Prompt input]              │
│ Video   │  [Settings]                 │
│ Audio   │  [Canvas / Output]          │
│ Agent   │                              │
│ Terminal│                              │
│         │                         [≡] │ ← toggle btn
└─────────┴──────────────────────────────┘
```

---

#### P1-3: Real Social Feed (`/social`)
**File:** `src/app/social/page.tsx` (currently redirects to `/`)
**Time:** 4-6 hours
**Changes:**
- Remove the redirect — build real page
- Create `GET /api/feed` endpoint (fetch posts from Supabase `social_posts`)
- Post composer: textarea + image URL input + post button
- Post cards: avatar, name, timestamp, content, media, likes, comments
- Like button: POST to `/api/posts/[id]/like`
- Comment expansion: show comments on click
- Follow button: POST to `/api/follow`
- Share button: Web Share API → clipboard fallback
- Real timestamps using `formatTime()` (already exists in codebase)
- Skeleton loading states while fetching
- Empty state: "No posts yet. Be the first to share something!"
- Mobile: single-column feed, sticky composer at top

**Supabase table needed:**
```sql
CREATE TABLE social_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  content TEXT NOT NULL,
  media_urls TEXT[], -- array of image URLs
  likes_count INT DEFAULT 0,
  comments_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE post_likes (
  post_id UUID REFERENCES social_posts(id),
  user_id UUID REFERENCES auth.users(id),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE follows (
  follower_id UUID REFERENCES auth.users(id),
  following_id UUID REFERENCES auth.users(id),
  PRIMARY KEY (follower_id, following_id)
);
```

---

#### P1-4: Public Creator Profiles (`/u/[username]`)
**Files:** `src/app/u/[username]/page.tsx` + `src/app/profile/page.tsx` update
**Time:** 3-4 hours
**Changes:**
- New dynamic route `/u/[username]`
- Fetch profile from Supabase by username
- Public profile shows: avatar, cover, bio, mood, location, website, interests, badges
- Show their posts (from `social_posts`)
- Show their gallery items (from `gallery_items`)
- Follow/Unfollow button
- "Mutual follows" section
- Role badge (Builder, Artist, Strategist, Operator, Founder)
- Your own profile at `/profile` stays as edit mode
- Link every feed post card avatar → `/u/[username]`

---

### Priority 2 — Strong Impact (Do After P1)

---

#### P2-1: Navbar Simplification
**File:** `src/components/Navbar.tsx`
**Time:** 1 hour
**Changes:**
- Primary links (always visible): Home, Studio, Gallery
- Secondary links (in dropdown "More"): Agents, Marketplace, Play, Profile, Settings
- Reduce visual weight of secondary links
- Add "More" dropdown with clean list
- Mobile: keep current overlay behavior, just fewer items

**New nav structure:**
```
Primary:  Home | Studio | Gallery
More:     Agents ▾ | Marketplace | Play | [Divider] | Profile | Settings
```

---

#### P2-2: Profile → Supabase Wiring
**File:** `src/context/ProfileContext.tsx`, `src/app/profile/page.tsx`
**Time:** 3 hours
**Changes:**
- On Clerk signup: create Supabase `profiles` row
- Replace ProfileContext localStorage with Supabase read/write
- Keep localStorage as fallback/cache for offline
- Add "Save to cloud" indicator
- Sync avatar uploads to Supabase Storage
- Add `is_featured`, `role`, `follower_count` fields

---

#### P2-3: Gallery → Supabase Wiring
**File:** `src/app/gallery/page.tsx`
**Time:** 2 hours
**Changes:**
- Fetch gallery items from Supabase `gallery_items` table
- Add creator attribution (link to `/u/[username]`)
- Add "Remix" button: "Make something inspired by this →"
- Add "Collect" button: save to user's collection
- Keep demo data as fallback for now
- Add real like count from Supabase

---

#### P2-4: Onboarding Flow
**File:** `src/app/onboarding/page.tsx` (new)
**Time:** 3 hours
**Changes:**
- New route `/onboarding` — shown once after first sign-up
- Step 1: "Create your profile" — name, avatar, role badge selection
- Step 2: "Post your first thing" — quick post composer
- Step 3: "Follow some builders" — suggested creators grid
- Progress indicator (step 1 of 3)
- Skip option (always visible)
- After completion: redirect to homepage
- Store completion in localStorage

---

### Priority 3 — Growth Features (Do After P2)

---

#### P3-1: Share & Remix Loop
**Time:** 2-3 hours
**Changes:**
- Every gallery item: "Share" button (copies URL)
- Every social post: "Share" button
- Every creation: "Remix this" → opens Studio with prompt pre-filled
- Add `og:image` meta tags for rich link previews
- Add "Share to Twitter" / "Share to LinkedIn" quick buttons

---

#### P3-2: Referral System
**Time:** 2 hours
**Changes:**
- User profile page: "Invite Friends" button
- Generate unique referral link: `litlabs.net?ref=[username]`
- On referral sign-up: both users get +100 LiTBit Coins bonus
- Track referrals in Supabase `referrals` table
- Show referral count on profile

---

#### P3-3: Creator Identity System
**Files:** Profile page, Supabase schema
**Time:** 2 hours
**Changes:**
- Add role selection during onboarding: Builder | Artist | Strategist | Operator | Founder
- Store in `profiles.role`
- Display as badge on profile, feed posts, creator cards
- Add level system: New → Active → Featured → Leader → Power
- Show level badge on profiles

---

#### P3-4: Weekly Featured Page
**File:** `src/app/featured/page.tsx` (new)
**Time:** 2 hours
**Changes:**
- "Featured This Week" curated showcase
- Top 5 creators
- Top 5 creations
- Most remixed project
- Most active community member
- Manual curation for now (you pick), auto later

---

### Priority 4 — Polish (Do After P3)

---

#### P4-1: Replace All Technical Language
**Files:** All pages
**Time:** 1-2 hours

Replace these terms globally:

| FROM | TO |
|------|-----|
| "Deploy Specialized AI Agents" | "Build your future social space" |
| "Neural Marketplace" | "Agent Marketplace" |
| "Agent Directory" | "AI Agents" |
| "Studio Encrypted" | "Sign in to access Studio" |
| "Linked Co-Builder Array" | "Following" |
| "Captured Visual Buffers" | "My Gallery" |
| "Public Node Comment Registry" | "Comments" |
| "Node Active" | "Online" |
| "Specialty Tags" | "Interests" |
| "Audio Deck" | "Music Links" |
| "Studio Badges" | "Badges" |
| "Creator OS Encrypted Sector" | (remove — too jargon) |
| "System Core" footer | "LiTree Lab Studios" |
| "NETWORK HUB" | (simplify) |
| "CAPTURED TELEMETRY NODES" | "Profile visits" |
| "POSTED TO 4 CHANNELS" | "Posted to social" |
| "ORCHESTRATION THREAD COMPILED" | (simplify to plain English) |

---

#### P4-2: Responsive Mobile Polish
**Files:** Navbar, Studio, Gallery, Feed
**Time:** 2 hours
**Changes:**
- Studio right drawer → bottom sheet on mobile
- Gallery masonry → 2-column grid on mobile
- Feed → single column on mobile
- Navbar secondary links → hamburger dropdown
- Profile → stacked layout on mobile

---

#### P4-3: Real Stats (Remove Fake Data)
**Files:** Homepage, Dashboard
**Changes:**
- Replace `52,891 Users` with real count: `SELECT COUNT(*) FROM users`
- Replace `10,420 Active Agents` with: `SELECT COUNT(*) FROM agents WHERE status='online'`
- Replace `2.4M Tasks Done` with: `SELECT COUNT(*) FROM tasks`
- If counts are low right now: hide this section entirely rather than show fake numbers
- Add "LIVE" indicator with real online count

---

## ═══════════════════════════════════════
## PART 7: COPY & BRAND VOICE LIBRARY
## ═══════════════════════════════════════

### Brand Voice

**Tone:** Confident, forward-looking, human, slightly playful
**NOT:** Robotic, corporate, jargon-heavy, generic

**Do say:**
- "Build your future social space"
- "Ship something today"
- "Where creators make the next wave"
- "Your creator OS is live"
- "Join the grid"
- "Remix this"
- "Follow builders"
- "Share your work"

**Don't say:**
- "Deploy specialized AI agents"
- "Neural marketplace"
- "Orchestration thread compiled"
- "Captured telemetry nodes"
- "System core v5.24"
- "Autonomous agent orchestration platform"

### Page Copy Templates

**Homepage Hero:**
```
[BADGE: NOW IN PUBLIC BETA]

Build your future social space.

Create agents. Share your work. Follow builders.
Launch experiments people actually want to explore.

[START FREE →]  [TRY STUDIO →]

✓ Free forever  ✓ No credit card  ✓ 5-minute setup
```

**Homepage Features:**
```
Create, Automate, Connect.

A creator network where your agents handle the busywork,
so you can focus on making, sharing, and growing together.

[4 feature cards: Build, Create, Share, Connect]
```

**Social Feed Empty State:**
```
The feed is quiet... for now.

Be the first to share something. Post what you're building,
share a creation, or just say hi to the community.
```

**Profile Tagline:**
```
[Username] is a [Role] building at LiTree Lab Studios.
```

**Gallery Item:**
```
[Made by @username] · [likes] ❤ · [Remix this →]
```

**Studio Sidebar Tooltips:**
```
Image — Generate AI images
Video — Create AI videos
Audio — Make AI music & TTS
Agents — Chat with AI agents
Terminal — Run agent commands
Pipeline — Chain workflows
Gallery — Your creations
Space — MiniMax Space tools
```

---

## ═══════════════════════════════════════
## PART 8: IMPLEMENTATION CHECKLIST
## ═══════════════════════════════════════

### Week 1: First Impression (Highest ROI)
- [ ] Rewrite homepage hero (P1-1)
- [ ] Build real `/social` page (P1-3)
- [ ] Simplify navbar (P2-1)
- [ ] Remove fake stats or replace with real (P4-3)
- [ ] Fix all technical language (P4-1)

### Week 2: Social Foundation
- [ ] Build `/u/[username]` public profiles (P1-4)
- [ ] Wire profile → Supabase (P2-2)
- [ ] Wire gallery → Supabase (P2-3)
- [ ] Build onboarding flow (P2-4)

### Week 3: Studio Polish
- [ ] Collapsible history drawer (P1-2)
- [ ] Add share buttons everywhere (P3-1)
- [ ] Mobile responsive polish (P4-2)

### Week 4: Growth Loop
- [ ] Referral system (P3-2)
- [ ] Creator identity & roles (P3-3)
- [ ] Featured this week page (P3-4)
- [ ] OG image meta tags for all pages

---

## ═══════════════════════════════════════
## PART 9: WHAT THE MOCKUP IMAGES TOLD ME
## ═══════════════════════════════════════

Your three mockups show strong creative vision. Here's what each one does well and what to keep:

**Mockup 1 (LiTree Social — Creator Spotlight + Trending Posts):**
✅ Creator carousel with colored avatar rings — KEEP, this is excellent
✅ Floating engagement badges (2.4k ❤) over images — KEEP, very engaging
✅ Role tags (Builder, Artist) on creator cards — KEEP
✅ Follow buttons on creator cards — KEEP
✅ Masonry grid for trending posts — KEEP
✅ Horizontal scroll carousel — KEEP
✅ Three-dot menu on posts — KEEP
❌ Navbar text "LiTree Social" — rename to "LiTree Lab Studios"
❌ Category "MORE" — simplify to icon or keep text but make it dropdown

**Mockup 2 (LiTree Grid — Network Map):**
✅ The network visualization map concept — USE for `/` or `/showcase`
✅ Featured agents panel (left) with LIVE status — KEEP for dashboard view
✅ Creator spotlight panel (right) — KEEP, excellent for discovery
✅ "REMIX THE GRID" button in popup — KEEP, great action label
✅ Active node count and Grid sync telemetry — KEEP but simplify labels
✅ Collapsible side panels (arrows on edges) — KEEP AND IMPLEMENT
❌ Too dense for a general homepage — save this for `/dashboard` or `/showcase`
❌ "GRID TELEMETRY" label — change to "Network Status"

**Mockup 3 (LiTree LabStudios — Split Build/Share):**
✅ The 50/50 split concept — USE for homepage or studio layout
✅ "BUILD with AI Agents" + "SHARE with Creators" headers — KEEP, perfect copy
✅ Neural Studio node graph visual — KEEP for studio page
✅ Neural Social Post Composer — KEEP, great name
✅ Social feed in split view — KEEP as option
✅ 3D isometric cubes as agent icons — KEEP
✅ "Mini Mode" button on node editor — KEEP, users want this
✅ Magenta border on SHARE section — KEEP as visual divider

---

## ═══════════════════════════════════════
## PART 10: QUICK WINS (Do Today)
## ═══════════════════════════════════════

These take under 30 minutes each and make immediate impact:

1. **Change homepage headline** — just edit the H1 in `page.tsx` from "Deploy Specialized AI Agents" to "Build your future social space."

2. **Add "Builders online" counter** — add a simple Supabase RPC that counts active sessions, display in navbar or homepage hero.

3. **Add follow buttons to homepage creator cards** — just wire the existing buttons to `/api/follow`.

4. **Replace all "NOW IN PUBLIC BETA" with something warmer** — try "Join the creator network" or remove it entirely.

5. **Add social share buttons to gallery** — add a `navigator.share` call and clipboard fallback on each gallery item.

6. **Make `/social` a real page instead of a redirect** — copy the feed section from homepage into its own page.

7. **Replace fake stats with real ones** — even if the numbers are small, real data > fake big numbers.

8. **Add "Remix" to gallery items** — one button, copies a prompt to clipboard.

---

*This document is your complete blueprint. Start with Week 1 items — the homepage hero rewrite and real social feed will transform how the site feels in a single afternoon.*
