# LiTT Landing — Real Asset and Product Manifest

Audited 2026-08-14 against the active `litlabs-website` checkout. Grades describe homepage suitability, not engineering completeness.

## Asset inventory

| Asset | Source | Type | Grade | Homepage location | Use? | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Canonical LiTT motion | `public/brand/litt-alive.mp4` | MP4, 1280×784, 5.125s | A | Hero | YES | Approved black/purple/lime operator; muted loop with poster and reduced-motion-safe fallback. |
| Canonical LiTT poster | `public/brand/litt-alive-poster.webp` | WebP | A | Hero fallback | YES | 30 KB, crisp and correctly matches the approved character. |
| LiTT agent city artwork | `public/brand/litt-agent-hero-v2.png` | PNG | B | Agent/supporting section | NO, this pass | Strong art but too illustrative to prove product execution. |
| LiTT base station | `public/brand/litt-base-station.png` | PNG | C | None | NO | Dense concept UI; should never be represented as a real product screenshot. |
| White/green mascot avatar | `public/brand/litt-mascot-avatar.png` | PNG | B | Legacy UI avatar | NO, homepage | High quality but conflicts with the approved black/purple/lime canonical LiTT. |
| White/green character sheet | `public/brand/litt-mascot-character-sheet.png` | PNG | B | None | NO | Legacy identity and very large (6.1 MB). Keep; do not delete. |
| White/green mascot hero | `public/brand/litt-mascot-hero.original.png` | PNG | B | None | NO | Legacy identity. Keep for archive/supporting uses only. |
| Creative Engine hero | `public/studio/creative-engine-hero.png` | PNG | B | Real surfaces/media | YES | Real repository production artwork; demonstrates media breadth without claiming it is a customer project. |
| Neon Cyber City | `public/gallery/museum/neon-cyber-city.png` | PNG | B | Real surfaces/media | YES | Internal LiTTree LabStudios demo-gallery sample; labeled as such. No fake likes or creator identity used. |
| XQuest cover | `public/games/artwork/xquest.png` | PNG | B | Games proof | YES | Real playable catalog item. Open-source attribution to Scott Rippey/MIT retained. |
| Studio mobile test capture | `tests/playwright/golden-journey.spec.ts-snapshots/studio-after-chat-mobile-chromium-win32.png` | Screenshot | C | None | NO | Authentic UI, but contains cookie overlay and test-user data. Recapture required. |
| Homepage visual snapshot | `tests/playwright/visual.spec.ts-snapshots/homepage-desktop-public-chromium-win32.png` | Screenshot | C | Regression only | NO | Useful for test comparison, not marketing proof. |
| Showcase architecture images | `public/showcase/*.png` | Images | C | Documentation | NO | Helpful explanatory art, not product screenshots. |
| Museum gallery set | `public/gallery/museum/*` | PNG set | B/C | Creative Engine | SELECTIVE | Internal demo fixtures only. Never present as customer uploads or use fixture likes. |
| Game artwork set | `public/games/artwork/*` | PNG/SVG set | B | Games | SELECTIVE | Catalog art. Respect each entry's `status`, license, developer, and attribution in `src/lib/games.ts`. |

## Real product surface ranking

| Surface | Implementation | Grade | Marketing decision |
| --- | --- | --- | --- |
| LiTT Studio shell | `src/components/studio/shell/StudioShell.tsx` plus canvas, rail, inspector, dock, command bar | A- implementation / C capture | Prominent after clean authenticated desktop capture. The current architecture genuinely connects canvas, side rails, inspector, bottom dock, and command bar. |
| LiTT Terminal | `src/components/litt-terminal/LiTTTerminalPage.tsx` | A- implementation / C capture | Hero/supporting proof after clean capture. Real MissionCanvas, project/branch context, scanned files, memory/activity tabs, output, chat, connectors, and wallpaper system exist. |
| Mission runtime | `src/components/litt-director/DirectorRuntime.tsx`, `MissionCanvas.tsx` | B | Use as controlled demo after a real run can be captured and sanitized. |
| Mission control dashboard | `src/components/dashboard/v2/MissionControlDashboard.tsx` | B | Supporting proof after visual cleanup; feature-dense and currently too busy for the hero. |
| Human approvals | `src/app/api/approvals/*`, `packages/litt-agent-core/src/contracts/approval.ts` | A capability / C capture | Claim is supported. Capture the actual approval interaction before presenting visual proof. |
| Files/code | `src/components/litt-terminal/FileExplorer.tsx`, `CodeEditor.tsx`, Studio project resolver and terminal scan APIs | B | Supporting proof once a real project is loaded. |
| Memory | Studio memory service and terminal memory tab | B | Supported capability. Needs a concise, real before/after capture. |
| Provider/BYOK | `src/components/KeyManager.tsx` and provider settings | B | Trust/support section after sensitive values are fully masked in a clean capture. |
| Voice | `src/features/voice/*`, `src/app/voice` | B/C | Real feature; visually promising orb/status system but not central landing proof yet. |
| Mobile companion | `packages/litt-companion` | C | Real implementation, early marketing quality. Keep out of the primary conversion path. |
| Games | `src/lib/games.ts`, game components and `/games` | B | Real catalog. Preserve open-source and inspired-game attribution; do not call third-party games LiTT-built. |
| Image/video/audio | Studio tool components and generation APIs | B | Real product breadth. Use actual user-approved outputs when available; internal samples must remain labeled. |

## Rejected or obsolete homepage material

- The white/green mascot generation is no longer canonical for the public homepage.
- `litt-base-station.png` is concept art, not a product screenshot.
- Demo gallery fixtures and their likes must not be shown as customer/community proof.
- The former homepage creation cards (`Artist Launch Site`, `Small Business Dashboard`, `Music Campaign`) were illustrative simulations and have been removed from the homepage proof section.
- No invented creator identities, customer counts, project counts, testimonials, or deployment URLs are permitted.

## Capture backlog

1. Start the app with a safe marketing/demo account and working Clerk access.
2. Load a real, non-sensitive Studio project.
3. Capture desktop Studio at 1440×900: left rail, canvas, preview, code/files, bottom dock, and LiTT activity visible.
4. Capture LiTT Terminal with repository, branch, runtime state, MissionCanvas, actual commands, and passing verification.
5. Capture an approval request with all account/project secrets removed.
6. Capture provider settings with every key masked.
7. Capture mobile Studio without cookie banners, test IDs, or personal data.
8. Export AVIF/WebP derivatives and retain a 2× source for each final marketing crop.

## Current audit limitation

The local app could not be cleanly captured during this pass because its first render was blocked by local auth/bot middleware, while the existing Studio snapshot contains a cookie modal and test-user content. No bypass or fabricated screenshot was used. The homepage upgrade therefore uses only safe repository media and accurately labeled internal/catalog content.
