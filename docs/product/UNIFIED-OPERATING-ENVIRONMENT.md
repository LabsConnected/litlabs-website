# LiTT — Unified Personal AI Operating Environment

**Status:** Approved product direction (founder, 2026-11-26). This is the umbrella vision; the Studio design program (`STUDIO-PRODUCT-SPEC.md`) is one part of it and is preserved intact inside it.
**Positioning:** Ask anything. Build anything. Manage everything.

## The idea

LiTT is not just an AI website builder. It is a personal AI operating environment: **Chat is the central intelligence; Studio is its creative workspace.** One account, one intelligence, many capabilities — the user should not need ten different applications to get something done.

LiTT Chat combines a conversational agent, a live browser agent, a coding agent, and a personal assistant. Around it sit: the live browser, Studio, the personal-assistant tools, LiTT CLI and PocketOS, media creation, and business automation (n8n) — all sharing memory and context, all passing through one permissions and execution gateway, all producing verification and activity history the user can inspect.

## Required capabilities

- Real-time web search with citations; deep research and synthesis.
- Interactive browser navigation and computer use, with a live browser view and user takeover at any moment.
- Persistent personal memory and project context, appropriately scoped per surface.
- Intelligent tool selection and model routing; multi-step autonomous task execution; specialized agent delegation and handoffs.
- Local and cloud execution: LiTT CLI and PocketOS integration; secure sandbox execution (E2B).
- File and document management; email, calendar, and connected applications.
- Scheduled and recurring automation; persistent background jobs with progress reporting.
- Voice and multimodal interaction (images, documents, audio, video).
- Website and application creation through Studio (the design program).
- Image, video, audio, and music creation.
- Cancellation, recovery, and resumable tasks; granular permissions and approval controls for consequential actions.

## Architecture requirements

- All capabilities share ONE intelligence layer, ONE permission system, ONE execution gateway, and appropriately scoped context. No separate disconnected assistants per feature.
- Use existing implementations before creating anything new.
- Never fabricate browsing, research, execution, verification, or completion.
- The user can always see what the agent is doing, stop it, approve consequential actions, and take control.
- No unnecessary infrastructure costs (standing founder directive, 2026-11-25).

## Foundations — honest status at adoption (2026-11-26)

Classes: Verified / Incomplete / Broken / Disconnected / Duplicated / Missing. Detail lives in `CAPABILITY-AUDIT.md`.

| System | Status | Note |
|---|---|---|
| Studio | Incomplete | Built; paid-beta acceptance in progress (Phase 0) |
| Browser agent + panel | Incomplete | Core proven live 2026-11-22; known Board defects (opens behind panels, tabs lost on reload) |
| LiTT CLI | Incomplete | Built; remote workspace-token defect diagnosed, repair implemented locally, end-to-end verification outstanding; Android fix local-only |
| PocketOS (phone) | Incomplete | Reported operational by its builder lane; not independently verified |
| Model routing | Incomplete | Routing exists; mid-build provider fallback observed live 2026-11-26 |
| Personal memory | Incomplete | Foundations exist; unified product integration unverified |
| Media generation | Incomplete | Generation exists in Studio flows; chat-driven Media control diagnosed, not fully built |
| Missions + automation (n8n) | Incomplete | n8n live (17 workflows); SMS alert path Broken (carrier account inactive); swarm Disconnected (idle) |
| Secure E2B execution | Verified | Sandbox template live; builds execute in E2B |
| Unified assistant (one intelligence across all surfaces) | Missing → Planned | The unification objective of this document |

**The next major objective is unification and verification, not more disconnected features.** Having endpoints, packages, and interfaces does not mean a capability works end to end; the capability audit (see `CAPABILITY-AUDIT.md`) is the instrument, and live end-to-end evidence is the only proof.
