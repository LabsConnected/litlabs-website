export type DiagnosticSeverity = "error" | "warning" | "info";

export interface StructuredDiagnostic {
  file?: string;
  line?: number;
  column?: number;
  severity: DiagnosticSeverity;
  message: string;
  source: string;
}

/**
 * Parse common compiler/linter/test output into bounded, source-labelled
 * diagnostics. The raw command output remains available for full details;
 * this projection is only for navigation and the Mission activity UI.
 */
export function parseDiagnostics(
  output: string,
  source: string,
): StructuredDiagnostic[] {
  const diagnostics: StructuredDiagnostic[] = [];
  const seen = new Set<string>();
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^(.*?)(?::(\d+)(?::(\d+))?)?\s*[-:]\s*(error|warning)\b\s*:??\s*(.+)$/i);
    const fallback = line.match(/\b(error|warning)\b\s*:?\s*(.+)$/i);
    if (!match && !fallback) continue;

    const file = match?.[1]?.trim() || undefined;
    const lineNumber = match?.[2] ? Number(match[2]) : undefined;
    const column = match?.[3] ? Number(match[3]) : undefined;
    const severity = ((match?.[4] ?? fallback?.[1])?.toLowerCase() === "warning" ? "warning" : "error") as DiagnosticSeverity;
    const message = (match?.[5] ?? fallback?.[2] ?? line).trim();
    const key = `${file ?? ""}:${lineNumber ?? ""}:${column ?? ""}:${severity}:${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push({ file, line: lineNumber, column, severity, message, source });
    if (diagnostics.length >= 100) break;
  }

  return diagnostics;
}
