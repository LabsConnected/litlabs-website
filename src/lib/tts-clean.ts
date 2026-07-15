/** Converts Markdown-heavy chat output into natural text for speech. */
export function cleanTextForSpeech(input: string): string {
  if (!input) return "";

  return input
    // Remove fenced code entirely. Reading source code aloud is usually noise.
    .replace(/```[\s\S]*?```/g, " Code example omitted. ")
    // Keep inline-code words but remove their delimiters.
    .replace(/`([^`]+)`/g, "$1")
    // Images and links: keep their human label, discard the URL.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // Remove raw URLs.
    .replace(/(?:https?:\/\/|www\.)\S+/gi, "")
    // Remove slash commands as standalone tokens or lines.
    .replace(/(^|\s)\/[a-z][\w-]*(?:\s+[^\n]*)?(?=$|\n)/gim, " ")
    // Remove Markdown headings, quotes, list markers and task boxes.
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>+\s?/gm, "")
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, "")
    .replace(/\[(?:x| )\]\s*/gi, "")
    // Remove emphasis/strike markers without removing their content.
    .replace(/(\*\*|__|~~)/g, "")
    .replace(/(^|\s)[*_](?=\S)|(?<=\S)[*_](?=\s|$|[.,!?;:])/g, "$1")
    // Remove HTML tags and decode common entities.
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "and")
    .replace(/&lt;/gi, "less than")
    .replace(/&gt;/gi, "greater than")
    // Smooth remaining whitespace and punctuation.
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, ". ")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+([,.;!?])/g, "$1")
    .trim();
}
