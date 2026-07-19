export type BuilderLocalCommand =
  | { type: "clear" }
  | { type: "new" }
  | { type: "terminal" }
  | { type: "sessions" }
  | { type: "delete" }
  | { type: "rename"; title: string }
  | { type: "help" }
  | { type: "unknown"; command: string };

export function parseBuilderLocalCommand(input: string): BuilderLocalCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const [rawCommand, ...args] = trimmed.slice(1).split(/\s+/);
  const command = rawCommand.toLowerCase();
  const argument = args.join(" ").trim();
  switch (command) {
    case "clear": return { type: "clear" };
    case "new": return { type: "new" };
    case "terminal": return { type: "terminal" };
    case "sessions": return { type: "sessions" };
    case "delete": return { type: "delete" };
    case "rename": return { type: "rename", title: argument };
    case "help": return { type: "help" };
    default: return { type: "unknown", command };
  }
}
