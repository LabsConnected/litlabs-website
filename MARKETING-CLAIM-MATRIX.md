# LiTT V1 Marketing Claim Matrix

Generated: 2026-08-20
Source: https://www.litlabs.net landing page + codebase audit

## Legend
- GREEN = claim is implemented + tested + live proof exists
- YELLOW = claim is implemented but missing tests or proof (or marked beta)
- RED = claim is not implemented or is pure marketing with no backing

## Claim Matrix

| Claim | Implementation | Tests | Live Proof | Status |
|-------|----------------|-------|------------|--------|
| "Not a chat. An operating system" | Core OS architecture in litt-kernel, litt-runtime, mission-control | 30+ test files in agent-core | Studio live at /studio | GREEN |
| "Start building" CTA | Links to /sign-up | Playwright landing.spec.ts | Sign-up flow live | GREEN |
| Mission workflow (MissionSequence) | mission-service.ts, mission-repository.ts, mission-executor.ts | mission-*.test.ts (30+ files) | Missions table in Supabase, /api/missions/* | GREEN |
| Human approvals | approval-system.ts with ApprovalManager, risk levels | sec4-approval-runtime.test.ts | /api/missions/approvals, approval UI in Studio | GREEN |
| Real files and assets | project-repository.ts, workspace-recovery.ts | StudioProjectFiles.test.tsx | Studio file browser live, Supabase storage | GREEN |
| Project memory / context | context-engine.ts, user-context.ts, conversation persistence | user-context.test.ts | Conversations persist across sessions | GREEN |
| Version history / checkpoints | workspace-checkpoint.ts, git commit integration | resume-checkpoint.test.ts, phase3d-mission-persistence.test.ts | /api/studio-projects/[id]/checkpoints, rollback API | GREEN |
| Export and ownership | /api/account/export, project download tools | Export tests in src/lib/projects/ | Export available in Studio | GREEN |
| Launch workflow / deployment | deployments.ts, GitLab/Vercel integration | studio-destinations.test.ts | Deployments table, deployment tracking live | GREEN |
| Model selection / BYOK | studio-models.ts, LITT_MODEL_ALIASES, BYOK category | useStudioModelStore.test.ts | Model picker in Studio, BYOK UI | GREEN |
| LiTBits accounting | product-truth.ts, LITTBITS_TERMINOLOGY, CREDIT_POLICY | Billing tests, product truth contract tests | Wallet page at /wallet, Stripe integration | GREEN |
| Voice mode | voice-runtime.ts, voice-session-service.ts, LiveKit integration | realtime.test.ts | Voice mode UI in Studio, /api/voice/* | YELLOW (beta) |
| Games pipeline | games.ts, retro-arcade.ts, /games page | RetroControlsModal.test.tsx | Games page live at /games | GREEN |
| Multi-agent crews | agent-registry.ts, /agents page, CORE_PERSONALITIES | agent-loop-*.test.ts | Agents page live at /agents | GREEN |
| Marketplace | /marketplace page, AgentCard components | marketplace.spec.ts | Marketplace live at /marketplace | GREEN |
| Cloud handoff | terminal-server, workspace-service.ts, terminal-client.ts | terminal.spec.ts, terminal-live.spec.ts | Terminal server live, workspace handoff functional | GREEN |
| Product demonstrations (RealCreations) | Component explicitly marked "illustrative simulations" | N/A (simulations) | Links to /showcase/* (demos, not real projects) | YELLOW (disclosed) |
| "Free to join" | Starter plan, 500 one-time credits, no CC required | Billing tests verify free tier | Sign-up works without CC | GREEN |
| "No credit card required" | Starter plan checkout without payment method | Billing tests | Confirmed | GREEN |
| "Your work stays yours" | Export functionality, ownership in product-truth.ts | Export tests | Export available, privacy policy at /privacy | GREEN |

## Summary

- **GREEN**: 17 claims
- **YELLOW**: 2 claims (voice mode = beta, product demonstrations = disclosed simulations)
- **RED**: 0 claims

## Notes

- Voice mode is honestly marked as "beta" in product-truth.ts
- RealCreations component honestly discloses "illustrative simulations" (not real deployed projects)
- No pure marketing claims without implementation backing were found
- The landing page is highly truthful — claims map to real implementations

## Recommendations

1. Upgrade voice mode to GREEN once it exits beta (needs tests + live proof)
2. Add real project examples to replace/supplement illustrative simulations
3. Expand E2E tests for full mission-to-deployment pipeline
4. Document checkpoint rollback feature for users
5. Showcase actual live URLs deployed through the platform
