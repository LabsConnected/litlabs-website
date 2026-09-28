# Studio UX simplification plan

Baseline: Larry's Studio UX plan (chat controls the workspace, the workspace shows the result, the inspector handles details). This document records that baseline, then the corrections found by reading `main` at `22aa433b` (2026-09-28). Line numbers below are from that snapshot. They must be re-inventoried before any later phase.

Phases 2 through 6 are blocked. Do not start them until both of these have landed and the tree has been re-read:

- Codex PR #537 (`codex/studio-freeform-canvas`). As of this writing it is **closed unmerged** (`mergeCommit` null, closed 2026-09-27). The same StudioShell work is already on `main` as #538 (`cea4d21e`). Treat #537's changed-file list as the overlap set anyway.
- Mobile-pass PR #545 (`feat/studio-mobile-architecture`, open). It rewrites Studio mobile under 768px and edits `CommandStudio.tsx`.

This PR is Phase 1 only: verified dead-code deletion, plus this plan.

## What Larry's plan claims

- Live Studio is `src/app/(app)/studio/page.tsx` rendering `CommandStudio`.
- There are no live floating windows. Clutter is about nine duplicate navigation UIs.
- The Inspector lives in the bottom dock and should move to a contextual right-side panel.
- Target: left LiTT chat, one center workspace (Design, Preview, Browser, Code, Files, Images, Deploy, Activity), right inspector hidden until something is selected, thin top bar (project, current surface, important status, Preview/Open, Deploy).
- Dead code to delete: `src/components/studio/shell/`, `StudioModeSwitcher`, the unmounted desktop `CommandStudioNav` rail (keep `MobileCommandNav`), `src/app/(app)/studio/components/windows/StudioWindowChrome.tsx`, `src/app/(app)/studio/stores/useWindowManagerStore.ts`.
- Later phases, in order, one commit each, with type-check, lint, and the relevant vitest suites between them:
  1. Dead-code deletion (this PR).
  2. One surface switcher. Remove duplicate rails, tabs, and menus.
  3. Move the inspector to a contextual right panel. Keep the old dock Inspector tab until the new panel is verified, then remove it.
  4. Remove the bottom dock as primary navigation.
  5. Mobile: full-width workspace, chat easy to reach, inspector as a bottom sheet.
  6. Visual polish: less chrome, honest disabled states, premium near-black LiTT look.
- Preserve browser control, the selection bridge, inspector source writes, persistence, approvals, and agent tooling. Move components. Do not rebuild the state layer.
- Unimplemented surfaces show an honest disabled or pending state.
- PR #547's spatial canvas (unmerged) should become an optional board inside the center, not primary navigation. Do not branch from it. Do not touch #540, #541, #544, or #550.

## Corrections against the code

### Live entry is correct

`src/app/(app)/studio/page.tsx` imports `CommandStudio` (line 7) and renders it. The canonical operating shell is `src/app/(app)/studio/components/shell/`, not `src/components/studio/shell/`.

Two different `StudioShell` components exist:

| Path | Role | Status |
| --- | --- | --- |
| `src/app/(app)/studio/components/shell/StudioShell.tsx` | Desktop operating shell used by `CommandStudio` (import at `CommandStudio.tsx` line 65, mount around line 2615) | Live. #537/#538 modify it. Not deleted. |
| `src/components/page-shells/StudioShell.tsx` | Loading placeholder for `/studio` (`studio/loading.tsx`) | Live. Not the same file. Not deleted. |
| `src/components/studio/shell/StudioShell.tsx` | Old resizable-panel shell (`TopBar`, `LeftRail`, `BottomDock`, `RightPanel`, `WorkspaceCanvas`, `CommandBar`) | Unmounted. Deleted in Phase 1. |

`studioShellActive` (`CommandStudio.tsx` lines 382–383) is desktop-only: `destination === "studio"` and viewport is known and not mobile and `localStorage["litt:studio:layout-mode"] !== "classic"`. Mobile and the classic override still render the older body (workspace tabs, `StudioDock`, `LiTTPanel`, `MobileCommandNav`).

### Floating windows are not the primary model, and they are not gone

The operating shell comment says it replaces the floating-window compositor. Surface switches mount one stage child (`data-testid="stage-surface-*"`). There is no window manager.

These overlays are still mounted from `CommandStudio` and are not navigation:

- Camera dock and screen dock (`CameraDock` / `ScreenDock` near the bottom of `CommandStudio.tsx`).
- Canvas action aside, opened by `canvas:execute-action` (around lines 1095 and 3332).
- `LiveVoiceOverlay`.
- Classic-mode `LiTTPanel` overlay when expanded.

`StudioWindowChrome.tsx` and `useWindowManagerStore.ts` are not in the tree. A repo-wide search for `useWindowManager`, `WindowChrome`, and `windowManager` in `*.ts` / `*.tsx` returns nothing. Phase 1 does not recreate them.

### The inspector is already on the right in the desktop shell

Larry's "inspector lives in the bottom dock" describes the classic/mobile path, not the current desktop default.

- Desktop shell: `ContextInspector` is the right column of `src/app/(app)/studio/components/shell/StudioShell.tsx` (lines 44–49). `inspectorOpen` defaults to `true` (`CommandStudio.tsx` line 385), so the panel is open even with no selection and falls through to `StudioInspector`.
- Classic/mobile: `StudioDock` still has an inspector tab, and the mobile `ContextDrawer` still hosts inspector content.

Phase 3 is not "create a right inspector from nothing." It is "make the existing right inspector selection-only, and stop also hosting inspector UI in the dock." Re-read both paths after #545.

### Duplicate navigation is two shells, not a single set of nine

Counted on this snapshot. "About nine" matches one shell. Both shells are still in the product, so the real set is larger.

Desktop shell (`studioShellActive`):

1. `WorkspaceRail` — icon rail for `PRIMARY_SURFACES` plus terminal (`stage-surfaces.ts` lines 58–72, `WorkspaceRail.tsx`).
2. `CommandStudioHeader` — Preview, Dock toggle, overflow dock tabs. When the shell is active, dock actions are remapped onto stage surfaces (`DOCK_TAB_TO_SURFACE`, `CommandStudio.tsx` lines 134–139 and 408–420).
3. `StudioOperatorBar` inside the LiTT layer — Terminal and Activity.
4. `WorktabBar` — task identity, not a surface switcher. Keep it, but it is a second chrome row.
5. `StudioPlanSurface` and Activity `MissionCards` — buttons that jump to Code, Design, Preview, Files, Terminal, Activity.

Classic and mobile (shell inactive):

6. Workspace tab strip — Design, Code, Preview only (`workspaceTabs`, around line 2158; rendered around line 2843). Browser, Files, Images, Deploy, Activity are not on this strip.
7. `StudioDock` — activity, files, terminal, inspector, media.
8. Header dock toggle (same header, different behavior).
9. `MobileCommandNav` — Chat, Preview, Files, Activity, More.
10. Fixed Chat | Canvas switcher plus the LiTT FAB.
11. Mobile tools sheet — Code, Canvas, Preview, Files, Terminal, Activity, and create modes.
12. Mobile `ContextDrawer` tabs — work, files, inspector, assets.

Center stage surfaces that already exist and are real (`renderStageSurface`, around line 2380): Plan, Design (`VisualCanvasBuilder`), Preview, Browser (`StudioBrowserJobsPanel`, including Take control / Return to LiTT), Code, Files, Images (`ImageStudio`), Assets, Deploy, Activity, Terminal. Larry's target list drops Plan, Assets, and Terminal from the primary switcher. They are functional today. Do not replace them with a fake finished tab, and do not delete them in a later phase without a new home (Terminal stays mounted when visited; that keep-alive must survive).

### Dead code verified before deletion

Searched `*.ts`, `*.tsx`, `*.js`, and `*.jsx` for static imports and `import()` of each target. Also searched #537's diff for those paths. #537 does not add, modify, or import any Phase 1 target. No deletion was skipped for overlap.

| Target | Importers on `main` | #537 | Action |
| --- | --- | --- | --- |
| `src/components/studio/shell/` (`StudioShell.tsx`, `TopBar.tsx`, `LeftRail.tsx`, `BottomDock.tsx`) | Only each other. No app, test, or dynamic import. | Not in the diff | Deleted |
| `src/app/(app)/studio/components/StudioModeSwitcher.tsx` | None. Docs mention a stale path `src/app/studio/components/StudioModeSwitcher.tsx` | Not in the diff | Deleted |
| Desktop `CommandStudioNav` default export | None. `MobileCommandNav` is imported by `CommandStudio.tsx` line 37 and `CommandStudioNav.mobile.test.tsx` | Not in the diff | Default export removed. `MobileCommandNav` kept |
| `src/app/(app)/studio/components/windows/StudioWindowChrome.tsx` | File absent. No symbol references | Not in the diff | Nothing to delete |
| `src/app/(app)/studio/stores/useWindowManagerStore.ts` | File absent. No symbol references | Not in the diff | Nothing to delete |

Left in place on purpose, even though nothing mounts them after the shell directory goes away:

- `src/components/studio/canvas/WorkspaceCanvas.tsx`
- `src/components/studio/command/CommandBar.tsx`
- `src/components/studio/inspector/RightPanel.tsx`
- `src/stores/useStudioStore.ts` (still imported by `WorkspaceCanvas` and `CommandBar`)

They were not on the Phase 1 list. Deleting them would widen the diff into stores #537 does not touch, without a fresh "nothing imports this" pass after the shell deletion. A later cleanup can remove them once that pass is repeated.

Stale prose, not code, still names the deleted shell or switcher: `docs/landing/REAL-ASSET-MANIFEST.md`, `docs/chat-api-wiring-map.md`, `docs/legacy/BLUEPRINT-legacy.md`, `SITE_REFERENCE.md`. Those docs were not edited here.

## What should stay

- `CommandStudio` data flow, stores, URL routing, approvals, tasks, and the classic layout behind `litt:studio:layout-mode=classic` until a later phase replaces it on purpose.
- Live shell: `WorkspaceRail`, `ContextInspector`, `ElementInspectorPanel`, `LiTTCommandLayer`, `stage-surfaces.ts`, preview selection bridge, `useElementEdits`, browser session control, image ops.
- `MobileCommandNav` until #545 replaces mobile navigation.
- Terminal stay-alive (`StudioTerminalDrawer` `visible={active}` while the surface stays mounted).
- Chat composer and transcript ownership in `useCanonicalConversation`.

## What later phases should change (not this PR)

Re-inventory line numbers first. #545 edits `CommandStudio.tsx`, the routing and shell tests, and adds `components/mobile/*`. #537/#538 already changed the shell, inspector, preview, and browser files. A plan written against pre-#538 `main` will point at the wrong lines.

2. **One switcher.** One control for Design, Preview, Browser, Code, Files, Images, Deploy, Activity. Remove the same destination from the rail, header dock, operator bar, workspace tabs, and mobile tools sheet. Keep task tabs as tasks.
3. **Inspector.** Default closed. Open on element, design-node, file, image, browser-target, or task selection, and show only that selection's controls. Desktop shell already has the right column; classic dock still has the old tab. Keep the dock tab until the right panel is verified.
4. **Dock.** Stop using `StudioDock` as navigation once every dock tab has a single home. Do not unmount the terminal session to do it.
5. **Mobile.** Wait for #545. Then design chat, full-width workspace, and an inspector sheet against that shell instead of shrinking the desktop rail.
6. **Polish.** Thin top bar, quieter status, honest pending states, no second empty panel.

### #547

Draft #547 (`cursor/studio-spatial-workspace-m1-4aec`) adds a floating-window board and `studio_workspaces`. Do not merge it into this work and do not edit that branch. If it lands later, the board should be an optional center view, not the way users change surfaces.

## Regression risks for Phase 1

- Removing the desktop rail must not drop `MobileCommandNav` or `MobileStudioSurface`. The mobile nav test imports the named export only.
- Deleting `src/components/studio/shell/` must not be confused with `components/shell/StudioShell.tsx` or `page-shells/StudioShell.tsx`.
- `WorkspaceCanvas`, `CommandBar`, `RightPanel`, and `useStudioStore` still type-check. They are unused at runtime.

## Acceptance for this PR

- Phase 1 deletions match the table above.
- `pnpm type-check`, `pnpm lint` (0 errors), `pnpm test`, and `pnpm build` are recorded with exit codes.
- No Phase 2–6 layout edits.
- No migrations, no edits under `packages/litt-agent-core`, `packages/litt-cli`, `packages/litt-models`, or `.github/workflows`.
