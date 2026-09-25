import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

describe("project-backed Design surface", () => {
  it("never mounts the new-project greeter when an active project exists", () => {
    const builder = read("src/app/(app)/studio/components/canvas/builder/VisualCanvasBuilder.tsx");
    expect(builder).toContain("activeProjectId || serverProjectId");
    expect(builder).toContain("<ProjectDesignSurface />");
  });

  it("keeps the greeter only in the project-less canvas path", () => {
    const stage = read("src/app/(app)/studio/components/canvas/builder/CanvasStage.tsx");
    expect(stage).toContain("<EmptyCanvasGreeter />");
    expect(read("src/app/(app)/studio/components/ProjectDesignSurface.tsx")).toContain("StudioPreviewPanel");
  });

  it("shares selection through StudioContext", () => {
    const context = read("src/app/(app)/studio/context/StudioContext.tsx");
    const commandStudio = read("src/app/(app)/studio/components/CommandStudio.tsx");
    expect(context).toContain("StudioSelection");
    expect(context).toContain("setSelection");
    expect(commandStudio).toContain("onSelectionChange={setPreviewSelection}");
  });
});
