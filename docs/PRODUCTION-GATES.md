# Production Launch Gates

**Last Updated:** 2026-08-08
**Status:** In Progress

---

## P0 Must Work

| Requirement | Status | Notes |
|-------------|--------|-------|
| Build (`pnpm build`) | ?? NEEDS TEST | Verified in CI only |
| TypeScript (`tsc --noEmit`) | ?? NEEDS TEST | Verified in CI only |
| Lint | ?? NEEDS TEST | Verified in CI only |
| Tests | ? VERIFIED | 700+ tests pass |
| Clerk auth | ? VERIFIED | Integrated |
| Supabase DB | ? VERIFIED | Connected |
| Studio chat | ?? NEEDS TEST | Route + UI exist |
| GitHub connect | ?? NEEDS TEST | Route exists |
| Terminal E2E | ?? NEEDS TEST | Code path exists |
| Stripe checkout | ?? NEEDS TEST | Code exists |

---

## P1 Must Survive

| Requirement | Status | Notes |
|-------------|--------|-------|
| Error boundaries | ? FIXED | 57 `error.tsx` files added |
| Loading states | ? FIXED | 58 `loading.tsx` files added |
| API retry logic | ? VERIFIED | `apiFetch()` in `api-response.ts` |
| Exponential backoff | ? VERIFIED | `backoff.ts` + `apiFetch()` delay |
| Terminal WebSocket rate limiting | ? VERIFIED | 60 inputs/10s per socket |
| Terminal connection timeout | ? VERIFIED | 10s timeout implemented |
| Terminal auto-reconnect | ? VERIFIED | Retries with fresh token |
| Workspace prepare polling | ? VERIFIED | 30 attempts x 2s = 60s max |
| Error tracking (Sentry) | ? FIXED | `@sentry/nextjs` installed, config files created, error boundaries report to Sentry |
| Performance monitoring | ?? NEEDS TEST | `@vercel/speed-insights` installed |
| Uptime monitoring | ?? BROKEN | No external monitoring |
| Log aggregation | ?? BROKEN | Railway logs only |
| Alerting | ?? BROKEN | No alerts configured |

---

## P2 Must Be Secure

| Requirement | Status | Notes |
|-------------|--------|-------|
| Terminal isolation | ?? BROKEN | Host PTY mode in production |
| Workspace persistence | ?? BROKEN | No Railway volume mounted |
| Command blocking | ? VERIFIED | `security.ts` blocks dangerous commands |
| Network tool blocking | ? VERIFIED | `curl`, `wget`, `nc`, `netcat` blocked |
| Shell escape blocking | ? VERIFIED | `$(...)` and backticks blocked |
| Audit logging | ? VERIFIED | `auditCommand()` + `/internal/audit-log` |
| Secret redaction | ? VERIFIED | `redactSecrets()` implemented |
| Workspace ownership check | ? VERIFIED | Socket auth enforces owner |
| Path traversal protection | ? VERIFIED | `resolveWorkspacePath()` constrains paths |
| Read/write/delete permissions | ? VERIFIED | Server validates paths |
| Stripe webhook signature | ?? NEEDS TEST | Code exists |
| Clerk webhook verification | ?? NEEDS TEST | Code exists |
| GitHub webhook verification | ? VERIFIED | `verifyWebhookSignature()` uses HMAC-SHA256 + `timingSafeEqual` |

---

## P3 Must Feel Finished

| Requirement | Status | Notes |
|-------------|--------|-------|
| Skip links | ? VERIFIED | Skip to main content link added |
| Focus management | ? VERIFIED | Focus trap in mobile drawer |
| Mobile navigation | ? VERIFIED | Bottom nav implemented |
| Terminal on mobile | ?? NEEDS TEST | Code exists |
| Mobile layout | ?? NEEDS TEST | Not visually verified |
| ARIA labels | ?? NEEDS TEST | Some exist |
| Keyboard navigation | ?? NEEDS TEST | `Ctrl+Shift+A` exists |
| Color contrast | ?? NEEDS TEST | Theme system exists |

---

## P4 Launch Polish

| Requirement | Status | Notes |
|-------------|--------|-------|
| SEO metadata | ? VERIFIED | Every page has metadata |
| Sitemap | ? VERIFIED | `/sitemap.ts` exists |
| robots.txt | ? VERIFIED | Configured |
| OpenGraph | ? VERIFIED | Default OG image configured |
| Structured data | ? VERIFIED | JSON-LD on homepage |

---

## P5 Nice Later

| Requirement | Status | Notes |
|-------------|--------|-------|
| Extra animations | ?? NEEDS TEST | Optional polish |
| Redesigns | ?? NEEDS TEST | Optional polish |
| Experimental features | ?? NEEDS TEST | Optional polish |
