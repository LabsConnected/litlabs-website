# Design System — Glass OS

## Overview

Glass OS is LiTTree's design system. Dark solid base with selective glass panels, purple AI accents, and green active states.

## Design tokens

See `src/app/globals.css` for the canonical token definitions.

### Solid base backgrounds

```css
--bg-main:      #07050d;                    /* app background */
--bg-elevated:  #0d0917;                    /* elevated sections */
--bg-solid:     rgba(14, 10, 22, 0.96);     /* readability-critical surfaces */
```

### Glass surfaces (3 levels)

```css
--glass-1: rgba(20, 14, 34, 0.68);   /* shell: header, sidebar, bottom bar */
--glass-2: rgba(26, 18, 42, 0.72);   /* panel: chat, files, properties */
--glass-3: rgba(34, 24, 54, 0.78);   /* chip: quick actions, status, toggles */
```

### Borders

```css
--border-soft:    rgba(255, 255, 255, 0.08);
--border-strong:  rgba(255, 255, 255, 0.14);
```

### Shadows

```css
--shadow-soft: 0 12px 30px rgba(0, 0, 0, 0.25);
--shadow-deep: 0 20px 60px rgba(0, 0, 0, 0.35);
```

### Radii

```css
--radius-sm: 12px;
--radius-md: 16px;
--radius-lg: 22px;
--radius-xl: 28px;
```

### Accents

```css
--purple:      #8b5cf6;                      /* AI / navigation */
--purple-soft: rgba(139, 92, 246, 0.18);
--green:       #9eff47;                      /* active / success */
--green-soft:  rgba(158, 255, 71, 0.18);
```

### Text (3 levels)

```css
--text-main: #f5f3fb;
--text-soft: #a8a2b8;
--text-dim:  #7d7690;
```

## Utility classes

### `.glass-shell` — Surface 1

App shell elements: header, sidebar, bottom bar, tab rows.

```css
background: rgba(15, 10, 24, 0.72);
border: 1px solid var(--border-soft);
backdrop-filter: blur(16px) saturate(135%);
box-shadow: 0 14px 40px rgba(0, 0, 0, 0.28);
```

### `.glass-panel` — Surface 2

Main panels: chat, files, properties, canvas sidebars.

```css
background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.015)), var(--glass-2);
border: 1px solid var(--border-soft);
backdrop-filter: blur(18px) saturate(140%);
box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 14px 36px rgba(0,0,0,0.28);
border-radius: var(--radius-lg);
```

### `.glass-chip` — Surface 3

Utility cards: quick actions, status, chips, toggles.

```css
background: rgba(28, 20, 44, 0.7);
border: 1px solid var(--border-soft);
backdrop-filter: blur(12px) saturate(130%);
border-radius: var(--radius-sm);
```

### `.glass-active` — Active state

Purple glow border for selected/active items.

```css
border-color: rgba(139, 92, 246, 0.35);
box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 0 0 1px rgba(139,92,246,0.18), 0 10px 30px rgba(139,92,246,0.12);
```

### `.glass-solid` — Readability surface

For code editor, preview iframe, terminal, logs, dense forms.

```css
background: var(--bg-solid);
border: 1px solid var(--border-soft);
border-radius: var(--radius-md);
```

## What should NOT be glass

- Code editor
- File text areas
- Preview iframe
- Long chat transcript background
- Dense forms
- Logs / terminal

These use `.glass-solid` or plain `--bg-solid` for readability.

## Motion principles

- **Restrained** — not everything animates
- **Purposeful** — motion communicates state change
- **Fast** — 120-180ms transitions, not slow
- **No bounce** — except LiTT character celebrations

```css
--glass-transition: 180ms ease;
--glass-transition-fast: 120ms ease;
```

## Themes (future)

### Built-in themes

```
🌌 Nebula
💜 Glass OS (default)
🟢 Matrix Garden
🌆 Cyber City
🌊 Midnight Wave
🖥 Command
🧊 Frost Glass
⚫ Pure Black
```

### What themes control

```
wallpaper
glass tint
accent color
glow color
LiTT halo
motion intensity
sound pack
```

### Generated themes (future)

> "Give me 90s arcade mixed with cyberpunk."

LiTT creates a custom workspace theme.

## Progressive disclosure UI

The same project looks different based on user persona:

### Builder (beginner)

```
Page | Text | Image | Button | Style | Publish
```

### Developer (advanced)

```
Chat | Canvas | Code | Preview | Files | Terminal | Git | Deploy
PLAN | ACT | AUTO
```

Same project underneath. Different amount exposed.

## What needs to be done

The Glass OS tokens and classes are already implemented in `globals.css`. The remaining work:

1. ✅ Tokens defined
2. ✅ Utility classes defined
3. ✅ Header, sidebar, tab rows converted
4. ✅ Composer converted
5. ✅ Inspector converted
6. ✅ Transcript message bubbles converted
7. ⬜ Bottom drawer / terminal rail
8. ⬜ Preview toolbar
9. ⬜ Canvas side panels
10. ⬜ Dashboard polish
11. ⬜ Theme system (post-P0)
