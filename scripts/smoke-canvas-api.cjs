/**
 * Smoke test for the Canvas API — verifies the full vertical slice:
 *   create canvas → add blocks → list → update block → revision → delete
 *
 * Run: node scripts/smoke-canvas-api.cjs
 * Requires: .env.local with SUPABASE_SERVICE_ROLE_KEY
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");

const env = fs.readFileSync(".env.local", "utf8");
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY="([^"]+)"/)[1];
const url = "https://rokbfvuoqildggnhappy.supabase.co";
const sb = createClient(url, key);

const TEST_USER = "test-user-smoke-" + Date.now();
let pass = 0;
let fail = 0;

function ok(name) { pass++; console.log("  PASS: " + name); }
function bad(name, err) { fail++; console.log("  FAIL: " + name + ": " + err); }

async function run() {
  console.log("\n=== Canvas API Smoke Test ===\n");
  console.log("Test user: " + TEST_USER + "\n");

  // 1. Create canvas
  console.log("1. Create canvas");
  const { data: canvas, error: e1 } = await sb.from("canvases").insert({
    id: crypto.randomUUID(),
    user_id: TEST_USER,
    title: "Smoke Test Canvas",
    type: "notes",
    status: "active",
    version: 1,
    metadata: {},
  }).select().single();
  if (e1) { bad("create canvas", e1.message); return; }
  ok("create canvas -> " + canvas.id);

  // 2. Add blocks
  console.log("2. Add blocks");
  const blockIds = [crypto.randomUUID(), crypto.randomUUID()];
  const { data: blocks, error: e2 } = await sb.from("canvas_blocks").insert([
    { id: blockIds[0], canvas_id: canvas.id, user_id: TEST_USER, type: "heading", content: { text: "Test Heading", level: 2 }, position: 0, metadata: {} },
    { id: blockIds[1], canvas_id: canvas.id, user_id: TEST_USER, type: "paragraph", content: { text: "This is a test paragraph." }, position: 1, metadata: {} },
  ]).select();
  if (e2) { bad("add blocks", e2.message); return; }
  ok("add 2 blocks -> " + blocks.length + " created");

  // 3. List blocks
  console.log("3. List blocks");
  const { data: listed, error: e3 } = await sb.from("canvas_blocks").select("*").eq("canvas_id", canvas.id).order("position", { ascending: true });
  if (e3) { bad("list blocks", e3.message); return; }
  if (listed.length !== 2) { bad("list blocks", "expected 2, got " + listed.length); return; }
  ok("list blocks -> " + listed.length + " in order");

  // 4. Update a block
  console.log("4. Update block");
  const { data: updated, error: e4 } = await sb.from("canvas_blocks").update({ content: { text: "Updated Heading", level: 3 } }).eq("id", blockIds[0]).eq("canvas_id", canvas.id).select().single();
  if (e4) { bad("update block", e4.message); return; }
  if (updated.content.text !== "Updated Heading") { bad("update block", "content not updated"); return; }
  ok("update block -> text now '" + updated.content.text + "'");

  // 5. Record a revision
  console.log("5. Record revision");
  const { data: rev, error: e5 } = await sb.from("canvas_revisions").insert({
    id: crypto.randomUUID(),
    canvas_id: canvas.id,
    version: 2,
    actor: "user",
    source_message_id: null,
    summary: "Updated heading",
    operations: [{ op: "block.update", blockId: blockIds[0], patch: { text: "Updated Heading" }, previousContent: { text: "Test Heading", level: 2 } }],
    snapshot: null,
  }).select().single();
  if (e5) { bad("record revision", e5.message); return; }
  ok("record revision -> v" + rev.version);

  // 6. List revisions
  console.log("6. List revisions");
  const { data: revs, error: e7 } = await sb.from("canvas_revisions").select("*").eq("canvas_id", canvas.id).order("version", { ascending: false });
  if (e7) { bad("list revisions", e7.message); return; }
  ok("list revisions -> " + revs.length + " revision(s)");

  // 7. Delete a block
  console.log("7. Delete block");
  const { error: e8 } = await sb.from("canvas_blocks").delete().eq("id", blockIds[1]).eq("canvas_id", canvas.id);
  if (e8) { bad("delete block", e8.message); return; }
  const { data: afterDelete } = await sb.from("canvas_blocks").select("id").eq("canvas_id", canvas.id);
  if (afterDelete.length !== 1) { bad("delete block", "expected 1 remaining, got " + afterDelete.length); return; }
  ok("delete block -> 1 remaining");

  // 8. Cascade delete
  console.log("8. Cascade delete");
  const { error: e9 } = await sb.from("canvases").delete().eq("id", canvas.id);
  if (e9) { bad("delete canvas", e9.message); return; }
  const { data: orphanBlocks } = await sb.from("canvas_blocks").select("id").eq("canvas_id", canvas.id);
  const { data: orphanRevs } = await sb.from("canvas_revisions").select("id").eq("canvas_id", canvas.id);
  if (orphanBlocks.length !== 0 || orphanRevs.length !== 0) { bad("cascade delete", "orphaned rows remain"); return; }
  ok("cascade delete -> blocks + revisions gone");

  console.log("\n=== Results ===");
  console.log("  Passed: " + pass);
  console.log("  Failed: " + fail);
  console.log(fail === 0 ? "\nALL TESTS PASSED\n" : "\nSOME TESTS FAILED\n");
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((err) => { console.error("Fatal:", err); process.exit(1); });
