---
name: litlab-seo-audit
description: Audit SEO metadata, sitemap, robots, structured data, and OG images for a route or the whole site. Reports missing/broken items.
subagent: true
model: swe
allowed-tools:
  - read
  - grep
  - glob
  - exec
permissions:
  allow:
    - Read(**)
    - Exec(pnpm)
    - Exec(npx)
---

Audit SEO implementation across the litlabs.net site.

## What to check

### 1. Metadata exports
For each page in `src/app/`, verify it exports a `metadata` object (or `generateMetadata` for dynamic routes).
- `grep -r "export const metadata\|export async function generateMetadata" src/app/`
- Pages WITHOUT metadata: list them with `<ref_file>` tags.
- Private/authed routes should have `robots: { index: false, follow: false }`.

### 2. Source of truth
- `src/lib/seo.ts` is the canonical SEO config — verify all routes import from it.
- `grep -r "from \"@/lib/seo\"" src/app/`

### 3. Sitemap & robots
- `src/app/sitemap.ts` should exist and export all public routes.
- `src/app/robots.ts` should reference `litlabs.net` and allow public routes.

### 4. Structured data (JsonLd)
- `src/components/seo/JsonLd.tsx` should exist.
- Homepage should render organization + website schema.

### 5. Images
- `public/favicon.ico`, `public/apple-icon.png`, `public/icon-512.png`, `public/og-image.png` should exist.
- Check `public/wallpapers/` for the 3 webp files: `litt-afterglow.webp`, `liquid-signal.webp`, `biolume-canopy.webp`.

### 6. Redirects
- `next.config.ts` should have redirects for legacy paths (`/jarvis` → `/litt`, etc).

## Output format
Report as a table:
| Check | Status | Notes |
|---|---|---|
| Metadata exports | ✅/❌ | count / missing files |
| ... | ... | ... |

End with a prioritized list of fixes needed (P0 = blocking, P1 = should fix, P2 = nice-to-have).
