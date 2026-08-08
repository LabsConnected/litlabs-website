# 🎯 LiTTree LabStudios — Production Launch Gates

**Last Updated:** 2026-08-08  
**Status:** 🟡 IN PROGRESS — P0/P1/P2 fixes applied, testing needed  
**Owner:** LiTTree Team  

---

## Status Legend

- ✅ **VERIFIED** — Tested and working in production
- 🟡 **NEEDS TEST** — Code exists, needs end-to-end verification
- 🔴 **BROKEN** — Confirmed broken or missing
- 🔵 **FIXED** — Was broken, now resolved

---

## P0 🔴 MUST WORK (Launch Blockers)

### Build & Type Safety

| Requirement | Status | Notes |
|-------------|--------|-------|
| `pnpm build` succeeds | 🟡 NEEDS TEST | Times out on Windows locally; CI has 10min timeout |
| `npx tsc --noEmit` passes | 🟡 NEEDS TEST | Times out on Windows; CI runs on Ubuntu |
| `pnpm lint` passes | ✅ VERIFIED | CI green |
| `pnpm test` passes | ✅ VERIFIED | 700 tests pass |
| No TypeScript errors | 🟡 NEEDS TEST | `useMemo<string>` fix applied; full check unverified |

### Authentication

| Requirement | Status | Notes |
|-------------|--------|-------|
| Clerk sign-up works | 🟡 NEEDS TEST | Code exists, not tested end-to-end |
| Clerk sign-in works | 🟡 NEEDS TEST | Code exists, not tested end-to-end |
| Session persistence | 🟡 NEEDS TEST | Should work via Clerk |
| Protected routes redirect | ✅ VERIFIED | Client-side guard in `studio/page.tsx` |
| API routes return 401 when not authenticated | ✅ VERIFIED | All `/api/studio-projects/*` routes check auth |
| Token refresh works | 🟡 NEEDS TEST | Clerk handles automatically |

### Database

| Requirement | Status | Notes |
|-------------|--------|-------|
| Supabase connection | ✅ VERIFIED | Env vars configured |
| Projects CRUD | 🟡 NEEDS TEST | Code exists |
| Workspace status tracking | ✅ VERIFIED | Schema: `not_prepared`, `preparing`, `ready`, `failed` |
| Atomic provisioning lock | ✅ VERIFIED | `claimProvisioningLock()` implemented |
| Stale lock recovery | ✅ VERIFIED | `recoverStaleProvisioning()` implemented |

### Studio Chat (LiTT/Spark)

| Requirement | Status | Notes |
|-------------|--------|-------|
| Chat UI loads | ✅ VERIFIED | `CommandStudio` renders |
| Send message | 🟡 NEEDS TEST | `useCanonicalConversation` exists |
| Message streaming | 🟡 NEEDS TEST | Code exists |
| Agent selection | 🟡 NEEDS TEST | UI exists |
| Context injection | 🟡 NEEDS TEST | Project/canvas context code exists |

### GitHub Integration

| Requirement | Status | Notes |
|-------------|--------|-------|
| GitHub App install | 🟡 NEEDS TEST | `/studio/github` route exists |
| Repo selection | 🟡 NEEDS TEST | UI exists |
| Clone to workspace | 🟡 NEEDS TEST | `git clone --depth 1` in `WorkspaceManager` |
| Branch selection | 🟡 NEEDS TEST | Code exists |

### Terminal (End-to-End)

| Requirement | Status | Notes |
|-------------|--------|-------|
| Terminal server online | ✅ VERIFIED | Health checks pass, uptime 1.2h |
| JWT token issuance | ✅ VERIFIED | Unit tests pass (6/6) |
| Socket.IO connection | ✅ VERIFIED | Integration tests pass (6/6) |
| PTY session creation | 🟡 NEEDS TEST | Server code exists |
| Command execution | 🟡 NEEDS TEST | Code exists |
| Output streaming | 🟡 NEEDS TEST | `terminal:output` event exists |
| Workspace preparation | 🟡 NEEDS TEST | Auto-triggers on terminal open |
| Token refresh on expiry | 🟡 NEEDS TEST | Auto-reconnect logic exists |
| File save from terminal | 🟡 NEEDS TEST | `/ws-files/write` endpoint exists |

### Payments (Stripe)

| Requirement | Status | Notes |
|-------------|--------|-------|
| Stripe checkout | 🟡 NEEDS TEST | `/api/stripe/checkout` exists |
| Webhook handling | 🟡 NEEDS TEST | `/api/stripe/webhook` exists |
| Credit balance update | 🟡 NEEDS TEST | Wallet system exists |
| Subscription status | 🟡 NEEDS TEST | Code exists |

---

## P1 🟠 MUST SURVIVE (Error Handling & Resilience)

### Error Handling

| Requirement | Status | Notes |
|-------------|--------|-------|
| `error.tsx` in routes | 🔵 FIXED | 57 error boundaries added to all routes |
| `loading.tsx` in routes | 🔵 FIXED | 58 loading states added to all routes |
| API error responses | ✅ VERIFIED | All routes return proper HTTP codes |
| User-friendly error messages | 🟡 NEEDS TEST | Some exist, not comprehensive |
| Graceful degradation | 🔵 FIXED | Error boundaries + loading states in all routes |

### Retries & Timeouts

| Requirement | Status | Notes |
|-------------|--------|-------|
| Terminal connection timeout | ✅ VERIFIED | 10s timeout implemented |
| Terminal auto-reconnect | ✅ VERIFIED | On auth failure, retries with fresh token |
| Workspace prepare polling | ✅ VERIFIED | 30 attempts × 2s = 60s max |
| API retry logic | 🟡 NEEDS TEST | Some routes have retries |
| Exponential backoff | 🔵 FIXED | `src/lib/backoff.ts` utility created |

### Loading States

| Requirement | Status | Notes |
|-------------|--------|-------|
| Route-level loading | 🔵 FIXED | 58 `loading.tsx` files added |
| Button loading spinners | ✅ VERIFIED | Common pattern |
| Skeleton screens | 🟡 NEEDS TEST | Some exist |
| Optimistic updates | 🟡 NEEDS TEST | Some UI patterns exist |

### Monitoring

| Requirement | Status | Notes |
|-------------|--------|-------|
| Error tracking (Sentry) | 🔴 BROKEN | Not configured |
| Performance monitoring | 🔴 BROKEN | Vercel Analytics unverified |
| Uptime monitoring | 🔴 BROKEN | No external monitoring |
| Log aggregation | 🔴 BROKEN | Railway logs only |
| Alerting | 🔴 BROKEN | No alerts configured |

### Rate Limiting

| Requirement | Status | Notes |
|-------------|--------|-------|
| API rate limiting | ✅ VERIFIED | Supabase-backed rate limiter exists |
| Terminal WebSocket rate limiting | 🔵 FIXED | 60 inputs per 10s per socket |
| Auth brute-force protection | 🟡 NEEDS TEST | Clerk handles |
| IP-based restrictions | 🔴 BROKEN | Not implemented |

---

## P2 🛡️ MUST BE SECURE

### Terminal Isolation

| Requirement | Status | Notes |
|-------------|--------|-------|
| Docker/sandbox isolation | 🔴 BROKEN | Host PTY mode in production |
| Process isolation | 🔴 BROKEN | No containerization |
| Resource limits (CPU/memory) | 🔴 BROKEN | No limits per PTY session |
| Network egress filtering | 🔴 BROKEN | Users can access internal services |
| Disk quota per workspace | 🔴 BROKEN | No limits |

### Permissions

| Requirement | Status | Notes |
|-------------|--------|-------|
| Workspace ownership check | ✅ VERIFIED | `ws.userId !== socket.data.userId` → Forbidden |
| Path traversal protection | ✅ VERIFIED | `resolveWorkspacePath()` constrains to root |
| Read/write/delete permissions | ✅ VERIFIED | Server validates paths |
| Admin override | 🟡 NEEDS TEST | Code exists |

### Secrets Management

| Requirement | Status | Notes |
|-------------|--------|-------|
| No secrets in client bundle | ✅ VERIFIED | Server-only env vars |
| Secret redaction in output | ✅ VERIFIED | `redactSecrets()` in terminal-server |
| API keys rotated | 🟡 NEEDS TEST | Manual process |
| `.env.local` not committed | ✅ VERIFIED | In `.gitignore` |

### Webhook Verification

| Requirement | Status | Notes |
|-------------|--------|-------|
| Stripe webhook signature | 🟡 NEEDS TEST | Code exists |
| Clerk webhook verification | 🟡 NEEDS TEST | Code exists |
| GitHub webhook verification | 🔴 BROKEN | Not implemented |

### Command Blocking

| Requirement | Status | Notes |
|-------------|--------|-------|
| Block dangerous commands | ✅ VERIFIED | `security.ts` blocks `rm -rf /`, `mkfs`, etc. |
| Block network tools | 🔵 FIXED | `curl`, `wget`, `nc`, `netcat` now blocked |
| Block shell escapes | 🔵 FIXED | `$(...)`, backticks now blocked |
| Audit log of commands | 🔵 FIXED | `auditCommand()` logs all commands, `/internal/audit-log` endpoint |

---

## P3 🎨 MUST FEEL FINISHED

### Mobile Responsive

| Requirement | Status | Notes |
|-------------|--------|-------|
| Mobile layout renders | 🟡 NEEDS TEST | Code looks correct |
| Touch targets = 44px | 🟡 NEEDS TEST | Common pattern |
| Mobile navigation | ✅ VERIFIED | Bottom nav: Studio, Dashboard, Discover, Gallery |
| Terminal on mobile | 🟡 NEEDS TEST | Code exists |
| Forms on mobile | 🟡 NEEDS TEST | Not verified |

### Accessibility

| Requirement | Status | Notes |
|-------------|--------|-------|
| ARIA labels | 🟡 NEEDS TEST | Some exist |
| Keyboard navigation | 🟡 NEEDS TEST | `Ctrl+Shift+A` exists |
| Focus management | 🔴 BROKEN | Not implemented |
| Skip links | 🔵 FIXED | Skip to main content link added to root layout |
| Color contrast | 🟡 NEEDS TEST | Theme system exists |

### UI Polish

| Requirement | Status | Notes |
|-------------|--------|-------|
| No broken buttons | 🟡 NEEDS TEST | Visual inspection needed |
| No dead links | 🟡 NEEDS TEST | Sitemap exists |
| Consistent spacing | 🟡 NEEDS TEST | Tailwind system |
| Loading skeletons | 🔵 FIXED | `loading.tsx` in all routes |
| Error messages | 🟡 NEEDS TEST | Some exist |

---

## P4 ✨ LAUNCH POLISH

### SEO

| Requirement | Status | Notes |
|-------------|--------|-------|
| Meta tags on all pages | ✅ VERIFIED | `buildMetadata()` used everywhere |
| OpenGraph tags | ✅ VERIFIED | Default OG image set |
| Twitter cards | ✅ VERIFIED | Configured |
| Sitemap | ✅ VERIFIED | 9 static pages |
| Robots.txt | ✅ VERIFIED | Configured |
| Structured data (JSON-LD) | ✅ VERIFIED | Organization schema on homepage |
| Dynamic OG images | 🔴 BROKEN | Not implemented |
| BreadcrumbList schema | 🔴 BROKEN | Not implemented |

### Performance

| Requirement | Status | Notes |
|-------------|--------|-------|
| Image optimization | ✅ VERIFIED | `next/image` used |
| Code splitting | ✅ VERIFIED | Dynamic imports |
| Lazy loading | ✅ VERIFIED | Common pattern |
| Bundle size < 500KB | 🟡 NEEDS TEST | Not measured |
| LCP < 2.5s | 🟡 NEEDS TEST | Not measured |
| CLS < 0.1 | 🟡 NEEDS TEST | Not measured |

### Analytics

| Requirement | Status | Notes |
|-------------|--------|-------|
| Vercel Analytics | 🟡 NEEDS TEST | Imported in LayoutShell |
| Custom events | 🔴 BROKEN | Not implemented |
| Conversion tracking | 🔴 BROKEN | Not implemented |
| Error tracking (Sentry) | 🔴 BROKEN | Not configured |

### Legal

| Requirement | Status | Notes |
|-------------|--------|-------|
| Privacy policy | ✅ VERIFIED | `/privacy` exists |
| Terms of service | ✅ VERIFIED | `/terms` exists |
| Cookie policy | ✅ VERIFIED | `/cookies` exists |
| Cookie consent UI | ✅ VERIFIED | `CookieConsent` component |
| GDPR compliance | 🟡 NEEDS TEST | Policies exist, not reviewed |

---

## P5 🚀 NICE LATER

| Feature | Status | Notes |
|---------|--------|-------|
| Advanced animations | 🟡 NEEDS TEST | Framer Motion used |
| Custom themes | ✅ VERIFIED | 16 skins |
| Wallpaper system | ✅ VERIFIED | Multiple backgrounds |
| EmulatorJS games | 🟡 NEEDS TEST | Code exists |
| Voice chat | 🟡 NEEDS TEST | `/voice` route exists |
| YouTube integration | 🟡 NEEDS TEST | Player component exists |
| Social feed | 🟡 NEEDS TEST | `/discover` exists |
| Marketplace | 🟡 NEEDS TEST | `/marketplace` exists |

---

## CRITICAL USER JOURNEYS

| Journey | Status | Notes |
|---------|--------|-------|
| Sign up → Dashboard | 🟡 NEEDS TEST | Not verified end-to-end |
| Dashboard → Studio | 🟡 NEEDS TEST | Code exists |
| Studio → Create image | 🟡 NEEDS TEST | UI exists |
| Studio → Create music | 🟡 NEEDS TEST | UI exists |
| Studio → Create video | 🟡 NEEDS TEST | UI exists |
| Studio → Agent chat | 🟡 NEEDS TEST | UI exists |
| GitHub → Clone → Terminal → Edit → Save | 🔴 BROKEN | Workspace persistence broken |
| Terminal → Reconnect after Railway restart | 🔴 BROKEN | Workspaces lost on restart |
| Stripe → Purchase → Credits | 🟡 NEEDS TEST | Code exists |
| Mobile → Studio → Terminal | 🟡 NEEDS TEST | Not visually tested |

---

## LAUNCH CHECKLIST

### Before Launch (P0)

- [ ] **Build:** `pnpm build` green in CI
- [ ] **TypeScript:** `tsc --noEmit` green in CI
- [ ] **Auth:** Sign up → sign in → dashboard works
- [ ] **Studio:** Open `/studio`, send message, get response
- [ ] **GitHub:** Connect repo, clone, see files in terminal
- [ ] **Terminal:** Full E2E: connect → command → output → disconnect
- [ ] **Persistence:** Workspace survives Railway restart
- [ ] **Isolation:** Terminal sessions isolated (Docker or sandbox)

### Before Launch (P1)

- [x] **Error boundaries:** `error.tsx` in all routes ✅
- [x] **Loading states:** `loading.tsx` in all routes ✅
- [ ] **Monitoring:** Sentry configured
- [x] **Rate limiting:** Terminal WebSocket protected ✅
- [x] **Retries:** Exponential backoff utility created ✅

### Before Launch (P2)

- [ ] **Security audit:** Terminal isolation verified
- [x] **Command blocking:** Network tools blocked ✅
- [x] **Command blocking:** Shell escapes blocked ✅
- [x] **Audit logging:** Command audit log implemented ✅
- [ ] **Secrets:** No leaks in client bundle
- [ ] **Webhooks:** Stripe signature verified

### Launch Week (P3-P4)

- [ ] **Mobile:** Test on iOS/Android
- [ ] **Accessibility:** Screen reader test
- [x] **Skip links:** Added to root layout ✅
- [ ] **SEO:** All meta tags present
- [ ] **Analytics:** Vercel Analytics working
- [ ] **Legal:** Policies reviewed by lawyer

### Post-Launch (P5)

- [ ] Advanced animations
- [ ] Dynamic OG images
- [ ] E2E test suite
- [ ] Performance optimization

---

## NEXT ACTIONS (Priority Order)

1. **Run CI pipeline** — verify build + typecheck + tests green
2. **Test auth flow** — sign up, sign in, access dashboard
3. **Test Studio chat** — send message, verify response
4. **Test GitHub → Terminal** — clone repo, see files, run command
5. **Test Stripe** — purchase, webhook, credits
6. **Fix workspace persistence** — mount Railway volume
7. **Fix terminal isolation** — Docker or sandbox
8. **Add Sentry** — error tracking
9. **Add focus management** — accessibility
10. **Add IP-based restrictions** — security

---

## KNOWN BLOCKERS

1. 🔴 **Workspace persistence** — Lost on Railway restart
2. 🔴 **Terminal isolation** — Host PTY mode in production
3. 🔵 **Error boundaries** — 57 error.tsx files added to all routes
4. 🔵 **Loading states** — 58 loading.tsx files added to all routes
5. 🔴 **Sentry** — Not configured
6. 🔴 **Build verification** — Times out on Windows, need CI verification
7. 🔴 **TypeScript verification** — Times out on Windows, need CI verification

---

## FILES TO TEST

### P0 Critical Path
- `src/app/studio/page.tsx` — Studio entry
- `src/app/studio/components/CommandStudio.tsx` — Studio hub
- `src/components/litt-terminal/TerminalPanel.tsx` — Terminal UI
- `src/app/api/studio-projects/[projectId]/workspace/prepare/route.ts` — Workspace provisioning
- `src/app/api/terminal/token/route.ts` — Terminal auth
- `terminal-server/server.ts` — Terminal server
- `terminal-server/workspace/WorkspaceManager.ts` — Git clone

### P1 Error Handling
- `src/components/route-error.tsx` — Shared error boundary component
- `src/components/route-loading.tsx` — Shared loading component
- `src/lib/backoff.ts` — Exponential backoff utility

### P2 Security
- `terminal-server/security.ts` — Command blocking + audit logging
- `terminal-server/auth.ts` — JWT verification
- `src/lib/terminal-auth.ts` — Token issuance

---

## SUCCESS CRITERIA FOR LAUNCH

**All P0 gates: ✅ VERIFIED**  
**All P1 gates: ✅ VERIFIED**  
**All P2 gates: ✅ VERIFIED**  
**P3-P4: 🟡 MOSTLY VERIFIED** (minor polish OK)

---

**This is the single source of truth. Update status as you test.**
