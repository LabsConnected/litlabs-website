# Implementation Roadmap — Design Program

**Governs:** the LiTT Studio design program defined in `STUDIO-PRODUCT-SPEC.md`. The broader company roadmap remains `PRODUCT_ROADMAP.md`; where the two disagree on design-program scope or status, this document governs and the disagreement is logged in `CAPABILITY-AUDIT.md`.
**Standing rule:** a phase begins only when the previous phase's acceptance criteria (`ACCEPTANCE-CRITERIA.md`) are met AND the founder approves the phase start. No phase interrupts Phase 0.

| Phase | Deliverable | Entry condition |
|---|---|---|
| 0 | Current release acceptance — 10 consecutive successful end-to-end staging runs of the paid-beta journey | In progress (streak 0/10 at seeding; staging frozen per run protocol) |
| 1 | Unified design system — reconcile DESIGN_SYSTEM conflict (C-1); design tokens, spacing, typography as one authority; full capability audit completed | Phase 0 complete + founder approval |
| 2 | Design Intelligence Engine — check catalogue automated; rendered inspection at desktop/tablet/phone (render gate built); scoped auto-repair + re-verify; go-live checklist live | Phase 1 complete |
| 3 | Visual editor + live code split view — WYSIWYG editing, drag-and-drop, layers, inspector, responsive editing, undo/redo, ready-made sections, collapsible approval cards | Phase 2 complete |
| 4 | AI style generator + variations — typed/chip/reference generation, style library, locking, selective regeneration, restyle proposals, design history | Phase 3 complete |
| 5 | Integrated media — in-editor insert/replace from uploads, generation, stock, library; image treatments | Phase 4 complete |
| 6 | Business website functionality — business details hub, provable forms, e-commerce, booking, SEO basics, analytics, custom domains | Phase 5 complete |
| 7 | Community Style Exchange — publish/share/trade/remix with attribution and pre-listing quality screen | Phase 6 complete |
| 8 | Creator economy — style monetization, creator payouts | Phase 7 complete |

**Dependencies that cross phases:** portable style recipes (designed in Phase 1, consumed by Phases 3, 4, 7, 8 — the Exchange must never require a rebuild); the headless render gate (Phase 2 infrastructure decision); the Business details data model (Phase 6, anticipated by editor fields in Phase 3).

## Master ecosystem roadmap (adopted 2026-11-26)

The design-program phases above nest inside the full LiTT roadmap (`UNIFIED-OPERATING-ENVIRONMENT.md`). Mapping: design Phase 0 = ecosystem Phase 0; design Phases 1–2 = ecosystem Phase 5 (with the unified design system feeding Phase 1); design Phase 3 = ecosystem Phase 4; design Phase 4 = ecosystem Phase 5; design Phase 5 = ecosystem Phase 6; design Phase 6 = ecosystem Phase 7 scope (business functionality); design Phase 7 = ecosystem Phase 9; design Phase 8 = ecosystem Phase 10.

| Phase | Product milestone |
|---|---|
| 0 | Stabilize current release (acceptance) |
| 1 | Unified Chat intelligence |
| 2 | Real-time browsing and autonomous execution |
| 3 | Personal memory and connected applications |
| 4 | Professional Studio visual editor |
| 5 | AI design intelligence and style generator |
| 6 | Integrated multimedia creation |
| 7 | Personal and business automation |
| 8 | Cross-device CLI and PocketOS integration |
| 9 | Social marketplace and Style Exchange |
| 10 | Creator economy and monetization |
