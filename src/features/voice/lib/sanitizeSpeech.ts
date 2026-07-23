export function sanitizeSpeech(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, " I added the code to the workspace. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>|]/g, "")
    .replace(/https?:\/\/\S+/g, "the provided link")
    .replace(
      /\b(?:src|app|components|lib|api)\/[\w./-]+\.(?:ts|tsx|js|jsx|json|css)\b/g,
      "the referenced file",
    )
    .replace(/\s+/g, " ")
    .trim();
}
