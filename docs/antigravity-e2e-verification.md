# Antigravity E2E Authentication & Browser Agent Specification

> **Status:** Active / Verified  
> **Last Updated:** August 2026  
> **Target Agent:** Antigravity (Google DeepMind IDE Agent) & Chromium Browser Subagent

---

## 1. Overview & Security Architecture

To allow automated browser testing of protected routes (e.g. `/studio`, `/dashboard`, `/settings`) without compromising security or exposing human owner credentials:

- **No Weakened Security:** Clerk route protection middleware in `src/proxy.ts` remains active in all environments. Anonymous sessions are blocked and redirected to `/sign-in`.
- **Dedicated Identity:** Authentication uses a dedicated, low-privilege Clerk user (`agent@litlabs.net`).
- **No Shared Credentials:** Secret keys, owner passwords, and production JWTs are never hardcoded, printed, logged, or committed.

---

## 2. Agent Identity & Authorization Profile

| Attribute | Specification |
|-----------|---------------|
| **Email** | `agent@litlabs.net` |
| **Clerk User ID** | `user_3HqDdfL95yjdW2dm9lMwy1SOEcq` |
| **First / Last Name** | `Antigravity Agent` |
| **Role Metadata** | `{ "role": "agent", "purpose": "e2e-testing" }` |
| **Entitlement Tier** | `Starter` (Standard user entitlements via `getUserEntitlements`) |
| **Allowed Scope** | Full read and navigation access across `/studio`, `/dashboard`, `/showcase`, `/games`, `/marketplace` |
| **Restricted Scope** | No access to platform owner overrides (`ADMIN_CLERK_IDS`), billing modifications, user administration, or deployment triggers |

---

## 3. Automated Authentication Methods

### Method A: Clerk Sign-In Ticket (Recommended for E2E / Headless Runs)
Using `@clerk/backend`, the agent can programmatically issue a short-lived sign-in ticket for `agent@litlabs.net`:

```typescript
import { createClerkClient } from '@clerk/backend';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const token = await clerk.signInTokens.createSignInToken({
  userId: 'user_3HqDdfL95yjdW2dm9lMwy1SOEcq',
  expiresInSeconds: 300,
});

// Navigate browser to consume ticket & establish session:
const ticketUrl = `http://localhost:3001/sign-in?ticket=${token.token}`;
await page.goto(ticketUrl, { waitUntil: 'domcontentloaded' });
```

### Method B: UI Form Sign-In
Navigate to `http://localhost:3001/sign-in`, enter `agent@litlabs.net` in the Clerk identifier input, enter the strong password, and submit.

---

## 4. Verification Protocol

When verifying protected application routes:

1. **Dev Server Verification:** Ensure Next.js dev server is listening on port 3001 (or 3000).
2. **Establish Session:** Open Chromium context and navigate to the ticket URL or complete UI sign-in.
3. **Verify Protected Navigation:**
   - Request `GET /studio` -> Expect `HTTP 200 OK` (URL: `http://localhost:3001/studio`).
   - Request `GET /dashboard` -> Expect `HTTP 200 OK` (URL: `http://localhost:3001/dashboard`).
4. **Confirm Route Protection:** Verify that unauthenticated requests to `/studio` return `HTTP 302` redirect to `/sign-in`.

---

## 5. Maintenance & Compliance

- **Environment File:** Non-sensitive test configuration can optionally reside in `.env.local` as `TEST_AGENT_EMAIL=agent@litlabs.net`.
- **Git Hygiene:** No temporary credential files, session tokens, or scratch logs should be committed to source control.
