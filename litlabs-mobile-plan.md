# LiTTree Lab Studios — Mobile-First Responsive Plan

## Critical Fix #1: Viewport Meta (layout.tsx)

Add this export to `src/app/layout.tsx` (Next.js 14+ pattern):

```typescript
import type { Metadata, Viewport } from "next";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0d0d0d",
};
```

Or use the `<meta>` tag approach in the head if you prefer.

---

## Mobile-First CSS (Add to globals.css)

Your existing Tailwind classes work. These additions polish the mobile experience:

```css
/* ============================================================
   MOBILE-FIRST RESPONSIVE ENHANCEMENTS
   ============================================================ */

/* Mobile typography scaling */
@media (max-width: 640px) {
  body {
    font-size: 13px;
  }
  
  h1 {
    font-size: 1.5rem !important;
    line-height: 1.2;
  }
  
  h2 {
    font-size: 1.25rem !important;
  }
  
  h3 {
    font-size: 1.1rem !important;
  }
}

/* Safe area insets for notched phones */
@supports (padding-top: env(safe-area-inset-top)) {
  body {
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
  }
}

/* Touch-friendly tap targets (min 44px) */
@media (pointer: coarse) {
  .btn,
  a,
  button,
  [role="button"] {
    min-height: 44px;
    min-width: 44px;
  }
  
  /* Larger touch targets on mobile */
  .agent-card,
  .feed-post,
  .chat-message {
    padding: 16px;
  }
}

/* Mobile layout adjustments for your existing grid classes */
@media (max-width: 768px) {
  /* Stack columns that are side-by-side on desktop */
  .grid.md\\:grid-cols-2 {
    grid-template-columns: 1fr;
  }
  
  .grid.md\\:grid-cols-3 {
    grid-template-columns: 1fr;
  }
  
  /* Reduce horizontal padding on mobile */
  .px-4.sm\\:px-6 {
    padding-left: 12px;
    padding-right: 12px;
  }
  
  /* Full-width cards on mobile */
  .glass-card {
    margin-left: -12px;
    margin-right: -12px;
    border-radius: 0;
    border-left: none;
    border-right: none;
  }
  
  /* Agent list horizontal scroll on mobile */
  .agent-showcase {
    display: flex;
    flex-direction: row;
    overflow-x: auto;
    gap: 12px;
    padding-bottom: 8px;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  
  .agent-showcase::-webkit-scrollbar {
    display: none;
  }
  
  .agent-showcase > * {
    flex: 0 0 280px;
    min-width: 280px;
  }
}

/* Floating messenger chats - mobile positioning */
@media (max-width: 640px) {
  .floating-chat-container {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    width: 100%;
    max-width: 100%;
    border-radius: 12px 12px 0 0;
    margin: 0;
  }
  
  /* Stack chats vertically on mobile */
  .floating-chat-container[data-count="2"],
  .floating-chat-container[data-count="3"] {
    position: relative;
    width: 100%;
    margin-bottom: 8px;
  }
}

/* Audio player mobile optimization */
@media (max-width: 480px) {
  .audio-player iframe {
    height: 80px;
  }
}

/* Prevent zoom on iOS inputs */
@media (max-width: 768px) {
  input,
  textarea,
  select {
    font-size: 16px; /* Prevents iOS zoom */
  }
}

/* Reduce motion for accessibility */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Tailwind Class Updates (page.tsx specific)

Replace these className patterns in `src/app/page.tsx`:

### Hero Section
```
OLD: <div className="grid md:grid-cols-2 gap-8 md:gap-12 items-center">
NEW: <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-12 items-center">
```

### Agent Showcase Card
```
OLD: <div className="space-y-3">
NEW: <div className="space-y-3 agent-showcase">
```

### Feed Posts (Social Section)
```
OLD: <div className="grid md:grid-cols-3 gap-6">
NEW: <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
```

### Stats Section
```
OLD: <div className="flex flex-wrap gap-8 pt-6">
NEW: <div className="flex flex-wrap gap-4 md:gap-8 pt-6 justify-center md:justify-start">
```

---

## Component-Specific Mobile Classes

### Floating Chat (Add to active chat containers)
```jsx
<div className={`floating-chat-container ${activeChats.length > 1 ? 'mobile-stacked' : ''}`}>
```

### Agent Cards (Horizontal scroll on mobile)
```jsx
<div className="agent-showcase">
  {UI_AGENTS.slice(0, 6).map((agent) => (
    <div key={agent.id} className="agent-card">
      {/* existing agent card content */}
    </div>
  ))}
</div>
```

### Feed Post (Full width on mobile)
```jsx
<div className="glass-card feed-post">
  {/* content */}
</div>
```

---

## Device Detection Hook (Optional)

Create `src/hooks/useDevice.ts`:

```typescript
import { useState, useEffect } from "react";

interface DeviceInfo {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isTouch: boolean;
  viewportWidth: number;
}

export function useDevice(): DeviceInfo {
  const [device, setDevice] = useState<DeviceInfo>({
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    isTouch: false,
    viewportWidth: 1920,
  });

  useEffect(() => {
    const checkDevice = () => {
      const width = window.innerWidth;
      const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
      
      setDevice({
        isMobile: width < 640,
        isTablet: width >= 640 && width < 1024,
        isDesktop: width >= 1024,
        isTouch,
        viewportWidth: width,
      });
    };

    checkDevice();
    window.addEventListener("resize", checkDevice);
    return () => window.removeEventListener("resize", checkDevice);
  }, []);

  return device;
}
```

Usage:
```typescript
const { isMobile, isTouch } = useDevice();

// Conditionally render
{isMobile ? <MobileLayout /> : <DesktopLayout />}

// Or modify classes
<div className={isMobile ? "p-3" : "p-6"}>
```

---

## Visual Polish Checklist

### Keep Dark Theme + Green Accent ✅
Your existing CSS vars already handle this:
- `--bg-color: #0d0d0d` — Keep
- `--accent-color: #79c0ff` — Keep (cyan/greenish)
- `--link-color: #d2a8ff` — Keep (purple accent)

### Mobile-Specific Polish

1. **Status Online Dot** — Add pulse animation
```css
.status-dot {
  @apply w-2 h-2 rounded-full bg-green-400;
  box-shadow: 0 0 6px #4ade80;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

2. **LitBit Coins Display** — Stack vertically on mobile
```
OLD: <div className="flex items-center gap-2">
NEW: <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1 sm:gap-2">
```

3. **@Handle Contrast** — Ensure visible on dark
Your existing `text-white/50` works, but on mobile boost to `text-white/70`

4. **Bottom Safe Area** — For iOS home indicator
Already in CSS above with `env(safe-area-inset-bottom)`

---

## Verification Checklist

Test these after implementing:

- [ ] iPhone SE (375×667) — All content fits
- [ ] iPhone 14 Pro (393×852) — No horizontal scroll
- [ ] iPad Mini (768×1024) — 2-column layout kicks in
- [ ] Desktop (1920×1080) — Existing layout preserved
- [ ] Lighthouse Mobile Score > 85
- [ ] Tap targets all ≥ 44px
- [ ] No input zoom on iOS
- [ ] Touch scrolling smooth (-webkit-overflow-scrolling)

---

## Implementation Order

1. **Add viewport export** to layout.tsx (5 min)
2. **Add mobile CSS** to globals.css (10 min)
3. **Update Tailwind classes** in page.tsx (15 min)
4. **Test on actual device** or Chrome DevTools
5. **Optional**: Add useDevice hook for complex conditional UI

---

## CSS Variables Reference (Your Existing)

| Variable | Value | Usage |
|----------|-------|-------|
| `--bg-color` | `#0d0d0d` | Page background |
| `--bg-card` | `rgba(24,24,27,0.95)` | Card backgrounds |
| `--text-color` | `#d4d4d8` | Primary text |
| `--text-muted` | `#71717a` | Secondary text |
| `--link-color` | `#d2a8ff` | Links, accents |
| `--header-color` | `#ff7b72` | Headers, warnings |
| `--accent-color` | `#79c0ff` | Cyan/green accent |
| `--success` | `#56d364` | Green, online status |

All preserved in mobile version.
