import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Guards the Studio dead-code cleanup (independently re-verified from PR #884):
// the legacy shell/canvas/command/inspector cluster, the orphaned app-level
// components and tools, and the orphaned `useStudioStore`. All were confirmed
// to have zero live (non-test, non-self) references before removal.

const SRC_ROOT = path.resolve(__dirname, "..");
const THIS_FILE = path.resolve(__filename);

const REMOVED_FILES = [
  "app/(app)/studio/components/BuilderStream.tsx",
  "app/(app)/studio/components/ProjectDrawer.tsx",
  "app/(app)/studio/components/StudioModeSwitcher.tsx",
  "app/(app)/studio/components/StudioStates.tsx",
  "app/(app)/studio/components/StudioStates.test.tsx",
  "app/(app)/studio/components/StudioTaskRail.tsx",
  "app/(app)/studio/components/VoiceDiagnosticsPanel.tsx",
  "app/(app)/studio/lib/create-api.ts",
  "app/(app)/studio/tools/AgentsTerminalTool.tsx",
  "app/(app)/studio/tools/ColorByNumberTool.tsx",
  "app/(app)/studio/tools/FlowTool.tsx",
  "app/(app)/studio/tools/LoopsTool.tsx",
  "app/(app)/studio/tools/PipelineTool.tsx",
  "components/studio/canvas/WorkspaceCanvas.tsx",
  "components/studio/command/CommandBar.tsx",
  "components/studio/inspector/RightPanel.tsx",
  "components/studio/shell/BottomDock.tsx",
  "components/studio/shell/LeftRail.tsx",
  "components/studio/shell/StudioShell.tsx",
  "components/studio/shell/TopBar.tsx",
  "stores/useStudioStore.ts",
];

// Substrings that would only appear in an import/require/re-export specifier
// pointing at one of the removed modules (relative or `@/`-aliased).
const REMOVED_IMPORT_FRAGMENTS = [
  "studio/components/BuilderStream",
  "studio/components/ProjectDrawer",
  "studio/components/StudioModeSwitcher",
  "studio/components/StudioStates",
  "studio/components/StudioTaskRail",
  "studio/components/VoiceDiagnosticsPanel",
  "studio/lib/create-api",
  "studio/tools/AgentsTerminalTool",
  "studio/tools/ColorByNumberTool",
  "studio/tools/FlowTool",
  "studio/tools/LoopsTool",
  "studio/tools/PipelineTool",
  "studio/canvas/WorkspaceCanvas",
  "studio/command/CommandBar",
  "studio/inspector/RightPanel",
  "studio/shell/BottomDock",
  "studio/shell/LeftRail",
  "studio/shell/StudioShell",
  "studio/shell/TopBar",
  "stores/useStudioStore",
];

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walkSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("studio dead-code cleanup", () => {
  it("removed files do not exist on disk", () => {
    for (const relPath of REMOVED_FILES) {
      expect(existsSync(path.join(SRC_ROOT, relPath))).toBe(false);
    }
  });

  it("no remaining source file imports a removed module", () => {
    const files = walkSourceFiles(SRC_ROOT).filter((f) => path.resolve(f) !== THIS_FILE);
    const offenders: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const fragment of REMOVED_IMPORT_FRAGMENTS) {
        if (content.includes(fragment)) {
          offenders.push(`${path.relative(SRC_ROOT, file)} references "${fragment}"`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
