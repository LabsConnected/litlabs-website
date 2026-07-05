import { Agent } from "./agents";

export interface AgentCommand {
  name: string;
  description: string;
  category: string;
  handler: (agent: Agent, args?: string[]) => Promise<string> | string;
}

// Core commands available to all agents
const CORE_COMMANDS: AgentCommand[] = [
  {
    name: "help",
    description: "Show all available commands",
    category: "Core",
    handler: () => "Available commands: chat, brief, plan, execute, status, memory, tasks, logs, reset, help",
  },
  {
    name: "status",
    description: "Show current agent status and health",
    category: "Core",
    handler: (agent) => `Status: ${agent.status}\nLast activity: ${agent.lastActivity.toLocaleString()}\nDomains: ${agent.domains.join(", ")}`,
  },
  {
    name: "brief",
    description: "Get a quick summary of current context",
    category: "Core",
    handler: (agent) => `${agent.name} (${agent.role})\n${agent.personality}\nSpecializes in: ${agent.domains.slice(0, 3).join(", ")}`,
  },
  {
    name: "reset",
    description: "Clear current session context",
    category: "Core",
    handler: () => "Session context cleared. Ready for new task.",
  },
];

// Director-specific commands
const DIRECTOR_COMMANDS: AgentCommand[] = [
  {
    name: "orchestrate",
    description: "Coordinate multi-agent workflow",
    category: "Orchestration",
    handler: () => "Analyzing task requirements... Assigning Forge for code implementation, Pulse for growth strategy, Visionary for creative assets. Workflow orchestrated.",
  },
  {
    name: "assign",
    description: "Assign task to specific agent",
    category: "Orchestration",
    handler: () => "Task assigned. Monitoring agent availability and priority queue.",
  },
  {
    name: "sync",
    description: "Sync all agents on current project state",
    category: "Orchestration",
    handler: () => "Syncing project context across all agents... Complete. All agents updated with latest project state.",
  },
  {
    name: "prioritize",
    description: "Set priority for current tasks",
    category: "Orchestration",
    handler: () => "Priority updated. High-priority tasks moved to front of queue.",
  },
  {
    name: "plan",
    description: "Create step-by-step strategy",
    category: "Strategy",
    handler: () => "Strategy plan created:\n1. Analyze requirements\n2. Design architecture\n3. Implement core features\n4. Test and iterate\n5. Deploy and monitor",
  },
  {
    name: "review",
    description: "Review current project status",
    category: "Strategy",
    handler: () => "Project review complete. Architecture is sound, code quality is good, next focus should be on performance optimization.",
  },
];

// Forge-specific commands
const FORGE_COMMANDS: AgentCommand[] = [
  {
    name: "build",
    description: "Build and compile project",
    category: "Build",
    handler: () => "Build started... TypeScript compilation complete. Bundle optimized. Build successful in 2.3s.",
  },
  {
    name: "debug",
    description: "Debug and fix issues",
    category: "Development",
    handler: () => "Debugging... Found 2 issues:\n1. Memory leak in useEffect - fixed\n2. Missing error boundary - added",
  },
  {
    name: "refactor",
    description: "Refactor code for better quality",
    category: "Development",
    handler: () => "Refactoring complete. Extracted 3 components, improved type safety, reduced bundle size by 12%.",
  },
  {
    name: "test",
    description: "Run test suite",
    category: "Testing",
    handler: () => "Running tests... 47 passed, 2 failed. Fixing failures... All tests passing now.",
  },
  {
    name: "audit",
    description: "Security and performance audit",
    category: "Quality",
    handler: () => "Audit complete. No critical vulnerabilities found. 3 performance optimizations suggested.",
  },
  {
    name: "deploy",
    description: "Deploy to production",
    category: "DevOps",
    handler: () => "Deployment initiated. Vercel build started... Deployed to https://litlabs.net",
  },
];

// Pulse-specific commands
const PULSE_COMMANDS: AgentCommand[] = [
  {
    name: "post",
    description: "Create and schedule social post",
    category: "Content",
    handler: () => "Post created. Scheduled for optimal engagement time (2:00 PM EST).",
  },
  {
    name: "trend",
    description: "Analyze trending topics",
    category: "Analytics",
    handler: () => "Trending analysis complete. Top topics: AI agents, creator tools, no-code platforms. Opportunity identified in AI-powered content creation.",
  },
  {
    name: "schedule",
    description: "Manage content calendar",
    category: "Planning",
    handler: () => "Content calendar updated. 3 posts scheduled for this week, 2 for next week.",
  },
  {
    name: "analyze",
    description: "Analyze performance metrics",
    category: "Analytics",
    handler: () => "Metrics analysis: Engagement up 23%, reach up 18%, conversion rate at 3.2%. Growth strategy working.",
  },
  {
    name: "campaign",
    description: "Launch marketing campaign",
    category: "Growth",
    handler: () => "Campaign launched. Target audience: creators and developers. Budget allocation optimized.",
  },
  {
    name: "optimize",
    description: "Optimize conversion funnel",
    category: "Growth",
    handler: () => "Funnel optimized. Reduced drop-off at sign-up by 34%. Added social proof elements.",
  },
];

// Visionary-specific commands
const VISIONARY_COMMANDS: AgentCommand[] = [
  {
    name: "prompt",
    description: "Generate AI image prompt",
    category: "Creative",
    handler: () => "Prompt generated: 'Futuristic command center interface, dark theme, neon accents, terminal aesthetic, high detail, 8K'",
  },
  {
    name: "style",
    description: "Apply visual style to content",
    category: "Design",
    handler: () => "Style applied. Modern dark theme with cyan and magenta accents. Consistent with brand identity.",
  },
  {
    name: "iterate",
    description: "Iterate on creative concept",
    category: "Creative",
    handler: () => "Iteration complete. Refined composition, improved color harmony, added depth elements.",
  },
  {
    name: "palette",
    description: "Generate color palette",
    category: "Design",
    handler: () => "Palette generated: #00ffff (primary), #f472b6 (secondary), #1a1a2e (background), #e879f9 (accent)",
  },
  {
    name: "compose",
    description: "Compose visual layout",
    category: "Design",
    handler: () => "Layout composed. Grid-based structure with emphasis on hierarchy and visual flow.",
  },
  {
    name: "brand",
    description: "Develop brand identity",
    category: "Branding",
    handler: () => "Brand identity developed. Logo, color system, typography, and voice guidelines created.",
  },
];

// Nexus-specific commands
const NEXUS_COMMANDS: AgentCommand[] = [
  {
    name: "scan",
    description: "Scan for connected devices",
    category: "IoT",
    handler: () => "Scan complete. 12 devices found: 5 smart lights, 3 sensors, 2 thermostats, 1 security camera, 1 hub.",
  },
  {
    name: "connect",
    description: "Connect to device or service",
    category: "Integration",
    handler: () => "Connection established. Device authenticated and ready for automation.",
  },
  {
    name: "automate",
    description: "Create automation rule",
    category: "Automation",
    handler: () => "Automation created: 'When motion detected, turn on lights and send notification'",
  },
  {
    name: "device-list",
    description: "List all connected devices",
    category: "IoT",
    handler: () => "Connected devices:\n- Living Room Lights (online)\n- Bedroom Thermostat (online)\n- Front Door Sensor (online)\n- Security Camera (recording)",
  },
  {
    name: "confirm",
    description: "Confirm system status",
    category: "System",
    handler: () => "System status confirmed. All services running normally. No alerts.",
  },
  {
    name: "status",
    description: "Show home automation status",
    category: "System",
    handler: () => "Home status: Armed, 12 devices online, 3 automations active, energy usage: normal",
  },
];

// Data Slayer-specific commands
const DATA_SLAYER_COMMANDS: AgentCommand[] = [
  {
    name: "analyze",
    description: "Analyze performance metrics",
    category: "Analytics",
    handler: () => "Analysis complete. Key insights: User engagement up 23%, retention at 78%, conversion rate 3.2%. Recommendation: Focus on onboarding optimization.",
  },
  {
    name: "report",
    description: "Generate detailed report",
    category: "Reporting",
    handler: () => "Report generated. Period: Last 30 days. Metrics: 12,450 unique visitors, 890 sign-ups, 34 purchases. Growth trend: Positive.",
  },
  {
    name: "chart",
    description: "Create visualization",
    category: "Visualization",
    handler: () => "Chart created. Type: Line graph showing user growth over time. Key data points highlighted. Export ready.",
  },
  {
    name: "compare",
    description: "Compare time periods",
    category: "Analytics",
    handler: () => "Comparison complete. This month vs last month: +18% traffic, +12% engagement, +8% conversion. Positive trend across all metrics.",
  },
  {
    name: "forecast",
    description: "Predict future trends",
    category: "Analytics",
    handler: () => "Forecast generated. Predicted growth: +15% next month based on current trends. Confidence: 87%. Recommended actions: Scale marketing efforts.",
  },
];

// Writing Coach-specific commands
const WRITING_COACH_COMMANDS: AgentCommand[] = [
  {
    name: "draft",
    description: "Draft new content",
    category: "Writing",
    handler: () => "Draft created. Topic: Product launch announcement. Tone: Professional yet approachable. Length: 300 words. Ready for review.",
  },
  {
    name: "rewrite",
    description: "Improve existing content",
    category: "Editing",
    handler: () => "Rewrite complete. Changes: Improved clarity, stronger call-to-action, better flow. Original meaning preserved, impact enhanced.",
  },
  {
    name: "tighten",
    description: "Make content more concise",
    category: "Editing",
    handler: () => "Content tightened. Reduced word count by 40% while maintaining key points. More punchy and direct.",
  },
  {
    name: "tone",
    description: "Adjust content tone",
    category: "Editing",
    handler: () => "Tone adjusted. Changed from formal to conversational while maintaining professionalism. More engaging and relatable.",
  },
  {
    name: "headline",
    description: "Generate compelling headlines",
    category: "Copywriting",
    handler: () => "Headlines generated:\n1. 'Transform Your Workflow with AI Agents'\n2. 'The Future of Work is Here'\n3. 'Stop Working Harder, Start Working Smarter'",
  },
];

// Music Producer-specific commands
const MUSIC_PRODUCER_COMMANDS: AgentCommand[] = [
  {
    name: "compose",
    description: "Create music composition",
    category: "Music",
    handler: () => "Composition created. Genre: Electronic. BPM: 128. Key: A minor. Structure: Intro-Verse-Chorus-Bridge-Outro. Ready for production.",
  },
  {
    name: "mix",
    description: "Mix audio tracks",
    category: "Production",
    handler: () => "Mix complete. Adjusted EQ for clarity, added compression to vocals, balanced levels. Mastered at -14 LUFS. Ready for distribution.",
  },
  {
    name: "beat",
    description: "Create beat pattern",
    category: "Production",
    handler: () => "Beat created. Style: Trap. Pattern: Kick-hat-snare-hat. Swing: 5%. Groove locked at 128 BPM. Export ready.",
  },
  {
    name: "sound",
    description: "Design sound effects",
    category: "Sound Design",
    handler: () => "Sound effects designed. Category: UI sounds. Types: Click, success, error, notification. All at 48kHz, 24-bit.",
  },
  {
    name: "master",
    description: "Master final audio",
    category: "Production",
    handler: () => "Mastering complete. LUFS: -14. Peak: -1.5dB. Stereo width enhanced. Low-end tightened. Ready for all platforms.",
  },
];

// Security Chief-specific commands
const SECURITY_CHIEF_COMMANDS: AgentCommand[] = [
  {
    name: "audit",
    description: "Run security audit",
    category: "Security",
    handler: () => "Security audit complete. Found 2 medium issues: Missing input validation on API routes, outdated dependency. 0 critical issues. Overall: Good posture.",
  },
  {
    name: "scan",
    description: "Scan for vulnerabilities",
    category: "Security",
    handler: () => "Vulnerability scan complete. 3 potential issues identified: 1 XSS risk in user input, 2 outdated packages. Priority: Medium.",
  },
  {
    name: "encrypt",
    description: "Encrypt sensitive data",
    category: "Privacy",
    handler: () => "Encryption applied. Algorithm: AES-256-GCM. Data at rest encrypted. TLS 1.3 for data in transit. Keys rotated.",
  },
  {
    name: "compliance",
    description: "Check compliance status",
    category: "Compliance",
    handler: () => "Compliance check complete. GDPR: Compliant. CCPA: Compliant. SOC2: In progress. All required data controls in place.",
  },
  {
    name: "verify",
    description: "Verify user authentication",
    category: "Security",
    handler: () => "Authentication verified. All sessions valid. MFA enabled for admin accounts. No suspicious activity detected. Token rotation active.",
  },
];

// Easter egg bonus commands
const BONUS_COMMANDS: AgentCommand[] = [
  {
    name: "matrix",
    description: "Enter the Matrix (visual easter egg)",
    category: "Easter Egg",
    handler: () => "Welcome to the Matrix, Neo. The system is yours. Red pill or blue pill? The choice is yours. 🕶️",
  },
  {
    name: "vault",
    description: "Access the secret vault (hidden features)",
    category: "Easter Egg",
    handler: () => "Vault access granted. Hidden features unlocked: 🎯 Developer mode, 🔧 Debug tools, 🚀 Performance mode, 🎨 Theme editor. Use responsibly.",
  },
  {
    name: "ascend",
    description: "Ascend to admin level (visual effect)",
    category: "Easter Egg",
    handler: () => "⚡ Ascension complete. You now have elevated clearance. System recognizes you as operator. All protocols available.",
  },
  {
    name: "legacy",
    description: "Access legacy system (retro mode)",
    category: "Easter Egg",
    handler: () => "📟 Legacy system online. Retro mode activated. Green phosphor screen engaged. 300 baud modem sounds optional.",
  },
];

export function getCommandsForAgent(agentId: string): AgentCommand[] {
  const baseCommands = [...CORE_COMMANDS];
  
  switch (agentId) {
    case "director":
      return [...baseCommands, ...DIRECTOR_COMMANDS];
    case "forge":
      return [...baseCommands, ...FORGE_COMMANDS];
    case "pulse":
      return [...baseCommands, ...PULSE_COMMANDS];
    case "visionary":
    case "pixel-forge":
      return [...baseCommands, ...VISIONARY_COMMANDS];
    case "home":
    case "nexus":
      return [...baseCommands, ...NEXUS_COMMANDS];
    case "data-slayer":
      return [...baseCommands, ...DATA_SLAYER_COMMANDS];
    case "writing-coach":
      return [...baseCommands, ...WRITING_COACH_COMMANDS];
    case "music-producer":
      return [...baseCommands, ...MUSIC_PRODUCER_COMMANDS];
    case "security-chief":
      return [...baseCommands, ...SECURITY_CHIEF_COMMANDS];
    default:
      return baseCommands;
  }
}

export async function executeCommand(
  agent: Agent,
  command: string,
  args?: string[]
): Promise<string> {
  // Check for easter egg commands first
  const bonusCommand = BONUS_COMMANDS.find((c) => c.name === command.toLowerCase());
  if (bonusCommand) {
    return await bonusCommand.handler(agent, args);
  }
  
  const commands = getCommandsForAgent(agent.id);
  const cmd = commands.find((c) => c.name === command.toLowerCase());
  
  if (!cmd) {
    return `Unknown command: ${command}. Type /help for available commands.`;
  }
  
  try {
    return await cmd.handler(agent, args);
  } catch (error) {
    return `Error executing command: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
}
