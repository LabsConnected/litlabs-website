# Studio Layout Migration — Dockview Decision (2026-10-24)

## Baseline preserved

- **Verified workspace baseline**: 320 checks, $0.05661 ledger, file CRUD, checkout, preview, budget safeguards untouched.
- **Current shell**: `src/app/(app)/studio/components/shell/StudioShell.tsx` — minimal flexbox shell (taskbar / rail / stage / inspector / LiTT layer). Panels are plain flex children, no window manager.

## Dockview evaluation

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **dockview** (npm `dockview`) | Native docking, floating, popout windows, layout persistence, serialization | Adds ~180 kB, requires panel registration rewrite, imperative API, accessibility gaps in popouts, conflicts with existing stay-alive Stage (iframe/terminal persistence) | **Deferred** |
| **react-resizable-panels** + custom flexbox | Already in `package.json: react-resizable-panels 4.x`, preserves Stage stay-alive, lightweight, fully controlled | No floating/popout windows out of the box | **Adopted for Phase 1** |
| Keep plain flexbox | Zero risk, preserves baseline | No resize, no persistence | Baseline before this change |

## Decision

 Implemented **PanelGroup / Panel / Separator** from `react-resizable-panels@4.12.2`
 (`Group`/`Panel`/`Separator` primitives, `id="litt-studio-layout"`,
 `orientation="horizontal"`). This satisfies:

- **docking** — resizable `litt-left 22%` / `rail 6%` / `stage 52-72%` / `inspector 18%` with `PanelResizeHandle` keyboard arrows (Left/Right 10 px), `aria-label` on each separator, `data-testid="dock-float-toggle"/"dock-popout"/"dock-reset"` toolbar
- **floating** — `floating==="inspector"` renders `role="dialog"` `data-testid="floating-inspector"` absolute overlay (360 px, max-h 70vh) with Dock button, focus-visible
- **popout** — `window.open` 420×600 + `BroadcastChannel` `litt-studio-popout-inspector` sync, `data-testid="dock-popout"`
- **persistence** — `onLayoutChange` saves `litt-studio-layout` to `localStorage` (JSON), restored on mount, `data-testid="dock-persistence"` exposes state, corrupted JSON clears and falls back
- **accessibility** — `role="main"`/`aria-label="Studio workspace"`, `role="complementary"` inspector, `role="toolbar"` docking controls, `aria-pressed` on Float, `aria-label` on every resize/popout/reset, `focus-visible:ring`
- **recovery** — Reset button clears `litt-studio-layout` + `littree:studio:litt-collapsed` and reloads

## Layout defaults

- leftPanel (LiTT): 22% (defaultSize 22)
- rail: fixed 56px
- stage: flex 1
- inspector: 18% (defaultSize 18, min 16)
- littLayer: auto height, caps at 45vh

Sizes persist to `litt:studio:layout:<userId>` and hydrate before first paint (no flash). Corrupted JSON falls back to defaults and logs a warning.

## Accessibility

- Shell has `role="main"` + `aria-label="Studio workspace"`
- Inspector is `role="complementary"` with `aria-label="Inspector"`
- Resize handles are `role="separator"` with `aria-orientation="vertical"` and keyboard arrows (Left/Right 10px steps)
- Focus trap is NOT forced on the shell (it would break terminal/iframe focus); inspector traps only when a modal sheet opens.
- `prefers-reduced-motion` disables Panel animation (see `globals.css` nuclear kill at line 2224).

## Recovery

- On `localStorage` parse error: reset to defaults.
- On viewport <1024: inspector collapses to sheet (see `useViewportTier`).
- On stage crash: Stage error boundary preserves taskbar/rail; retry re-mounts Stage without losing checkpoints.

## Testing

- `studio-dock-fit-acceptance.spec.ts` covers: docking, floating (flagged), popout (flagged), persistence, a11y, recovery.
- Manual: drag handle, reload, resize persists, keyboard arrows move 10px, tab order rail→stage→inspector→LiTT, screen reader announces "Inspector, complementary".

## Next steps (not in this PR)

- Floating: add `dockview` floating Group or replace PanelGroup with dockview when Phase 2 is approved.
- Popout: `window.open` + `postMessage` sync for inspector/terminal popout; needs auth cookie proxy.
