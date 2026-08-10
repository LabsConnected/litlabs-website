# Public Authority Source of Truth

This document defines the canonical public identity, product capabilities, and crawler/AI discovery configuration for LiTTree LabStudios.

## 1. Canonical Identity

**Company Name:** LiTTree LabStudios
**Product Ecosystem:** LiTTree / LitLabs
**Primary Domain:** [https://litlabs.net](https://litlabs.net)
**Canonical Origin:** [https://litlabs.net](https://litlabs.net)

### AI Agents
* **LiTT**: Core AI engineering, research, and execution brain.
* **Spark**: Creative companion for design, branding, and ideation.

### Core Capabilities
* **Build**: Apps, sites, dashboards, tools, games, automations.
* **Create**: Images, branding, music/audio concepts, video concepts.
* **Context**: Long-term project memory and semantic recall.
* **Control**: Real file system, terminal PTY, git integration.
* **Governance**: Mandatory human approval for sensitive or destructive actions.
* **Ownership**: Users own 100% of generated code and assets.

## 2. Public Authoritative Endpoints

* **Sitemap**: `/sitemap.xml` (Dynamically generated via `src/app/sitemap.ts`)
* **Robots**: `/robots.txt` (Dynamically generated via `src/app/robots.ts`)
* **LLM Guide**: `/llms.txt` (Concise machine-readable reference)
* **LLM Reference**: `/llms-full.txt` (Full machine-readable reference)
* **Identity JSON**: `/.well-known/littree.json` (Structured platform identity)
* **About Page**: `/about` (Primary human-readable source for agents)

## 3. Implementation Details

### Structured Data (JSON-LD)
We use `src/components/seo/AuthorityJsonLd.tsx` to inject site-wide Schema.org metadata:
* **Organization**: Identifies LiTTree LabStudios and official social profiles.
* **WebSite**: Defines the search action for Studio.
* **WebApplication**: Describes LiTTree Studio and its key features.

### Metadata Policy
Every major public page must use the `buildMetadata` helper from `src/lib/seo.ts` to ensure:
* Correct canonical URL.
* Consistent Open Graph and Twitter card properties.
* Accurate titles and descriptions without keyword stuffing.

### AI Crawler Policy
We welcome legitimate AI crawlers (GPTBot, ClaudeBot, PerplexityBot, etc.).
* **Access**: Public pages (`/`, `/about`, `/pricing`, `/docs`) are crawlable.
* **Protection**: Private application surfaces (`/studio`, `/wallet`, `/api`, etc.) are explicitly disallowed in `robots.ts`.
* **No Training**: We do not allow training on private project data without consent.

## 4. Maintenance Procedure

1. **Brand Changes**: Any change to canonical naming must be updated here and in `src/lib/seo.ts` / `src/lib/siteConfig.ts` first.
2. **New Public Routes**: Must be added to `src/app/sitemap.ts` and `src/app/robots.ts` if indexable.
3. **Verification**: After changes, verify endpoints as an unauthenticated client to ensure no secrets or private routes are leaked.

---

*Note: This document was established to harden public identity against stale third-party scans (e.g., legacy WordPress reports). The current architecture is a modern Next.js/TypeScript application.*
