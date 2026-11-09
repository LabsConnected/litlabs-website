import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { missionSchema, missionStateSchema, type Mission, type MissionState } from "./contracts.js";

// Durable mission store — same atomic temp+rename discipline as
// .litt/repairs/<runId>/report.json. A killed process can never leave a
// half-written state file, and resume() reloads the last checkpoint.

const MISSIONS_DIR = join(".litt", "missions");

export function missionDir(workspace: string, id: string): string {
  return join(workspace, MISSIONS_DIR, id);
}

function atomicWrite(path: string, data: string): void {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, data, "utf-8");
  renameSync(tmp, path);
}

export function saveMission(workspace: string, mission: Mission): void {
  const dir = missionDir(workspace, mission.id);
  mkdirSync(dir, { recursive: true });
  atomicWrite(join(dir, "mission.json"), JSON.stringify(mission, null, 2));
}

export function loadMission(workspace: string, id: string): Mission | null {
  const path = join(missionDir(workspace, id), "mission.json");
  if (!existsSync(path)) return null;
  const parsed = missionSchema.safeParse(JSON.parse(readFileSync(path, "utf-8")));
  if (!parsed.success) throw new Error(`mission ${id}: invalid mission.json — ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}

export function saveState(workspace: string, state: MissionState): void {
  const dir = missionDir(workspace, state.missionId);
  mkdirSync(dir, { recursive: true });
  atomicWrite(join(dir, "state.json"), JSON.stringify(state, null, 2));
}

export function loadState(workspace: string, id: string): MissionState {
  const path = join(missionDir(workspace, id), "state.json");
  if (existsSync(path)) {
    const parsed = missionStateSchema.safeParse(JSON.parse(readFileSync(path, "utf-8")));
    if (parsed.success) return parsed.data;
  }
  return missionStateSchema.parse({ missionId: id });
}

export function listMissions(workspace: string): { id: string; status: string }[] {
  const root = join(workspace, MISSIONS_DIR);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ id: e.name, status: loadState(workspace, e.name).status }));
}
