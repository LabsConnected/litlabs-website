// @vitest-environment node
import { createHash } from "crypto";
import { describe, expect, it, vi } from "vitest";
import {
  isWorkspaceSeedIdentical,
  type SeedCheckProject,
  type SeedCheckTransport,
} from "./workspace-seed-check";

/**
 * Workspace seed-identity: the workspace half of the loosened reuse
 * predicate. True ONLY when the workspace is proven byte-identical to
 * the starter provisioning seeded — the scaffold manifest present and
 * valid, its hashes matching, the file set exactly the template's seed
 * set, and the non-manifest seed files hash-matching the measured
 * seed. Every doubt is false.
 *
 * Seed literals below for nextjs / react-vite non-scaffold files were
 * verified byte-exact against the real seed (sha256 + length) produced
 * by terminal-server's writeTemplateFiles on 2026-11-11.
 */

const sha = (s: string) => createHash("sha256").update(s, "utf-8").digest("hex");

const WELCOME = "<!doctype html><html><!-- LITT-WELCOME-SCREEN --><body>Welcome to LiTT</body></html>";

function manifest(templateId: string, scaffoldFiles: string[], contents: Record<string, string>): string {
  const hashes: Record<string, string> = {};
  for (const f of scaffoldFiles) hashes[f] = sha(contents[f]);
  return JSON.stringify(
    { version: 1, scaffolded: true, marker: "LITT-WELCOME-SCREEN", templateId, scaffoldFiles, hashes },
    null,
    2,
  );
}

/** In-memory transport over a path→content map, deriving directories. */
function fakeTransport(
  files: Record<string, string>,
  opts: { reachable?: boolean } = {},
): SeedCheckTransport {
  return {
    fileOpsReachable: opts.reachable !== false,
    async listFiles(path: string) {
      const prefix = path === "." ? "" : `${path}/`;
      const entries = new Map<string, string>();
      for (const filePath of Object.keys(files)) {
        if (!filePath.startsWith(prefix)) continue;
        const rest = filePath.slice(prefix.length);
        if (!rest) continue;
        const [head, ...tail] = rest.split("/");
        entries.set(head, tail.length > 0 ? "directory" : "file");
      }
      return {
        entries: [...entries.entries()].map(([name, type]) => ({ name, type })),
      };
    },
    async readFile(path: string) {
      const content = files[path];
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return { content, size: Buffer.byteLength(content) };
    },
  };
}

function project(overrides: Partial<SeedCheckProject> = {}): SeedCheckProject {
  return {
    id: "proj-1",
    templateId: "blank-static",
    workspaceId: "ws-1",
    workspaceStatus: "ready",
    workspaceRoot: "/workspaces/proj-1",
    ...overrides,
  };
}

function deps(transport: SeedCheckTransport) {
  return { createTransport: vi.fn(async () => transport) };
}

function blankStaticFiles(indexContent: string = WELCOME): Record<string, string> {
  // The manifest always records the ORIGINAL seed bytes (WELCOME) — a
  // workspace whose index.html has since changed carries this same
  // manifest with different file content, which is exactly the mismatch
  // the check must catch.
  return {
    "index.html": indexContent,
    ".litt/scaffold.json": manifest("blank-static", ["index.html"], { "index.html": WELCOME }),
  };
}

describe("isWorkspaceSeedIdentical — blank-static", () => {
  it("is true for a workspace holding exactly the seeded welcome screen", async () => {
    await expect(
      isWorkspaceSeedIdentical("user-1", project(), deps(fakeTransport(blankStaticFiles()))),
    ).resolves.toBe(true);
  });

  it("is false when index.html was overwritten to empty (started-but-unfinished build)", async () => {
    // The db1fc2fc production case: an empty-body index.html is NOT the
    // seed — the manifest hash no longer matches, so it is not a blank.
    await expect(
      isWorkspaceSeedIdentical("user-1", project(), deps(fakeTransport(blankStaticFiles("")))),
    ).resolves.toBe(false);
  });

  it("is false when index.html was edited in any way", async () => {
    await expect(
      isWorkspaceSeedIdentical(
        "user-1",
        project(),
        deps(fakeTransport(blankStaticFiles(`${WELCOME}<!-- user edit -->`))),
      ),
    ).resolves.toBe(false);
  });

  it("is false when any file was added, even alongside an untouched seed", async () => {
    const files = {
      ...blankStaticFiles(),
      "assets/images/photo.jpeg": "jpeg-bytes",
    };
    await expect(
      isWorkspaceSeedIdentical("user-1", project(), deps(fakeTransport(files))),
    ).resolves.toBe(false);
  });

  it("is false when the scaffold manifest is gone (first write consumed it)", async () => {
    await expect(
      isWorkspaceSeedIdentical(
        "user-1",
        project(),
        deps(fakeTransport({ "index.html": WELCOME })),
      ),
    ).resolves.toBe(false);
  });

  it("is false when scaffold bookkeeping beyond the manifest exists", async () => {
    const files = {
      ...blankStaticFiles(),
      ".litt/checkpoints/abc/index.html": WELCOME,
    };
    await expect(
      isWorkspaceSeedIdentical("user-1", project(), deps(fakeTransport(files))),
    ).resolves.toBe(false);
  });

  it("is false for a foreign or stale manifest (marker / template / version mismatch)", async () => {
    const contents = { "index.html": WELCOME };
    const variants = [
      manifest("blank-static", ["index.html"], contents).replace("LITT-WELCOME-SCREEN", "SOMEONE-ELSE"),
      manifest("nextjs", ["index.html"], contents),
      manifest("blank-static", ["index.html"], contents).replace('"version": 1', '"version": 2'),
    ];
    for (const bad of variants) {
      const files = { ...contents, ".litt/scaffold.json": bad };
      await expect(
        isWorkspaceSeedIdentical("user-1", project(), deps(fakeTransport(files))),
      ).resolves.toBe(false);
    }
  });
});

describe("isWorkspaceSeedIdentical — other templates", () => {
  it("empty-static: a completely empty workspace is seed-identical; any file breaks it", async () => {
    const p = project({ templateId: "empty-static" });
    await expect(isWorkspaceSeedIdentical("user-1", p, deps(fakeTransport({})))).resolves.toBe(true);
    await expect(
      isWorkspaceSeedIdentical("user-1", p, deps(fakeTransport({ "index.html": "<html/>" }))),
    ).resolves.toBe(false);
  });

  const NEXTJS_PACKAGE_JSON = JSON.stringify(
    {
      name: "my-project",
      private: true,
      scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint" },
      dependencies: { next: "^16.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
    },
    null,
    2,
  );
  const NEXTJS_LAYOUT = `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

  function nextjsFiles(overrides: Record<string, string> = {}): Record<string, string> {
    const seed = {
      "app/page.tsx": WELCOME,
      "app/layout.tsx": NEXTJS_LAYOUT,
      "package.json": NEXTJS_PACKAGE_JSON,
    };
    return {
      ...seed,
      ...overrides,
      // Manifest hashes always describe the original seed bytes.
      ".litt/scaffold.json": manifest("nextjs", ["app/page.tsx"], seed),
    };
  }

  it("nextjs: the full seeded set, byte-identical, is seed-identical", async () => {
    const p = project({ templateId: "nextjs" });
    await expect(
      isWorkspaceSeedIdentical("user-1", p, deps(fakeTransport(nextjsFiles()))),
    ).resolves.toBe(true);
  });

  it("nextjs: an edited non-scaffold seed file (package.json) breaks identity", async () => {
    const p = project({ templateId: "nextjs" });
    const files = nextjsFiles({ "package.json": NEXTJS_PACKAGE_JSON.replace("my-project", "my-app") });
    await expect(
      isWorkspaceSeedIdentical("user-1", p, deps(fakeTransport(files))),
    ).resolves.toBe(false);
  });

  it("nextjs: a missing seed file breaks identity", async () => {
    const p = project({ templateId: "nextjs" });
    const files = nextjsFiles();
    delete files["app/layout.tsx"];
    await expect(
      isWorkspaceSeedIdentical("user-1", p, deps(fakeTransport(files))),
    ).resolves.toBe(false);
  });

  it("templates without a manifest authority (expo-react-native) are never tier-2 provable", async () => {
    const p = project({ templateId: "expo-react-native" });
    await expect(
      isWorkspaceSeedIdentical("user-1", p, deps(fakeTransport({ "README.md": "# My Project\n" }))),
    ).resolves.toBe(false);
  });
});

describe("isWorkspaceSeedIdentical — fail-safe plumbing", () => {
  it("never reaches the transport for an unprovisioned or not-ready workspace", async () => {
    const createTransport = vi.fn(async () => fakeTransport(blankStaticFiles()));
    for (const bad of [
      project({ workspaceId: null }),
      project({ workspaceRoot: null }),
      project({ workspaceStatus: "failed" }),
      project({ workspaceStatus: "not_prepared" }),
    ]) {
      await expect(
        isWorkspaceSeedIdentical("user-1", bad, { createTransport }),
      ).resolves.toBe(false);
    }
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("is false when the transport cannot be created or file ops are unreachable", async () => {
    await expect(
      isWorkspaceSeedIdentical("user-1", project(), {
        createTransport: async () => {
          throw new Error("terminal down");
        },
      }),
    ).resolves.toBe(false);
    await expect(
      isWorkspaceSeedIdentical(
        "user-1",
        project(),
        deps(fakeTransport(blankStaticFiles(), { reachable: false })),
      ),
    ).resolves.toBe(false);
  });

  it("is false when the workspace listing fails midway", async () => {
    const transport = fakeTransport(blankStaticFiles());
    const original = transport.listFiles.bind(transport);
    let calls = 0;
    transport.listFiles = async (p: string) => {
      calls += 1;
      if (calls > 1) throw new Error("socket died");
      return original(p);
    };
    await expect(
      isWorkspaceSeedIdentical("user-1", project(), deps(transport)),
    ).resolves.toBe(false);
  });
});
