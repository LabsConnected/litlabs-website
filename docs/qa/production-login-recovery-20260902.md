# Production login recovery — September 2, 2026

The production login page could render Clerk's form, then lose it or return to sign-in after email verification. Railway's running web deployment logged `secret-key-invalid` while resolving the Clerk handshake.

The web service's configured `CLERK_SECRET_KEY` returned HTTP 401 from Clerk's backend JWKS endpoint. The canonical development environment contained a valid production key (HTTP 200), whose signing-key IDs matched the public JWKS at `clerk.litlabs.net`. The valid key was copied directly to the same Railway web service through standard input and verified by readback. No authentication policy or session validation was disabled.

The newest web deployment could not roll out because `CommandStudio` still passed a removed `projectReady` prop to `CommandStudioHeader`. Remove that prop and its unused derived variable; the header already receives the canonical runtime state. Supply the header's required runtime inputs in the five existing Activity test fixtures as well.

## Deployment scope

- Repository: `LabsConnected/litlabs-website`, canonical worktree `E:\LiTT\Worktrees\main`.
- Railway project: `69a241af-cd1b-4cf1-baff-f5a6a5a5d7d5` (`litlabs-terminal-server`).
- Environment: `41f9b3f4-c783-4288-a6d3-077b4e55858f` (`production`).
- Web service: `a8a05220-e5ed-48f6-969d-1f82957341de`.
- Public domain: `https://www.litlabs.net`.
- Failed source deployment: `98d344fe-cd9c-472e-b035-4d48e1e7951d`, commit `2d39d60f9d05f851d6a537272d56e0651133b246`.
- Prior successful code deployment: `a98eb5ab-d6d6-47a1-b0bb-4eb790fedb78`, commit `e1da31eb857ae50b8efdf59ac2b25b3ed57b8e39`.

## Validation and remaining gates

The initial complete web suite passed 3,376 tests and failed five stale header fixtures, with 52 tests skipped. The corrected fixture file passes all 23 tests. TypeScript passes after both repairs. Re-run the full suite and the production webpack build before rollout, then verify Railway SUCCESS, `/api/health` commit identity, and browser sign-in through to protected Studio.

Full repository lint currently has five pre-existing errors in CLI/agent files (four CommonJS imports and one `prefer-const` finding) plus warnings. These are separate from this web repair and do not establish production completion.

## Recovery

If the new web build causes a regression, restore the prior successful **code** deployment above while keeping the validated production Clerk secret. Do not restore the invalid key. Confirm the health endpoint and complete a fresh browser sign-in after any rollback. A green health endpoint alone does not test Clerk authentication.

Do not commit secret values, print the secret when diagnosing this issue, or disable authentication to get past a failed handshake. Full Studio, voice, billing, persistence, and cross-user acceptance remain separate release gates.
