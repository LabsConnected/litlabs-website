# Capability Audit — Design Program

**Purpose:** The standing register that keeps "documented", "implemented", and "verified" separate. Seeded 2026-11-26 from verified evidence; the full systematic re-audit of every Studio capability is the entry gate for Phase 1 (see `IMPLEMENTATION-ROADMAP.md`) and remains owed.
**Status key:** Verified / Incomplete / Broken / Missing / Duplicate / Planned.

## Conflicts and duplicates

| ID | Finding | Status | Resolution path |
|---|---|---|---|
| C-1 | `DESIGN_SYSTEM.md` documents "Glass OS" (dark glass, purple AI accents) while the founder-approved standard is LiTT Signature (light default, one green accent #2FBF5A, no pink) and generated customer sites follow per-customer recipes. Two design authorities coexist. | Duplicate | Phase 1 (Unified design system) reconciles: one document of record for the Studio shell, one for generated-site recipes. Flagged, not silently resolved. |
| C-2 | Older roadmap items in `PRODUCT_ROADMAP.md` (P0 list) overlap this program's phases with different status claims (e.g., "Publish: Not started" vs publish verified live 2026-11-25/26). | Duplicate | `IMPLEMENTATION-ROADMAP.md` governs the design program; PRODUCT_ROADMAP statuses to be reconciled during the Phase 1 audit. |

## Design-program capabilities (seed classifications)

Classifications with evidence are in the capability register in `STUDIO-PRODUCT-SPEC.md`. Summary of the honest position at seeding:

- **Verified (staging):** one-approval build scope; checkout and credit accounting on the acceptance journey; checks persistence after the user_id type repair.
- **Incomplete:** AI website generation (works end to end; design quality and acceptance streak unproven — 0 of 10 at seeding, Run 1 in flight); media (panel exists, in-editor insert not built); publish (rollback unrehearsed); Design Intelligence (deterministic pieces only — contrast verifier, static layout judge, bare-page floor).
- **Missing:** WYSIWYG editing, split-view default, drag-and-drop, layers/inspector, responsive editing, editing undo/redo, design history, business details hub, collapsible approval cards.
- **Planned:** style generator + library (Phase 4), locking/selective regeneration/reference generation (Phase 4), provable forms + business functionality (Phase 6), Style Exchange (Phase 7), creator monetization (Phase 8).

## Audit method for the full pass (Phase 1 gate)

For every Studio capability: read the code path, exercise the user-facing flow live (staging), and classify from that evidence only — never from documentation, API presence, or health endpoints. Record: status, dependencies, UX requirements, acceptance criteria, and the verification evidence (run, date, artifact). A capability with no live exercise is at best Incomplete.

## Ecosystem capabilities (seed classifications, 2026-11-26)

Added when the unified operating-environment direction was adopted (`UNIFIED-OPERATING-ENVIRONMENT.md`). The class set gains **Disconnected** (built, but not wired into the unified product) for ecosystem scope.

| Capability | Status | Evidence note |
|---|---|---|
| Live web search with sources (Studio) | Incomplete | Lookup engine owned by a separate lane; not merged |
| Browser agent | Incomplete | Live proof 2026-11-22; Board placement + tab persistence defects open |
| LiTT CLI remote execution | Broken → repair in progress | Root cause proven (workspace-less token refused by isolation gate); fix local-only, unverified end to end |
| PocketOS phone inference | Incomplete | Builder-reported only |
| Personal memory (product) | Incomplete | Foundations exist; unification unverified |
| Media generation from chat | Incomplete | Diagnosis complete (2026-11-17); takeover build outstanding |
| n8n automation | Incomplete | 17 workflows live; alerting SMS path Broken; email alert credential missing |
| Agent swarm | Disconnected | Service alive, queue stale, not wired to Studio jobs |
| E2B sandbox execution | Verified | Template + live build execution |
| Unified Chat intelligence across surfaces | Missing | The objective of the unification phase |
