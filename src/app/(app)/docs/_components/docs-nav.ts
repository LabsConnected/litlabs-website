/**
 * Docs navigation config — the single source of truth for the /docs
 * information architecture. Every internal docs link must point at one of
 * these hrefs; docs-navigation.test.tsx enforces that each href resolves
 * to a real route file.
 */

export interface DocsNavPage {
  /** Route path, e.g. "/docs/quick-start". */
  href: string;
  /** Sidebar label. */
  title: string;
  /** Short description used on the overview page cards. */
  description: string;
}

export interface DocsNavGroup {
  label: string;
  pages: DocsNavPage[];
}

export const DOCS_NAV: DocsNavGroup[] = [
  {
    label: "Getting Started",
    pages: [
      {
        href: "/docs",
        title: "Overview",
        description:
          "What LiTT is, how Studio works, and how projects, chat, preview, terminal, and deployment fit together.",
      },
      {
        href: "/docs/quick-start",
        title: "Quick Start",
        description:
          "A step-by-step walkthrough: sign up, open Studio, build your first project, preview it, and deploy.",
      },
    ],
  },
  {
    label: "Studio",
    pages: [
      {
        href: "/docs/studio",
        title: "Studio Guide",
        description:
          "The Studio interface: LiTT chat, Plan, Canvas, Code, Preview, Media, Files, Terminal, and activity.",
      },
      {
        href: "/docs/building",
        title: "Building with LiTT",
        description:
          "Real example prompts and the build → verify → preview → deploy loop.",
      },
      {
        href: "/docs/preview-deploy",
        title: "Preview & Deployment",
        description:
          "How preview works, how it differs from production deployment, retries, and approvals.",
      },
    ],
  },
  {
    label: "CLI",
    pages: [
      {
        href: "/docs/cli",
        title: "Installation & Commands",
        description:
          "Install the LiTT CLI, sign in, and use the real commands: doctor, check, build, deploy verify, and more.",
      },
    ],
  },
  {
    label: "Platform",
    pages: [
      {
        href: "/docs/marketplace",
        title: "Marketplace",
        description:
          "Find and install specialist agents that extend what LiTT can do.",
      },
      {
        href: "/docs/safety",
        title: "Safety & Approvals",
        description:
          "How LiTT asks for approval before consequential actions, and how permission modes work.",
      },
    ],
  },
  {
    label: "Help",
    pages: [
      {
        href: "/docs/troubleshooting",
        title: "Troubleshooting",
        description:
          "Fix common launch issues: preview not starting, terminal disconnected, approvals, and CLI connectivity.",
      },
    ],
  },
];

/** Flattened list of every docs page in reading order. */
export const ALL_DOCS_PAGES: DocsNavPage[] = DOCS_NAV.flatMap(
  (group) => group.pages,
);

/** Every internal docs href, for dead-link regression tests. */
export function allDocsHrefs(): string[] {
  return ALL_DOCS_PAGES.map((page) => page.href);
}

/** Previous/next page for the bottom-of-article pager. */
export function docsPrevNext(href: string): {
  prev: DocsNavPage | null;
  next: DocsNavPage | null;
} {
  const idx = ALL_DOCS_PAGES.findIndex((page) => page.href === href);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? ALL_DOCS_PAGES[idx - 1]! : null,
    next: idx < ALL_DOCS_PAGES.length - 1 ? ALL_DOCS_PAGES[idx + 1]! : null,
  };
}
