# LiTTree Lab Studios — Appearance Blueprint

This document is the **single source of truth** for extending the look, feel, and visual FX of LiTTree Lab Studios. Other agents should read this before touching `src/context/ThemeContext.tsx`, `src/app/settings/page.tsx`, `src/components/AnimatedBackground.tsx`, or `src/app/globals.css`.

## 1. Design Philosophy

- **IDE Native**: dark, data-dense, flat 1px borders, monospace display fonts, command-center energy.
- **Theatre, not wallpaper**: surfaces should feel like control panels and stage rigs, not blog posts.
- **FX are opt-in**: all visual flourishes are toggles; never force animated backgrounds or heavy shaders on first load.
- **Theme tokens rule**: every component reads `--bg-color`, `--text-color`, `--accent-color`, `--border-color`, `--box-bg`, etc. Do not hard-code colors.

## 2. File Map

| File | Responsibility |
|------|----------------|
| `src/context/ThemeContext.tsx` | Authoritative theme state (`mode`, `skin`, `accent`, `backgroundMode`, `effects`, custom colors). Exposes `useTheme()` and `useCrtToggle()`. |
| `src/app/globals.css` | CSS variables and global FX selectors (`[data-effect-*]`). Add new FX here. |
| `src/app/settings/page.tsx` | Settings UI. The **Personalization** tab contains Theme Presets, Mode, Accent, Background & Effects, and the Global FX toggles. |
| `src/components/AnimatedBackground.tsx` | Canvas-driven background modes (`constellation`, `nebula`, `waves`, `minimal`, `holo`). Add new canvas scenes here. |
| `src/lib/themes.ts` | Static theme preset metadata used for preview cards. |
| `src/app/layout.tsx` | Root `<ClerkProvider>` + provider stack. Surfaces the theme CSS variables globally. |

## 3. Theme State Shape

```ts
interface Theme {
  mode: "dark" | "light" | "system";
  skin: SkinPreset;           // volcanic, neon, cyberpunk, etc.
  accent: AccentColor;        // neon-green, sunset-orange, etc.
  backgroundMode: BackgroundMode;
  customColors?: {            // optional hex overrides
    bgColor?: string;
    textColor?: string;
    linkColor?: string;
    headerColor?: string;
    borderColor?: string;
    accentColor?: string;
    boxBg?: string;
  };
  effects?: {
    glow?: boolean;           // neon text/box glow
    bloom?: boolean;          // accent drop-shadow on icons/images
    noise?: boolean;          // animated film-grain overlay
  };
}
```

- Persisted in `localStorage` under `litlabs-theme`.
- Loaded on mount so the first paint uses fallback `:root` variables and then switches to the stored theme.

## 4. How to Add a New Global FX Toggle

1. **Pick a key** in `ThemeContext.tsx`:
   - Add it to `EffectKey` union type.
   - Add a boolean to `Theme.effects`.
   - Set a default in `defaultTheme`.
2. **Wire the toggle** in `settings/page.tsx`:
   - Add an entry to the `EFFECTS` array (label + Lucide icon + `EffectKey`).
   - The existing `setEffect(id, !active)` handler will do the rest.
3. **Style it** in `globals.css`:
   - Read `ThemeContext` data attributes already set on `<html>`:
     - `data-effect-glow`, `data-effect-bloom`, `data-effect-noise`.
   - Add selectors like `:root[data-effect-myfx="true"] ... { ... }`.
   - Prefer CSS-only effects. If you need JS/canvas, add the state to `AnimatedBackground.tsx` instead.
4. **Keep it cheap**: avoid `mix-blend-mode` on large areas, avoid `backdrop-filter` on scrolling lists, and respect `prefers-reduced-motion`.

## 5. How to Add a New Background Mode

1. Append to `BackgroundMode` union in `AnimatedBackground.tsx`.
2. Add an entry to `cssBackgrounds` for CSS-only modes, **or** implement a new canvas branch in the main render loop.
3. Add a label to `BACKGROUND_MODES` in `settings/page.tsx`.
4. If the mode needs a new theme token, add a CSS variable and set it from `ThemeContext`.

## 6. How to Add a New Skin / Accent

1. Add the preset key to `SkinPreset`/`AccentColor` unions in `ThemeContext.tsx`.
2. Add the corresponding color object to `darkSkins` and `lightSkins` (both are required).
3. Add accent override to `accentOverrides`.
4. Add metadata to `THEMES` in `src/lib/themes.ts` so the settings preview card renders.

## 7. How to Add a New Settings Section

1. Add an entry to `SECTIONS` or `ADVANCED_SECTIONS` in `settings/page.tsx`.
2. Add search terms to `SECTION_SEARCH_TERMS`.
3. Add a legacy map entry to `legacyMap` if old hash URLs pointed elsewhere.
4. Render the section with `showSection("your-section")`.

## 8. Performance Rules

- Do **not** animate `box-shadow` on scroll.
- Do **not** run `requestAnimationFrame` loops when the tab is hidden.
- Do **not** use `backdrop-filter` on large surfaces.
- Use `transform` and `opacity` for motion.
- Always read `window.matchMedia("(prefers-reduced-motion: reduce)")` before starting canvas animations.

## 9. Accessibility / Safety

- FX are purely cosmetic. A page must remain usable if all FX are off.
- Never rely on color alone for state.
- Keep contrast ratios above 4.5:1 for small text (`mixMuted` in `ThemeContext` helps).

## 10. Current FX Reference

| FX | data attr | CSS target | Description |
|----|-----------|------------|-------------|
| Neon Glow | `data-effect-glow="true"` | `h1, h2, .font-black`, `button:hover, a:hover` | Accent text/box halos. |
| Bloom | `data-effect-bloom="true"` | `svg`, `img` | Accent drop-shadow on icons and images. |
| Film Grain | `data-effect-noise="true"` | `body::after` | Fixed SVG noise overlay. |
| CRT Scanlines | `crtEnabled` from `useCrtToggle()` | `.crt-overlay` | Separate legacy overlay. |

## 11. Quick Checklist Before Committing

- [ ] `npx tsc --noEmit` passes.
- [ ] `npx eslint src` has no new errors.
- [ ] New FX is behind a toggle and defaults to **off**.
- [ ] `prefers-reduced-motion` is respected for any motion.
- [ ] Theme tokens (CSS variables) are used instead of hard-coded colors.

---

Last updated: 2026-07-16. Keep this doc in sync with any theme/appearance work.
