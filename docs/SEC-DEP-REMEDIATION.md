# SEC-DEP: Dependency Remediation Track

## Status: BLOCKED / REMEDIATION REQUIRED

The CI functional gate (typecheck, lint, build, tests, Playwright) is GREEN.
The dependency security audit (`pnpm audit --prod --audit-level=high`) is RED
due to 7 high-severity vulnerabilities in transitive dependencies.

**Policy: Do NOT weaken the audit gate. Fix the owning packages.**

---

## Vulnerability Inventory

### Workstream 1: Web / AI SDK (undici)

| # | CVE | Package | Severity | Patched | Current | Root Path |
|---|-----|---------|----------|---------|---------|-----------|
| 1 | GHSA-vrm6-8vpv-qv8q | undici | high | >=6.24.0 | 5.29.0 | `@browserbasehq/stagehand@3.7.1` > `ai@5.0.226` > `@ai-sdk/provider-utils@3.0.31` > `undici@5.29.0` |
| 2 | GHSA-v9p9-hfj2-hcw8 | undici | high | >=6.24.0 | 5.29.0 | same as #1 |
| 3 | GHSA-vxpw-j846-p89q | undici | high | >=6.27.0 | 5.29.0 | same as #1 |

**Root cause:** `@ai-sdk/provider-utils@3.0.31` depends on `undici@^5.29.0`.
The latest `@ai-sdk/provider-utils@5.x` uses `undici@^7.28.0`, but upgrading
from 3.x to 5.x is a major version jump that requires testing Stagehand
and all AI SDK consumers.

**Remediation plan:**
1. Check if `@browserbasehq/stagehand@3.7.1` can use `@ai-sdk/provider-utils@4.x` or `5.x`.
2. If not, check if a newer Stagehand release updates the AI SDK.
3. Test the upgrade against Stagehand browser automation and all AI SDK consumers.
4. Do NOT force `undici` 6.x/7.x via pnpm overrides under packages expecting 5.x.

### Workstream 2: Expo / Mobile Companion (shell-quote, js-yaml, image-size)

| # | CVE | Package | Severity | Patched | Current | Root Path |
|---|-----|---------|----------|---------|---------|-----------|
| 4 | GHSA-395f-4hp3-45gv | shell-quote | high | >=1.9.0 | 1.8.4 | `cli` > `ink@7.1.0` > `react-devtools-core@6.1.5` > `shell-quote@1.8.4` |
| 5 | GHSA-5p4m-2wfm-xmqj | js-yaml | high | >=4.3.1 | ? | `packages/litt-companion` > `@expo/metro-runtime@57.0.8` > ... |
| 6 | GHSA-w3rx-r6r6-pgpr | image-size | high | <0.0.0 (NO FIX) | 1.2.1 | `packages/litt-companion` > `@expo/metro-runtime@57.0.8` > `expo@57.0.11` > `@expo/cli@57.0.13` > `@expo/metro@56.0.0` > `metro@0.84.4` > `image-size@1.2.1` |
| 7 | GHSA-5p2g-fcmc-qvqq | image-size | high | <0.0.0 (NO FIX) | 1.2.1 | same as #6 |

**Root cause:** The Expo/Metro mobile companion toolchain pulls in vulnerable
transitive dependencies. `image-size@1.2.1` has NO patched version available.

**Remediation plan:**
1. Check if Expo SDK 58+ updates `metro` and `image-size`.
2. For `shell-quote`: check if `react-devtools-core` has a newer release.
3. For `image-size`: NO FIX EXISTS. This requires an explicit security
   exception approved by the user. The vulnerability is in a mobile build
   tool (ICNS/JXL/HEIF parser DoS) and does not affect the web production
   runtime.

---

## CI Status Summary

| Step | Status |
|------|--------|
| Build @litt/agent-core | PASS |
| Type check | PASS |
| Lint | PASS |
| Terminal server build | PASS |
| Test (vitest) | PASS |
| Production build | PASS |
| Playwright core (blocking) | PASS |
| Playwright visual (non-blocking) | PASS |
| Playwright integration (non-blocking) | PASS |
| Migration reproducibility | PASS |
| Production-style upgrade | PASS |
| Lighthouse | PASS |
| **Dependency audit** | **BLOCKED** |

**CI-0 functional gate: PASS.**
**Security dependency gate: BLOCKED — separate SEC-DEP remediation track.**
