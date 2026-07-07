# Site Duplication Audit - 2026-07-07

## Best Clerk Setup

- Clerk owns identity, sessions, sign-in, sign-up, profile security, MFA, and sign-out.
- Supabase owns LiTTree app profile data, credits, agents, media, conversations, settings, and admin reporting.
- `/sign-in` and `/sign-up` are the only public auth front doors.
- `/login` should remain a redirect to `/sign-in`.
- Clerk webhook `/api/webhook/clerk` should be enabled for `user.created`, `user.updated`, and `user.deleted`.
- Required env vars: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `ADMIN_CLERK_IDS`.

## Fixed In This Pass

- Admin live stats no longer use fake fallback numbers or fake events.
- Real signup counts now come from `users.created_at`.
- Signup attribution is captured from first landing path, referrer, and UTM params.
- Recent Users now shows signup source and landing path.
- `/chat` redirects to `/studio?tool=chat`.
- `/agent-chat` redirects to `/studio?tool=chat`.
- Agent fleet admin snapshot maps to the actual `agents` schema.
- Active agents metric now uses running `active_tasks`, not a missing `agents.status` column.

## Duplicate Areas To Keep Consolidating

| Area | Current Routes | Best Primary |
| --- | --- | --- |
| Chat | `/chat`, `/agent-chat`, `/studio?tool=chat` | `/studio?tool=chat` |
| Builder | `/builder`, `/ai-builder`, `/studio?tool=builder` | `/studio?tool=builder` |
| Image generation | `/generate`, `/studio?tool=image`, `/studio/image` | `/studio?tool=image` |
| Agents | `/agent`, `/agents`, `/studio?tool=agents` | `/studio?tool=agents` for building, `/agents` for public catalog |
| Console | `/lit-console`, `/jarvis-terminal`, `/admin/terminal`, `/studio?tool=chat` | Keep `/admin/terminal` for admin, use Studio for user console |
| Profile/settings | `/profile`, `/profile/[username]`, `/settings` | Clerk profile for identity, `/settings` for app preferences, `/profile` for public creator page |
| LiT branding pages | `/lit`, `/litt`, `/littree`, `/jarvis` | Pick one product route and redirect the rest |

## Next Highest-Value Cleanup

1. Add redirects for `/litt`, `/littree`, and `/jarvis` after choosing the one canonical LiT assistant route.
2. Keep `/agents` as marketplace/catalog only; all creation/editing should open `/studio?tool=agents`.
3. Move billing/security/profile identity actions into Clerk user profile links, not custom settings fields.
4. Apply the Supabase migration before deploying the new admin attribution UI.
5. Add Clerk webhook monitoring in Admin so webhook failures are visible.
