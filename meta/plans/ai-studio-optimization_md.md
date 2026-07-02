---
SECTION_ID: plans.ai-studio-optimization_md
TYPE: plan
STATUS: in_progress
PRIORITY: high
---

# AI Studio Optimization — Implementation Plan

## Summary
Short plan to implement the "AI Studio & Performance Optimization" PRD. Saved as meta plan so agents and humans can pick it up.

## Steps
1. Code hygiene (2 days)
   - Refactor `src/lib/agents.ts` and all tools to import and use `src/lib/llm.ts`.
   - Add unit tests verifying `llm.ts` call paths.
2. Health & Observability (1 day)
   - Implement `/api/llm/health` with Redis caching.
   - Expose provider telemetry and Prometheus metrics.
3. UX (2 days)
   - Navbar provider chip with localStorage persistence.
   - AgentTool provider dropdown and ModelBadge reactivity.
   - Wire `/api/wallet` coin badge.
4. Performance (3 days)
   - Run Lighthouse, fix LCP/CLS/TTFB: image optimization, code-splitting, defer analytics.
   - Add Lighthouse CI and PR gating.
5. QA & Rollout (2 days)
   - E2E tests, monitoring alerts, staged rollout behind feature flags.

## Owners
- Frontend: Jace
- Backend: Backend team
- Design: Lumi

## Deliverables
- PRD (prds/ai-studio-optimization.md)
- Implementation PRs for each milestone
- Lighthouse baseline report (attached to first PR)

## Notes
- Ensure all secrets (OPENROUTER_API_KEY, GEMINI keys) are in repo secrets and not in dotfiles.
- Add small budget guardrails around expensive model usage.
