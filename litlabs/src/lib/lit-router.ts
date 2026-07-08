"use client";

export type LiTRouteAction =
  | { type: "navigate"; href: string; label: string }
  | { type: "noop"; response: string };

const SITE_MAP: Record<string, string> = {
  chat: "/studio?tool=chat",
  console: "/studio?tool=chat",
  terminal: "/studio?tool=chat",
  image: "/studio?tool=image",
  images: "/studio?tool=image",
  picture: "/studio?tool=image",
  builder: "/studio?tool=chat",
  build: "/studio?tool=chat",
  app: "/studio?tool=chat",
  website: "/studio?tool=chat",
  agents: "/studio?tool=chat",
  agent: "/studio?tool=chat",
  gallery: "/gallery",
  games: "/games/cloud",
  game: "/games/cloud",
  music: "/studio?tool=audio",
  audio: "/studio?tool=audio",
  marketplace: "/marketplace",
  store: "/marketplace",
  settings: "/settings",
  profile: "/profile",
  dashboard: "/dashboard",
  social: "/social",
  docs: "/docs",
  wallet: "/wallet",
};

const PHRASES: { patterns: string[]; action: LiTRouteAction }[] = [
  { patterns: ["take me to chat", "open chat", "open console", "open terminal", "go to chat"], action: { type: "navigate", href: "/studio?tool=chat", label: "LiT Console" } },
  { patterns: ["take me to image", "open image", "image generator", "generate image", "make an image", "go to image"], action: { type: "navigate", href: "/studio?tool=image", label: "Image Studio" } },
  { patterns: ["take me to builder", "open builder", "build app", "build a website", "go to builder", "create app"], action: { type: "navigate", href: "/studio?tool=chat", label: "LiTT CODE" } },
  { patterns: ["take me to agents", "open agents", "show agents", "my agents", "go to agents"], action: { type: "navigate", href: "/studio?tool=chat", label: "LiTT CODE" } },
  { patterns: ["take me to gallery", "open gallery", "show gallery", "my gallery", "go to gallery"], action: { type: "navigate", href: "/gallery", label: "Gallery" } },
  { patterns: ["take me to games", "open games", "play games", "go to games"], action: { type: "navigate", href: "/games/cloud", label: "Games" } },
  { patterns: ["take me to music", "open music", "make music", "go to music"], action: { type: "navigate", href: "/studio?tool=audio", label: "Music Studio" } },
  { patterns: ["take me to marketplace", "open marketplace", "browse agents", "go to marketplace"], action: { type: "navigate", href: "/marketplace", label: "Marketplace" } },
  { patterns: ["take me to settings", "open settings", "go to settings"], action: { type: "navigate", href: "/settings", label: "Settings" } },
  { patterns: ["take me to profile", "open profile", "go to profile"], action: { type: "navigate", href: "/profile", label: "Profile" } },
  { patterns: ["take me to dashboard", "open dashboard", "go to dashboard"], action: { type: "navigate", href: "/dashboard", label: "Dashboard" } },
  { patterns: ["take me to social", "open social", "go to social"], action: { type: "navigate", href: "/social", label: "Social" } },
  { patterns: ["take me to wallet", "open wallet", "go to wallet"], action: { type: "navigate", href: "/wallet", label: "Wallet" } },
];

export function routeFromText(text: string): LiTRouteAction | null {
  const lower = text.toLowerCase().trim();

  for (const { patterns, action } of PHRASES) {
    if (patterns.some((p) => lower.includes(p))) {
      return action;
    }
  }

  for (const [key, href] of Object.entries(SITE_MAP)) {
    const re = new RegExp(`\\b${key}\\b`, "i");
    if (re.test(lower)) {
      return { type: "navigate", href, label: key };
    }
  }

  return null;
}
