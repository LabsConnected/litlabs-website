# LiTT Design Intelligence Engine

**Status:** Specification (approved direction, 2026-11-26). Partial deterministic pieces exist in the codebase today; the systematic engine is Phase 2 of `IMPLEMENTATION-ROADMAP.md`.

## Purpose

LiTT must recognize bad design before presenting it to customers. The engine replaces one-at-a-time manual rule discovery with a comprehensive, automated design-quality system that behaves like an experienced professional designer, frontend engineer, and QA specialist combined.

## The workflow

1. Understand the customer's business and design requirements.
2. Establish a cohesive visual identity (per customer — never a hardcoded house look).
3. Generate multiple appropriate design variations.
4. Render the actual website.
5. Inspect the rendered site at desktop, tablet, and phone widths.
6. Detect visual and functional defects (check catalogue below).
7. Automatically repair confirmed defects within the authorized scope.
8. Render and verify again.
9. Present the finished design and alternative styles.
10. Preserve previous versions for instant restoration.

## Method

Four evidence sources, combined: (a) deterministic layout/design checks over the page source and computed styles; (b) browser inspection of the rendered page; (c) screenshot analysis; (d) AI design evaluation. **Verification results are never fabricated** — a check that did not run is reported as not run. The engine adapts to the customer's industry, brand, audience, and chosen aesthetic; it must not hardcode any single accent color, trade layout, or generic preference across every website.

Prerequisite infrastructure decision (open): the rendered-inspection steps need a headless render gate (Chromium driven via the terminal-server exec channel, or playwright-core with a pinned Chromium in the shell image). Until that gate exists, rendered checks are limited to the existing static judges.

## Check catalogue

| Check | Detects | State today |
|---|---|---|
| Visual balance | Awkward empty space, uneven layouts, dead voids beside content | Rule approved 2026-11-26 (founder screenshot); not yet automated |
| Color harmony | Excessive accent use, conflicting palettes, clashing accent shades | Rule approved 2026-11-26 (accent discipline; one accent family per page); not yet automated |
| Typography | Inconsistent fonts, sizes, weights; broken type scale | Missing |
| Navigation | Misaligned links/logos/buttons; links off the header baseline; dim low-contrast links | Rule approved 2026-11-26 (header/nav standard); not yet automated |
| Image composition | Poor cropping, empty frames, distortion, images not filling their frame | Rule approved 2026-11-26 (images fill their frame); not yet automated |
| Image relevance | Photos unrelated to the business | Partial: stock selection has no relevance gate today (known gap) |
| Spacing | Inconsistent margins and padding; no spacing system | Missing |
| Responsive design | Broken phone/tablet layouts, clipped headlines | Partial: desktop-only static layout judge exists (`rendered-layout`); phone judging needs the render gate |
| Visual hierarchy | Elements competing for attention; everything shouting | Missing |
| Brand consistency | Mismatched colors and component styles across pages | Missing |
| Accessibility | Poor contrast and readability | Implemented: WCAG AA contrast verifier resolving CSS variables (PR #1123) |
| Content integrity | Incorrect business details, leftover placeholders, raw markup leaking into rendered text | Partial |
| Functional integrity | Broken links, buttons, and forms | Partial: build checks exist; form delivery proof is Phase 6 |
| Layout integrity | Overlapping and clipped elements | Partial: static layout judge (PR #1125) |
| Design originality | Generic, repetitive layouts across customers | Missing |
| Bare-page floor | A build with no real styling presented as finished | Implemented: quality floor fails unstyled pages honestly (PR #1132) |

## Repair scope

Automatic repair is limited to confirmed, mechanical defects within the build's authorized scope (alignment, spacing, contrast-safe color adjustment, image frame fill, overflow). Anything touching content, structure, or taste is proposed to the owner, never silently applied. Every repair is followed by a re-render and re-verification; a repair that cannot be verified is reported as unverified.

## Outputs

- Per-build design report feeding the go-live checklist (see `STUDIO-PRODUCT-SPEC.md`): green = proven, amber = flagged with a fix action, red = failed honestly.
- Defect records with the rendered evidence (width, screenshot region, rule) so a human can confirm every automated claim.
