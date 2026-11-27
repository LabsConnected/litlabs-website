# Acceptance Criteria — Design Program

Phase gates for `IMPLEMENTATION-ROADMAP.md`. The paid-beta journey criteria live in the acceptance mission documentation and `ACCEPTANCE_TEST_MATRIX.md`; this file adds the design program's gates. A criterion is met only with live evidence (a run, a recording, a rendered screenshot), never by code presence alone.

## Phase 0 — Release acceptance
- 10 consecutive successful end-to-end staging runs of the paid-beta journey (build → checks → publish → styled live page), restarting at Run 1 after any repair deploy.
- Each run: exactly one build approval; balances exact; checks persisted and reported truthfully (loud note when checks cannot run); published page is styled (bare page = failed run).

## Phase 1 — Unified design system
- One design authority document for the Studio shell and one for generated-site recipes; conflict C-1 closed.
- Full capability audit delivered in `CAPABILITY-AUDIT.md` using the audit method defined there.

## Phase 2 — Design Intelligence Engine
- Every catalogue check in `DESIGN-INTELLIGENCE.md` runs on a real build and reports from rendered evidence at desktop, tablet, and phone widths.
- Seeded defect suite: the engine flags the known defect classes (sloppy nav alignment, image not filling frame, accent overuse, off-topic image, bare page, clipped phone headline) on purpose-built fixtures, with zero fabricated passes.
- Scoped auto-repair demonstrably fixes a seeded mechanical defect and re-verifies it; out-of-scope defects are proposed, not applied.

## Phase 3 — Visual editor + split view
- Owner edits a published-quality page end to end without touching code: move a section, rewrite a headline inline, restyle via inspector, undo twice, redo once — all saved to the project's real files and reflected in preview.
- Opening a page file shows code + live page split by default; edits reflect live; no empty placeholder panes.
- Phone-width editing changes phone styling only; desktop rendering unchanged.
- Decided approval cards collapse to one line and re-expand on demand.

## Phase 4 — Style generator
- One typed description produces at least four distinct full-page variations of the same content; words, prices, and photos provably unchanged across variations.
- Applying a look, then restoring the previous look, then returning forward, all work from design history.
- Locked sections are byte-identical after a full-page regeneration.

## Phase 5 — Media
- From the editor, the owner inserts an uploaded photo, a generated image, and a stock image into sections; each lands in the project files and renders in preview and published page.

## Phase 6 — Business functionality
- Changing the phone number in the Business details hub updates every occurrence on the site (header, contact, footer) with no other edits.
- Contact form test send arrives in the owner's email; the checklist shows the proof before publish.

## Phase 7 — Style Exchange
- A style published by one account previews on a second account's own content and applies without altering that content; remix preserves the original maker's credit; a style failing the readability screen is refused listing with the reason shown.

## Phase 8 — Creator economy
- A priced style purchase settles to the creator's balance with a complete, auditable record; refunds reverse cleanly.
