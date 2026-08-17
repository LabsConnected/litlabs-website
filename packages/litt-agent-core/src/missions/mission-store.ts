/**
 * Mission Store — LiTT Autopilot V1
 *
 * Persistent storage for missions using file-based persistence.
 */

import * as fs from "fs";
import * as path from "path";
import type { Mission } from "./mission-entities.js";
import type { MissionStatus } from "./mission-types.js";
import { generateMissionId } from "./mission-types.js";

const MISSION_STORAGE_VERSION = "1.0.0";
const MISSIONS_DIR_NAME = ".litt";

export class MissionStore {
  private missionsDir: string;
  private activeMissionId: string | null = null;

  constructor(projectRoot: string) {
    this.missionsDir = path.join(projectRoot, MISSIONS_DIR_NAME);
  }

  createMission(params: {
    goal: string;
    mode: "plan" | "act" | "auto";
    sessionId: string | null;
    workspaceId: string | null;
    projectRoot: string;
    metadata?: Record<string, unknown>;
  }): Mission {
    const id = generateMissionId();
    const mission: Mission = {
      id,
      version: MISSION_STORAGE_VERSION,
      goal: params.goal,
      normalizedGoal: params.goal.trim().toLowerCase(),
      projectRoot: params.projectRoot,
      workspaceId: params.workspaceId,
      sessionId: params.sessionId,
      mode: params.mode,
      status: "planning",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      currentStepId: null,
      steps: [],
      baseline: null,
      evidence: [],
      checkpoints: [],
      attemptCounters: {},
      retryBudgets: {},
      providerState: null,
      blockingReason: null,
      failureReason: null,
      completionReason: null,
      lastHeartbeatAt: Date.now(),
      metadata: params.metadata ?? {},
    };

    this.saveMission(mission);
    return mission;
  }

  getMission(id: string): Mission | null {
    const filePath = this.missionFilePath(id);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content) as Mission;
    } catch {
      return null;
    }
  }

  listMissions(filter?: {
    status?: MissionStatus;
    limit?: number;
    offset?: number;
  }): Mission[] {
    if (!fs.existsSync(this.missionsDir)) {
      return [];
    }

    let missions: Mission[] = [];
    const files = fs.readdirSync(this.missionsDir);

    for (const file of files) {
      if (!file.endsWith(".json")) continue;

      const mission = this.getMission(file.replace(".json", ""));
      if (!mission) continue;

      if (filter?.status && mission.status !== filter.status) {
        continue;
      }

      missions.push(mission);
    }

    missions.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    if (filter?.limit) {
      missions = missions.slice(filter.offset ?? 0, filter.limit);
    }

    return missions;
  }

  updateMission(mission: Mission): void {
    mission.updatedAt = new Date().toISOString();
    this.saveMission(mission);
  }

  private saveMission(mission: Mission): void {
    if (!fs.existsSync(this.missionsDir)) {
      fs.mkdirSync(this.missionsDir, { recursive: true });
    }

    const content = JSON.stringify(mission, null, 2);
    const filePath = this.missionFilePath(mission.id);
    const tempPath = `${filePath}.tmp`;

    fs.writeFileSync(tempPath, content, "utf-8");
    fs.renameSync(tempPath, filePath);
  }

  deleteMission(id: string): boolean {
    const filePath = this.missionFilePath(id);
    if (!fs.existsSync(filePath)) {
      return false;
    }

    fs.unlinkSync(filePath);
    if (this.activeMissionId === id) {
      this.activeMissionId = null;
    }

    return true;
  }

  cancelMission(id: string, reason: string): Mission | null {
    const mission = this.getMission(id);
    if (!mission) return null;

    mission.status = "cancelled";
    mission.blockingReason = reason;
    mission.completedAt = new Date().toISOString();
    mission.updatedAt = new Date().toISOString();

    this.saveMission(mission);
    return mission;
  }

  setActiveMission(id: string): boolean {
    const existing = this.getMission(id);
    if (!existing) return false;

    this.activeMissionId = id;
    return true;
  }

  getActiveMissionId(): string | null {
    return this.activeMissionId;
  }

  clearActiveMission(): void {
    this.activeMissionId = null;
  }

  isActive(id: string): boolean {
    return this.activeMissionId === id;
  }

  private missionFilePath(id: string): string {
    return path.join(this.missionsDir, `${id}.json`);
  }

  getMissionsDir(): string {
    return this.missionsDir;
  }
}

export function createMissionStore(projectRoot: string): MissionStore {
  return new MissionStore(projectRoot);
}