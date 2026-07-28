/**
 * Mock data for the visual test harness.
 * No real user data, no real API responses — all synthetic.
 */

import type { StudioMessage } from "../types/conversation";
import type { AgentId } from "../stores/useStudioAgentStore";

let mockIdCounter = 0;
function mockId(): string {
  return `mock-msg-${++mockIdCounter}`;
}

function userMsg(content: string, ago: number): StudioMessage {
  return { id: mockId(), role: "user", content, status: "complete", createdAt: Date.now() - ago };
}

function assistantMsg(content: string, ago: number, agentId: AgentId = "litt"): StudioMessage {
  return { id: mockId(), role: "assistant", content, agentId, status: "complete", createdAt: Date.now() - ago };
}

export const MOCK_MESSAGES: StudioMessage[] = [
  userMsg("Build me a landing page for a coffee shop", 60000),
  assistantMsg(
    "I'll help you build a coffee shop landing page. Here's my plan:\n\n1. **Hero section** with a bold headline and CTA\n2. **Menu showcase** with featured drinks\n3. **About section** with your story\n4. **Location & hours** footer\n\nWant me to start with the hero section?\n\n```tsx\nexport function Hero() {\n  return (\n    <section className=\"hero\">\n      <h1>Brewed with Passion</h1>\n      <p>Fresh coffee, every morning</p>\n    </section>\n  );\n}\n```",
    55000,
  ),
  userMsg("Looks great! Add a dark mode toggle.", 30000),
  assistantMsg(
    "Added a dark mode toggle to the hero section. The button switches between light and dark themes using a `useState` hook and CSS variables.\n\nThe toggle persists to `localStorage` so the user's preference is remembered on refresh.",
    25000,
  ),
];

export const MOCK_BUSY_MESSAGES: StudioMessage[] = [
  userMsg("Generate a logo for the coffee shop", 5000),
];

export const MOCK_SPARK_MESSAGES: StudioMessage[] = [
  userMsg("Give me 5 creative brand name ideas for a coffee shop", 120000),
  assistantMsg(
    "Here are 5 creative brand names for your coffee shop:\n\n1. **Bean & Bloom** — pairs coffee with growth\n2. **Grounded Hours** — cozy, grounded feeling\n3. **The Daily Grind** — playful double meaning\n4. **Crema & Co.** — refined, artisanal\n5. **Mugshot** — bold, memorable, modern\n\nWhich one resonates with your vision?",
    110000,
    "spark",
  ),
];

export const MOCK_CAPABILITIES = {
  repository: "connected" as const,
  repositoryName: "litlabs-website",
  repositoryIndexed: true,
  terminalExecution: "available" as const,
  writeAccess: true,
  connectedProviders: ["gemini", "openrouter", "groq"],
  availableTools: ["terminal", "canvas", "image", "video", "audio"],
  connectionSummary: "All systems operational",
  terminalStatus: "connected" as const,
  terminalSessionId: "pty-visual-test",
  terminalError: null,
  voiceTransportConnected: true,
  voiceMicrophoneOn: false,
  voiceHealth: {
    configured: true,
    tokenService: "healthy" as const,
    available: true,
  },
};

export const MOCK_CAPABILITIES_DISCONNECTED = {
  repository: "disconnected" as const,
  repositoryName: null,
  repositoryIndexed: false,
  terminalExecution: "unavailable" as const,
  writeAccess: false,
  connectedProviders: ["gemini"],
  availableTools: [],
  connectionSummary: "AI connected — connect a repository for full access",
  terminalStatus: "disconnected" as const,
  terminalSessionId: null,
  terminalError: null,
  voiceTransportConnected: false,
  voiceMicrophoneOn: false,
  voiceHealth: {
    configured: false,
    tokenService: "unknown" as const,
    available: false,
  },
};

export type VisualTestState =
  | "empty"
  | "conversation"
  | "busy"
  | "spark"
  | "inspector"
  | "activity-drawer"
  | "terminal-drawer"
  | "camera"
  | "mobile-conversation"
  | "mobile-composer";

export const VISUAL_TEST_STATES: { id: VisualTestState; label: string; viewport?: "mobile" | "desktop" }[] = [
  { id: "empty", label: "1. Empty Studio" },
  { id: "conversation", label: "2. Conversation with LiTT" },
  { id: "busy", label: "3. LiTT Working/Busy" },
  { id: "spark", label: "4. Spark Selected" },
  { id: "inspector", label: "5. Inspector Open" },
  { id: "activity-drawer", label: "6. Activity Drawer Open" },
  { id: "terminal-drawer", label: "7. Terminal Drawer Open" },
  { id: "camera", label: "8. Camera Overlay Open" },
  { id: "mobile-conversation", label: "9. Mobile Conversation", viewport: "mobile" },
  { id: "mobile-composer", label: "10. Mobile Composer", viewport: "mobile" },
];
