# Studio UX simplification plan

Larry's plan (2026-09-27) is the baseline. Everything under **Verified against the code** is a correction from reading the tree after Phase 1, at `c3bb99c6` on top of `main` `22aa433b`. Where they disagree, follow the code.

## Status

| Phase | What Larry asked | State |
| --- | --- | --- |
| 1 | Delete unmounted shell, mode switcher, desktop nav rail, window chrome, window-manager store | Done in `c3bb99c6`. See the deletion table. |
| 2 | One desktop surface switcher. Remove duplicate Preview/Files/Terminal/Activity entries. | Not started. |
| 3 | Move the inspector to a contextual right panel. Keep the dock Inspector tab until the new panel is verified, then remove it. | Not started. |
| 4 | Promote Browser, Files, Images, Deploy, Activity into the center. Terminal becomes a bottom utility panel. Delete `StudioDock`. Keep the PTY mounted. | Not started. |
| 5 | Mobile: one switcher, full-width workspace, inspector sheet. | Not started. |
| 6 | Remove nested chrome, empty panels, and duplicate labels. Honest disabled states. | Not started. |

Phases 2–6 stay blocked until PR #545 (mobile architecture) has landed and this inventory is repeated. PR #537 is closed unmerged; the same StudioShell files are already on `main` as #538 (`cea4d21e`). Larry's line numbers were taken before that shell. Do not edit from them.

Do not combine phases. After each later phase: `pnpm type-check`, `pnpm lint`, and the vitest files that mount `CommandStudio`, the dock, the terminal, and the inspector. Do not rebuild stores. Do not touch #540, #541, or #547. If #547's spatial board lands, it is an optional center view, not the surface switcher.

## Larry's plan (baseline)

Goal: chat controls the workspace, the workspace shows the result, the inspector handles details.

Target:

- Top bar: project name, current surface, status, Preview, Deploy.
- Left: LiTT chat, always available.
- Center: one surface at a time — Design, Preview, Browser, Code, Files, Images, Deploy, Activity.
- Right: inspector, hidden until a selection exists. On mobile it is a bottom sheet.

Larry's inventory, as written:

- Live root is `src/app/(app)/studio/page.tsx` rendering `CommandStudio.tsx` (he counted 2940 lines). He said there is no separate `StudioShell` on the live path.
- He said there are zero live floating or draggable windows. The clutter is nine switcher UIs.
- Regions he described: `CommandStudioHeader`; left `LiTTPanel` (Chat | Live, collapses to 64px without unmounting); center task rail plus a 36px Design | Code | Preview bar and one surface; bottom `StudioDock` (Activity, Files, Terminal, Inspector, Media) with the terminal kept alive by `display:none`; inspector inside the dock with seven tabs (Plan, Changes, Files, Preview, Checks, Approvals, Browser); mobile `MobileCommandNav`, `ContextDrawer`, and sheets.
- Dead code he listed: `src/components/studio/shell/` (he said 7 files: StudioShell, TopBar, LeftRail, BottomDock, WorkspaceCanvas, CommandBar, RightPanel), `StudioModeSwitcher.tsx`, the desktop `CommandStudioNav` rail, `windows/StudioWindowChrome.tsx`, `stores/useWindowManagerStore.ts`.
- Duplicate routes he counted: Preview 6 ways, Files 5, Terminal 4, Activity 3. The nine switchers: workspace tab bar, `MobileCommandNav`, `StudioDock` tabs, `MobileToolsSheet`, `ContextDrawer` tabs, header overflow, inspector tabs, LiTT panel tabs, and the dead `CommandStudioNav` rail.
- Stay: `LiTTPanel`, composer, transcript, approvals, studio stores plus `useStudioStore` / `useProjectStore` / `useSelectionStore` / `useTerminalStore`, `StudioTerminalDrawer` keep-alive, `StudioPreviewPanel` selection bridge, `VisualCanvasBuilder`, `CodeWorkspace`, browser jobs and live view, `studio-destinations.ts`, `StudioTaskRail`, and the legacy tools under `tools/`.
- Phase 2 removes inspector Files and Preview tabs (`StudioWorkspaceFrame.tsx` ~252), header overflow Preview and Terminal (keep Deploy), `MobileToolsSheet` surface shortcuts, and the LiTT "Activity" tab label path (Activity becomes a center surface; keep Live).
- Phase 3 extracts `StudioInspector` from `StudioWorkspaceFrame.tsx` ~387 into `StudioInspectorPanel.tsx`, mounts it as a right `<aside>`, hidden by default, opened from `useSelectionStore`, mobile sheet via `MobileBottomSheet`. Keep the dock tab until that panel is verified.
- Phase 4: terminal leaves the dock for a collapsible bottom panel; Browser, Files, Images, Deploy, and Activity become center surfaces; then delete `StudioDock`.
- Phase 5: `MobileCommandNav` becomes Chat, Workspace, Surfaces, Inspector. Remove `ContextDrawer` tabs and the tools-sheet shortcuts.
- Acceptance: one desktop way to each surface, chat stays mounted, terminal survives surface switches, browser Take control / Return to LiTT does not change layout, unimplemented surfaces are honestly disabled.

## Verified against the code

### Live entry

Correct. `src/app/(app)/studio/page.tsx` imports `CommandStudio` at line 8. `StudioHub` returns it at line 164, and the page renders `StudioHub` at line 196.

`CommandStudio.tsx` is 3706 lines, not 2940.

### There is a live StudioShell. Larry's "no StudioShell" claim is stale.

#538 added `src/app/(app)/studio/components/shell/StudioShell.tsx` (54 lines). `CommandStudio.tsx` imports it at line 65 and mounts it when `studioShellActive` is true (lines 382–383, mount at line 2615).

`studioShellActive` is desktop only: destination is studio, the viewport tier is known, the tier is not mobile, and `localStorage["litt:studio:layout-mode"]` is not `"classic"`. Mobile and the classic override still render the body Larry described (LiTT panel, 36px tabs, bottom dock).

| Path | What it is | Action |
| --- | --- | --- |
| `src/app/(app)/studio/components/shell/StudioShell.tsx` | Live desktop shell: task bar, rail, stage, right inspector, bottom LiTT layer | Keep. #537/#538 own this file. |
| `src/components/page-shells/StudioShell.tsx` | `/studio` loading placeholder | Keep. Different component. |
| `src/components/studio/shell/` | Old resizable-panel shell | Deleted in Phase 1. |

Desktop shell layout today, which Larry's inventory does not describe:

- Top: the same `CommandStudioHeader`.
- Left: `WorkspaceRail` (`stage-surfaces.ts` lines 58–72), not `LiTTPanel`. Surfaces: Plan, Design, Preview, Browser, Code, Files, Images, Assets, Deploy, Activity, plus Terminal.
- Center: one `stage-surface-*` child (`renderStageSurface` at line 2380). Design, Preview, Browser, Code, Files, Images, Deploy, and Activity already render here. Plan, Assets, and Terminal do too.
- Right: `ContextInspector` (`StudioShell.tsx` lines 44–49). `inspectorOpen` starts `true` (`CommandStudio.tsx` line 385), so the column is open with no selection and falls through to `StudioInspector`.
- Bottom: `LiTTCommandLayer`, not `LiTTPanel`. The transcript is collapsed until expanded. `StudioOperatorBar` inside that layer also opens Terminal and Activity.

The classic body Larry inventoried is the fallback, starting around line 2781. Workspace tabs are still only Design, Code, Preview (`workspaceTabs` lines 2158–2162, rendered at line 2843). `StudioDock` is mounted at line 2977 with Activity, Files, Terminal, Inspector, Media (`StudioDock.tsx` lines 83–89). The terminal comment at lines 2972–2976 says the PTY stays mounted with `display:none`.

### Floating windows

No window manager is mounted. `useWindowManagerStore` and `StudioWindowChrome` are absent, and a search of `*.ts` / `*.tsx` finds no `useWindowManager`, `WindowChrome`, or `windowManager` symbols.

These overlays are still real and are not the surface switcher:

- Camera dock and screen dock, defined near the bottom of `CommandStudio.tsx`.
- Canvas action aside, opened by `canvas:execute-action` (listener around line 1095, aside around line 3332).
- `LiveVoiceOverlay`.
- Classic `LiTTPanel` uses a fixed overlay when expanded (`CommandStudio.tsx` around line 2791).

#547 (unmerged) would add a floating-window board. It is not on this branch.

### Inspector

Larry is right about the classic/mobile dock, and wrong about the desktop default.

- Classic: the dock has an Inspector tab (`StudioDock.tsx` line 87). Its body is `inspectorContent`, which `CommandStudio` fills with `StudioInspector`. The seven tabs live in `StudioWorkspaceFrame.tsx` lines 252–260: Plan, Changes, Files, Preview, Checks, Approvals, Browser. Files and Preview there duplicate other navigation. The comment at lines 242–243 is stale (it still says Plan, Changes, Checks, Approvals and a bottom Activity | Terminal drawer).
- Desktop shell: the inspector is already the right column. It is not hidden by default, and it still embeds the same `StudioInspector` when nothing is selected (`CommandStudio.tsx` around line 2731). A preview selection mounts `ElementInspectorPanel` instead. A design-node selection mounts `BuilderPropertiesPanel`.

Phase 3 is not "create the first right inspector." It is "default the existing right inspector closed, show only the selection's controls, and remove the dock tab only after that path is verified." `useSelectionStore` is not what the live preview bridge uses. Preview selection is `previewSelection` / `studio:ask-litt`, and design selection is the canvas builder store. Do not switch that pipeline to `useSelectionStore` just because the plan names it.

## Phase 3

Not started. Do not build it in this PR.

Acceptance criteria:

- The right inspector is hidden until something is selected, and it shows only that selection's controls.
- The dock Inspector tab stays until the right panel is verified, then it is removed.
- On a phone, the same inspector is a bottom sheet.
- Editing an element's text or style in the inspector saves to the real source file, and the preview updates live. Phase 3 is not done until inspector edits persist. Controls that don't save count as fake UI and are not allowed.

Save-back check (read-only, no Phase 3 code): **(a) save-back exists on main; Phase 3 must preserve this wiring through the move.**

The live path does not use `useSelectionStore`. That store (`src/stores/useSelectionStore.ts`) is only read by the unmounted `RightPanel` (`src/components/studio/inspector/RightPanel.tsx`). Replacing the preview bridge with it would drop the write path.

What is wired today:

1. Selection bridge. `StudioPreviewPanel` (`src/app/(app)/studio/components/StudioPreviewPanel.tsx`) enables selection in an effect around line 319. Same-origin clicks and the cross-origin `postMessage` bridge (`terminal-server/preview/inspector.ts`, client side `bridgeRef` around line 270) call `onSelectionChange`. `CommandStudio` stores that as `previewSelection` and, when set, mounts `ElementInspectorPanel` in the right `ContextInspector` instead of the generic `StudioInspector`.
2. Text and style controls. `ElementInspectorPanel` (`src/app/(app)/studio/components/shell/ElementInspectorPanel.tsx`) commits text through `apply({ text })` and styles through `setStyle`, which calls local `apply`. `apply` calls `useElementEdits(...).applyPatch`.
3. File write. `useElementEdits` (`src/app/(app)/studio/hooks/useElementEdits.ts`) `resolve` lists project files and `readFile` POSTs `{ action: "read" }`. `applyPatch` runs `applyElementPatch` (`src/app/(app)/studio/lib/element-edits.ts`) and `writeFile` POSTs `{ action: "write", path, content }` to `/api/studio-projects/{projectId}/files`. `POST` in `src/app/api/studio-projects/[projectId]/files/route.ts` forwards `action: "write"` to the terminal server `ws-files/write`. On success, `applyPatch` dispatches `studio:files-changed` with `source: "element-edit"`. Undo and redo in `step` write the previous or next file body through the same `writeFile`.
4. Preview refresh. `StudioPreviewPanel`'s `studio:files-changed` listener (around line 615) sets `reloadFrameOnNextReadyRef` and calls `loadStatus(true)`. When the preview status payload is `ready`, `loadStatus` bumps `frameKey` (around line 491), which reloads the iframe. The update is a real reload after the file write, not an unsaved overlay.

`ElementInspectorPanel.test.tsx` covers the text write into `index.html` and the `files-changed` event, and a style change (`display: flex`) writing the file back.

Boundary, not a missing save: `resolve` only accepts a unique match in a `.html` file (`candidateHtmlFiles`, `locateElement`). JSX, TSX, and other framework output set status `unavailable` and render the reason plus Ask LiTT, with no style controls. That is the honest non-edit state. Phase 3 must keep it. Design-node properties (`BuilderPropertiesPanel`) are a different store and are not this write path. Phase 3 must not present those as source-file saves unless they gain the same `writeFile` path.

### Duplicate navigation

Larry's nine switchers match the classic/mobile body plus the dead rail. They do not include the desktop shell, which adds more.

Classic and mobile, checked in this tree:

| Switcher | Where | Still present |
| --- | --- | --- |
| Workspace tab bar | `CommandStudio.tsx` 2158 and 2843 | Design, Code, Preview only. Not Browser, Files, Images, Deploy, Activity. |
| `MobileCommandNav` | `CommandStudioNav.tsx`, mounted from `CommandStudio.tsx` line 37 | Chat, Preview, Files, Activity, More |
| `StudioDock` tabs | `StudioDock.tsx` 83–89, mount 2977 | Activity, Files, Terminal, Inspector, Media |
| `MobileToolsSheet` | `litt/MobileToolsSheet.tsx`, mounted from `CommandStudio.tsx` line 49 | Code, Canvas, Preview, Files, Terminal, Activity, plus create modes |
| `ContextDrawer` tabs | mobile overlay in the classic branch | work, files, inspector, assets |
| Header overflow | `CommandStudioHeader.tsx` 735 (Preview) and 764 (Terminal). Status popover also opens Terminal at line 568. | Yes |
| Inspector tabs | `StudioWorkspaceFrame.tsx` 252–260 | Seven tabs, including Files and Preview |
| LiTT panel tabs | `LiTTPanel.tsx` 173, label "Activity" on the `live` tab | Classic path only |
| Desktop `CommandStudioNav` rail | was the default export | Removed in Phase 1. `MobileCommandNav` kept. |

Preview on the classic path is reachable from the workspace tab, the header Preview button (`CommandStudioHeader.tsx` 311), the header overflow (735), the inspector Preview tab (256), mobile nav, and the tools sheet. That is six, as Larry said, before counting the desktop rail.

Files: dock, `ContextDrawer`, inspector Files tab, mobile nav, tools sheet. Five, as Larry said, on the classic path. The desktop shell also has `WorkspaceRail` "files".

Terminal: dock, header overflow, tools sheet, and LiTT live actions. The status popover is a fifth (`CommandStudioHeader.tsx` 568). Desktop shell adds the rail utility and `StudioOperatorBar`.

Activity: LiTT Activity tab, dock tab, mobile nav. Desktop shell adds the rail, the operator bar, and the Activity stage.

Desktop shell switchers that Larry did not list: `WorkspaceRail`, header Dock toggle (remapped to stage surfaces at `CommandStudio.tsx` 134–139 and 408–420), and `StudioOperatorBar`.

### Center surfaces already exist on the desktop shell

`renderStageSurface` (line 2380) already mounts Design (`VisualCanvasBuilder`), Preview, Browser (`StudioBrowserJobsPanel`, with Take control / Return to LiTT), Code, Files, Images (`ImageStudio`), Deploy, and Activity. Larry's phase 4 "promote these out of the dock" is already true for the desktop shell. The classic dock still has its own copies. A later phase has to delete the duplicates, not build a second browser.

Plan, Assets, and Terminal are also real stage surfaces. They are not in Larry's eight-item switcher. Do not show them as finished extra tabs, and do not unmount Terminal to remove them. The classic dock's `display:none` keep-alive and the shell's "visited surfaces stay mounted" behavior both have to survive.

### Dead code

Searched `*.ts`, `*.tsx`, `*.js`, and `*.jsx` for static imports and `import()`. Also searched PR #537's diff. None of the Phase 1 targets appear there, so nothing was held back for overlap.

| Larry's item | What the code actually is | Result |
| --- | --- | --- |
| `src/components/studio/shell/` | Four files were in that directory: `StudioShell.tsx`, `TopBar.tsx`, `LeftRail.tsx`, `BottomDock.tsx`. They imported only each other. | Deleted. |
| WorkspaceCanvas, CommandBar, RightPanel | Not inside `shell/`. They are `src/components/studio/canvas/WorkspaceCanvas.tsx`, `src/components/studio/command/CommandBar.tsx`, and `src/components/studio/inspector/RightPanel.tsx`. After the shell deletion, nothing imports them. | Left in place. They were not on the Phase 1 path list. `useStudioStore` is still imported by `WorkspaceCanvas` and `CommandBar`. |
| `StudioModeSwitcher.tsx` | No importer. Docs still mention a stale path. | Deleted. |
| Desktop `CommandStudioNav` | Default export had no importer. `MobileCommandNav` is imported by `CommandStudio.tsx` line 37 and `CommandStudioNav.mobile.test.tsx`. | Default export removed. Mobile nav kept. |
| `windows/StudioWindowChrome.tsx` | File does not exist. | Nothing to delete. |
| `stores/useWindowManagerStore.ts` | File does not exist. | Nothing to delete. |

Stale docs that still name the deleted shell or switcher were not edited: `docs/landing/REAL-ASSET-MANIFEST.md`, `docs/chat-api-wiring-map.md`, `docs/legacy/BLUEPRINT-legacy.md`, `SITE_REFERENCE.md`.

### What later phases must not assume

- `workspaceTabs` at line 2158 is not the desktop switcher. The desktop switcher is `WorkspaceRail`. Making the 36px bar "the only switcher" would resurrect the classic bar on a path that no longer shows it, and would miss the rail.
- `StudioWorkspaceFrame.tsx` ~387 is not a separate inspector component waiting to be moved. `StudioInspector` is already exported from that file and passed into both the dock and `ContextInspector`.
- Images on the shell are `ImageStudio` (`shell/ImageStudio.tsx`), not only the inline `MediaWorkspacePanel` Larry pointed at near `CommandStudio.tsx` 2690. That inline panel is part of the classic tree and has moved.
- `ContextDrawer` on this branch is `src/app/(app)/studio/components/context/ContextDrawer.tsx`, not `src/components/context/ContextDrawer.tsx`.
- #545 adds `src/app/(app)/studio/components/mobile/*` and edits `CommandStudio.tsx`, the routing tests, and `CommandStudio.mobile-nav.test.tsx`. Phase 5 has to start from that, not from today's `MobileCommandNav`.

## Phase 1 regression notes

- `MobileCommandNav` and `MobileStudioSurface` still export from `CommandStudioNav.tsx`.
- The live shell and the page-shell `StudioShell` were not deleted.
- `WorkspaceCanvas`, `CommandBar`, `RightPanel`, and `useStudioStore` still type-check. The first three are unmounted.

## Checks already recorded for Phase 1

| Command | Exit |
| --- | --- |
| `pnpm type-check` | 0 |
| `pnpm lint` | 0 (0 errors, 630 existing warnings) |
| `pnpm test` | 1. Only `tests/action-runtime-sql.integration.test.ts` failed: `spawn docker ENOENT`. 471 files passed, 6482 tests passed, 76 skipped. |
| `pnpm build` | 0 |

This document change does not alter runtime code. Those results still cover Phase 1.
