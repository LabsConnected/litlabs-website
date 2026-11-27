# LiTT Studio — Product Specification (Design Program)

**Status:** Approved direction, preserved 2026-11-26 by Larry Bol (Founder).
**Provenance:** Consolidated from Larry's own approvals in the 2026-11-26 design session (page editor, style generator, Style Exchange, design-quality rules) and his adopted product-vision framework of the same date.
**Companion documents:** `DESIGN-INTELLIGENCE.md` (automated design-quality engine), `CAPABILITY-AUDIT.md` (status register), `IMPLEMENTATION-ROADMAP.md` (phase order), `ACCEPTANCE-CRITERIA.md` (phase gates), `DESIGN_SYSTEM.md` (existing shell design doc — under reconciliation, see CAPABILITY-AUDIT conflict entry C-1).

## Governing principles

1. **The owner never needs the technical name of a problem.** LiTT acts as senior product designer, UX architect, frontend engineer, and QA specialist. The owner points and says "this looks off"; LiTT names it, specifies it, and turns it into an automated check.
2. **AI-first.** Manual editing is the fine-tuner, never the only path. Users generate, compare, customize, restore, and remix complete designs or single sections in natural language.
3. **Content is sacred.** Restyles, regeneration, and repairs preserve the customer's words, prices, photos, and business facts unless the owner explicitly instructs a change.
4. **Documented does not mean implemented. Implemented does not mean verified. Healthy does not mean functional.** Every capability carries one status: Verified / Incomplete / Broken / Missing / Duplicate / Planned — with evidence.
5. **No fake success.** Checks that cannot run say so loudly. A bare, unstyled page is a failure, never a finished build.
6. **Publishing is always a separate, explicit owner action.** Editing, generating, and previewing never deploy.

## Product architecture (required)

- AI-first website generation from a plain-language brief.
- Direct WYSIWYG page editing on the real page (Canvas & Design surface): click-to-select, drag to move (never off-screen), double-click inline text editing, floating element toolbar.
- Split-view editing: page source code and the live rendered page side by side by default when a page file is open; code edits reflect live; divider position persists. No dead empty panes.
- Layers/sections panel (page structure in order, drag to rearrange) and a contextual properties inspector (text, font, size, color, spacing, image) with plain labels.
- Responsive editing at desktop, tablet, and phone widths; phone-specific styling saved distinctly so phone fixes never wreck desktop.
- Undo/redo across all editing actions; checkpoints and full design history ("Your looks") with one-tap restore in either direction.
- AI design generator: type a look in plain words, tap a style chip, paste a reference link, or upload a reference screenshot; receive multiple full-page variations of the SAME content; preview at all widths; apply with one tap.
- Style library: portable design recipes (fonts, colors, spacing, shapes, component styling) that adapt to content and trade; seeded per business type from the topic packs; grows over time. A style is a recipe only — no executable code ever travels with a style.
- Design locking (protect elements/sections the owner likes from regeneration) and selective regeneration (redesign only the selected section or element).
- One-tap restyle proposal: current vs proposed shown side by side; nothing changes until the owner approves.
- Business details hub: name, phone, email, hours, address stored once; every occurrence on the site renders from that single source.
- Ready-made sections: gallery, testimonials, map + hours, contact form, menu/price list, about/story, call-to-action — inserted styled to match the page.
- Media: uploads (phone/computer), AI generation from chat, stock, and the Media library all insert directly into any section from the editor; image replacement in place.
- Contact forms that provably deliver: one-tap test send to the owner's email; delivery state shown honestly.
- Go-live checklist before publishing: form delivery proven, phone layout checked, real design present, image relevance, page title/description, address/domain state. Green means proven; amber means flagged with a fix action; publishing with an amber remains the owner's call.
- Verified publishing with rollback to any previous published version.
- Approval cards in chat: full scope wording while a decision is pending; once decided, the card collapses to a one-line record (what it was + the decision), expandable on demand.
- Community Style Exchange (Marketplace): publish, share, trade, and sell styles; preview any style on your own content before taking it; remix with credit to the original maker; creator profiles, collections, ratings, versioning; every published style passes a readability/contrast screen before listing.

## Capability register

Status key: **V** Verified · **I** Incomplete · **B** Broken · **M** Missing · **D** Duplicate · **P** Planned

| Capability | Status | Depends on | Acceptance evidence |
|---|---|---|---|
| AI website generation (brief → files → preview) | I | Agent loop, sandbox, preview | Staging acceptance runs 2026-11-25/26; streak in progress (Phase 0) |
| One-approval build scope | V (staging) | Approval system | Staging runs 2026-11-25/26: exactly one build approval per run |
| Build checks persist + loud note when checks cannot run | I | project_check_runs (text user_id) | PRs #1123, #1125, #1129, #1132; staging verification in progress |
| WYSIWYG direct page editing | M | Canvas & Design surface | Spec only (this document set) |
| Split-view code + live page (default for page files) | M | Code surface, live preview | Spec only; founder ruling 2026-11-26 |
| Drag-and-drop sections/elements with off-screen clamp | M | WYSIWYG editor | Spec only |
| Layers/sections panel + properties inspector | M | WYSIWYG editor | Spec only |
| Responsive editing (desktop/tablet/phone) | M | WYSIWYG editor | Spec only |
| Undo/redo for page editing | M | Editor state model | Spec only |
| Design history / Your looks / restore | M | Portable style recipes | Spec only |
| AI style generator + variations | P (Phase 4) | Style recipes, render pipeline | Spec only |
| Style library (trade-seeded recipes) | P (Phase 4) | Topic packs (20, in main via PR #1121) | Spec only |
| Design locking + selective regeneration | P (Phase 4) | Generator | Spec only |
| Reference-link / screenshot style generation | P (Phase 4) | Generator | Spec only |
| One-tap restyle proposal | P (Phase 4) | Generator | Spec only |
| Business details hub | P (Phase 6) | Project data model | Spec only |
| Ready-made sections | P (Phase 3) | Editor, style recipes | Spec only |
| Media insert from editor (upload/generate/stock/library) | I | Media panel (exists), editor | Media panel verified in Studio; in-editor insert spec only |
| Provable contact form (test send) | P (Phase 6) | Mail delivery path | Spec only |
| Go-live checklist | P (Phase 2/3) | Design Intelligence Engine | Spec only |
| Verified publish + rollback | I | Deployments | Publish verified on staging/production; rollback path unrehearsed |
| Collapsible decided approval cards | M | Chat approval UI | Founder ruling 2026-11-26; spec only |
| Style Exchange (share/trade/remix) | P (Phase 7) | Marketplace, style recipes | Spec only |
| Creator monetization for styles | P (Phase 8) | Exchange, payments | Spec only |
| Customer-site e-commerce / booking / analytics | P (Phase 6) | Business functionality | Spec only |

## Non-goals until later phases

Animations/effects libraries, theme stores, and decorative extras are out of scope until the basics are flawless (founder's declutter rule). Music and game tooling are parked; the focus is apps and websites.
