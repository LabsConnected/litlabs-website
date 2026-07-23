export type ChatRoom = {
  id: string;
  label: string;
  modelId: string;
  description: string;
  members: string[];
};

export const CHAT_ROOMS: ChatRoom[] = [
  {
    id: "studio-hq",
    label: "Studio HQ",
    modelId: "adaptive",
    description: "The default command room for planning, execution, and orchestration.",
    members: ["LiTT", "Studio"],
  },
  {
    id: "terminal-ops",
    label: "Terminal Ops",
    modelId: "gemini-2.5-flash",
    description: "Fast interactive shell tasks and quick agent operations.",
    members: ["LiTT", "CLI Bridge", "Terminal"],
  },
  {
    id: "creative-lab",
    label: "Creative Lab",
    modelId: "gpt-4o",
    description: "Visual, copy, and concept work for premium creative sessions.",
    members: ["Model Picker", "Studio", "Artists"],
  },
  {
    id: "reasoning-room",
    label: "Reasoning Room",
    modelId: "claude-3.5-sonnet",
    description: "Long-form analysis, decisions, and planning workflows.",
    members: ["Analyst", "Planner", "Reviewer"],
  },
];
