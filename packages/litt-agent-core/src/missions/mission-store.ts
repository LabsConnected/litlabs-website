/**
 * Mission Store — LiTT Autopilot V1
 *
 * Persistent storage for missions using file-based persistence.
 */

import * as fs from "fs";
import * as path from "path";
import type { Mission, MissionStep, Checkpoint } from "./mission-entities.js";
import type { MissionStatus } from "./mission-types.js";
import { generateMissionId } from "./mission-types.js";

const MISSION_STORAGE_VERSION = "1.0.0";
const MISSIONS_DIR_NAME = ".litt";
const CHECKPOINT_KEY = "__active_mission_id";

/**
 * Fill in missing fields from a partially-parsed mission object.
 * Used by getMission, loadMissionWithRecovery, and recoverMissionFromBackup
 * to ensure the returned Mission always has all required fields, even if
 * the JSON on disk is missing some (e.g. older format or partial write).
 */
function normalizeMission(parsed: Partial<Mission>, fallbackId: string): Mission {
  return {
    id: parsed.id ?? fallbackId,
    version: parsed.version ?? MISSION_STORAGE_VERSION,
    goal: parsed.goal ?? "",
    normalizedGoal: parsed.normalizedGoal ?? "",
    projectRoot: parsed.projectRoot ?? "",
    workspaceId: parsed.workspaceId ?? null,
    sessionId: parsed.sessionId ?? null,
    mode: parsed.mode ?? "auto",
    status: parsed.status ?? "planning",
    createdAt: parsed.createdAt ?? new Date().toISOString(),
    updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    startedAt: parsed.startedAt ?? null,
    completedAt: parsed.completedAt ?? null,
    currentStepId: parsed.currentStepId ?? null,
    steps: parsed.steps ?? [],
    baseline: parsed.baseline ?? null,
    evidence: parsed.evidence ?? [],
    checkpoints: parsed.checkpoints ?? [],
    attemptCounters: parsed.attemptCounters ?? {},
    retryBudgets: parsed.retryBudgets ?? {},
    providerState: parsed.providerState ?? null,
    blockingReason: parsed.blockingReason ?? null,
    failureReason: parsed.failureReason ?? null,
    completionReason: parsed.completionReason ?? null,
    lastHeartbeatAt: parsed.lastHeartbeatAt ?? Date.now(),
    metadata: parsed.metadata ?? {},
  } as Mission;
}

export class MissionStore {
  private missionsDir: string;
  private activeMissionId: string | null = null;
  private readonly activeMissionMarkerPath: string;

  constructor(projectRoot: string) {
    this.missionsDir = path.join(projectRoot, MISSIONS_DIR_NAME);
    this.activeMissionMarkerPath = path.join(this.missionsDir, CHECKPOINT_KEY);
    this.ensureDir();
    // Hydrate active mission ID from durable marker if it exists
    this.activeMissionId = this.loadActiveMissionMarker();
  }

  /**
   * Ensure the missions directory exists.
   */
  private ensureDir(): void {
    if (!fs.existsSync(this.missionsDir)) {
      fs.mkdirSync(this.missionsDir, { recursive: true });
    }
  }

  /**
   * Load active mission ID from durable marker file.
   */
  private loadActiveMissionMarker(): string | null {
    if (!fs.existsSync(this.activeMissionMarkerPath)) {
      return null;
    }
    try {
      const content = fs.readFileSync(this.activeMissionMarkerPath, "utf-8");
      return content.trim() || null;
    } catch {
      // Ignore read errors
    }
    return null;
  }

  /**
   * Save active mission ID to durable marker file.
   */
  private saveActiveMissionMarker(id: string): void {
    try {
      fs.writeFileSync(this.activeMissionMarkerPath, id, "utf-8");
    } catch {
      // Failure to persist marker should not prevent operation
    }
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
      const parsed = JSON.parse(content) as Partial<Mission>;
      return normalizeMission(parsed, id);
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
      const offset = filter.offset ?? 0;
      missions = missions.slice(offset, offset + filter.limit);
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
    const backupPath = `${filePath}.backup`;

    // Backup contract: first save = main only, no backup.
    // Second+ save: copy existing main to .backup before atomic write.
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, backupPath);
    }

    fs.writeFileSync(tempPath, content, "utf-8");

    // Atomic rename: on POSIX this is atomic. On Windows, renameSync
    // can fail with EPERM if the target exists or is locked by another
    // process (antivirus, indexer, etc.). Retry a few times, then fall
    // back to a direct write if rename keeps failing.
    try {
      fs.renameSync(tempPath, filePath);
    } catch {
      // Retry with unlink + rename, or fall back to direct write
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        fs.renameSync(tempPath, filePath);
      } catch {
        // Last resort: write directly (not atomic, but preserves data)
        try {
          fs.writeFileSync(filePath, content, "utf-8");
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }
        } catch {
          // If even direct write fails, the temp file may still exist.
          // The backup file (if any) preserves the previous state.
        }
      }
    }
  }

  deleteMission(id: string): boolean {
    const filePath = this.missionFilePath(id);
    if (!fs.existsSync(filePath)) {
      return false;
    }

    fs.unlinkSync(filePath);
    try {
      fs.unlinkSync(`${filePath}.backup`);
    } catch {
      // Ignore backup cleanup errors
    }

    if (this.activeMissionId === id) {
      this.activeMissionId = null;
      try {
        fs.unlinkSync(this.activeMissionMarkerPath);
      } catch {
        // Marker might not exist
      }
    }

    return true;
  }

  hasMission(id: string): boolean {
    return fs.existsSync(this.missionFilePath(id));
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
    this.saveActiveMissionMarker(id);
    return true;
  }

  getActiveMissionId(): string | null {
    return this.activeMissionId;
  }

  clearActiveMission(): void {
    this.activeMissionId = null;
    try {
      fs.unlinkSync(this.activeMissionMarkerPath);
    } catch {
      // Marker file might not exist
    }
  }

  isActive(id: string): boolean {
    return this.activeMissionId === id;
  }

  /**
   * Load a mission with recovery support.
   * Handles corrupted files gracefully.
   */
  loadMissionWithRecovery(id: string): {
    recoveryAttempted: boolean;
    recovered: Mission | null;
    error?: { id: string; reason: "corrupted" | "missing" | "incomplete"; error?: string };
  } {
    const filePath = this.missionFilePath(id);
    const backupPath = `${filePath}.backup`;

    if (!fs.existsSync(filePath)) {
      if (fs.existsSync(backupPath)) {
        try {
          const content = fs.readFileSync(backupPath, "utf-8");
          const parsed = JSON.parse(content) as Partial<Mission>;
          if (parsed.id && parsed.version) {
            const normalized = normalizeMission(parsed, id);
            fs.copyFileSync(backupPath, filePath);
            return { recoveryAttempted: true, recovered: normalized };
          }
        } catch {}
      }
      return { recoveryAttempted: true, recovered: null, error: { id, reason: "missing" } };
    }

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(content) as Partial<Mission>;

      if (!parsed.id || !parsed.version || !parsed.createdAt) {
        const backup = this.recoverMissionFromBackup(id);
        if (backup) {
          return { recoveryAttempted: true, recovered: backup };
        }
        return {
          recoveryAttempted: true,
          recovered: null,
          error: { id, reason: "corrupted", error: "Missing required fields" },
        };
      }

      return { recoveryAttempted: true, recovered: normalizeMission(parsed, id) };
    } catch (err) {
      const backup = this.recoverMissionFromBackup(id);
      if (backup) {
        return { recoveryAttempted: true, recovered: backup };
      }
      return {
        recoveryAttempted: true,
        recovered: null,
        error: {
          id,
          reason: "corrupted",
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  /**
   * Recovery from backup file.
   */
  recoverMissionFromBackup(id: string): Mission | null {
    const filePath = this.missionFilePath(id);
    const backupPath = `${filePath}.backup`;

    if (!fs.existsSync(backupPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(backupPath, "utf-8");
      const parsed = JSON.parse(content) as Partial<Mission>;

      if (parsed.id && parsed.version) {
        const normalized = normalizeMission(parsed, id);
        fs.copyFileSync(backupPath, filePath);
        return normalized;
      }
    } catch {
      // Recovery failed
    }

    return null;
  }

  /**
   * Get all open (non-terminal) mission IDs for recovery.
   */
  getOpenMissionIds(): string[] {
    const openStatuses: MissionStatus[] = ["planning", "working", "verifying", "blocked"];
    const allMissions = this.listMissions();
    return allMissions.filter((m) => openStatuses.includes(m.status as MissionStatus)).map((m) => m.id);
  }

  /**
   * Get the latest checkpoint for a mission.
   */
  getLatestCheckpoint(missionId: string): Checkpoint | null {
    const mission = this.getMission(missionId);
    if (!mission?.checkpoints || mission.checkpoints.length === 0) {
      return null;
    }
    return mission.checkpoints[mission.checkpoints.length - 1] || null;
  }

  /**
   * Resume a mission from a checkpoint.
   */
  resumeFromCheckpoint(missionId: string, checkpointId: string): Mission | null {
    const mission = this.getMission(missionId);
    if (!mission) return null;

    const checkpoint = mission.checkpoints.find((cp) => cp.id === checkpointId);
    if (!checkpoint) return null;

    mission.currentStepId = checkpoint.stepId ?? checkpoint.resumePoint;
    mission.metadata = { ...mission.metadata, resumedFrom: checkpointId };

    this.saveMission(mission);
    return mission;
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