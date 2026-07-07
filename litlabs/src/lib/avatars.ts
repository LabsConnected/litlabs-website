// Agent avatar metadata — no encoding, no data URLs, just CSS + emoji

export interface AgentAvatarMeta {
  emoji: string;
  initials: string;
  color: string;
  bg: string;
}

export const AGENT_AVATAR_META: Record<string, AgentAvatarMeta> = {
  director: {
    emoji: "🎯",
    initials: "D",
    color: "#22d3ee",
    bg: "rgba(34,211,238,0.12)",
  },
  forge: {
    emoji: "🔨",
    initials: "F",
    color: "#22d3ee",
    bg: "rgba(34,211,238,0.12)",
  },
  pulse: {
    emoji: "📈",
    initials: "P",
    color: "#f472b6",
    bg: "rgba(244,114,182,0.12)",
  },
  champion: {
    emoji: "🏆",
    initials: "C",
    color: "#00ff41",
    bg: "rgba(0,255,65,0.12)",
  },
  "code-champion": {
    emoji: "💻",
    initials: "CC",
    color: "#ff0080",
    bg: "rgba(255,0,128,0.12)",
  },
  "writing-coach": {
    emoji: "✍️",
    initials: "W",
    color: "#ff9ff3",
    bg: "rgba(255,159,243,0.12)",
  },
  "research-guru": {
    emoji: "🔬",
    initials: "R",
    color: "#00ff41",
    bg: "rgba(0,255,65,0.12)",
  },
  "support-agent": {
    emoji: "🤝",
    initials: "S",
    color: "#00ffff",
    bg: "rgba(0,255,255,0.12)",
  },
  "social-dominator": {
    emoji: "📱",
    initials: "SD",
    color: "#ff6b6b",
    bg: "rgba(255,107,107,0.12)",
  },
  "data-slayer": {
    emoji: "📊",
    initials: "DS",
    color: "#a855f7",
    bg: "rgba(168,85,247,0.12)",
  },
  "pixel-forge": {
    emoji: "🎨",
    initials: "PF",
    color: "#22d3ee",
    bg: "rgba(34,211,238,0.12)",
  },
  "music-producer": {
    emoji: "🎵",
    initials: "M",
    color: "#fbbf24",
    bg: "rgba(251,191,36,0.12)",
  },
  "legal-shield": {
    emoji: "⚖️",
    initials: "L",
    color: "#3b82f6",
    bg: "rgba(59,130,246,0.12)",
  },
  "security-guru": {
    emoji: "🔒",
    initials: "SG",
    color: "#ef4444",
    bg: "rgba(239,68,68,0.12)",
  },
  "security-chief": {
    emoji: "🛡️",
    initials: "SC",
    color: "#ef4444",
    bg: "rgba(239,68,68,0.12)",
  },
  "social-pilot": {
    emoji: "🚀",
    initials: "SP",
    color: "#a855f7",
    bg: "rgba(168,85,247,0.12)",
  },
  "ml-engineer": {
    emoji: "🧠",
    initials: "ML",
    color: "#a855f7",
    bg: "rgba(168,85,247,0.12)",
  },
  // New agents from agents.ts
  alexchen: {
    emoji: "🏗️",
    initials: "AC",
    color: "#f97316",
    bg: "rgba(249,115,22,0.12)",
  },
  sarahk: {
    emoji: "📈",
    initials: "SK",
    color: "#ec4899",
    bg: "rgba(236,72,153,0.12)",
  },
  mikedev: {
    emoji: "⚡",
    initials: "MD",
    color: "#06b6d4",
    bg: "rgba(6,182,212,0.12)",
  },
  jtaylor: {
    emoji: "📖",
    initials: "JT",
    color: "#8b5cf6",
    bg: "rgba(139,92,246,0.12)",
  },
  home: {
    emoji: "🏠",
    initials: "HC",
    color: "#10b981",
    bg: "rgba(16,185,129,0.12)",
  },
  code: {
    emoji: "👨‍💻",
    initials: "CC",
    color: "#ff0080",
    bg: "rgba(255,0,128,0.12)",
  },
  social: {
    emoji: "🚀",
    initials: "SD",
    color: "#ff6b6b",
    bg: "rgba(255,107,107,0.12)",
  },
  data: {
    emoji: "🔢",
    initials: "DS",
    color: "#a855f7",
    bg: "rgba(168,85,247,0.12)",
  },
  writer: {
    emoji: "📝",
    initials: "WC",
    color: "#ff9ff3",
    bg: "rgba(255,159,243,0.12)",
  },
};

// Kept for backward compat — returns emoji string (safe as text child)
export const AGENT_AVATARS: Record<string, string> = Object.fromEntries(
  Object.entries(AGENT_AVATAR_META).map(([k, v]) => [k, v.emoji]),
);

export function generateUserAvatar(name: string): AgentAvatarMeta {
  const seed = name.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const colors = [
    "#00ffff",
    "#ff0080",
    "#00ff41",
    "#ff6b6b",
    "#a855f7",
    "#fbbf24",
    "#22d3ee",
    "#3b82f6",
  ];
  const bgs = [
    "rgba(0,255,255,0.12)",
    "rgba(255,0,128,0.12)",
    "rgba(0,255,65,0.12)",
    "rgba(255,107,107,0.12)",
    "rgba(168,85,247,0.12)",
    "rgba(251,191,36,0.12)",
    "rgba(34,211,238,0.12)",
    "rgba(59,130,246,0.12)",
  ];
  return {
    emoji: "👤",
    initials: name.charAt(0).toUpperCase(),
    color: colors[seed % colors.length],
    bg: bgs[seed % bgs.length],
  };
}
