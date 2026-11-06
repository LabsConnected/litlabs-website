import { readFileSync } from "node:fs";
import { missionSchema } from "../lib/missions/contracts.js";
import { listMissions, loadMission, loadState, saveMission, saveState } from "../lib/missions/store.js";
import { runMission } from "../lib/missions/runner.js";

// litt mission — Mission Controller Stage 1 CLI.
//
//   litt mission create --file <mission.json>   validate + persist
//   litt mission start  --id <id>               run/resume the loop
//   litt mission resume --id <id>               alias for start
//   litt mission status [--id <id>]             report
//   litt mission list                           all missions + status
//
// Exit codes mirror `litt repair`: 0 complete · 1 blocked/failed ·
// 2 usage error · 3 parked on owner gate.

function argValue(args: string[], name: string): string | null {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

function printState(id: string, state: ReturnType<typeof loadState>, workspace: string): void {
  const mission = loadMission(workspace, id);
  console.log(`\n── mission ${id} — ${mission?.title ?? "?"} — ${state.status}`);
  for (const [sid, ss] of Object.entries(state.steps)) {
    console.log(`   [${ss.status}] ${sid} (attempts ${ss.attempts})`);
    for (const ev of ss.evidence.slice(-2)) console.log(`       ${ev}`);
  }
}

export async function missionCommand(args: string[]): Promise<number> {
  const sub = args[0];
  const workspace = process.cwd();

  if (sub === "list") {
    const all = listMissions(workspace);
    if (all.length === 0) { console.log("no missions"); return 0; }
    for (const m of all) console.log(`${m.status.padEnd(9)} ${m.id}`);
    return 0;
  }

  if (sub === "create") {
    const file = argValue(args, "--file");
    if (!file) { console.error("usage: litt mission create --file <mission.json>"); return 2; }
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(file, "utf-8")); }
    catch (e) { console.error(`cannot read ${file}: ${(e as Error).message}`); return 2; }
    const parsed = missionSchema.safeParse(raw);
    if (!parsed.success) {
      console.error(`invalid mission: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      return 2;
    }
    saveMission(workspace, parsed.data);
    const state = loadState(workspace, parsed.data.id);
    saveState(workspace, state);
    console.log(`mission ${parsed.data.id} created (${parsed.data.steps.length} steps)`);
    return 0;
  }

  if (sub === "start" || sub === "resume") {
    const id = argValue(args, "--id");
    if (!id) { console.error(`usage: litt mission ${sub} --id <id>`); return 2; }
    const mission = loadMission(workspace, id);
    if (!mission) { console.error(`mission ${id} not found`); return 2; }
    const result = await runMission(workspace, mission);
    printState(id, result.state, workspace);
    if (result.exitCode === 3) console.log("\nPARKED — owner action required. Resume with: litt mission resume --id " + id);
    return result.exitCode;
  }

  if (sub === "status") {
    const id = argValue(args, "--id");
    if (id) {
      printState(id, loadState(workspace, id), workspace);
      return 0;
    }
    return missionCommand(["list", ...args.slice(1)]);
  }

  console.error("usage: litt mission <create|start|resume|status|list>");
  return 2;
}
