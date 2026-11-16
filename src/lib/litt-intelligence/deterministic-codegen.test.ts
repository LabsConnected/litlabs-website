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
  persistDeterministicFiles,
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

// Multi-section page shaped like the incident site: nav, hero, gallery
// images, menu/about sections, footer, and an inline theme. A follow-up
// "change the heading + use a warm brown theme" once replaced ALL of
// this with a heading and a two-image gallery — every unrelated block
// deleted while read-back still "verified" the write.
const INCIDENT_SITE = `<!doctype html><html><head><title>Ember Oak</title><style>
body{font-family:Georgia,serif;background:#f7f2ea;color:#2c2420}
nav{display:flex;gap:18px;padding:14px 24px;background:#efe6d8}
nav a{color:#5b4636;text-decoration:none}
.hero{padding:60px 24px;text-align:center}
.gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:24px}
.gallery img{width:100%;border-radius:8px}
.menu{padding:24px;max-width:720px;margin:0 auto}
footer{padding:24px;text-align:center;background:#efe6d8}
</style></head><body>
<nav><a href="#menu">Menu</a><a href="#gallery">Gallery</a><a href="#about">About</a><a href="#contact">Contact</a></nav>
<header class="hero"><h1>EMBER OAK</h1><p>Small-batch roasted coffee</p></header>
<section class="gallery" id="gallery">
<img src="gallery-1.jpg" alt="Pour over"><img src="gallery-2.jpg" alt="Espresso shot"><img src="gallery-3.jpg" alt="Roasted beans">
</section>
<section class="menu" id="menu"><h2>Menu</h2><ul><li>Pour Over — 4</li><li>Espresso — 3</li><li>Flat White — 5</li></ul></section>
<section class="about" id="about"><h2>About</h2><p>Roasted in-house every week.</p></section>
<footer id="contact"><p>Visit us — 12 Roast Lane</p></footer>
</body></html>`;

// The incident output: requested change applied, everything else deleted.
// Still "styled" — the old styling-signature guard could not see it.
const GUTTED_SITE = `<!doctype html><html><head><title>Ember Oak Roasted</title><style>
body{background:#5b3a29;color:#f5ead9;font-family:Georgia,serif}
h1{color:#d9a05b}
.gallery{display:grid;gap:16px;padding:24px}
</style></head><body>
<h1>EMBER OAK ROASTED</h1>
<div class="gallery"><img src="a.jpg"><img src="b.jpg"></div>
</body></html>`;

// The correct edit: heading + warm-brown body — everything else kept.
const PRESERVING_SITE = INCIDENT_SITE
  .replace("<h1>EMBER OAK</h1>", "<h1>EMBER OAK ROASTED</h1>")
  .replace("background:#f7f2ea", "background:#5b3a29");

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

  it("rejects a styled rewrite that deletes most of an existing file", () => {
    const errs = validateEditFiles(
      [mk("index.html", GUTTED_SITE)],
      new Map([["index.html", INCIDENT_SITE]]),
      { userRequest: "Change the main heading to EMBER OAK ROASTED and make the page use a warm brown theme" },
    );
    expect(errs.join(" ")).toContain("index.html");
    expect(errs.join(" ")).toContain("existing content");
  });

  it("accepts a rewrite that keeps the existing content", () => {
    expect(
      validateEditFiles(
        [mk("index.html", PRESERVING_SITE)],
        new Map([["index.html", INCIDENT_SITE]]),
        { userRequest: "Change the main heading and the theme" },
      ),
    ).toEqual([]);
  });

  it("does not gate a full rewrite when the request asks for one", () => {
    expect(
      validateEditFiles(
        [mk("index.html", GUTTED_SITE)],
        new Map([["index.html", INCIDENT_SITE]]),
        { userRequest: "rebuild the site from scratch as a single heading page" },
      ),
    ).toEqual([]);
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

describe("generateDeterministicEdit — destructive-rewrite guard (P0)", () => {
  const incidentDisk = () => new Map([["index.html", INCIDENT_SITE]]);
  const request =
    "Change the main heading to EMBER OAK ROASTED and make the page use a warm brown theme";

  it("retries a gutted rewrite, then accepts the preserving one", async () => {
    let calls = 0;
    const caller = async () => ({
      content: ++calls === 1
        ? filesPayload([{ path: "index.html", content: GUTTED_SITE }])
        : filesPayload([{ path: "index.html", content: PRESERVING_SITE }]),
      latencyMs: 5,
    });
    const { files, diagnostics } = await generateDeterministicEdit({
      userRequest: request,
      model: "litt-coder:8k",
      existingFiles: incidentDisk(),
      callModel: caller,
      maxAttempts: 3,
    });
    expect(calls).toBe(2);
    expect(diagnostics.attempts).toBe(2);
    const index = files.find((f) => f.path === "index.html")!;
    expect(index.kind).toBe("changed");
    // The landed plan carries the requested change AND every unrelated block.
    expect(index.content).toContain("EMBER OAK ROASTED");
    for (const marker of ["<nav", "<section", "gallery-3.jpg", "<footer", "Roast Lane"]) {
      expect(index.content).toContain(marker);
    }
  });

  it("fails honestly when every attempt deletes the existing page", async () => {
    const caller = async () => ({
      content: filesPayload([{ path: "index.html", content: GUTTED_SITE }]),
      latencyMs: 5,
    });
    await expect(
      generateDeterministicEdit({
        userRequest: request,
        model: "litt-coder:8k",
        existingFiles: incidentDisk(),
        callModel: caller,
        maxAttempts: 2,
      }),
    ).rejects.toMatchObject({ name: "DeterministicCodegenError", code: "invalid-output" });
  });

  it("end-to-end: the persisted file keeps nav/sections/images, changing only the request", async () => {
    const disk = new Map([["index.html", INCIDENT_SITE]]);
    let calls = 0;
    const caller = async () => ({
      content: ++calls === 1
        ? filesPayload([{ path: "index.html", content: GUTTED_SITE }])
        : filesPayload([{ path: "index.html", content: PRESERVING_SITE }]),
      latencyMs: 5,
    });
    const transport = {
      readFile: async (p: string) => {
        if (!disk.has(p)) throw new Error("ENOENT");
        return { content: disk.get(p)!, size: disk.get(p)!.length };
      },
      writeFile: async (p: string, c: string) => {
        disk.set(p, c);
        return { saved: true };
      },
      createCheckpointBeforeMutation: async () => null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const { files } = await generateDeterministicEdit({
      userRequest: request,
      model: "litt-coder:8k",
      existingFiles: new Map(disk),
      callModel: caller,
      maxAttempts: 3,
    });
    const persist = await persistDeterministicFiles(
      transport,
      files.map((f) => ({ path: f.path, content: f.content, bytes: f.bytes, source: "model" as const })),
    );
    expect(persist.writes.every((w) => w.ok && w.verified)).toBe(true);

    // Read-back on the real stored bytes: the follow-up edit must preserve
    // everything the request never mentioned and change only what it named.
    const landed = disk.get("index.html")!;
    expect(landed).toContain("EMBER OAK ROASTED");
    expect(landed).toContain("background:#5b3a29");
    for (const marker of [
      "<nav", 'href="#menu"', "<section", "gallery-1.jpg", "gallery-3.jpg",
      "Pour Over", "<footer", "Roast Lane",
    ]) {
      expect(landed).toContain(marker);
    }
    expect(landed).not.toContain("EMBER OAK</h1>");
    // Every unrelated line of the original survives byte-for-byte — the
    // diff between before/after is only the heading and the body color.
    const before = new Set(INCIDENT_SITE.split("\n"));
    const removedLines = [...before].filter((l) => !landed.includes(l));
    expect(removedLines).toEqual([
      "body{font-family:Georgia,serif;background:#f7f2ea;color:#2c2420}",
      '<header class="hero"><h1>EMBER OAK</h1><p>Small-batch roasted coffee</p></header>',
    ]);
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
