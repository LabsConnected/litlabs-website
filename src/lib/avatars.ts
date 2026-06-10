// Inline SVG agent avatars — zero external dependencies, instant load, never break

function svgAvatar(initial: string, color: string, bgFrom = "#0a1a2e", bgTo = "#000"): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128"><defs><radialGradient id="bg" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="${bgFrom}"/><stop offset="100%" stop-color="${bgTo}"/></radialGradient><filter id="g"><feGaussianBlur stdDeviation="1.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><circle cx="32" cy="32" r="30" fill="url(#bg)" stroke="${color}" stroke-width="2" filter="url(#g)"/><text x="32" y="39" text-anchor="middle" fill="${color}" font-size="26" font-family="monospace" font-weight="bold" filter="url(#g)">${initial}</text></svg>`;
  const encoded = typeof Buffer !== "undefined"
    ? Buffer.from(svg).toString("base64")
    : btoa(svg);
  return `data:image/svg+xml;base64,${encoded}`;
}

export const AGENT_AVATARS: Record<string, string> = {
  director: svgAvatar("D", "#00ffff"),
  champion: svgAvatar("C", "#00ff41"),
  "code-champion": svgAvatar("CC", "#ff0080"),
  "writing-coach": svgAvatar("W", "#ff9ff3"),
  "research-guru": svgAvatar("R", "#00ff41"),
  "support-agent": svgAvatar("S", "#00ffff"),
  "social-dominator": svgAvatar("SD", "#ff6b6b"),
  "data-slayer": svgAvatar("DS", "#a855f7"),
  "pixel-forge": svgAvatar("PF", "#22d3ee"),
  "music-producer": svgAvatar("M", "#fbbf24"),
  "legal-shield": svgAvatar("L", "#3b82f6"),
  "security-guru": svgAvatar("SG", "#ef4444"),
  "ml-engineer": svgAvatar("ML", "#a855f7"),
};

// Generic user avatar — uses DiceBear (reliable CDN) with emoji fallback
export function generateUserAvatar(name: string): string {
  const seed = name.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const colors = ["#00ffff", "#ff0080", "#00ff41", "#ff6b6b", "#a855f7", "#fbbf24", "#22d3ee", "#3b82f6"];
  const color = colors[seed % colors.length];
  const initial = name.charAt(0).toUpperCase();
  return svgAvatar(initial, color, "#1a1a2e", "#0f0f1a");
}
