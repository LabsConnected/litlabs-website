// LiT Intent Router — detects user intent and maps to routes + actions
// This is the brain that lets LiT auto-navigate users to the right tool.

export type IntentRoute = {
  path: string;
  label: string;
  reason: string;
};

export type IntentResult = {
  route: IntentRoute | null;
  confidence: number;
  isAmbiguous: boolean;
  suggestions: IntentRoute[];
};

type IntentRule = {
  keywords: string[];
  route: string;
  label: string;
  reason: string;
};

const RULES: IntentRule[] = [
  // Studio — Image
  {
    keywords: ["image", "picture", "photo", "wallpaper", "logo", "art", "draw", "illustration", "poster", "thumbnail", "cover art", "album art", "portrait", "character design", "concept art"],
    route: "/studio?tool=image",
    label: "Studio — Image",
    reason: "That belongs in the Image Studio.",
  },
  // Studio — Video
  {
    keywords: ["video", "movie", "film", "animation", "clip", "reel", "trailer", "visual effect", "vfx"],
    route: "/studio?tool=video",
    label: "Studio — Video",
    reason: "That belongs in the Video Studio.",
  },
  // Studio — Audio
  {
    keywords: ["music", "song", "beat", "track", "audio", "sound", "melody", "instrumental", "podcast", "voice", "sfx", "sound effect", "rap", "hip hop beat"],
    route: "/studio?tool=audio",
    label: "Studio — Audio",
    reason: "That belongs in the Audio Studio.",
  },
  // Color by Number app
  {
    keywords: ["color by number", "coloring", "paint by numbers", "coloring page", "color book"],
    route: "/color",
    label: "Color by Number",
    reason: "That belongs in the Color by Number app.",
  },
  // Studio — Canvas
  {
    keywords: ["canvas", "paint", "sketch", "drawing", "pixel art"],
    route: "/studio?tool=canvas",
    label: "Studio — Canvas",
    reason: "That belongs in the Canvas tool.",
  },
  // Builder
  {
    keywords: ["build", "code", "app", "website", "react", "component", "landing page", "dashboard", "frontend", "backend", "api", "function", "bug fix", "debug", "refactor", "html", "css", "typescript", "javascript", "next.js", "game code"],
    route: "/studio?tool=builder",
    label: "Builder",
    reason: "That belongs in the AI Builder.",
  },
  // Canvas (code gen)
  {
    keywords: ["generate code", "scaffold", "template", "starter code", "boilerplate"],
    route: "/studio?tool=canvas",
    label: "Canvas",
    reason: "That belongs in the Canvas code generator.",
  },
  // Agents
  {
    keywords: ["agent", "ai agent", "create agent", "agent marketplace", "forge", "pulse", "visionary", "nexus", "social pilot", "automation agent", "custom agent", "agent dna"],
    route: "/studio?tool=agents",
    label: "Agents",
    reason: "That belongs in the Agent builder.",
  },
  // Terminal
  {
    keywords: ["terminal", "console", "command", "shell", "bash", "cli", "deploy", "git push", "build command", "run command"],
    route: "/studio?tool=terminal",
    label: "Terminal",
    reason: "That belongs in the Terminal.",
  },
  // Gallery
  {
    keywords: ["gallery", "my images", "my creations", "saved work", "portfolio", "showcase", "my art", "my projects"],
    route: "/gallery",
    label: "Gallery",
    reason: "That belongs in the Gallery.",
  },
  // Games
  {
    keywords: ["game", "play", "arcade", "hextris", "play game", "gaming", "retro game", "browser game"],
    route: "/games",
    label: "Games",
    reason: "That belongs in the Arcade.",
  },
  // Marketplace
  {
    keywords: ["marketplace", "buy", "sell", "coins", "purchase", "subscribe", "subscription", "upgrade", "pricing", "credits", "lbc", "store", "asset", "template"],
    route: "/marketplace",
    label: "Marketplace",
    reason: "That belongs in the Marketplace.",
  },
  // Social
  {
    keywords: ["social", "post", "feed", "community", "share", "follow", "comment", "timeline", "social media", "content calendar"],
    route: "/social",
    label: "Social",
    reason: "That belongs in the Social feed.",
  },
  // Profile
  {
    keywords: ["profile", "my profile", "edit profile", "avatar", "bio", "username", "my page"],
    route: "/profile",
    label: "Profile",
    reason: "That belongs in your Profile.",
  },
  // Settings
  {
    keywords: ["settings", "preferences", "api key", "byok", "billing", "model key", "theme", "appearance", "notifications", "account settings"],
    route: "/settings",
    label: "Settings",
    reason: "That belongs in Settings.",
  },
  // Dashboard
  {
    keywords: ["dashboard", "analytics", "stats", "telemetry", "overview", "admin", "metrics", "kpi"],
    route: "/dashboard",
    label: "Dashboard",
    reason: "That belongs in the Dashboard.",
  },
  // Admin
  {
    keywords: ["admin panel", "system admin", "server status", "uptime", "live system", "admin dashboard"],
    route: "/admin",
    label: "Admin",
    reason: "That belongs in the Admin panel.",
  },
  // Wallet
  {
    keywords: ["wallet", "balance", "transactions", "earn coins", "spend coins", "payment", "stripe"],
    route: "/wallet",
    label: "Wallet",
    reason: "That belongs in your Wallet.",
  },
  // Chat (general)
  {
    keywords: ["chat", "talk", "ask", "question", "help", "advice", "brainstorm", "idea", "explain", "what is", "how do", "why"],
    route: "/studio?tool=chat",
    label: "Chat",
    reason: "Let's chat about it.",
  },
];

export function detectIntent(text: string): IntentResult {
  const lower = text.toLowerCase().trim();
  if (!lower) return { route: null, confidence: 0, isAmbiguous: false, suggestions: [] };

  const scored: { rule: IntentRule; score: number }[] = [];

  for (const rule of RULES) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) {
        score += kw.length > 6 ? 3 : 2;
      }
    }
    if (score > 0) {
      scored.push({ rule, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { route: null, confidence: 0, isAmbiguous: false, suggestions: [] };
  }

  const top = scored[0];
  const second = scored[1];

  // If top score is much higher than second, high confidence
  const confidence = second ? Math.min(1, top.score / (top.score + second.score)) : 1;
  const isAmbiguous = confidence < 0.6 && scored.length > 1;

  const suggestions = scored.slice(0, 3).map((s) => ({
    path: s.rule.route,
    label: s.rule.label,
    reason: s.rule.reason,
  }));

  return {
    route: isAmbiguous ? null : { path: top.rule.route, label: top.rule.label, reason: top.rule.reason },
    confidence,
    isAmbiguous,
    suggestions,
  };
}

export function buildNavigationMessage(intent: IntentResult): string {
  if (!intent.route) {
    if (intent.isAmbiguous && intent.suggestions.length > 0) {
      const opts = intent.suggestions.map((s, i) => `${i + 1}. **${s.label}** — ${s.reason}`).join("\n");
      return `I can help with that! Which one fits best?\n\n${opts}\n\nType the number or tell me more.`;
    }
    return "";
  }
  return `${intent.route.reason} Opening ${intent.route.label} now.`;
}
