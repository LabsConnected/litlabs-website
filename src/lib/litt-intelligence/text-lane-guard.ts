/**
 * Text-lane guard: explicit no-tools directive for the V1 text-only path.
 *
 * The V1 fallback lane attaches NO tools to the model call, but the shared
 * runtime-context block teaches tool-invocation tokens (files.write,
 * path="index.html", …). A model primed that way may echo the call as
 * ordinary text — markup that can never execute on this path.
 *
 * Appending this directive to the final prompt states the constraint
 * explicitly, so the model answers in plain words instead of emitting
 * tool-call syntax. The syntax shapes named here mirror the detectors in
 * tool-call-markup.ts (envelopes, fenced/JSON payloads, pseudo-function
 * calls); keep them in sync.
 */
export const V1_NO_TOOLS_DIRECTIVE =
  "\n\nCRITICAL — TOOL AVAILABILITY THIS TURN: you have NO tools available on this turn. " +
  "Do not emit tool-call markup of any kind — no <tool_call> or <invoke> tags, " +
  "no ```tool_call fenced blocks, no JSON tool envelopes, and no tool.name(args) " +
  "pseudo-function calls such as files.write(path=..., content=...). " +
  "None of these can execute on this turn. " +
  "If the request needs a file written, an image generated, or any other tool action, " +
  "say so in plain words instead of writing out a call.";

/** Append the no-tools directive to a V1 text-only prompt. */
export function withV1NoToolsDirective(prompt: string): string {
  return prompt + V1_NO_TOOLS_DIRECTIVE;
}
