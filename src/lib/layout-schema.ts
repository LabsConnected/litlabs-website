// AI-Driven Layout Schema
// AI outputs this JSON to dynamically assemble UI blocks

export type LayoutTheme = "cyber" | "neon" | "glitch" | "minimal" | "dark";
export type LayoutType = "grid" | "feed" | "dashboard" | "profile";

export interface LayoutWidget {
  id: string;
  type: "KodiStreamPlayer" | "SocialFeed" | "MediaGrid" | "ChatPanel" | 
        "AgentStatus" | "StatsPanel" | "ProfileHeader" | "HeroBanner";
  props: Record<string, unknown>;
}

export interface LayoutSchema {
  version: "1.0";
  layout: LayoutType;
  theme: LayoutTheme;
  widgets: LayoutWidget[];
  userId?: string;
  agentId?: string;
}

// Example AI output for: "Build me a trap music profile page with media player"
export const EXAMPLE_LAYOUT: LayoutSchema = {
  version: "1.0",
  layout: "dashboard",
  theme: "neon",
  userId: "highlife4real1989@gmail.com",
  agentId: "social-dominator",
  widgets: [
    {
      id: "w1",
      type: "ProfileHeader",
      props: {
        username: "Larry B",
        avatar: "🎧",
        bio: "Trap Music Curator",
        stats: { agents: 12, plays: "1.8K" }
      }
    },
    {
      id: "w2",
      type: "KodiStreamPlayer",
      props: {
        source: "usr_folder/media/trap_mixes",
        autoplay: false,
        showTracklist: true
      }
    },
    {
      id: "w3",
      type: "SocialFeed",
      props: {
        display: "latest_tracks",
        limit: 20
      }
    }
  ]
};

export function generateLayout(userPrompt: string, user: string, agent: string): LayoutSchema {
  // In production, call LLM to parse prompt into layout JSON
  // For now, return base template
  return {
    version: "1.0",
    layout: "dashboard",
    theme: "cyber",
    userId: user,
    agentId: agent,
    widgets: [
      { id: "w1", type: "ProfileHeader", props: { username: user.split("@")[0] } },
      { id: "w2", type: "AgentStatus", props: { agent } },
      { id: "w3", type: "StatsPanel", props: {} }
    ]
  };
}