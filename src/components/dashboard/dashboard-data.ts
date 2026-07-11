import {
  Zap,
  Sparkles,
  ShoppingBag,
  Gamepad2,
  Music,
  Radio,
  Clapperboard,
  Wrench,
  Image as ImageIcon,
  Mic,
  FileText,
  Terminal,
  MessageSquare,
} from "lucide-react";

export type IconComponent = React.ComponentType<{
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  color?: string;
}>;

export const APPS = [
  {
    id: "jarvis",
    label: "Jarvis",
    icon: Terminal,
    color: "#ff00a0",
    href: "/dashboard?app=jarvis",
  },
  {
    id: "studio",
    label: "Studio",
    icon: Zap,
    color: "#00f0ff",
    href: "/studio",
  },
  {
    id: "gallery",
    label: "Gallery",
    icon: Sparkles,
    color: "#ff00a0",
    href: "/gallery",
  },
  {
    id: "social",
    label: "Social",
    icon: MessageSquare,
    color: "#ff00a0",
    href: "/social",
  },
  {
    id: "marketplace",
    label: "Marketplace",
    icon: ShoppingBag,
    color: "#ff9ff3",
    href: "/marketplace",
  },
  { id: "music", label: "Music", icon: Music, color: "#ff2d78", href: "/dashboard?app=music" },
  {
    id: "games",
    label: "Games",
    icon: Gamepad2,
    color: "#8b5cf6",
    href: "/games",
  },
  {
    id: "watch",
    label: "Watch",
    icon: Clapperboard,
    color: "#3b82f6",
    href: "/dashboard?app=watch",
  },
  { id: "radio", label: "Radio", icon: Radio, color: "#10b981", href: "/dashboard?app=radio" },
  { id: "tools", label: "Tools", icon: Wrench, color: "#f59e0b", href: "/dashboard?app=tools" },
];

export const AGENTS = [
  {
    name: "LiTTree",
    status: "online" as const,
    task: "Orchestration",
    color: "#22d3ee",
  },
  {
    name: "Forge",
    status: "working" as const,
    task: "Code review",
    color: "#22d3ee",
  },
  {
    name: "Pulse",
    status: "online" as const,
    task: "Content scheduling",
    color: "#f472b6",
  },
  {
    name: "Visionary",
    status: "idle" as const,
    task: "Awaiting creative brief",
    color: "#e879f9",
  },
  {
    name: "Nexus",
    status: "online" as const,
    task: "Automation monitoring",
    color: "#34d399",
  },
  {
    name: "Alex Chen",
    status: "online" as const,
    task: "Architecture",
    color: "#3b82f6",
  },
  {
    name: "Sarah K.",
    status: "working" as const,
    task: "Growth strategy",
    color: "#ec4899",
  },
  {
    name: "Mike Dev",
    status: "online" as const,
    task: "API design",
    color: "#06b6d4",
  },
  {
    name: "J. Taylor",
    status: "idle" as const,
    task: "Script editing",
    color: "#f59e0b",
  },
  {
    name: "Home Controller",
    status: "online" as const,
    task: "Device sync",
    color: "#22d3ee",
  },
];

export const CREATORS = [
  {
    name: "Alex Chen",
    handle: "@alexchen",
    color: "#3b82f6",
    followers: "12.4K",
  },
  { name: "Sarah K.", handle: "@sarahk", color: "#ec4899", followers: "8.2K" },
  {
    name: "Mike Dev",
    handle: "@mikedev",
    color: "#06b6d4",
    followers: "15.1K",
  },
  {
    name: "J. Taylor",
    handle: "@jtaylor",
    color: "#f59e0b",
    followers: "6.8K",
  },
  {
    name: "Pixel Forge",
    handle: "@pixelforge",
    color: "#8b5cf6",
    followers: "22.3K",
  },
];

export const GAMES = [
  { title: "Neon Racer", genre: "Arcade", color: "#ff00a0", players: "2.4k" },
  {
    title: "Agent Arena",
    genre: "Strategy",
    color: "#00f0ff",
    players: "1.8k",
  },
  { title: "Synth Maze", genre: "Puzzle", color: "#8b5cf6", players: "980" },
  { title: "Cyber Drift", genre: "Racing", color: "#ff9ff3", players: "3.1k" },
];

export const WATCH = [
  {
    title: "Agent Setup Guide",
    channel: "LiTree LabStudios",
    views: "12k",
    color: "#ff00a0",
  },
  {
    title: "Studio Deep Dive",
    channel: "LiTree LabStudios",
    views: "8.5k",
    color: "#00f0ff",
  },
  {
    title: "Creator Spotlight #04",
    channel: "Community",
    views: "4.2k",
    color: "#8b5cf6",
  },
];

export const RADIO = [
  {
    id: "synthwave-fm",
    title: "Synthwave FM",
    genre: "Synthwave",
    listeners: 342,
    color: "#ff00a0",
    nowPlaying: "Neon Horizon — Lazerhawk",
    streamUrl: null as string | null,
    description: "Retro-futuristic synth vibes for late-night sessions.",
    playlist: [
      { id: "midnight-city", title: "Midnight City", artist: "M83", url: "https://www.youtube.com/embed/dX3k_QDnzHE?autoplay=1&loop=1&playlist=dX3k_QDnzHE", duration: 243 },
      { id: "nightcall", title: "Nightcall", artist: "Kavinsky", url: "https://www.youtube.com/embed/MV_3Dpw-BRY?autoplay=1&loop=1&playlist=MV_3Dpw-BRY", duration: 258 },
    ],
  },
  {
    id: "lofi-lounge",
    title: "Lo-Fi Lounge",
    genre: "Lo-Fi",
    listeners: 891,
    color: "#00f0ff",
    nowPlaying: "Midnight Study — ChillHop",
    streamUrl: null as string | null,
    description: "Chill beats for deep focus and study flow.",
    playlist: [
      { id: "resonance", title: "Resonance", artist: "Home", url: "https://www.youtube.com/embed/8GW6sLrK40k?autoplay=1&loop=1&playlist=8GW6sLrK40k", duration: 212 },
      { id: "solaris", title: "Solaris", artist: "Cyberpunk Ambient", url: "https://www.youtube.com/embed/SvO5EfwfMoQ?autoplay=1&loop=1&playlist=SvO5EfwfMoQ", duration: 180 },
    ],
  },
  {
    id: "cyber-beats",
    title: "Cyber Beats",
    genre: "Darksynth",
    listeners: 156,
    color: "#8b5cf6",
    nowPlaying: "Ghost Protocol — Power Glove",
    streamUrl: null as string | null,
    description: "Hard-hitting dark synth for intense work sessions.",
    playlist: [
      { id: "tech-noir", title: "Tech Noir", artist: "Gunship", url: "https://www.youtube.com/embed/JRkNZH_3K3s?autoplay=1&loop=1&playlist=JRkNZH_3K3s", duration: 322 },
      { id: "nightcall", title: "Nightcall", artist: "Kavinsky", url: "https://www.youtube.com/embed/MV_3Dpw-BRY?autoplay=1&loop=1&playlist=MV_3Dpw-BRY", duration: 258 },
    ],
  },
  {
    id: "focus-flow",
    title: "Focus Flow",
    genre: "Ambient",
    listeners: 620,
    color: "#10b981",
    nowPlaying: "Weightless — Marconi Union",
    streamUrl: null as string | null,
    description: "Ambient soundscapes engineered for peak concentration.",
    playlist: [
      { id: "resonance", title: "Resonance", artist: "Home", url: "https://www.youtube.com/embed/8GW6sLrK40k?autoplay=1&loop=1&playlist=8GW6sLrK40k", duration: 212 },
      { id: "solaris", title: "Solaris", artist: "Cyberpunk Ambient", url: "https://www.youtube.com/embed/SvO5EfwfMoQ?autoplay=1&loop=1&playlist=SvO5EfwfMoQ", duration: 180 },
    ],
  },
];

export const TOOLS = [
  {
    title: "Prompt Vault",
    desc: "Saved prompts & styles",
    icon: FileText,
    color: "#f59e0b",
  },
  {
    title: "Asset Locker",
    desc: "Images, audio & projects",
    icon: ImageIcon,
    color: "#00f0ff",
  },
  {
    title: "Quick Notes",
    desc: "Scratchpad & ideas",
    icon: Mic,
    color: "#ff00a0",
  },
  {
    title: "Batch Gen",
    desc: "Multi-run generations",
    icon: Zap,
    color: "#8b5cf6",
  },
];
