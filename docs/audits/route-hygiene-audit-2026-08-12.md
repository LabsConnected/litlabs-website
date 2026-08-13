# Legacy Route Hygiene Audit — 2026-08-12

## Route Classification

| Route | Type | Status | Action |
|-------|------|--------|--------|
| `/studio` | CANONICAL | Active | Primary creator surface |
| `/dashboard` | CANONICAL | Active | Dashboard home |
| `/chat` | REDIRECT | Redirects to Studio | Uses `buildChatRedirectUrl()` helper |
| `/code` | LEGACY BUT REQUIRED | Active page | VS Code-style code scanner (662 lines) |
| `/builder` | REDIRECT | → `/studio?tool=image` | Simple redirect |
| `/ai-builder` | REDIRECT | → `/studio?tool=workflows` | Simple redirect |
| `/creator` | REDIRECT | → `/dashboard` | Simple redirect |
| `/agent-chat` | REDIRECT | → `/studio?tool=chat` | Simple redirect |
| `/agent` | REDIRECT | → `/agents` | Simple redirect |
| `/agents` | REDIRECT | → `/studio?tool=agents` | Simple redirect |
| `/dashboard?app=music` | REDIRECT | → `/studio?tool=music` | Compatibility redirect (new) |
| `/hire` | HYBRID | Public + Auth | Bare for signed-out, AppShell for signed-in |
| `/settings` | OWN SHELL | Active | Has own sidebar, not wrapped in AppShell |
| `/games/cloud` | SELF_CONTAINED | Active | Own chrome (emulator) |
| `/login` | PUBLIC | Auth page | Bare public |
| `/sign-in` | PUBLIC | Auth page | Bare public |
| `/sign-up` | PUBLIC | Auth page | Bare public |
| `/privacy` | PUBLIC | Legal | Bare public |
| `/terms` | PUBLIC | Legal | Bare public |
| `/cookies` | PUBLIC | Legal | Bare public |
| `/docs` | PUBLIC | Documentation | Bare public |
| `/pricing` | PUBLIC | Marketing | Bare public |
| `/showcase` | CANONICAL | Active | Public showcase |
| `/games` | CANONICAL | Active | Games hub |
| `/discover` | CANONICAL | Active | Social feed |
| `/marketplace` | CANONICAL | Active | Marketplace |
| `/wallet` | CANONICAL | Active | Wallet/credits |
| `/profile` | CANONICAL | Active | User profile |
| `/voice` | CANONICAL | Active | Voice interface |
| `/litt` | CANONICAL | Active | LiTT assistant |
| `/litt-terminal` | CANONICAL | Active | Terminal interface |

## Summary

- **Canonical routes**: Studio, Dashboard, Showcase, Games, Discover, Marketplace, Wallet, Profile, Voice, LiTT
- **Redirects**: 8 legacy routes redirect to canonical surfaces
- **Public**: 7 legal/auth/marketing pages with bare chrome
- **Hybrid**: /hire (public for signed-out, AppShell for signed-in)
- **Own shell**: /settings (has its own sidebar)
- **Self-contained chrome**: /games/cloud (emulator)

No dead routes found. All legacy routes have appropriate redirects.
