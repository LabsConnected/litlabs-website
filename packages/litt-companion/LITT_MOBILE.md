# LiTT Mobile Instructions

## Project

- **Path:** `packages/litt-companion`
- **Framework:** Expo / React Native / Expo Router
- **SDK:** Expo SDK 57, React Native 0.86
- **Primary platform:** Android
- **iOS:** Keep compatibility where reasonably possible
- **Production API:** `https://litlabs.net`
- **Package manager:** pnpm (monorepo workspace)
- **Config:** `packages/litt-companion/litt-mobile.config.json`

## Rules

1. When the user asks about the mobile app, work inside
   `packages/litt-companion` unless a shared API/type genuinely needs adjustment.

2. Reuse existing LiTTree APIs and authentication.
   Do not duplicate backend business logic inside the mobile application.

3. Production API: `https://litlabs.net`

4. Android is the first priority.
   Keep iOS compatibility where reasonably possible.

5. Use Expo Router for navigation.

6. Prefer real React Native screens/components.

7. Use WebView only for heavyweight Studio experiences that are not practical
   to reproduce natively.

8. Reuse the existing LiTTree design system/tokens where possible.

9. Do not introduce a second authentication architecture.

10. After changing mobile code, run:

    ```
    pnpm mobile:check
    ```

11. Before reporting success, include:
    - files changed
    - checks executed
    - errors/warnings
    - whether Expo export passed

12. Never:
    - deploy production
    - submit to Play Store/App Store
    - rotate secrets
    - alter production database data

    unless explicitly requested.

## Commands

Root-level pnpm scripts (run from repo root):

| Command             | What it does                                    |
|---------------------|-------------------------------------------------|
| `pnpm mobile:check`  | TypeScript check + Expo export (Android)        |
| `pnpm mobile:start`  | Start Expo dev server                           |
| `pnpm mobile:build`  | EAS Android build (preview profile, no store)   |
| `pnpm mobile:doctor` | Run expo-doctor                                 |

LiTT terminal commands (type in the LiTT web terminal):

| Command              | What it does                                    |
|----------------------|-------------------------------------------------|
| `litt mobile:check`  | typecheck + Expo export                         |
| `litt mobile:start`  | start Expo dev server                           |
| `litt mobile:build`  | EAS Android build                               |
| `litt mobile:doctor` | expo doctor                                     |

## Environment Variables

Create `packages/litt-companion/.env.local` (gitignored):

```bash
EXPO_PUBLIC_API_URL=https://litlabs.net
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=<your-clerk-publishable-key>
```

- `EXPO_PUBLIC_API_URL` — the backend API base URL
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` — Clerk publishable key for auth
  (same key as `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` from the web app)

**Never expose in the mobile app:**
- Clerk secret keys
- Supabase service-role keys
- private API tokens
- server credentials

Expo exposes env vars prefixed with `EXPO_PUBLIC_` to client code via
`process.env.EXPO_PUBLIC_*`.

## API Client

Use `src/lib/api.ts` which reads `EXPO_PUBLIC_API_URL` — do not hardcode
URLs throughout components.

## Project Structure

```
packages/litt-companion/
├── app/
│   ├── _layout.tsx              # Root layout (Stack navigator, theme)
│   └── index.tsx                # Home screen
├── src/
│   └── lib/
│       └── api.ts               # API client (uses EXPO_PUBLIC_API_URL)
├── app.json                     # Expo config (Android-first)
├── metro.config.js              # Monorepo-aware Metro config
├── babel.config.js              # Expo babel preset
├── tsconfig.json                # TypeScript config (extends expo/tsconfig.base)
├── package.json                 # Dependencies and scripts
├── litt-mobile.config.json      # LiTT auto-discovery metadata
└── LITT_MOBILE.md               # This file
```

## Expected LiTT Workflow

When the user says something like:

> "Build the Android Home screen."

LiTT should:

1. Identify `packages/litt-companion` as the mobile project
2. Inspect `packages/litt-companion/app/` for Expo Router routes
3. Edit React Native files
4. Run `pnpm mobile:check`
5. Report results

Do not require repeated explanations of:
- folder location
- framework
- API host
- platform priority

## Auth

Use `expo-secure-store` for token storage and Clerk's React Native SDK
(`@clerk/clerk-expo`) for authentication. The publishable key goes in
`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`. Do NOT put the Clerk secret key
in the mobile app — secret keys stay server-side on the backend.
