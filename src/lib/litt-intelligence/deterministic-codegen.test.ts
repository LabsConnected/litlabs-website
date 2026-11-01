import { describe, it, expect } from "vitest";
import {
  parseDeterministicFilesOutput,
  validateGeneratedFile,
  validateEditFiles,
  normalizeWebsiteFiles,
  assembleIndexHtml,
  extractHtmlBodyFragment,
  isSafeGeneratedPath,
  isDeterministicCodegenModel,
  generateDeterministicWebsite,
  generateDeterministicEdit,
  snapshotWebsiteFiles,
  referencedAssets,
  CODEGEN_FILES_SCHEMA,
  WELCOME_SCREEN_MARKER,
} from "./deterministic-codegen";

const VALID_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Fermata</title>
<link rel="stylesheet" href="style.css"></head>
<body><header><h1>Fermata Coffee</h1><button id="order">Order</button></header>
<script src="app.js" defer></script></body></html>`;

const VALID_CSS = `body { margin: 0; background: #1a120b; color: #f5ead9; }
#order { background: #c98f4e; }`;

const VALID_JS = `document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("order").addEventListener("click", () => {
    document.getElementById("status").textContent = "brewing";
  });
});`;

const filesPayload = (files: Array<{ path: string; content: string }>) =>
  JSON.stringify({ files });

describe("deterministic-codegen — model eligibility", () => {
  it("recognizes the litt-coder pin in all accepted forms", () => {
    expect(isDeterministicCodegenModel("ollama/litt-coder:8k")).toBe(true);
    expect(isDeterministicCodegenModel("litt-coder:8k")).toBe(true);
    expect(isDeterministicCodegenModel("ollama-litt-coder-8k")).toBe(true);
  });
  it("rejects non-lane models and junk", () => {
    expect(isDeterministicCodegenModel("gemini-2.5-flash")).toBe(false);
    expect(isDeterministicCodegenModel("ollama/litt-hermes-fast:8k")).toBe(false);
    expect(isDeterministicCodegenModel("")).toBe(false);
    expect(isDeterministicCodegenModel(undefined)).toBe(false);
  });
});

describe("parseDeterministicFilesOutput", () => {
  it("accepts the canonical files[] shape", () => {
    const r = parseDeterministicFilesOutput(
      filesPayload([
        { path: "index.html", content: VALID_HTML },
        { path: "style.css", content: VALID_CSS },
      ]),
    );
    expect(r.ok).toBe(true);
    expect(r.files.map((f) => f.path)).toEqual(["index.html", "style.css"]);
    expect(r.files[0].via).toBe("files-json");
  });

  it("unwraps text-format write_file calls (the model's natural output)", () => {
    const raw = JSON.stringify({
      name: "write_file",
      arguments: { path: "app.js", content: VALID_JS },
    });
    const r = parseDeterministicFilesOutput(raw);
    expect(r.ok).toBe(true);
    expect(r.files[0]).toMatchObject({ path: "app.js", via: "tool-call-text" });
  });

  it("unwraps write_file calls with stringified arguments and JSONL sequences", () => {
    const line1 = JSON.stringify({ name: "write_file", arguments: JSON.stringify({ path: "index.html", content: VALID_HTML }) });
    const line2 = JSON.stringify({ name: "write_file", arguments: JSON.stringify({ path: "app.js", content: VALID_JS }) });
    const r = parseDeterministicFilesOutput(`${line1}\n${line2}`);
    expect(r.files.map((f) => f.path).sort()).toEqual(["app.js", "index.html"]);
  });

  it("rejects phantom (non-file) tool calls", () => {
    const raw = JSON.stringify({ name: "DOMContentLoaded", arguments: { foo: 1 } });
    const r = parseDeterministicFilesOutput(raw);
    expect(r.ok).toBe(false);
    expect(r.rejected.some((x) => x.reason === "phantom-tool-call")).toBe(true);
  });

  it("rejects parameter-schema echoes", () => {
    const r = parseDeterministicFilesOutput(
      filesPayload([{ path: "style.css", content: '{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]}' }]),
    );
    expect(r.ok).toBe(false);
    expect(r.rejected.some((x) => x.reason === "schema-echo" && x.path === "style.css")).toBe(true);
  });

  it("repairs literal \\n corruption and flags the repair", () => {
    const corrupted = VALID_JS.replace(/\n/g, "\\n");
    const r = parseDeterministicFilesOutput(filesPayload([{ path: "app.js", content: corrupted }]));
    expect(r.ok).toBe(true);
    expect(r.files[0].content).toContain("\n");
    expect(r.repairs).toContain("unescaped-newlines:app.js");
  });

  it("rejects malformed JSON outright", () => {
    const r = parseDeterministicFilesOutput("this is not json at all {{{");
    expect(r.ok).toBe(false);
    expect(r.rejected.some((x) => x.reason === "malformed-json")).toBe(true);
  });

  it("rejects unsafe paths, bad extensions, and duplicates", () => {
    const r = parseDeterministicFilesOutput(
      filesPayload([
        { path: "../escape.html", content: VALID_HTML },
        { path: "/abs.css", content: VALID_CSS },
        { path: "evil.exe", content: "MZ" },
        { path: "index.html", content: VALID_HTML },
        { path: "INDEX.html", content: VALID_HTML },
      ]),
    );
    const reasons = r.rejected.map((x) => x.reason);
    expect(reasons).toContain("bad-path");
    expect(reasons).toContain("bad-extension");
    expect(reasons).toContain("duplicate-path");
    expect(r.files.map((f) => f.path)).toEqual(["index.html"]);
  });
});

describe("validateGeneratedFile", () => {
  it("requires complete HTML5 structure", () => {
    expect(validateGeneratedFile("index.html", VALID_HTML).ok).toBe(true);
    const bad = validateGeneratedFile("index.html", "<html><body>hi</body></html>");
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(" ")).toContain("doctype");
  });
  it("validates CSS brace balance and rejects HTML leakage", () => {
    expect(validateGeneratedFile("style.css", VALID_CSS).ok).toBe(true);
    expect(validateGeneratedFile("style.css", "body { color: red;").ok).toBe(false);
    expect(validateGeneratedFile("style.css", "<div>not css</div>").ok).toBe(false);
  });
  it("syntax-checks JavaScript without executing it", () => {
    expect(validateGeneratedFile("app.js", VALID_JS).ok).toBe(true);
    expect(validateGeneratedFile("app.js", "function (broken {").ok).toBe(false);
  });
  it("validates JSON files", () => {
    expect(validateGeneratedFile("data.json", '{"a":1}').ok).toBe(true);
    expect(validateGeneratedFile("data.json", "{a:1}").ok).toBe(false);
  });
});

describe("deterministic template", () => {
  it("produces a valid HTML5 document with asset links", () => {
    const html = assembleIndexHtml({ title: "T <x>", bodyHtml: "<p>hi</p>", cssPath: "style.css", jsPath: "app.js" });
    expect(validateGeneratedFile("index.html", html).ok).toBe(true);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('href="style.css"');
    expect(html).toContain('src="app.js"');
    expect(html).toContain("T &lt;x&gt;");
  });
  it("extracts a body fragment from partial documents", () => {
    expect(extractHtmlBodyFragment("<body><p>x</p></body>")).toBe("<p>x</p>");
    expect(extractHtmlBodyFragment("<h1>fragment only</h1>")).toBe("<h1>fragment only</h1>");
    expect(extractHtmlBodyFragment("<!doctype html><html><head></head></html>")).toBeNull();
  });
  it("collects referenced css/js assets", () => {
    const a = referencedAssets(VALID_HTML);
    expect(a.css).toEqual(["style.css"]);
    expect(a.js).toEqual(["app.js"]);
  });
});

describe("normalizeWebsiteFiles", () => {
  const mk = (path: string, content: string) => ({ path, content, via: "files-json" as const });
  it("renames a lone non-index html file to index.html", () => {
    const repairs: string[] = [];
    const out = normalizeWebsiteFiles([mk("site.html", VALID_HTML)], "P", repairs, []);
    expect(out?.[0].path).toBe("index.html");
    expect(repairs[0]).toContain("renamed-index");
  });
  it("template-wraps a salvageable body fragment", () => {
    const repairs: string[] = [];
    const fragment = "<header><h1>Big enough fragment to keep</h1><p>content here</p></header>";
    const out = normalizeWebsiteFiles([mk("index.html", fragment)], "P", repairs, []);
    expect(validateGeneratedFile("index.html", out![0].content).ok).toBe(true);
    expect(repairs).toContain("index-template-wrap:index.html");
  });
  it("returns null when no index salvage exists", () => {
    expect(normalizeWebsiteFiles([mk("a.css", VALID_CSS)], "P", [], [])).toBeNull();
  });
});

describe("generateDeterministicWebsite (stubbed model)", () => {
  const okCaller = () => async () => ({
    content: filesPayload([
      { path: "index.html", content: VALID_HTML },
      { path: "style.css", content: VALID_CSS },
      { path: "app.js", content: VALID_JS },
    ]),
    latencyMs: 5,
    promptTokens: 100,
    completionTokens: 300,
  });

  it("returns validated files on first good output", async () => {
    const { files, diagnostics } = await generateDeterministicWebsite({
      userRequest: "build a site",
      model: "litt-coder:8k",
      callModel: okCaller(),
    });
    expect(files.map((f) => f.path)).toEqual(["index.html", "style.css", "app.js"]);
    expect(diagnostics.attempts).toBe(1);
    expect(diagnostics.completionTokens).toBe(300);
  });

  it("retries with feedback after invalid output, then succeeds", async () => {
    let calls = 0;
    const caller = async () => {
      calls++;
      if (calls === 1) return { content: "not json", latencyMs: 5 };
      return {
        content: filesPayload([
          { path: "index.html", content: VALID_HTML },
          { path: "style.css", content: VALID_CSS },
          { path: "app.js", content: VALID_JS },
        ]),
        latencyMs: 5,
      };
    };
    const { diagnostics } = await generateDeterministicWebsite({
      userRequest: "build",
      model: "litt-coder:8k",
      callModel: caller,
      maxAttempts: 3,
    });
    expect(calls).toBe(2);
    expect(diagnostics.attempts).toBe(2);
    expect(diagnostics.rejected.length).toBeGreaterThan(0);
  });

  it("retries when index.html links an asset that was not generated", async () => {
    let calls = 0;
    const htmlOnly = () => filesPayload([{ path: "index.html", content: VALID_HTML }]);
    const full = () => filesPayload([
      { path: "index.html", content: VALID_HTML },
      { path: "style.css", content: VALID_CSS },
      { path: "app.js", content: VALID_JS },
    ]);
    const caller = async () => ({ content: ++calls === 1 ? htmlOnly() : full(), latencyMs: 5 });
    const { files, diagnostics } = await generateDeterministicWebsite({
      userRequest: "build", model: "litt-coder:8k", callModel: caller, maxAttempts: 3,
    });
    expect(calls).toBe(2);
    expect(files).toHaveLength(3);
  });

  it("fails honestly after bounded retries", async () => {
    const caller = async () => ({ content: "{broken", latencyMs: 5 });
    await expect(
      generateDeterministicWebsite({ userRequest: "build", model: "litt-coder:8k", callModel: caller, maxAttempts: 2 }),
    ).rejects.toMatchObject({ name: "DeterministicCodegenError", code: "invalid-output" });
  });
});

describe("path safety + schema", () => {
  it("accepts in-workspace relative paths only", () => {
    expect(isSafeGeneratedPath("index.html")).toBe(true);
    expect(isSafeGeneratedPath("assets/site.css")).toBe(true);
    expect(isSafeGeneratedPath("..\\up.html")).toBe(false);
    expect(isSafeGeneratedPath("C:/win.html")).toBe(false);
  });
  it("schema requires files[] with path+content strings", () => {
    expect(CODEGEN_FILES_SCHEMA.required).toEqual(["files"]);
  });
});

// ─── Phase 3: edit mode ──────────────────────────────────────────

const EDIT_HTML = VALID_HTML.replace("Fermata Coffee", "Roasted Bean Co");
const NEW_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>About</title>
<link rel="stylesheet" href="style.css"></head>
<body><h1>About us</h1></body></html>`;

describe("validateEditFiles", () => {
  const existing = new Map([
    ["index.html", VALID_HTML],
    ["style.css", VALID_CSS],
    ["app.js", VALID_JS],
  ]);
  const mk = (path: string, content: string) => ({ path, content, via: "files-json" as const });

  it("accepts html references that resolve to on-disk files", () => {
    // NEW_PAGE references style.css which exists on disk but is not emitted.
    expect(validateEditFiles([mk("about.html", NEW_PAGE)], existing)).toEqual([]);
  });
  it("rejects html references to files neither emitted nor on disk", () => {
    const page = NEW_PAGE.replace("style.css", "missing.css");
    const errs = validateEditFiles([mk("about.html", page)], existing);
    expect(errs.join(" ")).toContain("missing.css");
  });
  it("still enforces per-type syntax on emitted files", () => {
    const errs = validateEditFiles([mk("app.js", "function (broken {")], existing);
    expect(errs.join(" ")).toContain("app.js");
  });
});

describe("generateDeterministicEdit (stubbed model)", () => {
  const existing = new Map([
    ["index.html", VALID_HTML],
    ["style.css", VALID_CSS],
    ["app.js", VALID_JS],
  ]);
  const caller = (content: string) => async () => ({ content, latencyMs: 5 });

  it("classifies added / changed / unchanged and emits the write plan", async () => {
    const { files } = await generateDeterministicEdit({
      userRequest: "rename the brand and add an about page",
      model: "litt-coder:8k",
      existingFiles: existing,
      callModel: caller(filesPayload([
        { path: "index.html", content: EDIT_HTML },     // changed
        { path: "about.html", content: NEW_PAGE },      // added
        { path: "style.css", content: VALID_CSS },      // unchanged echo
      ])),
    });
    const byPath = Object.fromEntries(files.map((f) => [f.path, f.kind]));
    expect(byPath["index.html"]).toBe("changed");
    expect(byPath["about.html"]).toBe("added");
    expect(byPath["style.css"]).toBe("unchanged");
    // app.js was never emitted → structurally untouchable.
    expect(files.map((f) => f.path)).not.toContain("app.js");
  });

  it("retries when the payload is all byte-identical echoes", async () => {
    let calls = 0;
    const retryCaller = async () => ({
      content: ++calls === 1
        ? filesPayload([{ path: "style.css", content: VALID_CSS }]) // identical echo
        : filesPayload([{ path: "style.css", content: VALID_CSS + "\nh1 { letter-spacing: 1px; }\n" }]),
      latencyMs: 5,
    });
    const { files, diagnostics } = await generateDeterministicEdit({
      userRequest: "increase letter spacing",
      model: "litt-coder:8k",
      existingFiles: existing,
      callModel: retryCaller,
      maxAttempts: 3,
    });
    expect(calls).toBe(2);
    expect(files[0].kind).toBe("changed");
    expect(diagnostics.attempts).toBe(2);
  });

  it("fails honestly when all echoes stay identical", async () => {
    await expect(
      generateDeterministicEdit({
        userRequest: "change something",
        model: "litt-coder:8k",
        existingFiles: existing,
        callModel: caller(filesPayload([{ path: "style.css", content: VALID_CSS }])),
        maxAttempts: 2,
      }),
    ).rejects.toMatchObject({ name: "DeterministicCodegenError", code: "invalid-output" });
  });

  it("retries when a quoted contract literal never lands, then succeeds when it does", async () => {
    let calls = 0;
    const missingLiteral = VALID_CSS;
    const withLiteral = VALID_CSS + "\n/* BANNER-TEXT */\n";
    const caller = async () => {
      calls++;
      return {
        content: filesPayload([
          { path: "style.css", content: calls === 1 ? missingLiteral : withLiteral },
        ]),
        latencyMs: 5,
      };
    };
    const { files } = await generateDeterministicEdit({
      userRequest: 'add a comment containing "banner-text"',
      model: "litt-coder:8k",
      existingFiles: existing,
      callModel: caller,
      maxAttempts: 3,
    });
    expect(calls).toBe(2);
    expect(files[0].content.toLowerCase()).toContain("banner-text");
  });

  it("fails honestly when the contract literal never appears", async () => {
    await expect(
      generateDeterministicEdit({
        userRequest: 'add a comment containing "never-present"',
        model: "litt-coder:8k",
        existingFiles: existing,
        callModel: caller(filesPayload([{ path: "style.css", content: VALID_CSS + "\n.x{}" }])),
        maxAttempts: 2,
      }),
    ).rejects.toMatchObject({ name: "DeterministicCodegenError", code: "invalid-output" });
  });

  it("does not treat path-like or extension-like quoted strings as contract literals", async () => {
    const { files } = await generateDeterministicEdit({
      userRequest: 'update "index.html" and "style.css" with fresh colors',
      model: "litt-coder:8k",
      existingFiles: existing,
      callModel: caller(filesPayload([{ path: "style.css", content: VALID_CSS + "\n.y{}" }])),
      maxAttempts: 1,
    });
    expect(files[0].path).toBe("style.css");
  });
});

describe("snapshotWebsiteFiles", () => {
  type Entry = { name: string; type: string };
  const fakeTransport = (files: Record<string, string>) => ({
    listFiles: async (dir: string) => ({
      entries: dir === ""
        ? Object.keys(files).map((name): Entry => ({ name, type: "file" }))
        : [],
    }),
    readFile: async (p: string) => {
      if (!(p in files)) throw new Error("ENOENT");
      return { content: files[p], size: files[p].length };
    },
    writeFile: async () => ({ saved: true }),
    createCheckpointBeforeMutation: async () => null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  it("detects a real site → edit mode", async () => {
    const r = await snapshotWebsiteFiles(fakeTransport({
      "index.html": VALID_HTML,
      "style.css": VALID_CSS,
      "notes.txt": "ignore me",
    }));
    expect(r.kind).toBe("edit");
    expect(r.snapshot!.files.get("index.html")).toBe(VALID_HTML);
    expect(r.snapshot!.files.has("style.css")).toBe(true);
  });
  it("welcome-screen index.html → build mode", async () => {
    const r = await snapshotWebsiteFiles(fakeTransport({
      "index.html": `<html><body><!-- ${WELCOME_SCREEN_MARKER} --></body></html>`,
    }));
    expect(r.kind).toBe("build");
  });
  it("missing index.html → build mode", async () => {
    const r = await snapshotWebsiteFiles(fakeTransport({ "style.css": VALID_CSS }));
    expect(r.kind).toBe("build");
  });
  it("oversized real site → too-large", async () => {
    const r = await snapshotWebsiteFiles(fakeTransport({
      "index.html": VALID_HTML + "x".repeat(11 * 1024),
    }));
    expect(r.kind).toBe("too-large");
  });
  it("welcome screen over the byte budget still → build mode", async () => {
    const r = await snapshotWebsiteFiles(fakeTransport({
      "index.html": `<html><body><!-- ${WELCOME_SCREEN_MARKER} -->${"x".repeat(11 * 1024)}</body></html>`,
    }));
    expect(r.kind).toBe("build");
  });
});
