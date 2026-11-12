import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf-8");
}

describe("Global LiTT singleton surface", () => {
  it("keeps the legacy companion guest-only on AppShell routes", () => {
    const layout = read("src/components/LayoutShell.tsx");
    expect(layout).toContain("!isStudio && !isSignedIn && <GlobalCompanion />");
  });

  it("keeps the authenticated operator persistent but hidden inside Studio", () => {
    const entry = read("src/components/litt/GlobalLittEntry.tsx");
    expect(entry).toContain('fetch("/api/litt/global"');
    expect(entry).toContain('pathname.startsWith("/studio")');
    expect(entry).toContain("resolveLittNavigation(trimmed, context, null)");
    expect(entry).toContain("studioBridgeUrl(context, lastUserMessage?.content ?? draft, null)");
    expect(entry).not.toContain("useConversationStore");
  });
});
