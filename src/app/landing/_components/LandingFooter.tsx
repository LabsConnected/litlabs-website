import Link from "next/link";
import { Sparkles } from "lucide-react";

const COLS: Array<{
  title: string;
  links: Array<{ label: string; href: string }>;
}> = [
  {
    title: "Product",
    links: [
      { label: "Studio", href: "/studio" },
      { label: "Agents", href: "/agents" },
      { label: "Marketplace", href: "/marketplace" },
      { label: "Pricing", href: "/settings" },
    ],
  },
  {
    title: "Build",
    links: [
      { label: "Docs", href: "/docs" },
      { label: "API", href: "/docs" },
      { label: "Templates", href: "/gallery" },
      { label: "Showcase", href: "/showcase" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/profile" },
      { label: "Blog", href: "/social" },
      { label: "Careers", href: "/social" },
      { label: "Contact", href: "/social" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "Cookies", href: "/cookies" },
      { label: "Security", href: "/docs" },
    ],
  },
];

function GitHubIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2.1c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.27-1.68-1.27-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.35.95.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.24 2.75.12 3.04.74.81 1.18 1.83 1.18 3.09 0 4.42-2.7 5.39-5.27 5.68.41.36.78 1.07.78 2.15v3.19c0 .31.21.68.8.56C20.21 21.38 23.5 17.07 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

function TwitterIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.244 2H21.5l-7.5 8.57L23 22h-6.81l-5.34-6.99L4.66 22H1.4l8.02-9.16L1 2h6.94l4.83 6.39L18.244 2zm-1.19 18h1.83L7.04 4H5.1l11.954 16z" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M19.27 5.33a17.84 17.84 0 0 0-4.39-1.36.07.07 0 0 0-.07.03c-.19.33-.4.77-.55 1.12a16.5 16.5 0 0 0-4.97 0 11 11 0 0 0-.56-1.12.07.07 0 0 0-.07-.03 17.86 17.86 0 0 0-4.39 1.36.06.06 0 0 0-.03.03C1.5 9.62.7 13.78 1.1 17.9a.08.08 0 0 0 .03.05 17.93 17.93 0 0 0 5.4 2.72.07.07 0 0 0 .08-.02c.41-.57.78-1.17 1.1-1.8a.07.07 0 0 0-.04-.1 11.8 11.8 0 0 1-1.68-.8.07.07 0 0 1 0-.12c.11-.08.23-.17.34-.26a.07.07 0 0 1 .07-.01c3.52 1.6 7.33 1.6 10.81 0a.07.07 0 0 1 .07.01c.11.09.22.18.34.26a.07.07 0 0 1 0 .12c-.53.31-1.09.57-1.68.8a.07.07 0 0 0-.04.1c.32.63.69 1.23 1.1 1.8a.07.07 0 0 0 .08.02 17.87 17.87 0 0 0 5.41-2.72.08.08 0 0 0 .03-.05c.5-4.77-.78-8.9-3.3-12.55a.06.06 0 0 0-.03-.02zM8.52 15.38c-1.07 0-1.94-.97-1.94-2.16 0-1.19.86-2.17 1.94-2.17 1.09 0 1.96.98 1.94 2.17 0 1.19-.86 2.16-1.94 2.16zm6.97 0c-1.07 0-1.94-.97-1.94-2.16 0-1.19.86-2.17 1.94-2.17 1.09 0 1.96.98 1.94 2.17 0 1.19-.85 2.16-1.94 2.16z" />
    </svg>
  );
}

const SOCIALS: Array<{
  label: string;
  href: string;
  Icon: () => React.JSX.Element;
}> = [
  {
    label: "GitHub",
    href: "https://github.com/LabsConnected/litlabs-website",
    Icon: GitHubIcon,
  },
  { label: "Twitter", href: "https://twitter.com/litlabs", Icon: TwitterIcon },
  { label: "Discord", href: "/social", Icon: DiscordIcon },
];

export function LandingFooter() {
  return (
    <footer className="relative z-10 border-t border-white/5 bg-[#06060e] px-6 py-16">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-10 md:grid-cols-[1.4fr_3fr]">
          {/* Brand */}
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-2.5 text-sm font-black tracking-tight text-white"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 via-fuchsia-500 to-amber-400 shadow-lg shadow-fuchsia-500/30">
                <Sparkles size={15} className="text-black" />
              </div>
              LiTT <span className="text-neutral-500">/</span> Labs
            </Link>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-neutral-500">
              The AI project operating system for creators, builders, and
              independent teams. Stop chatting. Start shipping.
            </p>
            <div className="mt-5 flex items-center gap-2">
              {SOCIALS.map(({ label, href, Icon }) => (
                <a
                  key={label}
                  href={href}
                  aria-label={label}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/8 bg-white/[0.02] text-neutral-400 transition hover:border-white/20 hover:bg-white/[0.05] hover:text-white"
                >
                  <Icon />
                </a>
              ))}
            </div>
          </div>

          {/* Link columns */}
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {COLS.map((col) => (
              <div key={col.title}>
                <div className="mb-4 text-[10px] font-black uppercase tracking-[0.18em] text-neutral-500">
                  {col.title}
                </div>
                <ul className="space-y-2.5">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <Link
                        href={l.href}
                        className="text-sm text-neutral-400 transition hover:text-white"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-white/5 pt-6 text-xs text-neutral-500 sm:flex-row">
          <div>© {new Date().getFullYear()} LiTTree-LabStudios™. LiTT™ and Spark™ are LiTTree-LabStudios trademarks.</div>
          <div className="flex items-center gap-2 font-mono text-neutral-600">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            All systems normal · v1.0.0
          </div>
        </div>
      </div>
    </footer>
  );
}
