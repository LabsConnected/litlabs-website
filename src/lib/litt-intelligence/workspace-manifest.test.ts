import { describe, it, expect } from "vitest";
import {
  captureWorkspaceManifest,
  manifestChangeEvidence,
  MANIFEST_MAX_FILES,
  type WorkspaceManifestProbe,
} from "./workspace-manifest";

function probe(files: Record<string, string>): WorkspaceManifestProbe {
  return {
    async listFiles(path) {
      const prefix = path === "." ? "" : `${path}/`;
      const names = new Map<string, string>();
      for (const key of Object.keys(files)) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const seg = rest.split("/")[0];
        names.set(seg, rest.includes("/") ? "directory" : "file");
      }
      return { entries: [...names.entries()].map(([name, type]) => ({ name, type })) };
    },
    async readFile(path) {
      const content = files[path];
      if (content === undefined) throw new Error(`missing ${path}`);
      return { content, size: content.length };
    },
  };
}

describe("captureWorkspaceManifest", () => {
  it("captures nested files with stable hashes", async () => {
    const { manifest } = await captureWorkspaceManifest(
      probe({ "index.html": "<h1>hi</h1>", "assets/app.js": "console.log(1)" }),
    );
    expect([...manifest.keys()].sort()).toEqual(["assets/app.js", "index.html"]);
  });

  it("skips unreadable files instead of failing", async () => {
    const p = probe({ "a.txt": "ok", "b.txt": "ok" });
    const orig = p.readFile;
    p.readFile = (path) => (path === "b.txt" ? Promise.reject(new Error("denied")) : orig(path));
    const { manifest } = await captureWorkspaceManifest(p);
    expect([...manifest.keys()]).toEqual(["a.txt"]);
  });
});

describe("manifestChangeEvidence", () => {
  it("reports unchanged for identical manifests", async () => {
    const { manifest } = await captureWorkspaceManifest(probe({ "index.html": "x" }));
    const evidence = manifestChangeEvidence(manifest, new Map(manifest), false);
    expect(evidence.status).toBe("unchanged");
    expect(evidence.files).toEqual([]);
  });

  it("reports added, modified, and deleted files", async () => {
    const before = (await captureWorkspaceManifest(probe({ "index.html": "v1", "old.txt": "x" }))).manifest;
    const after = (await captureWorkspaceManifest(
      probe({ "index.html": "v2", "new.css": "body{}" }),
    )).manifest;
    const evidence = manifestChangeEvidence(before, after, false);
    expect(evidence.status).toBe("changed");
    expect(evidence.files).toEqual(["index.html", "new.css", "old.txt"]);
  });

  it("marks truncated comparisons honestly", async () => {
    const evidence = manifestChangeEvidence(new Map(), new Map([["a", "h"]]), true);
    expect(evidence.status).toBe("changed");
    expect(evidence.unknownReason).toContain("truncated");
  });
});
