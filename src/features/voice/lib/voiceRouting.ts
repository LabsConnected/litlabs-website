import type { VoiceAgentId } from "@/features/voice/types";

export function chooseAgent(input: string): VoiceAgentId {
  const technicalIntent =
    /\b(code|build|debug|fix|deploy|github|repository|database|terminal|api|architecture|error|runtime)\b/i;

  const companionIntent =
    /\b(idea|creative|show me|surprise|what can we make|help me choose|explain|tour)\b/i;

  if (technicalIntent.test(input)) return "litt";
  if (companionIntent.test(input)) return "spark";

  return "litt";
}
