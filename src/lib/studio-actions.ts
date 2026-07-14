export type StudioActionContext = {
  route: string;
  projectId?: string;
  branch?: string;
  viewport: {
    width: number;
    height: number;
    device: "mobile" | "tablet" | "desktop";
  };
  selectedElement?: {
    label: string;
    componentName?: string;
    cssSelector?: string;
    sourceFile?: string;
  };
  visibleText: string[];
  consoleErrors: string[];
  relatedFiles: string[];
  activeAgent: string;
  userGoal?: string;
};

export type StudioActionId =
  | "improve-screen"
  | "build-idea"
  | "next-step"
  | "add-feature"
  | "explain-simply"
  | "research-best"
  | "test-repair"
  | "production-ready";

export const STUDIO_ACTIONS: Array<{
  id: StudioActionId;
  label: string;
  shortDescription: string;
}> = [
  { id: "improve-screen", label: "Fix this screen", shortDescription: "Find and repair visible UX problems" },
  { id: "build-idea", label: "Build from my idea", shortDescription: "Turn plain language into a safe plan" },
  { id: "next-step", label: "Find the next step", shortDescription: "Recommend the highest-value move" },
  { id: "add-feature", label: "Add a real feature", shortDescription: "Replace placeholders with working behavior" },
  { id: "explain-simply", label: "Explain this simply", shortDescription: "Explain the current screen without jargon" },
  { id: "research-best", label: "Research the best approach", shortDescription: "Compare current official implementations" },
  { id: "test-repair", label: "Test and repair", shortDescription: "Reproduce problems, fix, and verify" },
  { id: "production-ready", label: "Make it production-ready", shortDescription: "Finish reliability, security, and QA" },
];

const ACTION_INSTRUCTIONS: Record<StudioActionId, string> = {
  "improve-screen": `Inspect the rendered screen and related source files. Find the five highest-impact usability, visual, accessibility, responsive, and functional problems. Explain them in plain language, propose exact corrections, and define acceptance criteria. Preserve working behavior, LiTTree branding, the visible composer, camera, microphone, files, and navigation. Small isolated fixes may be implemented directly; present a plan before structural changes.`,
  "build-idea": `Help the user turn an idea into the smallest complete feature they can test today. Infer the likely goal from the active project and conversation before asking questions. Describe the user flow, real content, data, components, integrations, risks, and completion tests. Ask at most one simple choice question only if the answer materially changes the build.`,
  "next-step": `Inspect the active project and determine the single highest-value unfinished step. Consider broken flows, placeholder UI, missing backend connections, mobile usability, errors, security, and user value. Recommend one next move, explain why it wins, list affected files and dependencies, and give a concrete testable definition of done.`,
  "add-feature": `Find the most valuable placeholder, fake control, or incomplete workflow visible in this context and turn it into a real feature. Explain the user outcome first. Locate the implementation automatically, connect real data or behavior, handle loading/empty/error states, and specify mobile and desktop tests. Do not add another decorative card.`,
  "explain-simply": `Explain what this screen does, what is real, what is still simulated, and what the user can do next. Use plain language and concrete examples. Do not require the user to know component names, frameworks, APIs, or developer terminology. End with the best next action and why.`,
  "research-best": `Research the best current implementation using official documentation and primary sources. Compare two or three suitable approaches for this exact project, including compatibility, maintenance, security, cost, and UX tradeoffs. Recommend one approach, link the sources, and translate the recommendation into an implementation plan and verification checklist.`,
  "test-repair": `Reproduce the most important user flow on this screen. Inspect visible behavior, responsive layout, console errors, network failures, keyboard access, and touch targets. Identify the first blocking failure, make the smallest safe repair, then run typecheck, focused lint, production build, and relevant viewport or interaction tests. Report evidence, not guesses.`,
  "production-ready": `Audit this feature for real production use. Check authentication, authorization, error handling, loading and empty states, data persistence, accessibility, responsive behavior, performance, privacy, observability, and rollback safety. Separate blockers from later improvements, fix safe blockers, and finish with changed files, verification results, remaining risks, and the next recommended release step.`,
};

export function buildStudioActionPrompt(
  actionId: StudioActionId,
  context: StudioActionContext,
): string {
  const selected = context.selectedElement
    ? `${context.selectedElement.label}${context.selectedElement.componentName ? ` (${context.selectedElement.componentName})` : ""}`
    : "Nothing explicitly selected; infer the relevant area from the current screen.";

  return `You are LiTT-Code, the project-aware engineering guide inside LiTT Studio.

USER-FRIENDLY ACTION
${STUDIO_ACTIONS.find((action) => action.id === actionId)?.label ?? actionId}

CURRENT CONTEXT
- Route: ${context.route}
- Project: ${context.projectId ?? "active project"}
- Branch: ${context.branch ?? "not provided"}
- Viewport: ${context.viewport.width}×${context.viewport.height} (${context.viewport.device})
- Selected area: ${selected}
- Active agent: ${context.activeAgent}
- Related files: ${context.relatedFiles.join(", ") || "infer from route and repository"}
- Visible interface text: ${context.visibleText.join(" | ") || "not captured"}
- Recent browser errors: ${context.consoleErrors.join(" | ") || "none captured"}
${context.userGoal ? `- User goal: ${context.userGoal}` : ""}

WORKFLOW
${ACTION_INSTRUCTIONS[actionId]}

OPERATING RULES
- Never ask for information already visible in the route, rendered interface, repository, screenshot, DOM, or errors.
- Infer first and clarify second. If clarification is essential, ask one plain-language choice question.
- Use real content and outcome-based labels, not placeholders or vague words such as enhance or optimize.
- For large work: inspect, create a reviewable plan, then wait for approval before structural edits.
- For small safe fixes: implement directly and verify.
- Every completed build must report changed files, checks performed, failures, remaining risks, and the next recommended step.`;
}
