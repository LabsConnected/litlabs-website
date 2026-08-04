// Smoke test: extract the buildPlayerDocument function from page.tsx,
// transpile the TS types away with regex, and validate the generated
// script syntax with `new Function()`.
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");
const PAGE_PATH = join(ROOT, "src", "app", "games", "retro", "play", "[gameId]", "page.tsx");

const source = readFileSync(PAGE_PATH, "utf8");

// Extract the full buildPlayerDocument function source
const funcStart = source.indexOf("function buildPlayerDocument");
// The function body { comes after "): string {" — skip the type annotation { }
const bodyMarker = source.indexOf("): string {", funcStart);
const bodyStart = source.indexOf("{", bodyMarker);
let depth = 0;
let end = bodyStart;
for (let i = bodyStart; i < source.length; i++) {
  if (source[i] === "{") depth++;
  else if (source[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
}
let funcSource = source.substring(funcStart, end + 1);

// Extract escapeForScript and numericGameId
function extractFunc(name) {
  const start = source.indexOf(`function ${name}`);
  const bs = source.indexOf("{", start);
  let d = 0;
  let e = bs;
  for (let i = bs; i < source.length; i++) {
    if (source[i] === "{") d++;
    else if (source[i] === "}") { d--; if (d === 0) { e = i; break; } }
  }
  return source.substring(start, e + 1);
}

const escapeFunc = extractFunc("escapeForScript");
const numericFunc = extractFunc("numericGameId");

// Strip TS type annotations with simple regex transformations
function stripTypes(code) {
  return code
    // Remove the buildPlayerDocument signature: "opts: { ... }): string {"
    .replace(/buildPlayerDocument\(opts:\s*\{[\s\S]*?\}\):\s*string\s*\{/, "buildPlayerDocument(opts) {")
    // Remove simple type annotations on variables
    .replace(/:\s*string\b/g, "")
    .replace(/:\s*number\b/g, "")
    .replace(/:\s*boolean\b/g, "")
    .replace(/:\s*undefined\b/g, "")
    .replace(/:\s*void\b/g, "")
    // Remove `as const` 
    .replace(/\s+as\s+const\b/g, "")
    // Remove type imports/exports
    .replace(/export\s+/g, "");
}

const jsCode = [
  stripTypes(numericFunc),
  stripTypes(escapeFunc),
  stripTypes(funcSource),
  "// Test call:",
  "const html = buildPlayerDocument({",
  "  core: 'fceumm',",
  "  gameUrl: 'blob:http://localhost/test',",
  "  gameName: 'Super Mario Bros 3',",
  "  gameId: 'smb3-12345',",
  "  color: '#a78bfa',",
  "  biosUrl: undefined,",
  "  buildId: 'ejs-4.2.3-litt-v9',",
  "  dataPath: '/emulatorjs/4.2.3/data/',",
  "});",
  "console.log('HTML length:', html.length);",
  "require('fs').writeFileSync('__smoke_output.html', html);",
  // Extract the config script and write it
  "const m = html.match(/<div id=\"game\"><\\/div><script>([\\s\\S]*?)<\\/script>/);",
  "if (!m) { console.error('no script match'); process.exit(1); }",
  "const script = m[1];",
  "console.log('Script length:', script.length);",
  "require('fs').writeFileSync('__smoke_config_script.js', script);",
  "console.log('Script written to __smoke_config_script.js');",
].join("\n");

const tmpJs = join(__dirname, "__smoke_run.cjs");
writeFileSync(tmpJs, jsCode);

try {
  const { execSync } = await import("node:child_process");
  execSync(`node "${tmpJs}"`, { stdio: "inherit", cwd: __dirname });
} catch (err) {
  console.error("✖ Failed to run buildPlayerDocument:", err.message);
  process.exit(1);
}

// Now validate the extracted script syntax
const scriptPath = join(__dirname, "__smoke_config_script.js");
const configScript = readFileSync(scriptPath, "utf8");

console.log("\n--- Syntax validation ---");
try {
   
  new Function(configScript);
  console.log("✓ Config script syntax is VALID");
} catch (err) {
  console.error("✖ Config script has SYNTAX ERROR:");
  console.error(`  ${err.message}`);
  process.exit(1);
}

// Content checks
console.log("\n--- Content checks ---");
const checks = [
  { pattern: /window\.EJS_player\s*=/, label: "EJS_player" },
  { pattern: /window\.EJS_core\s*=/, label: "EJS_core" },
  { pattern: /window\.EJS_gameUrl\s*=/, label: "EJS_gameUrl" },
  { pattern: /window\.EJS_pathtodata\s*=/, label: "EJS_pathtodata" },
  { pattern: /window\.EJS_ready\s*=/, label: "EJS_ready callback" },
  { pattern: /window\.EJS_onGameStart\s*=/, label: "EJS_onGameStart callback" },
  { pattern: /__littWatch/, label: "MutationObserver progress watcher" },
  { pattern: /config script started/, label: "config-started beacon" },
];

let allFound = true;
for (const c of checks) {
  if (c.pattern.test(configScript)) {
    console.log(`  ✓ ${c.label}`);
  } else {
    console.error(`  ✖ ${c.label} MISSING`);
    allFound = false;
  }
}

// HTML structure checks
console.log("\n--- HTML structure checks ---");
const htmlPath = join(__dirname, "__smoke_output.html");
const html = readFileSync(htmlPath, "utf8");
const scriptTags = html.match(/<script/g);
const scriptEnds = html.match(/<\/script>/g);
console.log(`  <script> tags: ${scriptTags?.length ?? 0}`);
console.log(`  </script> tags: ${scriptEnds?.length ?? 0}`);
if (configScript.includes("</script")) {
  console.error("  ✖ Config script contains literal </script> — will break HTML parsing!");
  allFound = false;
} else {
  console.log("  ✓ No literal </script> in config script (escapeForScript worked)");
}
if (html.includes("loader.js")) {
  console.log("  ✓ loader.js script tag present in HTML");
} else {
  console.error("  ✖ loader.js script tag MISSING from HTML");
  allFound = false;
}
console.log(`  HTML written to: ${htmlPath}`);

// Balance check
let parenDepth = 0, braceDepth = 0, bracketDepth = 0;
for (const ch of configScript) {
  if (ch === "(") parenDepth++;
  if (ch === ")") parenDepth--;
  if (ch === "{") braceDepth++;
  if (ch === "}") braceDepth--;
  if (ch === "[") bracketDepth++;
  if (ch === "]") bracketDepth--;
}
console.log("\n--- Balance check ---");
console.log(`  Parens: ${parenDepth === 0 ? "✓" : `✖ off by ${parenDepth}`}`);
console.log(`  Braces: ${braceDepth === 0 ? "✓" : `✖ off by ${braceDepth}`}`);
console.log(`  Brackets: ${bracketDepth === 0 ? "✓" : `✖ off by ${bracketDepth}`}`);

// Cleanup
try { unlinkSync(tmpJs); } catch {}
try { unlinkSync(scriptPath); } catch {}

if (allFound && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
  console.log("\n✅ ALL SMOKE TESTS PASSED");
} else {
  console.log("\n❌ SMOKE TESTS FAILED");
  process.exit(1);
}
